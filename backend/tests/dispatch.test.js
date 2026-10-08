import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import DispatchOrder from '../src/models/DispatchOrder.js';
import ReliefDistribution from '../src/models/ReliefDistribution.js';
import Resource from '../src/models/Resource.js';
import { sweepDispatch } from '../src/services/dispatchService.js';
import { api, createUser, resetDb, startTestServer, stopTestServer, tokenFor } from './helpers.js';

before(startTestServer, { timeout: 120_000 });
after(stopTestServer);
beforeEach(resetDb);

async function officer(role, district = 'Ratnapura') {
  const user = await createUser({ role, district });
  return { user, token: tokenFor(user) };
}

async function addResource(token, name = 'Kuruwita rescue team') {
  const res = await api('/api/resources', {
    method: 'POST',
    token,
    body: { name, type: 'TEAM', district: 'Ratnapura' }
  });
  assert.equal(res.status, 201);
  return res.data.resource;
}

async function createOrder(token, resourceId, description = 'Rescue team to Kuruwita') {
  const res = await api('/api/dispatch', {
    method: 'POST',
    token,
    body: {
      district: 'Ratnapura',
      priority: 'HIGH',
      items: [{ resourceId, type: 'TEAM', description }],
      clientUUID: `ord-${Math.random().toString(36).slice(2, 12)}`
    }
  });
  assert.equal(res.status, 201);
  return res.data.order;
}

async function toAcked(districtToken, leader) {
  const resource = await addResource(districtToken);
  const order = await createOrder(districtToken, resource._id);
  const reserved = await api(`/api/dispatch/${order._id}/reserve`, { method: 'POST', token: districtToken, body: {} });
  assert.equal(reserved.status, 200);
  const assigned = await api(`/api/dispatch/${order._id}/assign`, {
    method: 'POST',
    token: districtToken,
    body: { teamLeadId: leader.user._id.toString() }
  });
  assert.equal(assigned.status, 200);
  const acked = await api(`/api/dispatch/${order._id}/ack`, { method: 'POST', token: leader.token, body: {} });
  assert.equal(acked.status, 200);
  return { resource, orderId: order._id };
}

test('a valid dispatch order can be created', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const resource = await addResource(district.token);
  const order = await createOrder(district.token, resource._id);
  assert.equal(order.status, 'CREATED');
  assert.equal(order.priority, 'HIGH');
  assert.equal(order.district, 'Ratnapura');
  assert.match(order.ref, /^DO-\d{4}$/);
  assert.equal(order.items[0].status, 'PENDING');
});

test('an available resource can be reserved', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const resource = await addResource(district.token);
  const order = await createOrder(district.token, resource._id);
  const reserved = await api(`/api/dispatch/${order._id}/reserve`, { method: 'POST', token: district.token, body: {} });
  assert.equal(reserved.status, 200);
  assert.equal(reserved.data.order.status, 'RESERVED');
  assert.equal(reserved.data.order.fulfillment, 'FULL');
  assert.equal(reserved.data.order.items[0].status, 'RESERVED');
  const stored = await Resource.findById(resource._id);
  assert.equal(stored.status, 'RESERVED');
});

test('a resource that is already reserved cannot be reserved by a second order', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const resource = await addResource(district.token);
  const first = await createOrder(district.token, resource._id, 'first');
  const second = await createOrder(district.token, resource._id, 'second');
  assert.equal((await api(`/api/dispatch/${first._id}/reserve`, { method: 'POST', token: district.token, body: {} })).status, 200);
  const again = await api(`/api/dispatch/${second._id}/reserve`, { method: 'POST', token: district.token, body: {} });
  assert.equal(again.status, 422);
  assert.match(again.data.error, /Nothing available/);
  assert.equal(again.data.order.status, 'CREATED');
  assert.equal(again.data.order.items[0].status, 'PARTNER_REQUESTED');
  const stored = await Resource.findById(resource._id);
  assert.equal(stored.status, 'RESERVED');
  assert.equal(await Resource.countDocuments({ status: 'RESERVED' }), 1);
});

