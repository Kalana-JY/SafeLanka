import { Router } from 'express';
import { z } from 'zod';
import Alert from '../models/Alert.js';
import DeliveryReceipt from '../models/DeliveryReceipt.js';
import HazardEvent, { WARNING_LEVELS, HAZARD_TYPES } from '../models/HazardEvent.js';
import TargetArea from '../models/TargetArea.js';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { validate } from '../middleware/validate.js';
import { countRecipients } from '../utils/geo.js';
import { broadcastAlert, applyLevelToEvent, expireDueAlerts } from '../services/alertService.js';
import { recordAudit } from '../utils/audit.js';

const router = Router();
router.use(requireAuth);

const langRecord = z.object({ si: z.string().default(''), ta: z.string().default(''), en: z.string().default('') });

const createAlertSchema = z.object({
  eventId: z.string().min(1),
  targetAreaId: z.string().min(1),
  level: z.enum(WARNING_LEVELS),
  headline: langRecord,
  body: langRecord,
  expiresAt: z.string().datetime()
});

function checkExpiry(expiresAt) {
  const exp = new Date(expiresAt);
  if (Number.isNaN(exp.getTime())) return 'expiresAt must be a valid datetime';
  if (exp <= new Date()) return 'expiresAt must be in the future';
  if (exp - new Date() > 12 * 3600 * 1000) return 'expiresAt must be within 12h (usecase.md UC-01 rule 1)';
  return null;
}

async function loadArea(areaId) {
  const area = await TargetArea.findById(areaId);
  return area;
}

// Overlap guard (v1 simplification, documented): same event + same district +
// an already PUBLISHED alert that has not expired => treated as >30% overlap.
async function findOverlap(eventId, district, excludeId = null) {
  const candidates = await Alert.find({
    eventId,
    status: 'PUBLISHED',
    expiresAt: { $gt: new Date() },
    ...(excludeId ? { _id: { $ne: excludeId } } : {})
  }).populate('targetAreaId', 'district');
  return candidates.find((a) => a.targetAreaId?.district === district) || null;
}

// --- events + areas (DMC manages; read for all staff in later steps) ---

router.post(
  '/events',
  requireRole('DMC_OFFICER'),
  validate(z.object({ name: z.string().min(1), hazardType: z.enum(HAZARD_TYPES), district: z.string().min(1) })),
  async (req, res, next) => {
    try {
      const event = await HazardEvent.create({ ...req.body, createdBy: req.user._id });
      recordAudit(req.user._id.toString(), 'EVENT_CREATE', 'HazardEvent', event._id.toString());
      res.status(201).json({ event });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/events', async (req, res, next) => {
  try {
    const filter = req.query.district ? { district: req.query.district } : {};
    res.json({ events: await HazardEvent.find(filter).sort({ createdAt: -1 }) });
  } catch (err) {
    next(err);
  }
});

router.get('/areas/:id/reach', async (req, res, next) => {
  try {
    const area = await TargetArea.findById(req.params.id);
    if (!area) return res.status(404).json({ error: 'TargetArea not found' });
    const reach = await countRecipients(area.district);
    res.json({ reach, district: area.district, estPopulation: area.estPopulation });
  } catch (err) {
    next(err);
  }
});

router.get('/areas', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.eventId) filter.eventId = req.query.eventId;
    if (req.query.district) filter.district = req.query.district;
    res.json({ areas: await TargetArea.find(filter).sort({ createdAt: -1 }) });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/areas',
  requireRole('DMC_OFFICER'),
  validate(
    z.object({
      name: z.string().min(1),
      district: z.string().min(1),
      eventId: z.string().min(1),
      polygon: z.string().optional(),
      estPopulation: z.number().int().min(0).default(0)
    })
  ),
  async (req, res, next) => {
    try {
      const event = await HazardEvent.findById(req.body.eventId);
      if (!event) return res.status(404).json({ error: 'HazardEvent not found' });
      const area = await TargetArea.create(req.body);
      res.status(201).json({ area });
    } catch (err) {
      next(err);
    }
  }
);

// --- alerts ---

