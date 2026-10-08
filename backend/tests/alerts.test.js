import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import Alert from '../src/models/Alert.js';
import DeliveryReceipt from '../src/models/DeliveryReceipt.js';
import HazardEvent from '../src/models/HazardEvent.js';
import User from '../src/models/User.js';
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

function withAllLanguages(value, fallbackEn) {
  if (value && typeof value === 'object') {
    const en = value.en ?? fallbackEn;
    return { en, si: value.si ?? `සිංහල ${en}`, ta: value.ta ?? `தமிழ் ${en}` };
  }
  const en = value ?? fallbackEn;
  return { en, si: `සිංහල ${en}`, ta: `தமிழ் ${en}` };
}

function draftBody(event, area, extra = {}) {
  const { headline, body, ...rest } = extra;
  return {
    eventId: event._id,
    targetAreaId: area._id,
    level: 'WARNING',
    expiresAt: hoursFromNow(2),
    ...rest,
    headline: withAllLanguages(headline, 'Flood warning'),
    body: withAllLanguages(body, 'Move to higher ground.')
  };
}

test('a valid alert draft can be created', async () => {
  const dmc = await officer('DMC_OFFICER');
  const { event, area } = await eventAndArea(dmc.token);
  const res = await api('/api/alerts', { method: 'POST', token: dmc.token, body: draftBody(event, area) });
  assert.equal(res.status, 201);
  assert.equal(res.data.alert.status, 'DRAFT');
  assert.equal(res.data.alert.level, 'WARNING');
  assert.equal(res.data.alert.headline.en, 'Flood warning');
  assert.equal(res.data.alert.body.en, 'Move to higher ground.');
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

const SAMPLE = {
  headline: { en: 'Flood warning', si: 'ගංවතුර අනතුරු ඇඟවීම', ta: 'வெள்ள எச்சரிக்கை' },
  body: { en: 'Move to higher ground.', si: 'උස් බිමකට යන්න.', ta: 'உயர்ந்த இடத்திற்கு செல்லுங்கள்.' }
};

test('a draft stores English, Sinhala, and Tamil separately', async () => {
  const dmc = await officer('DMC_OFFICER');
  const { event, area } = await eventAndArea(dmc.token);
  const res = await api('/api/alerts', {
    method: 'POST',
    token: dmc.token,
    body: draftBody(event, area, SAMPLE)
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.alert.headline.en, SAMPLE.headline.en);
  assert.equal(res.data.alert.headline.si, SAMPLE.headline.si);
  assert.equal(res.data.alert.headline.ta, SAMPLE.headline.ta);
  assert.equal(res.data.alert.body.si, SAMPLE.body.si);
  assert.equal(res.data.alert.body.ta, SAMPLE.body.ta);
  assert.notEqual(res.data.alert.headline.si, res.data.alert.headline.en);
  assert.notEqual(res.data.alert.headline.ta, res.data.alert.headline.en);
});

test('an English-only draft can be saved and cannot be published', async () => {
  const dmc = await officer('DMC_OFFICER');
  const { event, area } = await eventAndArea(dmc.token);
  const draft = await api('/api/alerts', {
    method: 'POST',
    token: dmc.token,
    body: {
      eventId: event._id,
      targetAreaId: area._id,
      level: 'WARNING',
      headline: 'Flood warning',
      body: 'Move to higher ground.',
      expiresAt: hoursFromNow(2)
    }
  });
  assert.equal(draft.status, 201);
  assert.equal(draft.data.alert.headline.en, 'Flood warning');
  assert.equal(draft.data.alert.headline.si, '');
  assert.equal(draft.data.alert.headline.ta, '');
  assert.equal(draft.data.alert.status, 'DRAFT');

  const published = await api(`/api/alerts/${draft.data.alert._id}/publish`, {
    method: 'POST',
    token: dmc.token,
    body: {}
  });
  assert.equal(published.status, 422);
  assert.match(published.data.error, /Sinhala/);
  const stored = await Alert.findById(draft.data.alert._id);
  assert.equal(stored.status, 'DRAFT');
  assert.equal(stored.isComplete(), false);
});

test('publish succeeds only when English, Sinhala, and Tamil are all present', async () => {
  const dmc = await officer('DMC_OFFICER');
  await createUser({ role: 'CITIZEN', district: 'Ratnapura' });
  const { event, area } = await eventAndArea(dmc.token);
  const draft = await api('/api/alerts', {
    method: 'POST',
    token: dmc.token,
    body: draftBody(event, area, SAMPLE)
  });
  const published = await api(`/api/alerts/${draft.data.alert._id}/publish`, {
    method: 'POST',
    token: dmc.token,
    body: {}
  });
  assert.equal(published.status, 200);
  assert.equal(published.data.alert.status, 'PUBLISHED');
  const stored = await Alert.findById(draft.data.alert._id);
  assert.equal(stored.isComplete(), true);
  assert.equal(stored.headline.si, SAMPLE.headline.si);
  assert.equal(stored.headline.ta, SAMPLE.headline.ta);
  assert.equal(stored.body.en, SAMPLE.body.en);
});

test('publish is rejected when one required language is missing', async () => {
  const dmc = await officer('DMC_OFFICER');
  const { event, area } = await eventAndArea(dmc.token);

  async function attempt(headline, body) {
    const draft = await api('/api/alerts', {
      method: 'POST',
      token: dmc.token,
      body: {
        eventId: event._id,
        targetAreaId: area._id,
        level: 'WARNING',
        headline,
        body,
        expiresAt: hoursFromNow(2)
      }
    });
    assert.equal(draft.status, 201);
    const published = await api(`/api/alerts/${draft.data.alert._id}/publish`, {
      method: 'POST',
      token: dmc.token,
      body: {}
    });
    const stored = await Alert.findById(draft.data.alert._id);
    assert.equal(stored.status, 'DRAFT');
    return published;
  }

  const noEnglish = await attempt(
    { si: SAMPLE.headline.si, ta: SAMPLE.headline.ta },
    { si: SAMPLE.body.si, ta: SAMPLE.body.ta }
  );
  assert.equal(noEnglish.status, 422);
  assert.match(noEnglish.data.error, /English/);

  const noSinhala = await attempt(
    { en: SAMPLE.headline.en, ta: SAMPLE.headline.ta },
    { en: SAMPLE.body.en, ta: SAMPLE.body.ta }
  );
  assert.equal(noSinhala.status, 422);
  assert.match(noSinhala.data.error, /Sinhala/);

  const noTamil = await attempt(
    { en: SAMPLE.headline.en, si: SAMPLE.headline.si },
    { en: SAMPLE.body.en, si: SAMPLE.body.si }
  );
  assert.equal(noTamil.status, 422);
  assert.match(noTamil.data.error, /Tamil/);
});

test('citizens keep en, si, and ta, and dispatch uses that language', async () => {
  const signup = await api('/api/auth/signup', {
    method: 'POST',
    body: {
      fullName: 'Sinhala Citizen',
      email: 'si-citizen@test.local',
      mobileNo: '0710000101',
      password: 'secret1',
      district: 'Ratnapura',
      preferredLanguage: 'si'
    }
  });
  assert.equal(signup.status, 201);
  assert.equal(signup.data.user.preferredLanguage, 'si');
  const changed = await api('/api/users/me', {
    method: 'PATCH',
    token: signup.data.accessToken,
    body: { preferredLanguage: 'ta' }
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.user.preferredLanguage, 'ta');
  await User.updateOne({ _id: signup.data.user._id }, { preferredLanguage: 'si' });

  const english = await createUser({ role: 'CITIZEN', district: 'Ratnapura', preferredLanguage: 'en' });
  const tamil = await createUser({ role: 'CITIZEN', district: 'Ratnapura', preferredLanguage: 'ta' });
  const legacy = await createUser({ role: 'CITIZEN', district: 'Ratnapura', preferredLanguage: 'en' });
  await User.collection.updateOne({ _id: legacy._id }, { $set: { preferredLanguage: 'fr' } });
  await assert.rejects(() => createUser({ role: 'CITIZEN', preferredLanguage: 'fr' }));

  const dmc = await officer('DMC_OFFICER');
  const { event, area } = await eventAndArea(dmc.token);
  const draft = await api('/api/alerts', {
    method: 'POST',
    token: dmc.token,
    body: draftBody(event, area, SAMPLE)
  });
  const published = await api(`/api/alerts/${draft.data.alert._id}/publish`, {
    method: 'POST',
    token: dmc.token,
    body: {}
  });
  assert.equal(published.status, 200);

  async function sent(userId) {
    const rows = await DeliveryReceipt.find({ alertId: draft.data.alert._id, userId });
    assert.equal(rows.length, 3);
    assert.equal(new Set(rows.map((row) => row.language)).size, 1);
    assert.equal(new Set(rows.map((row) => row.headline)).size, 1);
    return rows[0];
  }

  const si = await sent(signup.data.user._id);
  assert.equal(si.language, 'si');
  assert.equal(si.headline, SAMPLE.headline.si);

  const ta = await sent(tamil._id);
  assert.equal(ta.language, 'ta');
  assert.equal(ta.headline, SAMPLE.headline.ta);

  const en = await sent(english._id);
  assert.equal(en.language, 'en');
  assert.equal(en.headline, SAMPLE.headline.en);

  const fallback = await sent(legacy._id);
  assert.equal(fallback.language, 'en');
  assert.equal(fallback.headline, SAMPLE.headline.en);
});

test('publish without a token is rejected', async () => {
  const dmc = await officer('DMC_OFFICER');
  const { event, area } = await eventAndArea(dmc.token);
  const draft = await api('/api/alerts', { method: 'POST', token: dmc.token, body: draftBody(event, area) });
  const res = await api(`/api/alerts/${draft.data.alert._id}/publish`, { method: 'POST', body: {} });
  assert.equal(res.status, 401);
});

test('a single district is stored as both district and districts', async () => {
  const dmc = await officer('DMC_OFFICER');
  const eventRes = await api('/api/events', {
    method: 'POST',
    token: dmc.token,
    body: { name: 'Local flood', hazardType: 'FLOOD', district: 'Ratnapura' }
  });
  const areaRes = await api('/api/areas', {
    method: 'POST',
    token: dmc.token,
    body: { name: 'Ratnapura bank', district: 'Ratnapura', eventId: eventRes.data.event._id, estPopulation: 1000 }
  });
  assert.equal(areaRes.status, 201);
  assert.equal(areaRes.data.area.district, 'Ratnapura');
  assert.deepEqual(areaRes.data.area.districts, ['Ratnapura']);
});

test('a target area can cover several districts and rejects an empty or duplicate list', async () => {
  const dmc = await officer('DMC_OFFICER');
  const eventRes = await api('/api/events', {
    method: 'POST',
    token: dmc.token,
    body: { name: 'Basin flood', hazardType: 'FLOOD', district: 'Ratnapura' }
  });
  const created = await api('/api/areas', {
    method: 'POST',
    token: dmc.token,
    body: {
      name: 'Kalu Ganga basin',
      districts: ['Ratnapura', 'Kalutara'],
      eventId: eventRes.data.event._id,
      polygon: '[[6.68,80.40],[6.58,80.00]]'
    }
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.area.districts, ['Ratnapura', 'Kalutara']);
  assert.equal(created.data.area.district, 'Ratnapura');
  assert.equal(created.data.area.polygon, '[[6.68,80.40],[6.58,80.00]]');

  const empty = await api('/api/areas', {
    method: 'POST',
    token: dmc.token,
    body: { name: 'Empty', districts: [], eventId: eventRes.data.event._id }
  });
  assert.equal(empty.status, 422);
  assert.equal(empty.data.error, 'At least one district is required');

  const duplicate = await api('/api/areas', {
    method: 'POST',
    token: dmc.token,
    body: { name: 'Dup', districts: ['Ratnapura', ' Ratnapura '], eventId: eventRes.data.event._id }
  });
  assert.equal(duplicate.status, 422);
  assert.equal(duplicate.data.error, 'Duplicate district');

  const missing = await api('/api/areas', {
    method: 'POST',
    token: dmc.token,
    body: { name: 'Nowhere', eventId: eventRes.data.event._id }
  });
  assert.equal(missing.status, 422);
  assert.equal(missing.data.error, 'At least one district is required');
});

test('an alert cannot use a target area from another hazard event', async () => {
  const dmc = await officer('DMC_OFFICER');
  const first = await eventAndArea(dmc.token, { name: 'First flood' });
  const second = await eventAndArea(dmc.token, { name: 'Second flood' });
  const res = await api('/api/alerts', {
    method: 'POST',
    token: dmc.token,
    body: draftBody(second.event, first.area)
  });
  assert.equal(res.status, 404);
  assert.equal(res.data.error, 'TargetArea not found for this event');
});

test('reach counts eligible users across the area districts', async () => {
  const dmc = await officer('DMC_OFFICER');
  const eventRes = await api('/api/events', {
    method: 'POST',
    token: dmc.token,
    body: { name: 'Basin flood', hazardType: 'FLOOD', district: 'Ratnapura' }
  });
  const areaRes = await api('/api/areas', {
    method: 'POST',
    token: dmc.token,
    body: { name: 'Basin', districts: ['Ratnapura', 'Kalutara'], eventId: eventRes.data.event._id }
  });
  assert.equal(areaRes.status, 201);

  await createUser({ role: 'CITIZEN', district: 'Ratnapura', preferredLanguage: 'en' });
  await createUser({ role: 'CITIZEN', district: 'Kalutara', preferredLanguage: 'si' });
  await createUser({ role: 'VOLUNTEER', district: 'Kalutara', preferredLanguage: 'en' });
  await createUser({ role: 'CITIZEN', district: 'Colombo', preferredLanguage: 'en' });
  await createUser({ role: 'CITIZEN', district: 'Ratnapura', preferredLanguage: 'ta', alertOptIn: false });
  await createUser({ role: 'CITIZEN', district: 'Ratnapura', preferredLanguage: 'en', active: false });
  const legacy = await createUser({ role: 'CITIZEN', district: 'Ratnapura', preferredLanguage: 'en' });
  await User.collection.updateOne({ _id: legacy._id }, { $set: { preferredLanguage: 'fr' } });

  const reach = await api(`/api/areas/${areaRes.data.area._id}/reach`, { token: dmc.token });
  assert.equal(reach.status, 200);
  assert.equal(reach.data.reach, 4);
  assert.equal(reach.data.excluded, 1);
  assert.deepEqual(reach.data.districts, [
    { district: 'Ratnapura', eligible: 2 },
    { district: 'Kalutara', eligible: 2 }
  ]);
  assert.equal(reach.data.districts.reduce((sum, row) => sum + row.eligible, 0), reach.data.reach);
  assert.deepEqual(reach.data.languages, { en: 3, si: 1, ta: 0 });
  assert.equal(reach.data.languages.en + reach.data.languages.si + reach.data.languages.ta, reach.data.reach);

  const draft = await api('/api/alerts', {
    method: 'POST',
    token: dmc.token,
    body: draftBody(eventRes.data.event, areaRes.data.area, SAMPLE)
  });
  assert.equal(draft.status, 201);
  assert.equal(draft.data.reach, 4);
  const published = await api(`/api/alerts/${draft.data.alert._id}/publish`, {
    method: 'POST',
    token: dmc.token,
    body: {}
  });
  assert.equal(published.status, 200);
  assert.equal(published.data.summary.attempted, 12);
  const outside = await User.findOne({ district: 'Colombo', role: 'CITIZEN' });
  const outsideReceipts = await DeliveryReceipt.countDocuments({ alertId: draft.data.alert._id, userId: outside._id });
  assert.equal(outsideReceipts, 0);
  const kalutara = await User.findOne({ district: 'Kalutara', preferredLanguage: 'si' });
  const kalutaraReceipts = await DeliveryReceipt.find({ alertId: draft.data.alert._id, userId: kalutara._id });
  assert.equal(kalutaraReceipts.length, 3);
  assert.ok(kalutaraReceipts.every((row) => row.language === 'si'));
});

test('reach is zero when the target area has no eligible recipients', async () => {
  const dmc = await officer('DMC_OFFICER');
  const eventRes = await api('/api/events', {
    method: 'POST',
    token: dmc.token,
    body: { name: 'Quiet district', hazardType: 'FLOOD', district: 'Galle' }
  });
  const areaRes = await api('/api/areas', {
    method: 'POST',
    token: dmc.token,
    body: { name: 'Galle coast', district: 'Galle', eventId: eventRes.data.event._id }
  });
  const reach = await api(`/api/areas/${areaRes.data.area._id}/reach`, { token: dmc.token });
  assert.equal(reach.status, 200);
  assert.equal(reach.data.reach, 0);
  assert.equal(reach.data.excluded, 0);
  assert.deepEqual(reach.data.districts, [{ district: 'Galle', eligible: 0 }]);
  assert.deepEqual(reach.data.languages, { en: 0, si: 0, ta: 0 });
});
