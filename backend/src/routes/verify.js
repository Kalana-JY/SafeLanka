import { Router } from 'express';
import { z } from 'zod';
import GroundReport from '../models/GroundReport.js';
import Evidence from '../models/Evidence.js';
import HazardEvent, { LEVEL_RANK } from '../models/HazardEvent.js';
import VerificationRecord, { VERIFY_DECISIONS } from '../models/VerificationRecord.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { validate } from '../middleware/validate.js';
import { recordAudit } from '../utils/audit.js';

const router = Router();
router.use(requireAuth);

const LOCK_LEASE_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 30 * 60 * 1000;

const verifySchema = z.object({
  decision: z.enum(VERIFY_DECISIONS),
  score: z.number().min(0).max(100),
  remarks: z.string().min(1).max(2000),
  escalate: z.enum(['WARNING', 'EVACUATE']).optional(),
  sensorStationId: z.string().max(80).optional(),
  sensorReadAt: z.string().datetime().optional(),
  secondReportIds: z.array(z.string()).max(10).default([])
});

function lockHeldBy(report, userId) {
  return (
    report.lockedBy &&
    report.lockedBy.toString() === userId.toString() &&
    report.lockedUntil &&
    report.lockedUntil > new Date()
  );
}

// POST /api/reports/:id/lock — 5-min pessimistic lease. Second officer → 423.
router.post('/reports/:id/lock', requireRole('DMC_OFFICER'), async (req, res, next) => {
  try {
    const report = await GroundReport.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (report.lockedBy && report.lockedUntil > new Date() && report.lockedBy.toString() !== req.user._id.toString()) {
      return res.status(423).json({ error: 'Locked by another officer', lockedBy: report.lockedBy, lockedUntil: report.lockedUntil });
    }
    report.lockedBy = req.user._id;
    report.lockedUntil = new Date(Date.now() + LOCK_LEASE_MS);
    await report.save();
    res.json({ lockedBy: report.lockedBy, lockedUntil: report.lockedUntil });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/reports/:id/lock — holder-only release (expiry covers abandonment).
router.delete('/reports/:id/lock', requireRole('DMC_OFFICER'), async (req, res, next) => {
  try {
    const report = await GroundReport.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (!report.lockedBy) return res.json({ released: false });
    if (report.lockedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only the lock holder can release' });
    }
    report.lockedBy = null;
    report.lockedUntil = null;
    await report.save();
    res.json({ released: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/reports/:id/verify — requires the caller's lock (423 otherwise).
router.post('/reports/:id/verify', requireRole('DMC_OFFICER'), validate(verifySchema), async (req, res, next) => {
  try {
    const report = await GroundReport.findById(req.params.id).populate('reporterId', 'fullName email role district');
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(report.status)) {
      return res.status(409).json({ error: `Report already ${report.status}` });
    }
    if (!lockHeldBy(report, req.user._id)) {
      return res.status(423).json({ error: 'Acquire the lock before verifying', lockedBy: report.lockedBy, lockedUntil: report.lockedUntil });
    }

    const { decision, score, remarks, escalate, sensorStationId, sensorReadAt, secondReportIds } = req.body;

    // Stale-sensor rule (usecase.md UC-03 rule 5): no fresh reading => cap 60 + note.
    const readAt = sensorReadAt ? new Date(sensorReadAt) : null;
    const sensorStale = !readAt || Date.now() - readAt.getTime() > STALE_AFTER_MS;
    if (sensorStale) {
      if (score > 60) return res.status(422).json({ error: 'Stale sensor: score capped at 60' });
      if (!/STALE_SENSOR/i.test(remarks)) {
        return res.status(422).json({ error: 'Stale sensor: remarks must note STALE_SENSOR' });
      }
    }

    // Two-source rule (usecase.md UC-03 rule 1) for escalation.
    const sources = [];
    const photoCount = await Evidence.countDocuments({ reportId: report._id, mediaType: 'PHOTO' });
    if (photoCount > 0) sources.push('photo');
    if (!sensorStale && sensorStationId) sources.push('sensor');
    if (secondReportIds.length > 0) {
      const found = await GroundReport.countDocuments({ _id: { $in: secondReportIds } });
      if (found !== secondReportIds.length) return res.status(422).json({ error: 'Unknown secondReportIds' });
      sources.push('second_report');
    }
    if (report.reporterId?.role === 'VOLUNTEER') sources.push('volunteer');

    if (escalate && decision !== 'VERIFIED') {
      return res.status(422).json({ error: 'Escalation requires a VERIFIED decision' });
    }
    if (escalate && sources.length < 2) {
      return res.status(422).json({ error: 'Escalation needs ≥2 corroborating sources', sources });
    }

    const record = await VerificationRecord.create({
      reportId: report._id,
      officerId: req.user._id,
      decision,
      score,
      remarks,
      sensorStationId,
      sensorReadAt: readAt,
      sensorStale,
      sources
    });

    report.status = decision;
    report.lockedBy = null;
    report.lockedUntil = null;
    await report.save();

    let event = null;
    if (escalate) {
      const district = report.reporterId?.district || 'Ratnapura';
      event =
        (await HazardEvent.find({ status: 'ACTIVE', district, hazardType: report.hazardType }).sort({ createdAt: -1 }).limit(1))[0] ||
        (await HazardEvent.create({ name: `Auto: ${report.hazardType} in ${district}`, hazardType: report.hazardType, district, level: 'WATCH', createdBy: req.user._id }));
      if (LEVEL_RANK[escalate] > LEVEL_RANK[event.level]) event.level = escalate;
      await event.save();
      record.escalatedTo = escalate;
      record.eventId = event._id;
      await record.save();
    }

    recordAudit(req.user._id.toString(), 'REPORT_VERIFY', 'GroundReport', report._id.toString(), null, {
      decision,
      score,
      sources,
      escalatedTo: escalate || null
    });
    res.json({ record, report, sources, event });
  } catch (err) {
    next(err);
  }
});

export default router;
