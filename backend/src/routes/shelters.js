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

// Set status from the occupancy currently stored. The update matches that
// occupancy, so a concurrent check-in is not overwritten with a stale status.
async function syncOpenStatus(shelterId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await Shelter.findById(shelterId);
    if (!current || ['PLANNED', 'CLOSED'].includes(current.status)) return current;
    const status = occupancyStatus(current.occupancy, current.capacity);
    const updated = await Shelter.findOneAndUpdate(
      { _id: shelterId, occupancy: current.occupancy, status: { $nin: ['PLANNED', 'CLOSED'] } },
      { $set: { status } },
      { returnDocument: 'after' }
    );
    if (updated) return updated;
  }
  return Shelter.findById(shelterId);
}

function isDuplicateKey(err) {
  return err?.code === 11000;
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

    const householdSize = req.body.householdSize;
    const claimed = await Shelter.findOneAndUpdate(
      {
        _id: shelter._id,
        status: { $in: ['OPEN', 'NEARLY_FULL'] },
        $expr: { $lte: [{ $add: ['$occupancy', householdSize] }, '$capacity'] }
      },
      { $inc: { occupancy: householdSize } },
      { returnDocument: 'after' }
    );
    if (!claimed) {
      const current = await Shelter.findById(shelter._id);
      if (!current) return res.status(404).json({ error: 'Shelter not found' });
      if (!['OPEN', 'NEARLY_FULL'].includes(current.status)) {
        return res.status(409).json({ error: `Shelter is ${current.status} — cannot check in` });
      }
      const alternate = await findAlternate(current);
      return res.status(409).json({ error: 'Shelter full', alternate });
    }

    let evacuee = null;
    let record;
    try {
      evacuee = await Evacuee.create({
        fullName: req.body.name,
        contactNo: req.body.contactNo,
        householdSize
      });
      record = await EvacueeRecord.create({
        evacueeId: evacuee._id,
        shelterId: shelter._id,
        specialNeeds: req.body.specialNeeds,
        clientUUID: req.body.clientUUID
      });
    } catch (err) {
      if (evacuee) await Evacuee.deleteOne({ _id: evacuee._id });
      await Shelter.updateOne(
        { _id: shelter._id, occupancy: { $gte: householdSize } },
        { $inc: { occupancy: -householdSize } }
      );
      await syncOpenStatus(shelter._id);
      if (isDuplicateKey(err)) {
        const dup = await EvacueeRecord.findOne({ clientUUID: req.body.clientUUID }).populate('evacueeId');
        if (dup) return res.json({ record: dup, deduped: true });
      }
      throw err;
    }

    await syncOpenStatus(shelter._id);
    const fresh = await Shelter.findById(shelter._id);
    recordAudit(req.user._id.toString(), 'SHELTER_CHECKIN', 'EvacueeRecord', record._id.toString(), null, {
      shelter: shelter._id.toString(),
      specialNeeds: !!req.body.specialNeeds
    });
    res.status(201).json({
      record: await record.populate('evacueeId'),
      ...shelterView(fresh),
      ...(fresh.status !== 'OPEN' ? { notice: `Shelter now ${fresh.status}` } : {})
    });
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
      const record = await EvacueeRecord.findOneAndUpdate(
        { _id: req.body.recordId, shelterId: shelter._id, checkOutAt: null },
        { $set: { checkOutAt: new Date() } },
        { returnDocument: 'after' }
      ).populate('evacueeId');
      if (!record) {
        const existing = await EvacueeRecord.findOne({ _id: req.body.recordId, shelterId: shelter._id });
        if (!existing) return res.status(404).json({ error: 'Check-in record not found in this shelter' });
        return res.status(409).json({ error: 'Already checked out' });
      }
      const size = record.evacueeId?.householdSize || 1;
      // Subtract only while the counter still contains this household.
      // A missed match leaves occupancy as it is, including any newer check-in.
      await Shelter.findOneAndUpdate(
        { _id: shelter._id, occupancy: { $gte: size } },
        { $inc: { occupancy: -size } },
        { returnDocument: 'after' }
      );
      await syncOpenStatus(shelter._id);
      const fresh = await Shelter.findById(shelter._id);
      recordAudit(req.user._id.toString(), 'SHELTER_CHECKOUT', 'EvacueeRecord', record._id.toString());
      res.json({ record, ...shelterView(fresh) });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
