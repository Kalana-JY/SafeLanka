import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import Evacuee from '../src/models/Evacuee.js';
import EvacueeRecord from '../src/models/EvacueeRecord.js';
import Shelter from '../src/models/Shelter.js';
import { api, createUser, resetDb, startTestServer, stopTestServer, tokenFor } from './helpers.js';

before(startTestServer, { timeout: 120_000 });
after(stopTestServer);
beforeEach(resetDb);

async function officer(role, district = 'Ratnapura') {
  const user = await createUser({ role, district });
  return { user, token: tokenFor(user) };
}

async function registerShelter(token, { name = 'Ratnapura Central College', capacity = 10 } = {}) {
  const res = await api('/api/shelters', {
    method: 'POST',
    token,
    body: { buildingName: name, district: 'Ratnapura', capacity, address: 'Ratnapura' }
  });
  return res;
}

test('creating a shelter with no usable capacity is rejected', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const res = await registerShelter(district.token, { capacity: 0 });
  assert.equal(res.status, 422);
  assert.equal(res.data.error, 'Validation failed');
  assert.equal(await Shelter.countDocuments(), 0);
});

test('a shelter stored without valid capacity cannot be opened', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const shelter = new Shelter({ buildingName: 'Unrated hall', district: 'Ratnapura', capacity: 0 });
  await shelter.save({ validateBeforeSave: false });
  const res = await api(`/api/shelters/${shelter._id}/open`, { method: 'POST', token: district.token, body: {} });
  assert.equal(res.status, 422);
  assert.match(res.data.error, /Capacity must be set/);
  const stored = await Shelter.findById(shelter._id);
  assert.equal(stored.status, 'PLANNED');
});

test('a valid shelter can be opened by a district officer', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const created = await registerShelter(district.token, { capacity: 480 });
  assert.equal(created.status, 201);
  assert.equal(created.data.shelter.status, 'PLANNED');
  const opened = await api(`/api/shelters/${created.data.shelter._id}/open`, { method: 'POST', token: district.token, body: {} });
  assert.equal(opened.status, 200);
  assert.equal(opened.data.shelter.status, 'OPEN');
  assert.equal(opened.data.shelter.capacity, 480);
});

test('check-in below 90% stores the household and leaves the shelter OPEN', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const warden = await officer('WARDEN');
  const created = await registerShelter(district.token, { capacity: 10 });
  await api(`/api/shelters/${created.data.shelter._id}/open`, { method: 'POST', token: district.token, body: {} });
  const res = await api(`/api/shelters/${created.data.shelter._id}/checkin`, {
    method: 'POST',
    token: warden.token,
    body: { name: 'Nimal Perera', contactNo: '0771111111', householdSize: 4, clientUUID: 'hh-open-1' }
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.occupancy, 4);
  assert.equal(res.data.shelter.status, 'OPEN');
  assert.equal(res.data.record.evacueeId.fullName, 'Nimal Perera');
  assert.equal(res.data.record.evacueeId.householdSize, 4);
});

test('check-in at exactly 90% sets NEARLY_FULL', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const warden = await officer('WARDEN');
  const created = await registerShelter(district.token, { capacity: 10 });
  await api(`/api/shelters/${created.data.shelter._id}/open`, { method: 'POST', token: district.token, body: {} });
  const res = await api(`/api/shelters/${created.data.shelter._id}/checkin`, {
    method: 'POST',
    token: warden.token,
    body: { name: 'Kamala Silva', householdSize: 9, clientUUID: 'hh-90' }
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.occupancy, 9);
  assert.equal(res.data.capacity, 10);
  assert.equal(res.data.shelter.status, 'NEARLY_FULL');
});

