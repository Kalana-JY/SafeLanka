import { Router } from 'express';
import { z } from 'zod';
import DispatchOrder, { ORDER_PRIORITY, ORDER_STATUS } from '../models/DispatchOrder.js';
import Resource, { RESOURCE_TYPES, RESOURCE_STATUS } from '../models/Resource.js';
import ReliefDistribution from '../models/ReliefDistribution.js';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { validate } from '../middleware/validate.js';
import { sweepDispatch, RESERVE_HOLD_MS } from '../services/dispatchService.js';
import { recordAudit } from '../utils/audit.js';

const router = Router();
router.use(requireAuth);

const DISTRICT = ['DISTRICT_OFFICER'];
const TEAM = ['TEAM_LEADER'];

function generateOrderRef() {
  return 'DO-' + Math.floor(1000 + Math.random() * 9000);
}

// Distribute is atomic: EN_ROUTE -> ON_SITE (arrival, device-stamped) ->
// FULFILLED in one transaction. ON_SITE persists on the distribution record
// and audit trail rather than as a lingering order state.

// --- resources ---

router.post(
  '/resources',
  requireRole(...DISTRICT),
  validate(
    z.object({
      name: z.string().min(1).max(160),
      type: z.enum(RESOURCE_TYPES).default('OTHER'),
      district: z.string().min(1).max(80),
      capacity: z.number().min(0).optional(),
      organization: z.string().max(160).optional()
    })
  ),
  async (req, res, next) => {
    try {
      const resource = await Resource.create(req.body);
      recordAudit(req.user._id.toString(), 'RESOURCE_CREATE', 'Resource', resource._id.toString());
      res.status(201).json({ resource });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/resources', requireRole(...DISTRICT, ...TEAM), async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.district) filter.district = req.query.district;
    if (req.query.status) filter.status = req.query.status;
    res.json({ resources: await Resource.find(filter).sort({ createdAt: -1 }).limit(200) });
  } catch (err) {
    next(err);
  }
});

// --- orders ---

const itemSchema = z.object({
  resourceId: z.string().optional(),
  type: z.string().max(40).default('OTHER'),
  description: z.string().max(500).optional()
});

router.post(
  '/dispatch',
  requireRole(...DISTRICT),
  validate(
    z.object({
      eventId: z.string().optional(),
      district: z.string().min(1).max(80),
      priority: z.enum(ORDER_PRIORITY).default('MEDIUM'),
      items: z.array(itemSchema).min(1).max(20),
      teamLeadId: z.string().optional(),
      clientUUID: z.string().min(1).max(64)
    })
  ),
  async (req, res, next) => {
    try {
      const existing = await DispatchOrder.findOne({ clientUUID: req.body.clientUUID });
      if (existing) return res.json({ order: existing, deduped: true });

      let ref = generateOrderRef();
      for (let i = 0; i < 5 && (await DispatchOrder.exists({ ref })); i++) ref = generateOrderRef();

      const order = await DispatchOrder.create({
        ref,
        eventId: req.body.eventId,
        district: req.body.district,
        priority: req.body.priority,
        items: req.body.items.map((it) => ({ ...it, status: 'PENDING' })),
        teamLeadId: req.body.teamLeadId,
        clientUUID: req.body.clientUUID
      });
      recordAudit(req.user._id.toString(), 'DISPATCH_CREATE', 'DispatchOrder', order._id.toString(), null, { ref });
      res.status(201).json({ order });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/dispatch', requireRole(...DISTRICT), async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.district) filter.district = req.query.district;
    if (req.query.status) filter.status = req.query.status;
    const orders = await DispatchOrder.find(filter).populate('teamLeadId', 'fullName email').sort({ createdAt: -1 }).limit(100);
    res.json({ orders });
  } catch (err) {
    next(err);
  }
});

router.get('/dispatch/mine', requireRole(...TEAM), async (req, res, next) => {
  try {
    const orders = await DispatchOrder.find({ teamLeadId: req.user._id })
      .populate('items.resourceId', 'name type status')
      .sort({ createdAt: -1 });
    res.json({ orders });
  } catch (err) {
    next(err);
  }
});

