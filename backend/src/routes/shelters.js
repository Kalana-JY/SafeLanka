import { Router } from 'express';
import { z } from 'zod';
import Shelter, { SHELTER_STATUS, occupancyStatus } from '../models/Shelter.js';
import Evacuee from '../models/Evacuee.js';
import EvacueeRecord from '../models/EvacueeRecord.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { validate } from '../middleware/validate.js';
import { recordAudit } from '../utils/audit.js';

const router = Router();
router.use(requireAuth);

const MANAGE = ['DISTRICT_OFFICER'];
const OPERATE = ['DISTRICT_OFFICER', 'WARDEN'];

const createSchema = z.object({
  buildingName: z.string().min(1).max(160),
  district: z.string().min(1).max(80),
  address: z.string().max(300).optional(),
  capacity: z.number().int().min(1),
  wardenId: z.string().optional(),
  eventId: z.string().optional()
});

const checkinSchema = z.object({
  name: z.string().min(1).max(120),
  contactNo: z.string().max(20).optional(),
  householdSize: z.number().int().min(1).default(1),
  specialNeeds: z.string().max(500).optional(),
  clientUUID: z.string().min(1).max(64)
});

// Nearest available shelter in the same district (most free space first).
export async function findAlternate(shelter) {
  const candidates = await Shelter.find({
    _id: { $ne: shelter._id },
    district: shelter.district,
    status: { $in: ['OPEN', 'NEARLY_FULL'] }
  });
  return candidates
    .map((s) => ({ shelter: s, free: s.capacity - s.occupancy }))
    .filter((c) => c.free > 0)
    .sort((a, b) => b.free - a.free)[0]?.shelter || null;
}

async function refreshStatus(shelter) {
  if (['PLANNED', 'CLOSED'].includes(shelter.status)) return shelter;
  shelter.status = occupancyStatus(shelter.occupancy, shelter.capacity);
  await shelter.save();
  return shelter;
}

function shelterView(shelter, extra = {}) {
  return {
    shelter,
    occupancy: shelter.occupancy,
    capacity: shelter.capacity,
    availableSpace: Math.max(0, shelter.capacity - shelter.occupancy),
    ...extra
  };
}

// --- CRUD ---

router.post('/shelters', requireRole(...MANAGE), validate(createSchema), async (req, res, next) => {
  try {
    const shelter = await Shelter.create(req.body);
    recordAudit(req.user._id.toString(), 'SHELTER_CREATE', 'Shelter', shelter._id.toString());
    res.status(201).json({ shelter });
  } catch (err) {
    next(err);
  }
});

router.get('/shelters', requireRole(...MANAGE), async (req, res, next) => {
  try {
    const filter = req.query.district ? { district: req.query.district } : {};
    res.json({ shelters: await Shelter.find(filter).sort({ createdAt: -1 }) });
  } catch (err) {
    next(err);
  }
});

// Citizen + staff view of open shelters (mobile Shelters list).
router.get('/shelters/open', async (req, res, next) => {
  try {
    const filter = { status: { $in: ['OPEN', 'NEARLY_FULL', 'FULL'] } };
    if (req.query.district) filter.district = req.query.district;
    const shelters = await Shelter.find(filter).sort({ status: 1 });
    res.json({ shelters: shelters.map((s) => shelterView(s)) });
  } catch (err) {
    next(err);
  }
});

router.get('/shelters/:id', async (req, res, next) => {
  try {
    const shelter = await Shelter.findById(req.params.id);
    if (!shelter) return res.status(404).json({ error: 'Shelter not found' });
    const activeRecords = await EvacueeRecord.find({ shelterId: shelter._id, checkOutAt: null }).populate('evacueeId');
    const specialNeedsCount = activeRecords.filter((r) => r.specialNeeds).length;
    res.json({ ...shelterView(shelter, { activeRecords, specialNeedsCount }) });
  } catch (err) {
    next(err);
  }
});

router.get('/shelters/:id/alternate', async (req, res, next) => {
  try {
    const shelter = await Shelter.findById(req.params.id);
    if (!shelter) return res.status(404).json({ error: 'Shelter not found' });
    const alternate = await findAlternate(shelter);
    if (!alternate) return res.status(404).json({ error: 'No alternate shelter with free space' });
    res.json({ alternate: shelterView(alternate) });
  } catch (err) {
    next(err);
  }
});

// --- lifecycle ---