test('one person below the 90% line stays OPEN', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const warden = await officer('WARDEN');
  const created = await registerShelter(district.token, { capacity: 10 });
  await api(`/api/shelters/${created.data.shelter._id}/open`, { method: 'POST', token: district.token, body: {} });
  const res = await api(`/api/shelters/${created.data.shelter._id}/checkin`, {
    method: 'POST',
    token: warden.token,
    body: { name: 'Sunil Fernando', householdSize: 8, clientUUID: 'hh-89' }
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.occupancy, 8);
  assert.equal(res.data.shelter.status, 'OPEN');
});

test('a full shelter rejects another check-in', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const warden = await officer('WARDEN');
  const created = await registerShelter(district.token, { name: 'Central College', capacity: 5 });
  await api(`/api/shelters/${created.data.shelter._id}/open`, { method: 'POST', token: district.token, body: {} });
  const filled = await api(`/api/shelters/${created.data.shelter._id}/checkin`, {
    method: 'POST',
    token: warden.token,
    body: { name: 'First household', householdSize: 5, clientUUID: 'hh-fill' }
  });
  assert.equal(filled.status, 201);
  assert.equal(filled.data.shelter.status, 'FULL');
  const rejected = await api(`/api/shelters/${created.data.shelter._id}/checkin`, {
    method: 'POST',
    token: warden.token,
    body: { name: 'Second household', householdSize: 1, clientUUID: 'hh-overflow' }
  });
  assert.equal(rejected.status, 409);
  assert.match(rejected.data.error, /FULL/);
  assert.equal(await Evacuee.countDocuments(), 1);
  const stored = await Shelter.findById(created.data.shelter._id);
  assert.equal(stored.occupancy, 5);
});

test('a check-in that would exceed remaining beds returns the alternate shelter', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const warden = await officer('WARDEN');
  const primary = await registerShelter(district.token, { name: 'Central College', capacity: 10 });
  const alternate = await registerShelter(district.token, { name: 'Town Hall', capacity: 20 });
  await api(`/api/shelters/${primary.data.shelter._id}/open`, { method: 'POST', token: district.token, body: {} });
  await api(`/api/shelters/${alternate.data.shelter._id}/open`, { method: 'POST', token: district.token, body: {} });
  await api(`/api/shelters/${primary.data.shelter._id}/checkin`, {
    method: 'POST',
    token: warden.token,
    body: { name: 'Large household', householdSize: 8, clientUUID: 'hh-tight' }
  });
  const rejected = await api(`/api/shelters/${primary.data.shelter._id}/checkin`, {
    method: 'POST',
    token: warden.token,
    body: { name: 'Does not fit', householdSize: 3, clientUUID: 'hh-no-fit' }
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.data.error, 'Shelter full');
  assert.equal(rejected.data.alternate.buildingName, 'Town Hall');
  assert.equal(await Evacuee.countDocuments({ fullName: 'Does not fit' }), 0);
});

test('the same client UUID does not create a second household', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const warden = await officer('WARDEN');
  const created = await registerShelter(district.token, { capacity: 20 });
  await api(`/api/shelters/${created.data.shelter._id}/open`, { method: 'POST', token: district.token, body: {} });
  const body = { name: 'Repeat household', householdSize: 3, clientUUID: 'same-device-key' };
  const first = await api(`/api/shelters/${created.data.shelter._id}/checkin`, { method: 'POST', token: warden.token, body });
  const second = await api(`/api/shelters/${created.data.shelter._id}/checkin`, { method: 'POST', token: warden.token, body });
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.data.deduped, true);
  assert.equal(second.data.record._id, first.data.record._id);
  assert.equal(await Evacuee.countDocuments(), 1);
  assert.equal(await EvacueeRecord.countDocuments(), 1);
  const stored = await Shelter.findById(created.data.shelter._id);
  assert.equal(stored.occupancy, 3);
});