router.post('/alerts', requireRole('DMC_OFFICER'), validate(createAlertSchema), async (req, res, next) => {
  try {
    const { eventId, targetAreaId, level, headline, body, expiresAt } = req.body;
    const expiryErr = checkExpiry(expiresAt);
    if (expiryErr) return res.status(422).json({ error: expiryErr });

    const event = await HazardEvent.findById(eventId);
    if (!event || event.status !== 'ACTIVE') return res.status(404).json({ error: 'Active HazardEvent not found' });
    const area = await loadArea(targetAreaId);
    if (!area || area.eventId.toString() !== eventId) {
      return res.status(404).json({ error: 'TargetArea not found for this event' });
    }

    const alert = await Alert.create({
      eventId,
      targetAreaId,
      level,
      headline,
      body,
      expiresAt,
      createdBy: req.user._id
    });
    recordAudit(req.user._id.toString(), 'ALERT_DRAFT', 'Alert', alert._id.toString());
    const reach = await countRecipients(area.district);
    res.status(201).json({ alert, reach });
  } catch (err) {
    next(err);
  }
});

router.get('/alerts', requireRole('DMC_OFFICER'), async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const alerts = await Alert.find(filter).sort({ createdAt: -1 }).limit(100);
    res.json({ alerts });
  } catch (err) {
    next(err);
  }
});

// Active public feed: all authenticated roles (citizen home, staff dashboards).
router.get('/alerts/active', async (req, res, next) => {
  try {
    const alerts = await Alert.find({ status: 'PUBLISHED', expiresAt: { $gt: new Date() } })
      .populate('targetAreaId', 'name district')
      .sort({ publishedAt: -1 });
    const district = req.query.district;
    res.json({ alerts: district ? alerts.filter((a) => a.targetAreaId?.district === district) : alerts });
  } catch (err) {
    next(err);
  }
});