test('two concurrent reserves of one resource succeed only once', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const resource = await addResource(district.token);
  const first = await createOrder(district.token, resource._id, 'left');
  const second = await createOrder(district.token, resource._id, 'right');
  const [a, b] = await Promise.all([
    api(`/api/dispatch/${first._id}/reserve`, { method: 'POST', token: district.token, body: {} }),
    api(`/api/dispatch/${second._id}/reserve`, { method: 'POST', token: district.token, body: {} })
  ]);
  const statuses = [a.status, b.status].sort((x, y) => x - y);
  assert.deepEqual(statuses, [200, 422]);
  const winner = a.status === 200 ? a : b;
  const loser = a.status === 422 ? a : b;
  assert.equal(winner.data.order.status, 'RESERVED');
  assert.equal(winner.data.order.items[0].status, 'RESERVED');
  assert.equal(loser.data.order.status, 'CREATED');
  assert.equal(loser.data.order.items[0].status, 'PARTNER_REQUESTED');
  assert.match(loser.data.error, /Nothing available/);
  const storedWinner = await DispatchOrder.findById(winner.data.order._id);
  const storedLoser = await DispatchOrder.findById(loser.data.order._id);
  assert.equal(storedWinner.status, 'RESERVED');
  assert.equal(storedWinner.items[0].status, 'RESERVED');
  assert.equal(storedLoser.status, 'CREATED');
  assert.equal(storedLoser.items[0].status, 'PARTNER_REQUESTED');
  assert.equal((await Resource.findById(resource._id)).status, 'RESERVED');
  assert.equal(await Resource.countDocuments({ status: 'RESERVED' }), 1);
});

test('a failed order save releases the resource claimed by that reserve', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const resource = await addResource(district.token);
  const order = await createOrder(district.token, resource._id);
  const originalSave = DispatchOrder.prototype.save;
  DispatchOrder.prototype.save = async function failReserveSave() {
    throw new Error('reserve save failed');
  };
  try {
    const res = await api(`/api/dispatch/${order._id}/reserve`, { method: 'POST', token: district.token, body: {} });
    assert.equal(res.status, 500);
    assert.equal(res.data.error, 'Internal server error');
  } finally {
    DispatchOrder.prototype.save = originalSave;
  }
  const storedOrder = await DispatchOrder.findById(order._id);
  assert.equal(storedOrder.status, 'CREATED');
  assert.equal(storedOrder.items[0].status, 'PENDING');
  assert.equal(storedOrder.reservationExpiresAt ?? null, null);
  assert.equal(storedOrder.teamLeadId ?? null, null);
  assert.equal((await Resource.findById(resource._id)).status, 'AVAILABLE');
  assert.equal(await Resource.countDocuments({ status: 'RESERVED' }), 0);
  assert.equal(await Resource.countDocuments({ status: 'DEPLOYED' }), 0);
});

test('acknowledging an order that was never sent is rejected', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const leader = await officer('TEAM_LEADER');
  const resource = await addResource(district.token);
  const order = await createOrder(district.token, resource._id);
  const res = await api(`/api/dispatch/${order._id}/ack`, { method: 'POST', token: leader.token, body: {} });
  assert.equal(res.status, 422);
  assert.match(res.data.error, /Only SENT/);
  const stored = await DispatchOrder.findById(order._id);
  assert.equal(stored.status, 'CREATED');
});

test('abort from RESERVED releases the resource', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const resource = await addResource(district.token);
  const order = await createOrder(district.token, resource._id);
  await api(`/api/dispatch/${order._id}/reserve`, { method: 'POST', token: district.token, body: {} });
  const aborted = await api(`/api/dispatch/${order._id}/abort`, {
    method: 'POST',
    token: district.token,
    body: { reason: 'Road is unsafe' }
  });
  assert.equal(aborted.status, 200);
  assert.equal(aborted.data.order.status, 'ABORTED');
  assert.equal(aborted.data.order.abortReason, 'Road is unsafe');
  const stored = await Resource.findById(resource._id);
  assert.equal(stored.status, 'AVAILABLE');
});