test('check-out reduces occupancy and can leave NEARLY_FULL', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const warden = await officer('WARDEN');
  const created = await registerShelter(district.token, { capacity: 10 });
  await api(`/api/shelters/${created.data.shelter._id}/open`, { method: 'POST', token: district.token, body: {} });
  const checked = await api(`/api/shelters/${created.data.shelter._id}/checkin`, {
    method: 'POST',
    token: warden.token,
    body: { name: 'Leaving household', householdSize: 9, clientUUID: 'hh-leave' }
  });
  assert.equal(checked.data.shelter.status, 'NEARLY_FULL');
  const out = await api(`/api/shelters/${created.data.shelter._id}/checkout`, {
    method: 'POST',
    token: warden.token,
    body: { recordId: checked.data.record._id }
  });
  assert.equal(out.status, 200);
  assert.equal(out.data.occupancy, 0);
  assert.equal(out.data.shelter.status, 'OPEN');
  assert.ok(out.data.record.checkOutAt);
});

test('closing an occupied shelter without a transfer is rejected', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const warden = await officer('WARDEN');
  const created = await registerShelter(district.token, { capacity: 10 });
  await api(`/api/shelters/${created.data.shelter._id}/open`, { method: 'POST', token: district.token, body: {} });
  await api(`/api/shelters/${created.data.shelter._id}/checkin`, {
    method: 'POST',
    token: warden.token,
    body: { name: 'Still inside', householdSize: 2, clientUUID: 'hh-stay' }
  });
  const closed = await api(`/api/shelters/${created.data.shelter._id}/close`, { method: 'POST', token: district.token, body: {} });
  assert.equal(closed.status, 422);
  assert.match(closed.data.error, /check out or transfer/);
  const stored = await Shelter.findById(created.data.shelter._id);
  assert.equal(stored.status, 'OPEN');
  assert.equal(stored.occupancy, 2);
});

test('an empty shelter can be closed', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const created = await registerShelter(district.token, { capacity: 10 });
  await api(`/api/shelters/${created.data.shelter._id}/open`, { method: 'POST', token: district.token, body: {} });
  const closed = await api(`/api/shelters/${created.data.shelter._id}/close`, { method: 'POST', token: district.token, body: {} });
  assert.equal(closed.status, 200);
  assert.equal(closed.data.shelter.status, 'CLOSED');
});

test('a warden cannot open a shelter and a citizen cannot check anyone in', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const warden = await officer('WARDEN');
  const citizen = await officer('CITIZEN');
  const created = await registerShelter(district.token, { capacity: 10 });
  const openAttempt = await api(`/api/shelters/${created.data.shelter._id}/open`, { method: 'POST', token: warden.token, body: {} });
  assert.equal(openAttempt.status, 403);
  await api(`/api/shelters/${created.data.shelter._id}/open`, { method: 'POST', token: district.token, body: {} });
  const checkin = await api(`/api/shelters/${created.data.shelter._id}/checkin`, {
    method: 'POST',
    token: citizen.token,
    body: { name: 'Citizen attempt', householdSize: 1, clientUUID: 'hh-citizen' }
  });
  assert.equal(checkin.status, 403);
  assert.equal(await Evacuee.countDocuments(), 0);
});

test('concurrent check-ins cannot exceed capacity', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const warden = await officer('WARDEN');
  const created = await registerShelter(district.token, { capacity: 5 });
  await api(`/api/shelters/${created.data.shelter._id}/open`, { method: 'POST', token: district.token, body: {} });
  const [a, b] = await Promise.all([
    api(`/api/shelters/${created.data.shelter._id}/checkin`, {
      method: 'POST',
      token: warden.token,
      body: { name: 'Household A', householdSize: 3, clientUUID: 'race-a' }
    }),
    api(`/api/shelters/${created.data.shelter._id}/checkin`, {
      method: 'POST',
      token: warden.token,
      body: { name: 'Household B', householdSize: 3, clientUUID: 'race-b' }
    })
  ]);
  const statuses = [a.status, b.status].sort((x, y) => x - y);
  assert.deepEqual(statuses, [201, 409]);
  const stored = await Shelter.findById(created.data.shelter._id);
  assert.equal(stored.occupancy, 3);
  assert.ok(stored.occupancy <= stored.capacity);
  assert.equal(await Evacuee.countDocuments(), 1);
  assert.equal(await EvacueeRecord.countDocuments(), 1);
});

