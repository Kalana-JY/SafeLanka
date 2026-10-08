import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import Alert from '../src/models/Alert.js';
import DeliveryReceipt from '../src/models/DeliveryReceipt.js';
import HazardEvent from '../src/models/HazardEvent.js';
import { api, createUser, hoursFromNow, resetDb, startTestServer, stopTestServer, tokenFor } from './helpers.js';

before(startTestServer, { timeout: 120_000 });
after(stopTestServer);
beforeEach(resetDb);

async function officer(role, district = 'Ratnapura') {
  const user = await createUser({ role, district });
  return { user, token: tokenFor(user) };
}

async function eventAndArea(token, { district = 'Ratnapura', name = 'Kalu Ganga flood' } = {}) {
  const eventRes = await api('/api/events', {
    method: 'POST',
    token,
    body: { name, hazardType: 'FLOOD', district }
  });
  assert.equal(eventRes.status, 201);
  const areaRes = await api('/api/areas', {
    method: 'POST',
    token,
    body: { name: `${name} area`, district, eventId: eventRes.data.event._id, estPopulation: 12000 }
  });
  assert.equal(areaRes.status, 201);
  return { event: eventRes.data.event, area: areaRes.data.area };
}

function draftBody(event, area, extra = {}) {
  return {
    eventId: event._id,
    targetAreaId: area._id,
    level: 'WARNING',
    headline: 'Flood warning',
    body: 'Move to higher ground.',
    expiresAt: hoursFromNow(2),
    ...extra
  };
}

test('a valid alert draft can be created', async () => {
  const dmc = await officer('DMC_OFFICER');
  const { event, area } = await eventAndArea(dmc.token);
  const res = await api('/api/alerts', { method: 'POST', token: dmc.token, body: draftBody(event, area) });
  assert.equal(res.status, 201);
  assert.equal(res.data.alert.status, 'DRAFT');
  assert.equal(res.data.alert.level, 'WARNING');
  assert.equal(res.data.alert.headline, 'Flood warning');
  assert.equal(res.data.reach, 0);
});

test('invalid alert data is rejected', async () => {
  const dmc = await officer('DMC_OFFICER');
  const { event, area } = await eventAndArea(dmc.token);
  const missing = await api('/api/alerts', {
    method: 'POST',
    token: dmc.token,
    body: { eventId: event._id, targetAreaId: area._id, level: 'WARNING', expiresAt: hoursFromNow(2) }
  });
  assert.equal(missing.status, 422);
  assert.equal(missing.data.error, 'Validation failed');

  const tooLong = await api('/api/alerts', {
    method: 'POST',
    token: dmc.token,
    body: draftBody(event, area, { expiresAt: hoursFromNow(13) })
  });
  assert.equal(tooLong.status, 422);
  assert.match(tooLong.data.error, /12h/);

  const past = await api('/api/alerts', {
    method: 'POST',
    token: dmc.token,
    body: draftBody(event, area, { expiresAt: hoursFromNow(-1) })
  });
  assert.equal(past.status, 422);
  assert.match(past.data.error, /future/);
});

test('publishing a WARNING raises the hazard level and marks the alert published', async () => {
  const dmc = await officer('DMC_OFFICER');
  const { event, area } = await eventAndArea(dmc.token);
  const draft = await api('/api/alerts', { method: 'POST', token: dmc.token, body: draftBody(event, area) });
  const published = await api(`/api/alerts/${draft.data.alert._id}/publish`, {
    method: 'POST',
    token: dmc.token,
    body: {}
  });
  assert.equal(published.status, 200);
  assert.equal(published.data.alert.status, 'PUBLISHED');
  assert.ok(published.data.alert.publishedAt);

  const events = await api('/api/events', { token: dmc.token });
  const updated = events.data.events.find((item) => item._id === event._id);
  assert.equal(updated.level, 'WARNING');
  assert.equal(updated.status, 'ACTIVE');
});

test('publishing does not lower an existing higher hazard level', async () => {
  const dmc = await officer('DMC_OFFICER');
  const { event, area } = await eventAndArea(dmc.token);
  await HazardEvent.updateOne({ _id: event._id }, { level: 'EVACUATE' });
  const draft = await api('/api/alerts', {
    method: 'POST',
    token: dmc.token,
    body: draftBody(event, area, { level: 'WATCH', headline: 'Watch', body: 'Monitor the river.' })
  });
  const published = await api(`/api/alerts/${draft.data.alert._id}/publish`, {
    method: 'POST',
    token: dmc.token,
    body: {}
  });
  assert.equal(published.status, 200);
  const stored = await HazardEvent.findById(event._id);
  assert.equal(stored.level, 'EVACUATE');
  assert.equal(stored.status, 'ACTIVE');
});

