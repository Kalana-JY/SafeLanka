import { Router } from 'express';
import { z } from 'zod';
import Alert, { asLocalized } from '../models/Alert.js';
import DeliveryReceipt from '../models/DeliveryReceipt.js';
import HazardEvent, { WARNING_LEVELS, HAZARD_TYPES } from '../models/HazardEvent.js';
import TargetArea, { areaDistricts, normalizeDistrictList } from '../models/TargetArea.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { validate } from '../middleware/validate.js';
import { summarizeReach } from '../utils/geo.js';
import { recordAudit } from '../utils/audit.js';
import {
  AlertRuleError,
  cancelAlert,
  createDraft,
  expireDueAlerts,
  publishAlert,
  reissueAlert,
  retryFailedDeliveries
} from '../services/alertService.js';

const router = Router();
router.use(requireAuth);

// A string is English only. An object may carry en, si, and ta. Drafts may omit a language.
const localizedField = z
  .union([
    z.string(),
    z.object({
      en: z.string().optional(),
      si: z.string().optional(),
      ta: z.string().optional()
    })
  ])
  .transform((v) => asLocalized(v))
  .refine((v) => v.en || v.si || v.ta, { message: 'Required' });

const createAlertSchema = z.object({
  eventId: z.string().min(1),
  targetAreaId: z.string().min(1),
  level: z.enum(WARNING_LEVELS),
  headline: localizedField,
  body: localizedField,
  expiresAt: z.string().datetime()
});

function sendServiceError(err, res, next) {
  if (err instanceof AlertRuleError) {
    return res.status(err.status).json({ error: err.message, ...(err.details || {}) });
  }
  return next(err);
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

// reach: eligible recipients. excluded: active citizens/volunteers in the area who opted out.
// districts[].eligible sums to reach. languages (en/si/ta, invalid counts as en) also sum to reach.
router.get('/areas/:id/reach', async (req, res, next) => {
  try {
    const area = await TargetArea.findById(req.params.id);
    if (!area) return res.status(404).json({ error: 'TargetArea not found' });
    const summary = await summarizeReach(areaDistricts(area));
    res.json({ ...summary, district: area.district, estPopulation: area.estPopulation });
  } catch (err) {
    next(err);
  }
});

router.get('/areas', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.eventId) filter.eventId = req.query.eventId;
    if (req.query.district) {
      filter.$or = [{ district: req.query.district }, { districts: req.query.district }];
    }
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
      district: z.string().optional(),
      districts: z.array(z.string()).optional(),
      eventId: z.string().min(1),
      polygon: z.string().optional(),
      estPopulation: z.number().int().min(0).default(0)
    })
  ),
  async (req, res, next) => {
    try {
      const normalized = normalizeDistrictList(req.body);
      if (normalized.error) return res.status(422).json({ error: normalized.error });
      const event = await HazardEvent.findById(req.body.eventId);
      if (!event) return res.status(404).json({ error: 'HazardEvent not found' });
      const area = await TargetArea.create({
        name: req.body.name,
        eventId: req.body.eventId,
        polygon: req.body.polygon,
        estPopulation: req.body.estPopulation,
        districts: normalized.districts,
        district: normalized.districts[0]
      });
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
    const result = await createDraft({
      eventId,
      targetAreaId,
      level,
      headline,
      body,
      expiresAt,
      actorId: req.user._id
    });
    res.status(201).json(result);
  } catch (err) {
    sendServiceError(err, res, next);
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
      .populate('targetAreaId', 'name district districts')
      .sort({ publishedAt: -1 });
    const district = req.query.district;
    res.json({
      alerts: district ? alerts.filter((a) => areaDistricts(a.targetAreaId).includes(district)) : alerts
    });
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
      const result = await publishAlert(req.params.id, {
        actorId: req.user._id,
        secondConfirmedBy: req.body.secondConfirmedBy,
        simulateFailure: req.body.simulateFailure
      });
      res.json(result);
    } catch (err) {
      sendServiceError(err, res, next);
    }
  }
);

router.post(
  '/alerts/:id/cancel',
  requireRole('DMC_OFFICER'),
  validate(z.object({ reason: z.string().min(1) })),
  async (req, res, next) => {
    try {
      const result = await cancelAlert(req.params.id, { reason: req.body.reason, actorId: req.user._id });
      res.json(result);
    } catch (err) {
      sendServiceError(err, res, next);
    }
  }
);

router.post('/alerts/:id/retry', requireRole('DMC_OFFICER'), async (req, res, next) => {
  try {
    const result = await retryFailedDeliveries(req.params.id, { actorId: req.user._id });
    res.json(result);
  } catch (err) {
    sendServiceError(err, res, next);
  }
});

router.post(
  '/alerts/:id/reissue',
  requireRole('DMC_OFFICER'),
  validate(
    z.object({
      level: z.enum(WARNING_LEVELS).optional(),
      headline: localizedField.optional(),
      body: localizedField.optional(),
      expiresAt: z.string().datetime()
    })
  ),
  async (req, res, next) => {
    try {
      const result = await reissueAlert(req.params.id, {
        level: req.body.level,
        headline: req.body.headline,
        body: req.body.body,
        expiresAt: req.body.expiresAt,
        actorId: req.user._id
      });
      res.status(201).json(result);
    } catch (err) {
      sendServiceError(err, res, next);
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