test('abort after assignment releases a DEPLOYED resource', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const leader = await officer('TEAM_LEADER');
  const resource = await addResource(district.token);
  const order = await createOrder(district.token, resource._id);
  await api(`/api/dispatch/${order._id}/reserve`, { method: 'POST', token: district.token, body: {} });
  await api(`/api/dispatch/${order._id}/assign`, {
    method: 'POST',
    token: district.token,
    body: { teamLeadId: leader.user._id.toString() }
  });
  assert.equal((await Resource.findById(resource._id)).status, 'DEPLOYED');
  const aborted = await api(`/api/dispatch/${order._id}/abort`, {
    method: 'POST',
    token: district.token,
    body: { reason: 'No longer required' }
  });
  assert.equal(aborted.status, 200);
  assert.equal(aborted.data.order.status, 'ABORTED');
  assert.equal((await Resource.findById(resource._id)).status, 'AVAILABLE');
});

test('ack timeout returns the order to RESERVED and does not leave resources DEPLOYED', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const leader = await officer('TEAM_LEADER');
  const resource = await addResource(district.token);
  const order = await createOrder(district.token, resource._id);
  await api(`/api/dispatch/${order._id}/reserve`, { method: 'POST', token: district.token, body: {} });
  await api(`/api/dispatch/${order._id}/assign`, {
    method: 'POST',
    token: district.token,
    body: { teamLeadId: leader.user._id.toString() }
  });
  await DispatchOrder.updateOne(
    { _id: order._id },
    { notifiedAt: new Date(Date.now() - 10 * 60 * 1000) }
  );
  const sweep = await api('/api/dispatch/__sweep', { method: 'POST', token: district.token, body: {} });
  assert.equal(sweep.status, 200);
  assert.equal(sweep.data.ackTimedOut, 1);
  const storedOrder = await DispatchOrder.findById(order._id);
  assert.equal(storedOrder.status, 'RESERVED');
  assert.equal(storedOrder.teamLeadId, null);
  assert.equal(storedOrder.unacked, true);
  const storedResource = await Resource.findById(resource._id);
  assert.equal(storedResource.status, 'RESERVED');
});

test('assign cannot leave a resource DEPLOYED after acknowledgement timeout reverts the order', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const leader = await officer('TEAM_LEADER');
  const resource = await addResource(district.token);
  const order = await createOrder(district.token, resource._id);
  assert.equal((await api(`/api/dispatch/${order._id}/reserve`, { method: 'POST', token: district.token, body: {} })).status, 200);
  const originalSave = DispatchOrder.prototype.save;
  let armed = true;
  DispatchOrder.prototype.save = async function sweepOnSent(...args) {
    const result = await originalSave.apply(this, args);
    if (armed && this.status === 'SENT') {
      armed = false;
      await DispatchOrder.updateOne(
        { _id: this._id },
        { notifiedAt: new Date(Date.now() - 10 * 60 * 1000) }
      );
      await sweepDispatch();
    }
    return result;
  };
  try {
    const assigned = await api(`/api/dispatch/${order._id}/assign`, {
      method: 'POST',
      token: district.token,
      body: { teamLeadId: leader.user._id.toString() }
    });
    assert.equal(assigned.status, 200);
  } finally {
    DispatchOrder.prototype.save = originalSave;
  }
  const storedOrder = await DispatchOrder.findById(order._id);
  assert.equal(storedOrder.status, 'RESERVED');
  assert.equal(storedOrder.teamLeadId, null);
  assert.equal(storedOrder.unacked, true);
  assert.equal(storedOrder.items[0].status, 'RESERVED');
  assert.equal((await Resource.findById(resource._id)).status, 'RESERVED');
  assert.equal(await Resource.countDocuments({ status: 'DEPLOYED' }), 0);
});

test('a failed assign save does not leave the resource DEPLOYED', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const leader = await officer('TEAM_LEADER');
  const resource = await addResource(district.token);
  const order = await createOrder(district.token, resource._id);
  assert.equal((await api(`/api/dispatch/${order._id}/reserve`, { method: 'POST', token: district.token, body: {} })).status, 200);
  const originalSave = DispatchOrder.prototype.save;
  DispatchOrder.prototype.save = async function failAssignSave(...args) {
    if (this.status === 'SENT') throw new Error('assign save failed');
    return originalSave.apply(this, args);
  };
  try {
    const assigned = await api(`/api/dispatch/${order._id}/assign`, {
      method: 'POST',
      token: district.token,
      body: { teamLeadId: leader.user._id.toString() }
    });
    assert.equal(assigned.status, 500);
    assert.equal(assigned.data.error, 'Internal server error');
  } finally {
    DispatchOrder.prototype.save = originalSave;
  }
  const storedOrder = await DispatchOrder.findById(order._id);
  assert.equal(storedOrder.status, 'RESERVED');
  assert.equal(storedOrder.teamLeadId ?? null, null);
  assert.equal(storedOrder.notifiedAt ?? null, null);
  assert.equal(storedOrder.items[0].status, 'RESERVED');
  assert.equal((await Resource.findById(resource._id)).status, 'RESERVED');
  assert.equal(await Resource.countDocuments({ status: 'DEPLOYED' }), 0);
});