router.get('/alerts/:id', requireRole('DMC_OFFICER'), async (req, res, next) => {
  try {
    const alert = await Alert.findById(req.params.id).populate('targetAreaId');
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    const failed = await DeliveryReceipt.countDocuments({ alertId: alert._id, state: 'FAILED' });
    res.json({ alert, failedReceipts: failed });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/alerts/:id/publish',
  requireRole('DMC_OFFICER'),
  validate(z.object({ secondConfirmedBy: z.string().optional(), simulateFailure: z.array(z.enum(['SMS', 'PUSH', 'SIREN'])).optional() })),
  async (req, res, next) => {
    try {
      const alert = await Alert.findById(req.params.id).populate('targetAreaId');
      if (!alert) return res.status(404).json({ error: 'Alert not found' });
      if (alert.status !== 'DRAFT') return res.status(409).json({ error: `Only DRAFT alerts can be published (is ${alert.status})` });
      if (!alert.isComplete()) {
        return res.status(422).json({ error: 'Publish blocked: headline and body required in si, ta and en' });
      }
      const expiryErr = checkExpiry(alert.expiresAt);
      if (expiryErr) return res.status(422).json({ error: expiryErr });

      if (alert.level === 'EVACUATE') {
        const { secondConfirmedBy } = req.body;
        if (!secondConfirmedBy) {
          return res.status(422).json({ error: 'EVACUATE requires second officer confirmation (maker-checker)' });
        }
        const second = await User.findById(secondConfirmedBy);
        if (!second || second.role !== 'DMC_OFFICER' || second._id.toString() === req.user._id.toString()) {
          return res.status(422).json({ error: 'secondConfirmedBy must be a different active DMC officer' });
        }
        alert.secondConfirmedBy = second._id;
      }

      const district = alert.targetAreaId.district;
      const overlap = await findOverlap(alert.eventId.toString(), district, alert._id);
      if (overlap) {
        return res.status(409).json({ error: 'Overlapping active alert exists for this event+district', conflictingAlertId: overlap._id });
      }

      alert.status = 'PUBLISHED';
      alert.publishedAt = new Date();
      await alert.save();

      const event = await HazardEvent.findById(alert.eventId);
      if (event) await applyLevelToEvent(event, alert.level);

      const summary = await broadcastAlert(alert, {
        district,
        simulateFailure: req.body.simulateFailure,
        actorId: req.user._id.toString()
      });
      recordAudit(req.user._id.toString(), 'ALERT_PUBLISH', 'Alert', alert._id.toString(), { status: 'DRAFT' }, { status: 'PUBLISHED', version: alert.version });
      res.json({ alert, summary });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/alerts/:id/cancel',
  requireRole('DMC_OFFICER'),
  validate(z.object({ reason: z.string().min(1) })),
  async (req, res, next) => {
    try {
      const alert = await Alert.findById(req.params.id);
      if (!alert) return res.status(404).json({ error: 'Alert not found' });
      if (!['DRAFT', 'PUBLISHED'].includes(alert.status)) {
        return res.status(409).json({ error: `Cannot cancel alert in status ${alert.status}` });
      }
      alert.status = 'CANCELLED';
      alert.cancelledReason = req.body.reason;
      await alert.save();
      recordAudit(req.user._id.toString(), 'ALERT_CANCEL', 'Alert', alert._id.toString(), null, { reason: req.body.reason });
      res.json({ alert });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/alerts/:id/retry', requireRole('DMC_OFFICER'), async (req, res, next) => {
  try {
    const alert = await Alert.findById(req.params.id);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    const res2 = await DeliveryReceipt.updateMany(
      { alertId: alert._id, state: 'FAILED' },
      { $set: { state: 'DELIVERED', sentAt: new Date() } }
    );
    const [attempted, delivered, failed] = await Promise.all([
      DeliveryReceipt.countDocuments({ alertId: alert._id }),
      DeliveryReceipt.countDocuments({ alertId: alert._id, state: 'DELIVERED' }),
      DeliveryReceipt.countDocuments({ alertId: alert._id, state: 'FAILED' })
    ]);
    const perChannel = await DeliveryReceipt.aggregate([
      { $match: { alertId: alert._id } },
      { $group: { _id: '$channel', attempted: { $sum: 1 }, delivered: { $sum: { $cond: [{ $eq: ['$state', 'DELIVERED'] }, 1, 0] } } } }
    ]);
    alert.delivery = {
      attempted,
      delivered,
      failed,
      perChannel: perChannel.map((c) => ({ channel: c._id, attempted: c.attempted, delivered: c.delivered, failed: c.attempted - c.delivered }))
    };
    await alert.save();
    recordAudit(req.user._id.toString(), 'ALERT_RETRY', 'Alert', alert._id.toString(), null, { retried: res2.modifiedCount });
    res.json({ alert, retried: res2.modifiedCount });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/alerts/:id/reissue',
  requireRole('DMC_OFFICER'),
  validate(
    z.object({
      level: z.enum(WARNING_LEVELS).optional(),
      headline: langRecord.optional(),
      body: langRecord.optional(),
      expiresAt: z.string().datetime()
    })
  ),
  async (req, res, next) => {
    try {
      const prev = await Alert.findById(req.params.id);
      if (!prev) return res.status(404).json({ error: 'Alert not found' });
      if (prev.status !== 'PUBLISHED') return res.status(409).json({ error: 'Only PUBLISHED alerts can be reissued' });
      const expiryErr = checkExpiry(req.body.expiresAt);
      if (expiryErr) return res.status(422).json({ error: expiryErr });

      prev.status = 'CANCELLED';
      prev.cancelledReason = 'superseded by reissue';
      await prev.save();

      const next1 = await Alert.create({
        eventId: prev.eventId,
        targetAreaId: prev.targetAreaId,
        version: prev.version + 1,
        level: req.body.level || prev.level,
        headline: req.body.headline || prev.headline,
        body: req.body.body || prev.body,
        expiresAt: req.body.expiresAt,
        createdBy: req.user._id,
        previousAlertId: prev._id
      });
      recordAudit(req.user._id.toString(), 'ALERT_REISSUE', 'Alert', next1._id.toString(), { version: prev.version }, { version: next1.version });
      res.status(201).json({ alert: next1, previousAlertId: prev._id });
    } catch (err) {
      next(err);
    }
  }
);

// Test hook for the verify matrix (calls the same job function as the 60s timer).
router.post('/alerts/__expire-now', requireRole('DMC_OFFICER'), async (req, res, next) => {
  try {
    res.json({ expired: await expireDueAlerts() });
  } catch (err) {
    next(err);
  }
});

export default router;
