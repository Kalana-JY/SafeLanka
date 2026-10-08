import DispatchOrder from '../models/DispatchOrder.js';
import Resource from '../models/Resource.js';
import { recordAudit } from '../utils/audit.js';

export const ACK_TIMEOUT_MS = Number(process.env.ACK_TIMEOUT_MS) || 5 * 60 * 1000;
export const RESERVE_HOLD_MS = Number(process.env.RESERVE_HOLD_MS) || 15 * 60 * 1000;

async function releaseOrderResources(order, actorId, why) {
  for (const item of order.items) {
    if (!item.resourceId || item.status !== 'RESERVED') continue;
    await Resource.updateOne(
      { _id: item.resourceId, status: { $in: ['RESERVED', 'DEPLOYED'] } },
      { $set: { status: 'AVAILABLE' } }
    );
    item.status = 'PENDING';
  }
  await order.save();
  recordAudit(actorId, 'DISPATCH_RELEASE', 'DispatchOrder', order._id.toString(), null, { why });
}

// Ack timeout: SENT + silence past ACK_TIMEOUT_MS => unassign, back to RESERVED.
// Assign moves the resource to DEPLOYED while the line stays RESERVED, so the
// resource has to be restored before the order is saved. A missing resource,
// or one no longer DEPLOYED, is left unchanged.
async function sweepAckTimeouts(now) {
  const stale = await DispatchOrder.find({ status: 'SENT', notifiedAt: { $lt: new Date(now - ACK_TIMEOUT_MS) } });
  for (const order of stale) {
    for (const item of order.items || []) {
      if (!item.resourceId || item.status !== 'RESERVED') continue;
      await Resource.updateOne(
        { _id: item.resourceId, status: 'DEPLOYED' },
        { $set: { status: 'RESERVED' } }
      );
    }
    order.teamLeadId = null;
    order.status = 'RESERVED';
    order.notifiedAt = null;
    order.unacked = true;
    await order.save();
    recordAudit('system', 'DISPATCH_ACK_TIMEOUT', 'DispatchOrder', order._id.toString());
  }
  return stale.length;
}

// Reserve hold: RESERVED past hold => release, back to CREATED for re-planning.
async function sweepReserveHolds(now) {
  const expired = await DispatchOrder.find({ status: 'RESERVED', reservationExpiresAt: { $lt: new Date(now) } });
  for (const order of expired) {
    await releaseOrderResources(order, 'system', 'reserve-hold-expired');
    order.status = 'CREATED';
    order.reservationExpiresAt = null;
    order.needsAttention = true;
    await order.save();
    recordAudit('system', 'DISPATCH_HOLD_EXPIRED', 'DispatchOrder', order._id.toString());
  }
  return expired.length;
}

export async function sweepDispatch() {
  const now = Date.now();
  const [ackTimedOut, holdsExpired] = await Promise.all([sweepAckTimeouts(now), sweepReserveHolds(now)]);
  return { ackTimedOut, holdsExpired };
}

export function startDispatchSweeps(intervalMs = 60000) {
  const timer = setInterval(() => {
    sweepDispatch().catch((err) => console.error('[dispatch-sweep]', err.message));
  }, intervalMs);
  timer.unref?.();
  return timer;
}