test('ack timeout does not overwrite a resource that is no longer DEPLOYED', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const leader = await officer('TEAM_LEADER');
  const resource = await addResource(district.token);
  const other = await addResource(district.token, 'Unrelated deployed team');
  const order = await createOrder(district.token, resource._id);
  await api(`/api/dispatch/${order._id}/reserve`, { method: 'POST', token: district.token, body: {} });
  await api(`/api/dispatch/${order._id}/assign`, {
    method: 'POST',
    token: district.token,
    body: { teamLeadId: leader.user._id.toString() }
  });
  await Resource.updateOne({ _id: resource._id }, { status: 'MAINTENANCE' });
  await Resource.updateOne({ _id: other._id }, { status: 'DEPLOYED' });
  await DispatchOrder.updateOne(
    { _id: order._id },
    { notifiedAt: new Date(Date.now() - 10 * 60 * 1000) }
  );
  const sweep = await api('/api/dispatch/__sweep', { method: 'POST', token: district.token, body: {} });
  assert.equal(sweep.status, 200);
  assert.equal(sweep.data.ackTimedOut, 1);
  const storedOrder = await DispatchOrder.findById(order._id);
  assert.equal(storedOrder.status, 'RESERVED');
  assert.equal(storedOrder.teamLeadId, null);
  assert.equal(storedOrder.unacked, true);
  assert.equal((await Resource.findById(resource._id)).status, 'MAINTENANCE');
  assert.equal((await Resource.findById(other._id)).status, 'DEPLOYED');
});

test('ack timeout still returns the order when its resource is missing', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const leader = await officer('TEAM_LEADER');
  const resource = await addResource(district.token);
  const order = await createOrder(district.token, resource._id);
  await api(`/api/dispatch/${order._id}/reserve`, { method: 'POST', token: district.token, body: {} });
  await api(`/api/dispatch/${order._id}/assign`, {
    method: 'POST',
    token: district.token,
    body: { teamLeadId: leader.user._id.toString() }
  });
  await Resource.deleteOne({ _id: resource._id });
  await DispatchOrder.updateOne(
    { _id: order._id },
    { notifiedAt: new Date(Date.now() - 10 * 60 * 1000) }
  );
  const sweep = await api('/api/dispatch/__sweep', { method: 'POST', token: district.token, body: {} });
  assert.equal(sweep.status, 200);
  assert.equal(sweep.data.ackTimedOut, 1);
  const storedOrder = await DispatchOrder.findById(order._id);
  assert.equal(storedOrder.status, 'RESERVED');
  assert.equal(storedOrder.teamLeadId, null);
  assert.equal(storedOrder.unacked, true);
  assert.equal(storedOrder.items[0].status, 'RESERVED');
  assert.equal(await Resource.findById(resource._id), null);
  assert.equal(await Resource.countDocuments({ status: 'DEPLOYED' }), 0);
});

test('departure without both safety checks is rejected and the order stays ACKED', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const leader = await officer('TEAM_LEADER');
  const { orderId } = await toAcked(district.token, leader);
  const res = await api(`/api/dispatch/${orderId}/arrive`, {
    method: 'POST',
    token: leader.token,
    body: { routeChecked: false, weatherChecked: true }
  });
  assert.equal(res.status, 422);
  assert.match(res.data.error, /Route and weather/);
  assert.equal((await DispatchOrder.findById(orderId)).status, 'ACKED');
});