router.post('/shelters/:id/open', requireRole(...MANAGE), async (req, res, next) => {
  try {
    const shelter = await Shelter.findById(req.params.id);
    if (!shelter) return res.status(404).json({ error: 'Shelter not found' });
    if (shelter.status !== 'PLANNED') return res.status(409).json({ error: `Only PLANNED shelters can be opened (is ${shelter.status})` });
    if (shelter.capacity < 1) return res.status(422).json({ error: 'Capacity must be set before opening' });
    shelter.status = 'OPEN';
    await shelter.save();
    recordAudit(req.user._id.toString(), 'SHELTER_OPEN', 'Shelter', shelter._id.toString());
    res.json({ shelter });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/shelters/:id/close',
  requireRole(...MANAGE),
  validate(z.object({ transferTo: z.string().optional() })),
  async (req, res, next) => {
    try {
      const shelter = await Shelter.findById(req.params.id);
      if (!shelter) return res.status(404).json({ error: 'Shelter not found' });
      if (shelter.status === 'CLOSED') return res.status(409).json({ error: 'Already closed' });

      const active = await EvacueeRecord.find({ shelterId: shelter._id, checkOutAt: null }).populate('evacueeId');
      if (active.length > 0) {
        if (!req.body.transferTo) {
          return res.status(422).json({ error: `Occupancy is ${shelter.occupancy}: check out or transfer before closing` });
        }
        const target = await Shelter.findById(req.body.transferTo);
        if (!target || !['OPEN', 'NEARLY_FULL'].includes(target.status)) {
          return res.status(422).json({ error: 'Transfer target must be an open shelter' });
        }
        const moving = active.reduce((n, r) => n + (r.evacueeId?.householdSize || 1), 0);
        if (target.capacity - target.occupancy < moving) {
          return res.status(422).json({ error: 'Transfer target has no space' });
        }
        await EvacueeRecord.updateMany({ shelterId: shelter._id, checkOutAt: null }, { $set: { shelterId: target._id } });
        shelter.occupancy = 0;
        target.occupancy += moving;
        await shelter.save();
        await refreshStatus(target);
      }
      shelter.status = 'CLOSED';
      await shelter.save();
      recordAudit(req.user._id.toString(), 'SHELTER_CLOSE', 'Shelter', shelter._id.toString(), null, {
        transferred: req.body.transferTo || null
      });
      res.json({ shelter });
    } catch (err) {
      next(err);
    }
  }
);

// --- check-in / check-out (idempotent on clientUUID) ---

router.post('/shelters/:id/checkin', requireRole(...OPERATE), validate(checkinSchema), async (req, res, next) => {
  try {
    const shelter = await Shelter.findById(req.params.id);
    if (!shelter) return res.status(404).json({ error: 'Shelter not found' });

    const existing = await EvacueeRecord.findOne({ clientUUID: req.body.clientUUID }).populate('evacueeId');
    if (existing) return res.json({ record: existing, deduped: true });

    if (!['OPEN', 'NEARLY_FULL'].includes(shelter.status)) {
      return res.status(409).json({ error: `Shelter is ${shelter.status} — cannot check in` });
    }
    if (shelter.capacity - shelter.occupancy < req.body.householdSize) {
      const alternate = await findAlternate(shelter);
      return res.status(409).json({ error: 'Shelter full', alternate });
    }

    const evacuee = await Evacuee.create({
      fullName: req.body.name,
      contactNo: req.body.contactNo,
      householdSize: req.body.householdSize
    });
    const record = await EvacueeRecord.create({
      evacueeId: evacuee._id,
      shelterId: shelter._id,
      specialNeeds: req.body.specialNeeds,
      clientUUID: req.body.clientUUID
    });
    shelter.occupancy += evacuee.householdSize;
    await refreshStatus(shelter);
    recordAudit(req.user._id.toString(), 'SHELTER_CHECKIN', 'EvacueeRecord', record._id.toString(), null, {
      shelter: shelter._id.toString(),
      specialNeeds: !!req.body.specialNeeds
    });
    res.status(201).json({ record: await record.populate('evacueeId'), ...shelterView(shelter), ...(shelter.status !== 'OPEN' ? { notice: `Shelter now ${shelter.status}` } : {}) });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/shelters/:id/checkout',
  requireRole(...OPERATE),
  validate(z.object({ recordId: z.string().min(1) })),
  async (req, res, next) => {
    try {
      const shelter = await Shelter.findById(req.params.id);
      if (!shelter) return res.status(404).json({ error: 'Shelter not found' });
      const record = await EvacueeRecord.findOne({ _id: req.body.recordId, shelterId: shelter._id }).populate('evacueeId');
      if (!record) return res.status(404).json({ error: 'Check-in record not found in this shelter' });
      if (record.checkOutAt) return res.status(409).json({ error: 'Already checked out' });
      record.checkOutAt = new Date();
      await record.save();
      shelter.occupancy = Math.max(0, shelter.occupancy - (record.evacueeId?.householdSize || 1));
      await refreshStatus(shelter);
      recordAudit(req.user._id.toString(), 'SHELTER_CHECKOUT', 'EvacueeRecord', record._id.toString());
      res.json({ record, ...shelterView(shelter) });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