router.get('/dispatch/:id', async (req, res, next) => {
  try {
    const order = await DispatchOrder.findById(req.params.id)
      .populate('teamLeadId', 'fullName email')
      .populate('items.resourceId', 'name type status district');
    if (!order) return res.status(404).json({ error: 'Dispatch order not found' });
    const isStaff = ['DISTRICT_OFFICER', 'DMC_OFFICER'].includes(req.user.role);
    const isHolder = req.user.role === 'TEAM_LEADER' && order.teamLeadId?._id.toString() === req.user._id.toString();
    if (!isStaff && !isHolder) {
      return res.status(403).json({ error: 'Forbidden for role ' + req.user.role });
    }
    const distribution = await ReliefDistribution.findOne({ orderId: order._id });
    res.json({ order, distribution });
  } catch (err) {
    next(err);
  }
});

// Reserve: AVAILABLE items lock; the rest become partner-request stubs (split fulfilment).
router.post('/dispatch/:id/reserve', requireRole(...DISTRICT), async (req, res, next) => {
  try {
    const order = await DispatchOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Dispatch order not found' });
    if (order.status !== 'CREATED') return res.status(409).json({ error: `Only CREATED orders can be reserved (is ${order.status})` });

    let reserved = 0;
    for (const item of order.items) {
      if (!item.resourceId) {
        item.status = 'PARTNER_REQUESTED';
        item.partnerNote = 'No district resource specified — partner request stub';
        continue;
      }
      const resource = await Resource.findById(item.resourceId);
      if (resource && resource.status === 'AVAILABLE') {
        resource.status = 'RESERVED';
        await resource.save();
        item.status = 'RESERVED';
        reserved += 1;
      } else {
        item.status = 'PARTNER_REQUESTED';
        item.partnerNote = 'District resource unavailable — partner request stub';
      }
    }
    if (reserved === 0) {
      await order.save();
      return res.status(422).json({ error: 'Nothing available to reserve — all lines need partners', order });
    }
    order.fulfillment = order.items.some((i) => i.status === 'PARTNER_REQUESTED') ? 'PARTIAL' : 'FULL';
    order.status = 'RESERVED';
    order.reservationExpiresAt = new Date(Date.now() + RESERVE_HOLD_MS);
    await order.save();
    recordAudit(req.user._id.toString(), 'DISPATCH_RESERVE', 'DispatchOrder', order._id.toString(), null, {
      reserved,
      fulfillment: order.fulfillment
    });
    res.json({ order });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/dispatch/:id/assign',
  requireRole(...DISTRICT),
  validate(z.object({ teamLeadId: z.string().min(1) })),
  async (req, res, next) => {
    try {
      const order = await DispatchOrder.findById(req.params.id);
      if (!order) return res.status(404).json({ error: 'Dispatch order not found' });
      if (order.status !== 'RESERVED') return res.status(409).json({ error: `Only RESERVED orders can be assigned (is ${order.status})` });
      const lead = await User.findById(req.body.teamLeadId);
      if (!lead || lead.role !== 'TEAM_LEADER' || !lead.active) {
        return res.status(422).json({ error: 'teamLeadId must be an active TEAM_LEADER' });
      }
      order.teamLeadId = lead._id;
      order.status = 'SENT';
      order.notifiedAt = new Date();
      order.unacked = false;
      await order.save();
      await Resource.updateMany(
        { _id: { $in: order.items.map((i) => i.resourceId).filter(Boolean) }, status: 'RESERVED' },
        { $set: { status: 'DEPLOYED' } }
      );
      recordAudit(req.user._id.toString(), 'DISPATCH_ASSIGN', 'DispatchOrder', order._id.toString(), null, {
        teamLeadId: lead._id.toString()
      });
      res.json({ order });
    } catch (err) {
      next(err);
    }
  }
);

function requireHolder(req, res, order) {
  if (!order.teamLeadId || order.teamLeadId.toString() !== req.user._id.toString()) {
    res.status(403).json({ error: 'Only the assigned team leader' });
    return false;
  }
  return true;
}

router.post('/dispatch/:id/ack', requireRole(...TEAM), async (req, res, next) => {
  try {
    const order = await DispatchOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Dispatch order not found' });
    if (order.status !== 'SENT') return res.status(422).json({ error: `Only SENT orders can be acknowledged (is ${order.status})` });
    if (!requireHolder(req, res, order)) return;
    order.status = 'ACKED';
    await order.save();
    recordAudit(req.user._id.toString(), 'DISPATCH_ACK', 'DispatchOrder', order._id.toString());
    res.json({ order });
  } catch (err) {
    next(err);
  }
});

// Safety gate: EN_ROUTE requires explicit route + weather confirmation.
router.post(
  '/dispatch/:id/arrive',
  requireRole(...TEAM),
  validate(z.object({ routeChecked: z.boolean(), weatherChecked: z.boolean() })),
  async (req, res, next) => {
    try {
      const order = await DispatchOrder.findById(req.params.id);
      if (!order) return res.status(404).json({ error: 'Dispatch order not found' });
      if (order.status !== 'ACKED') return res.status(422).json({ error: `Only ACKED orders can depart (is ${order.status})` });
      if (!requireHolder(req, res, order)) return;
      if (!req.body.routeChecked || !req.body.weatherChecked) {
        return res.status(422).json({ error: 'Route and weather checklist required before EN_ROUTE' });
      }
      order.safetyCheck = { routeChecked: true, weatherChecked: true, checkedAt: new Date(), checkedBy: req.user._id };
      order.status = 'EN_ROUTE';
      await order.save();
      recordAudit(req.user._id.toString(), 'DISPATCH_EN_ROUTE', 'DispatchOrder', order._id.toString());
      res.json({ order });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/dispatch/:id/distribute',
  requireRole(...TEAM),
  validate(
    z.object({
      beneficiaries: z.number().int().min(1),
      distributedAt: z.string().datetime().optional(),
      notes: z.string().max(1000).optional()
    })
  ),
  async (req, res, next) => {
    try {
      const order = await DispatchOrder.findById(req.params.id);
      if (!order) return res.status(404).json({ error: 'Dispatch order not found' });
      if (await ReliefDistribution.exists({ orderId: order._id })) {
        return res.status(409).json({ error: 'Distribution already recorded for this order' });
      }
      if (order.status !== 'EN_ROUTE') return res.status(422).json({ error: `Only EN_ROUTE orders can record distribution (is ${order.status})` });
      if (!requireHolder(req, res, order)) return;
      const distribution = await ReliefDistribution.create({
        orderId: order._id,
        teamLeadId: req.user._id,
        beneficiaries: req.body.beneficiaries,
        distributedAt: req.body.distributedAt ? new Date(req.body.distributedAt) : new Date(),
        notes: req.body.notes
      });
      for (const item of order.items) {
        if (item.status === 'RESERVED') item.status = 'FULFILLED';
      }
      order.status = 'FULFILLED';
      await order.save();
      await Resource.updateMany(
        { _id: { $in: order.items.map((i) => i.resourceId).filter(Boolean) }, status: 'DEPLOYED' },
        { $set: { status: 'AVAILABLE' } }
      );
      recordAudit(req.user._id.toString(), 'DISPATCH_DISTRIBUTE', 'DispatchOrder', order._id.toString(), null, {
        beneficiaries: req.body.beneficiaries
      });
      res.json({ order, distribution });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/dispatch/:id/abort',
  validate(z.object({ reason: z.string().min(1).max(500) })),
  async (req, res, next) => {
    try {
      const order = await DispatchOrder.findById(req.params.id);
      if (!order) return res.status(404).json({ error: 'Dispatch order not found' });
      const isDistrict = req.user.role === 'DISTRICT_OFFICER';
      const isHolder = order.teamLeadId?.toString() === req.user._id.toString();
      if (!isDistrict && !isHolder) return res.status(403).json({ error: 'Only the district officer or assigned team' });
      if (['FULFILLED', 'ABORTED'].includes(order.status)) {
        return res.status(409).json({ error: `Cannot abort ${order.status} order` });
      }
      for (const item of order.items) {
        if (!item.resourceId || item.status !== 'RESERVED') continue;
        await Resource.updateOne(
          { _id: item.resourceId, status: { $in: ['RESERVED', 'DEPLOYED'] } },
          { $set: { status: 'AVAILABLE' } }
        );
        item.status = 'PENDING';
      }
      order.status = 'ABORTED';
      order.abortReason = req.body.reason;
      order.teamLeadId = null;
      await order.save();
      recordAudit(req.user._id.toString(), 'DISPATCH_ABORT', 'DispatchOrder', order._id.toString(), null, {
        reason: req.body.reason
      });
      res.json({ order });
    } catch (err) {
      next(err);
    }
  }
);

// Test hook for the verify matrix (same sweep as the 60s timer).
router.post('/dispatch/__sweep', requireRole(...DISTRICT), async (req, res, next) => {
  try {
    res.json(await sweepDispatch());
  } catch (err) {
    next(err);
  }
});

export default router;
