import { Router } from 'express';
import { z } from 'zod';
import GroundReport from '../models/GroundReport.js';
import Evidence, { MEDIA_TYPES } from '../models/Evidence.js';
import { HAZARD_TYPES } from '../models/HazardEvent.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { validate } from '../middleware/validate.js';
import { distanceM } from '../utils/geo.js';
import { scoreCredibility, generateReportRef } from '../utils/credibility.js';
import { recordAudit } from '../utils/audit.js';

const router = Router();
router.use(requireAuth);

const CITIZEN_ROLES = ['CITIZEN', 'VOLUNTEER'];
const REPORT_LIMIT_PER_HOUR = 5;
const DUPE_RADIUS_M = 500;
const DUPE_WINDOW_HOURS = 6;

const submitSchema = z.object({
  hazardType: z.enum(HAZARD_TYPES),
  description: z.string().min(1).max(2000),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  mediaType: z.enum(MEDIA_TYPES).default('PHOTO'),
  evidenceBase64: z.string().max(50000000).optional(),
  clientUUID: z.string().min(1).max(64)
});

async function evidenceFor(reportId) {
  return Evidence.find({ reportId }).sort({ createdAt: 1 });
}

// POST /api/reports — idempotent on clientUUID: a retry returns the original.
router.post('/reports', requireRole(...CITIZEN_ROLES), validate(submitSchema), async (req, res, next) => {
  try {
    const { hazardType, description, lat, lng, mediaType, evidenceBase64, clientUUID } = req.body;

    const existing = await GroundReport.findOne({ clientUUID });
    if (existing) {
      const evidence = await evidenceFor(existing._id);
      return res.json({ report: existing, evidence, deduped: true });
    }

    const hourAgo = new Date(Date.now() - 3600 * 1000);
    const recentCount = await GroundReport.countDocuments({ reporterId: req.user._id, createdAt: { $gte: hourAgo } });
    if (recentCount >= REPORT_LIMIT_PER_HOUR) {
      return res.status(429).json({ error: 'Report limit reached (5/hour). Try again later.' });
    }

    const hasEvidence = !!evidenceBase64;
    const { score, reasons, nearSensor } = scoreCredibility({ role: req.user.role, hasEvidence, lat, lng });

    // Dedupe hint: same type within 500m in the last 6h. Advisory only — still creates.
    const windowStart = new Date(Date.now() - DUPE_WINDOW_HOURS * 3600 * 1000);
    const candidates = await GroundReport.find({ hazardType, createdAt: { $gte: windowStart } }).select('_id ref lat lng');
    const possibleDuplicateOf = candidates
      .map((c) => ({ id: c._id, ref: c.ref, distanceM: Math.round(distanceM(lat, lng, c.lat, c.lng)) }))
      .filter((c) => c.distanceM <= DUPE_RADIUS_M);

    let ref = generateReportRef();
    for (let i = 0; i < 5 && (await GroundReport.exists({ ref })); i++) ref = generateReportRef();

    const report = await GroundReport.create({
      ref,
      reporterId: req.user._id,
      hazardType,
      description,
      lat,
      lng,
      status: hasEvidence ? 'SUBMITTED' : 'UNDER_REVIEW',
      credibility: score,
      sensorCorroborated: nearSensor,
      clientUUID
    });

    let evidence = [];
    if (hasEvidence) {
      const doc = await Evidence.create({
        reportId: report._id,
        mediaType,
        data: evidenceBase64,
        sizeKb: Math.round(Buffer.byteLength(evidenceBase64, 'utf8') / 1024)
      });
      evidence = [doc.toJSON()];
    }

    recordAudit(req.user._id.toString(), 'REPORT_SUBMIT', 'GroundReport', report._id.toString(), null, {
      ref,
      credibility: score,
      reasons
    });
    res.status(201).json({ report, evidence, credibilityReasons: reasons, possibleDuplicateOf });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/mine — citizen's own reports with evidence metadata.
router.get('/reports/mine', requireRole(...CITIZEN_ROLES), async (req, res, next) => {
  try {
    const reports = await GroundReport.find({ reporterId: req.user._id }).sort({ createdAt: -1 });
    const withEvidence = await Promise.all(
      reports.map(async (r) => ({ report: r, evidence: await evidenceFor(r._id) }))
    );
    res.json({ reports: withEvidence });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/notifications — status updates and progress alerts for reporter
router.get('/reports/notifications', requireRole(...CITIZEN_ROLES), async (req, res, next) => {
  try {
    const reports = await GroundReport.find({ reporterId: req.user._id }).sort({ updatedAt: -1, createdAt: -1 });
    const notifications = reports.map((r) => {
      let type = 'UNDER_REVIEW';
      let title = 'Report Under Review';
      let message = `Your ${r.hazardType} report (${r.ref}) has been submitted and is in the DMC Duty Officer queue.`;

      if (r.status === 'VERIFIED') {
        type = 'ACCEPTED';
        title = 'Report Accepted';
        message = `Good news! Your ${r.hazardType} report (${r.ref}) has been verified by the DMC Duty Officer and published to Community Reports.`;
      } else if (r.status === 'REJECTED') {
        type = 'REJECTED';
        title = 'Report Unverified';
        message = `Your ${r.hazardType} report (${r.ref}) was reviewed by the DMC Duty Officer and could not be verified.`;
      }

      return {
        id: `${r._id}-${r.status}`,
        reportId: r._id,
        ref: r.ref,
        hazardType: r.hazardType,
        status: r.status,
        type,
        title,
        message,
        timestamp: r.updatedAt || r.createdAt
      };
    });

    res.json({ notifications });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/queue — ordered severity×credibility×age + SLA flag (UC-03).
const SEVERITY_W = { TSUNAMI: 4, FLOOD: 3, LANDSLIDE: 3, CYCLONE: 2, OTHER: 1 };
const SLA_MIN = 15;
router.get('/reports/queue', requireRole('DMC_OFFICER'), async (req, res, next) => {
  try {
    const reports = await GroundReport.find({ status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] } })
      .populate('reporterId', 'fullName email role district')
      .limit(200);
    const now = Date.now();
    const ranked = reports.map((r) => {
      const waitingMin = Math.floor((now - r.createdAt.getTime()) / 60000);
      const slaBreached = waitingMin > SLA_MIN;
      const rank = (SEVERITY_W[r.hazardType] || 1) * r.credibility + waitingMin;
      return { report: r, waitingMin, slaBreached, rank };
    });
    ranked.sort((a, b) => b.rank - a.rank);
    res.json({ queue: ranked });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/community — all reports accepted/verified by DMC duty officers
router.get('/reports/community', async (req, res, next) => {
  try {
    const reports = await GroundReport.find({ status: 'VERIFIED' })
      .populate('reporterId', 'fullName district')
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(100);
    const withEvidence = await Promise.all(
      reports.map(async (r) => ({
        report: r,
        evidence: await evidenceFor(r._id)
      }))
    );
    res.json({ reports: withEvidence });
  } catch (err) {
    next(err);
  }
});

// POST /api/reports/:id/evidence — add evidence (photos, voice) to an existing report
router.post(
  '/reports/:id/evidence',
  validate(
    z.object({
      mediaType: z.enum(MEDIA_TYPES).default('PHOTO'),
      evidenceBase64: z.string().max(50000000)
    })
  ),
  async (req, res, next) => {
    try {
      const report = await GroundReport.findById(req.params.id);
      if (!report) return res.status(404).json({ error: 'Report not found' });
      const { mediaType, evidenceBase64 } = req.body;
      const doc = await Evidence.create({
        reportId: report._id,
        mediaType,
        data: evidenceBase64,
        sizeKb: Math.round(Buffer.byteLength(evidenceBase64, 'utf8') / 1024)
      });
      res.status(201).json({ evidence: doc.toJSON() });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/reports/:id — owner or DMC. Includes evidence payload for review.
router.get('/reports/:id', async (req, res, next) => {
  try {
    const report = await GroundReport.findById(req.params.id).populate('reporterId', 'fullName email role');
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const isOwner = report.reporterId._id.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'DMC_OFFICER') {
      return res.status(403).json({ error: 'Forbidden for role ' + req.user.role });
    }
    const evidence = await Evidence.find({ reportId: report._id }).select('+data').sort({ createdAt: 1 });
    res.json({ report, evidence });
  } catch (err) {
    next(err);
  }
});

export default router;