test('concurrent check-ins that both fit are both recorded', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const warden = await officer('WARDEN');
  const created = await registerShelter(district.token, { capacity: 10 });
  await api(`/api/shelters/${created.data.shelter._id}/open`, { method: 'POST', token: district.token, body: {} });
  const [a, b] = await Promise.all([
    api(`/api/shelters/${created.data.shelter._id}/checkin`, {
      method: 'POST',
      token: warden.token,
      body: { name: 'Household A', householdSize: 4, clientUUID: 'fit-a' }
    }),
    api(`/api/shelters/${created.data.shelter._id}/checkin`, {
      method: 'POST',
      token: warden.token,
      body: { name: 'Household B', householdSize: 4, clientUUID: 'fit-b' }
    })
  ]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const stored = await Shelter.findById(created.data.shelter._id);
  assert.equal(stored.occupancy, 8);
  assert.equal(stored.status, 'OPEN');
  assert.equal(await EvacueeRecord.countDocuments(), 2);
});

test('concurrent check-ins with the same client UUID do not double occupancy', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const warden = await officer('WARDEN');
  const created = await registerShelter(district.token, { capacity: 20 });
  await api(`/api/shelters/${created.data.shelter._id}/open`, { method: 'POST', token: district.token, body: {} });
  const body = { name: 'One household', householdSize: 4, clientUUID: 'same-race-key' };
  const [a, b] = await Promise.all([
    api(`/api/shelters/${created.data.shelter._id}/checkin`, { method: 'POST', token: warden.token, body }),
    api(`/api/shelters/${created.data.shelter._id}/checkin`, { method: 'POST', token: warden.token, body })
  ]);
  const statuses = [a.status, b.status].sort((x, y) => x - y);
  assert.deepEqual(statuses, [200, 201]);
  const deduped = [a, b].find((res) => res.data.deduped);
  assert.equal(deduped.status, 200);
  assert.equal(deduped.data.deduped, true);
  assert.equal(await Evacuee.countDocuments(), 1);
  assert.equal(await EvacueeRecord.countDocuments(), 1);
  const stored = await Shelter.findById(created.data.shelter._id);
  assert.equal(stored.occupancy, 4);
});

test('two concurrent check-outs of one record decrement occupancy once', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const warden = await officer('WARDEN');
  const created = await registerShelter(district.token, { capacity: 10 });
  await api(`/api/shelters/${created.data.shelter._id}/open`, { method: 'POST', token: district.token, body: {} });
  const checked = await api(`/api/shelters/${created.data.shelter._id}/checkin`, {
    method: 'POST',
    token: warden.token,
    body: { name: 'Leaving once', householdSize: 4, clientUUID: 'leave-once' }
  });
  const [a, b] = await Promise.all([
    api(`/api/shelters/${created.data.shelter._id}/checkout`, {
      method: 'POST',
      token: warden.token,
      body: { recordId: checked.data.record._id }
    }),
    api(`/api/shelters/${created.data.shelter._id}/checkout`, {
      method: 'POST',
      token: warden.token,
      body: { recordId: checked.data.record._id }
    })
  ]);
  const statuses = [a.status, b.status].sort((x, y) => x - y);
  assert.deepEqual(statuses, [200, 409]);
  const stored = await Shelter.findById(created.data.shelter._id);
  assert.equal(stored.occupancy, 0);
  assert.equal(stored.status, 'OPEN');
  const storedRecord = await EvacueeRecord.findById(checked.data.record._id);
  assert.ok(storedRecord.checkOutAt);
});