test('publishing ALL_CLEAR closes the hazard event', async () => {
  const dmc = await officer('DMC_OFFICER');
  const { event, area } = await eventAndArea(dmc.token);
  const draft = await api('/api/alerts', {
    method: 'POST',
    token: dmc.token,
    body: draftBody(event, area, { level: 'ALL_CLEAR', headline: 'All clear', body: 'Floodwater has receded.' })
  });
  const published = await api(`/api/alerts/${draft.data.alert._id}/publish`, {
    method: 'POST',
    token: dmc.token,
    body: {}
  });
  assert.equal(published.status, 200);
  const stored = await HazardEvent.findById(event._id);
  assert.equal(stored.level, 'ALL_CLEAR');
  assert.equal(stored.status, 'CLOSED');
});

test('publish writes one simulated receipt per opted-in citizen or volunteer per channel', async () => {
  const dmc = await officer('DMC_OFFICER');
  await createUser({ role: 'CITIZEN', district: 'Ratnapura', alertOptIn: true });
  await createUser({ role: 'VOLUNTEER', district: 'Ratnapura', alertOptIn: true });
  await createUser({ role: 'CITIZEN', district: 'Ratnapura', alertOptIn: false });
  await createUser({ role: 'CITIZEN', district: 'Colombo', alertOptIn: true });
  const { event, area } = await eventAndArea(dmc.token);
  const draft = await api('/api/alerts', { method: 'POST', token: dmc.token, body: draftBody(event, area) });
  const published = await api(`/api/alerts/${draft.data.alert._id}/publish`, {
    method: 'POST',
    token: dmc.token,
    body: {}
  });
  assert.equal(published.status, 200);
  assert.equal(published.data.summary.attempted, 6);
  assert.equal(published.data.summary.delivered, 6);
  assert.equal(published.data.summary.failed, 0);
  assert.deepEqual(
    published.data.summary.perChannel.map((row) => row.channel).sort(),
    ['PUSH', 'SIREN', 'SMS']
  );
  const receipts = await DeliveryReceipt.find({ alertId: draft.data.alert._id });
  assert.equal(receipts.length, 6);
  assert.ok(receipts.every((row) => row.state === 'DELIVERED'));
});

test('simulateFailure marks only the named channel failed and still does not call a gateway', async () => {
  const dmc = await officer('DMC_OFFICER');
  await createUser({ role: 'CITIZEN', district: 'Ratnapura' });
  const { event, area } = await eventAndArea(dmc.token);
  const draft = await api('/api/alerts', { method: 'POST', token: dmc.token, body: draftBody(event, area) });
  const published = await api(`/api/alerts/${draft.data.alert._id}/publish`, {
    method: 'POST',
    token: dmc.token,
    body: { simulateFailure: ['SMS'] }
  });
  assert.equal(published.status, 200);
  const sms = published.data.summary.perChannel.find((row) => row.channel === 'SMS');
  const push = published.data.summary.perChannel.find((row) => row.channel === 'PUSH');
  assert.equal(sms.failed, 1);
  assert.equal(sms.delivered, 0);
  assert.equal(push.delivered, 1);
  assert.equal(push.failed, 0);
  const failed = await DeliveryReceipt.countDocuments({ alertId: draft.data.alert._id, channel: 'SMS', state: 'FAILED' });
  assert.equal(failed, 1);
});

test('a second active alert for the same event and district is rejected', async () => {
  const dmc = await officer('DMC_OFFICER');
  const { event, area } = await eventAndArea(dmc.token);
  const first = await api('/api/alerts', { method: 'POST', token: dmc.token, body: draftBody(event, area) });
  const second = await api('/api/alerts', {
    method: 'POST',
    token: dmc.token,
    body: draftBody(event, area, { headline: 'Update', body: 'Water is still rising.' })
  });
  const ok = await api(`/api/alerts/${first.data.alert._id}/publish`, { method: 'POST', token: dmc.token, body: {} });
  assert.equal(ok.status, 200);
  const conflict = await api(`/api/alerts/${second.data.alert._id}/publish`, { method: 'POST', token: dmc.token, body: {} });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.conflictingAlertId, first.data.alert._id);
});