test('a valid distribution records beneficiaries and fulfils the order', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const leader = await officer('TEAM_LEADER');
  const { resource, orderId } = await toAcked(district.token, leader);
  const departed = await api(`/api/dispatch/${orderId}/arrive`, {
    method: 'POST',
    token: leader.token,
    body: { routeChecked: true, weatherChecked: true }
  });
  assert.equal(departed.status, 200);
  assert.equal(departed.data.order.status, 'EN_ROUTE');
  const distributed = await api(`/api/dispatch/${orderId}/distribute`, {
    method: 'POST',
    token: leader.token,
    body: { beneficiaries: 40, notes: 'Dry rations issued at the school' }
  });
  assert.equal(distributed.status, 200);
  assert.equal(distributed.data.order.status, 'FULFILLED');
  assert.equal(distributed.data.distribution.beneficiaries, 40);
  assert.equal(distributed.data.distribution.notes, 'Dry rations issued at the school');
  assert.equal(await ReliefDistribution.countDocuments({ orderId }), 1);
  assert.equal((await Resource.findById(resource._id)).status, 'AVAILABLE');
});

test('a second distribution for the same order is rejected', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const leader = await officer('TEAM_LEADER');
  const { orderId } = await toAcked(district.token, leader);
  await api(`/api/dispatch/${orderId}/arrive`, {
    method: 'POST',
    token: leader.token,
    body: { routeChecked: true, weatherChecked: true }
  });
  const first = await api(`/api/dispatch/${orderId}/distribute`, {
    method: 'POST',
    token: leader.token,
    body: { beneficiaries: 10 }
  });
  assert.equal(first.status, 200);
  const second = await api(`/api/dispatch/${orderId}/distribute`, {
    method: 'POST',
    token: leader.token,
    body: { beneficiaries: 5 }
  });
  assert.equal(second.status, 409);
  assert.match(second.data.error, /already recorded/);
  assert.equal(await ReliefDistribution.countDocuments({ orderId }), 1);
});

test('distribution with no beneficiaries is rejected', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const leader = await officer('TEAM_LEADER');
  const { orderId } = await toAcked(district.token, leader);
  await api(`/api/dispatch/${orderId}/arrive`, {
    method: 'POST',
    token: leader.token,
    body: { routeChecked: true, weatherChecked: true }
  });
  const res = await api(`/api/dispatch/${orderId}/distribute`, {
    method: 'POST',
    token: leader.token,
    body: { beneficiaries: 0 }
  });
  assert.equal(res.status, 422);
  assert.equal(res.data.error, 'Validation failed');
  assert.equal((await DispatchOrder.findById(orderId)).status, 'EN_ROUTE');
});

test('a team leader who was not assigned cannot accept the order', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const assigned = await officer('TEAM_LEADER');
  const other = await officer('TEAM_LEADER');
  const resource = await addResource(district.token);
  const order = await createOrder(district.token, resource._id);
  await api(`/api/dispatch/${order._id}/reserve`, { method: 'POST', token: district.token, body: {} });
  await api(`/api/dispatch/${order._id}/assign`, {
    method: 'POST',
    token: district.token,
    body: { teamLeadId: assigned.user._id.toString() }
  });
  const res = await api(`/api/dispatch/${order._id}/ack`, { method: 'POST', token: other.token, body: {} });
  assert.equal(res.status, 403);
  assert.equal((await DispatchOrder.findById(order._id)).status, 'SENT');
});

test('a warden cannot create or reserve a dispatch', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const warden = await officer('WARDEN');
  const resource = await addResource(district.token);
  const created = await api('/api/dispatch', {
    method: 'POST',
    token: warden.token,
    body: {
      district: 'Ratnapura',
      priority: 'HIGH',
      items: [{ resourceId: resource._id, type: 'TEAM', description: 'Unauthorized' }],
      clientUUID: 'warden-order'
    }
  });
  assert.equal(created.status, 403);
  const order = await createOrder(district.token, resource._id);
  const reserved = await api(`/api/dispatch/${order._id}/reserve`, { method: 'POST', token: warden.token, body: {} });
  assert.equal(reserved.status, 403);
  assert.equal((await DispatchOrder.findById(order._id)).status, 'CREATED');
  assert.equal((await Resource.findById(resource._id)).status, 'AVAILABLE');
});