test('a check-out overlapping a new check-in keeps the new occupancy', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const warden = await officer('WARDEN');
  const created = await registerShelter(district.token, { capacity: 10 });
  const shelterId = created.data.shelter._id;
  await api(`/api/shelters/${shelterId}/open`, { method: 'POST', token: district.token, body: {} });
  const checked = await api(`/api/shelters/${shelterId}/checkin`, {
    method: 'POST',
    token: warden.token,
    body: { name: 'Household A', householdSize: 4, clientUUID: 'overlap-a' }
  });
  const [out, inn] = await Promise.all([
    api(`/api/shelters/${shelterId}/checkout`, {
      method: 'POST',
      token: warden.token,
      body: { recordId: checked.data.record._id }
    }),
    api(`/api/shelters/${shelterId}/checkin`, {
      method: 'POST',
      token: warden.token,
      body: { name: 'Household B', householdSize: 3, clientUUID: 'overlap-b' }
    })
  ]);
  assert.equal(out.status, 200);
  assert.equal(inn.status, 201);
  const stored = await Shelter.findById(shelterId);
  assert.equal(stored.occupancy, 3);
  assert.equal(stored.status, 'OPEN');
  const leaving = await EvacueeRecord.findById(checked.data.record._id);
  const staying = await EvacueeRecord.findOne({ clientUUID: 'overlap-b' }).populate('evacueeId');
  assert.ok(leaving.checkOutAt);
  assert.equal(staying.checkOutAt, null);
  assert.equal(staying.evacueeId.householdSize, 3);
  assert.equal(await EvacueeRecord.countDocuments({ checkOutAt: null }), 1);
});

test('a check-out that misses the occupancy guard does not erase a newer check-in', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const warden = await officer('WARDEN');
  const created = await registerShelter(district.token, { capacity: 10 });
  const shelterId = created.data.shelter._id;
  await api(`/api/shelters/${shelterId}/open`, { method: 'POST', token: district.token, body: {} });
  const checked = await api(`/api/shelters/${shelterId}/checkin`, {
    method: 'POST',
    token: warden.token,
    body: { name: 'Household A', householdSize: 4, clientUUID: 'guard-a' }
  });
  // The counter no longer contains this household, so the decrement cannot match.
  await Shelter.updateOne({ _id: shelterId }, { occupancy: 0 });
  const originalFind = Shelter.findOneAndUpdate.bind(Shelter);
  let injected = false;
  Shelter.findOneAndUpdate = async function injectCheckin(filter, update, options) {
    const delta = update && update.$inc && update.$inc.occupancy;
    if (!injected && typeof delta === 'number' && delta < 0) {
      injected = true;
      const newer = await api(`/api/shelters/${shelterId}/checkin`, {
        method: 'POST',
        token: warden.token,
        body: { name: 'Household B', householdSize: 3, clientUUID: 'guard-b' }
      });
      assert.equal(newer.status, 201);
    }
    return originalFind(filter, update, options);
  };
  try {
    const out = await api(`/api/shelters/${shelterId}/checkout`, {
      method: 'POST',
      token: warden.token,
      body: { recordId: checked.data.record._id }
    });
    assert.equal(out.status, 200);
    assert.equal(injected, true);
  } finally {
    Shelter.findOneAndUpdate = originalFind;
  }
  const stored = await Shelter.findById(shelterId);
  assert.equal(stored.occupancy, 3);
  assert.equal(stored.status, 'OPEN');
  const leaving = await EvacueeRecord.findById(checked.data.record._id);
  const staying = await EvacueeRecord.findOne({ clientUUID: 'guard-b' }).populate('evacueeId');
  assert.ok(leaving.checkOutAt);
  assert.equal(staying.checkOutAt, null);
  assert.equal(staying.evacueeId.householdSize, 3);
  assert.equal(await EvacueeRecord.countDocuments({ checkOutAt: null }), 1);
});