test('alerts for the same event in different districts can both be published', async () => {
  const dmc = await officer('DMC_OFFICER');
  const eventRes = await api('/api/events', {
    method: 'POST',
    token: dmc.token,
    body: { name: 'Basin flood', hazardType: 'FLOOD', district: 'Ratnapura' }
  });
  const ratnapura = await api('/api/areas', {
    method: 'POST',
    token: dmc.token,
    body: { name: 'Ratnapura bank', district: 'Ratnapura', eventId: eventRes.data.event._id, estPopulation: 1000 }
  });
  const colombo = await api('/api/areas', {
    method: 'POST',
    token: dmc.token,
    body: { name: 'Downstream', district: 'Colombo', eventId: eventRes.data.event._id, estPopulation: 1000 }
  });
  const first = await api('/api/alerts', {
    method: 'POST',
    token: dmc.token,
    body: draftBody(eventRes.data.event, ratnapura.data.area)
  });
  const second = await api('/api/alerts', {
    method: 'POST',
    token: dmc.token,
    body: draftBody(eventRes.data.event, colombo.data.area, { headline: 'Downstream watch', body: 'Monitor levels.' })
  });
  assert.equal((await api(`/api/alerts/${first.data.alert._id}/publish`, { method: 'POST', token: dmc.token, body: {} })).status, 200);
  assert.equal((await api(`/api/alerts/${second.data.alert._id}/publish`, { method: 'POST', token: dmc.token, body: {} })).status, 200);
});

test('EVACUATE publish without a different DMC officer is rejected', async () => {
  const dmc = await officer('DMC_OFFICER');
  const { event, area } = await eventAndArea(dmc.token);
  const draft = await api('/api/alerts', {
    method: 'POST',
    token: dmc.token,
    body: draftBody(event, area, { level: 'EVACUATE', headline: 'Evacuate', body: 'Leave the basin now.' })
  });
  const missing = await api(`/api/alerts/${draft.data.alert._id}/publish`, { method: 'POST', token: dmc.token, body: {} });
  assert.equal(missing.status, 422);
  assert.match(missing.data.error, /second officer/);

  const sameOfficer = await api(`/api/alerts/${draft.data.alert._id}/publish`, {
    method: 'POST',
    token: dmc.token,
    body: { secondConfirmedBy: dmc.user._id.toString() }
  });
  assert.equal(sameOfficer.status, 422);
  assert.match(sameOfficer.data.error, /different active DMC/);
  const stored = await Alert.findById(draft.data.alert._id);
  assert.equal(stored.status, 'DRAFT');
});

test('a draft whose expiry has passed cannot be published', async () => {
  const dmc = await officer('DMC_OFFICER');
  const { event, area } = await eventAndArea(dmc.token);
  const draft = await api('/api/alerts', { method: 'POST', token: dmc.token, body: draftBody(event, area) });
  await Alert.updateOne({ _id: draft.data.alert._id }, { expiresAt: new Date(Date.now() - 60_000) });
  const res = await api(`/api/alerts/${draft.data.alert._id}/publish`, { method: 'POST', token: dmc.token, body: {} });
  assert.equal(res.status, 422);
  assert.match(res.data.error, /future/);
});

test('an EXPIRED alert cannot be published or cancelled', async () => {
  const dmc = await officer('DMC_OFFICER');
  const { event, area } = await eventAndArea(dmc.token);
  const draft = await api('/api/alerts', { method: 'POST', token: dmc.token, body: draftBody(event, area) });
  const published = await api(`/api/alerts/${draft.data.alert._id}/publish`, { method: 'POST', token: dmc.token, body: {} });
  assert.equal(published.status, 200);
  await Alert.updateOne({ _id: draft.data.alert._id }, { expiresAt: new Date(Date.now() - 60_000) });
  const expired = await api('/api/alerts/__expire-now', { method: 'POST', token: dmc.token, body: {} });
  assert.equal(expired.status, 200);
  assert.equal(expired.data.expired, 1);

  const cancel = await api(`/api/alerts/${draft.data.alert._id}/cancel`, {
    method: 'POST',
    token: dmc.token,
    body: { reason: 'too late' }
  });
  assert.equal(cancel.status, 409);
  assert.match(cancel.data.error, /EXPIRED/);

  const republish = await api(`/api/alerts/${draft.data.alert._id}/publish`, { method: 'POST', token: dmc.token, body: {} });
  assert.equal(republish.status, 409);
  assert.match(republish.data.error, /DRAFT/);
});

test('a district officer cannot publish an alert', async () => {
  const dmc = await officer('DMC_OFFICER');
  const district = await officer('DISTRICT_OFFICER');
  const { event, area } = await eventAndArea(dmc.token);
  const draft = await api('/api/alerts', { method: 'POST', token: dmc.token, body: draftBody(event, area) });
  const res = await api(`/api/alerts/${draft.data.alert._id}/publish`, { method: 'POST', token: district.token, body: {} });
  assert.equal(res.status, 403);
  const stored = await Alert.findById(draft.data.alert._id);
  assert.equal(stored.status, 'DRAFT');
});

test('publish without a token is rejected', async () => {
  const dmc = await officer('DMC_OFFICER');
  const { event, area } = await eventAndArea(dmc.token);
  const draft = await api('/api/alerts', { method: 'POST', token: dmc.token, body: draftBody(event, area) });
  const res = await api(`/api/alerts/${draft.data.alert._id}/publish`, { method: 'POST', body: {} });
  assert.equal(res.status, 401);
});
