import { after, afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import GroundReport from '../src/models/GroundReport.js';
import Evidence from '../src/models/Evidence.js';
import VerificationRecord from '../src/models/VerificationRecord.js';
import HazardEvent from '../src/models/HazardEvent.js';
import AuditLog from '../src/models/AuditLog.js';
import { generateReportRef } from '../src/utils/credibility.js';
import { api, createUser, resetDb, startTestServer, stopTestServer, tokenFor } from './helpers.js';

before(startTestServer, { timeout: 120_000 });
after(async () => {
  await resetDb();
  await stopTestServer();
});
beforeEach(resetDb);
afterEach(resetDb);

// ---------------------------------------------------------------- fixtures
let uuidSeq = 0;
function freshUUID(prefix = 'uuid') {
  uuidSeq += 1;
  return `${prefix}-${Date.now()}-${uuidSeq}-${Math.random().toString(36).slice(2, 8)}`;
}

const SAMPLE_BASE64_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function sampleReportPayload(overrides = {}) {
  return {
    hazardType: 'LANDSLIDE',
    description: 'Fresh cracks observed on slope along Aranayake road after heavy rains.',
    lat: 7.15,
    lng: 80.45,
    mediaType: 'PHOTO',
    evidenceBase64: SAMPLE_BASE64_IMAGE,
    clientUUID: freshUUID('uuid'),
    ...overrides
  };
}

async function citizenActor(role = 'CITIZEN', district = 'Kegalle') {
  const user = await createUser({ role, district });
  return { user, token: tokenFor(user) };
}

async function dmcActor(district = 'Ratnapura') {
  const user = await createUser({ role: 'DMC_OFFICER', district });
  return { user, token: tokenFor(user) };
}

function freshSensor() {
  return { sensorStationId: 'ARANAYAKE-RG-01', sensorReadAt: new Date().toISOString() };
}

async function createReportViaApi(citizen, overrides = {}) {
  const res = await api('/api/reports', {
    method: 'POST',
    token: citizen.token,
    body: sampleReportPayload(overrides)
  });
  assert.equal(res.status, 201, `setup report create failed: ${JSON.stringify(res.data)}`);
  return res.data.report;
}

async function seedReport({ reporterId, hazardType = 'FLOOD', credibility = 50, status = 'SUBMITTED', createdAt = null, withPhoto = false }) {
  let ref = generateReportRef();
  for (let i = 0; i < 5 && (await GroundReport.exists({ ref })); i++) ref = generateReportRef();
  const doc = { ref, reporterId, hazardType, description: 'seeded report', lat: 7.15, lng: 80.45, status, credibility, clientUUID: freshUUID('seed') };
  if (createdAt) {
    doc.createdAt = createdAt;
    doc.updatedAt = createdAt;
  }
  const report = await GroundReport.create(doc);
  if (withPhoto) {
    await Evidence.create({ reportId: report._id, mediaType: 'PHOTO', data: SAMPLE_BASE64_IMAGE, sizeKb: 1 });
  }
  return report;
}

// ============================================================
// 1. QUEUE — UC-03 ordering + SLA + auth (reports.js:151-171)
// ============================================================

test('UC-03: DMC queue returns SUBMITTED/UNDER_REVIEW ranked by severity x credibility + age', async () => {
  const dmc = await dmcActor();
  const c1 = await citizenActor('CITIZEN', 'Kegalle');
  const c2 = await citizenActor('CITIZEN', 'Kegalle');
  const c3 = await citizenActor('CITIZEN', 'Kegalle');

  // Same age (waitingMin ~0) so rank = weight * credibility.
  // FLOOD(3)*80=240 > TSUNAMI(4)*50=200 > OTHER(1)*90=90
  await seedReport({ reporterId: c1.user._id, hazardType: 'TSUNAMI', credibility: 50 });
  await seedReport({ reporterId: c2.user._id, hazardType: 'FLOOD', credibility: 80 });
  await seedReport({ reporterId: c3.user._id, hazardType: 'OTHER', credibility: 90 });

  const res = await api('/api/reports/queue', { token: dmc.token });
  assert.equal(res.status, 200);
  assert.equal(res.data.queue.length, 3);
  assert.equal(res.data.queue[0].report.hazardType, 'FLOOD');
  assert.equal(res.data.queue[1].report.hazardType, 'TSUNAMI');
  assert.equal(res.data.queue[2].report.hazardType, 'OTHER');
  assert.ok(typeof res.data.queue[0].rank === 'number');
  assert.ok(typeof res.data.queue[0].waitingMin === 'number');
  assert.equal(res.data.queue[0].slaBreached, false);
});

test('UC-03: Queue flags SLA breach when QUEUED > 15min and excludes decided reports', async () => {
  const dmc = await dmcActor();
  const citizen = await citizenActor('CITIZEN', 'Kegalle');

  const oldDate = new Date(Date.now() - 20 * 60 * 1000); // 20 min ago
  const oldReport = await seedReport({ reporterId: citizen.user._id, hazardType: 'FLOOD', credibility: 50, createdAt: oldDate });
  const freshReport = await seedReport({ reporterId: citizen.user._id, hazardType: 'FLOOD', credibility: 50 });
  await seedReport({ reporterId: citizen.user._id, hazardType: 'FLOOD', credibility: 50, status: 'VERIFIED' });
  await seedReport({ reporterId: citizen.user._id, hazardType: 'FLOOD', credibility: 50, status: 'REJECTED' });

  const res = await api('/api/reports/queue', { token: dmc.token });
  assert.equal(res.status, 200);
  assert.equal(res.data.queue.length, 2, 'Only SUBMITTED/UNDER_REVIEW should be queued');

  const oldEntry = res.data.queue.find((q) => q.report._id === oldReport._id.toString());
  const freshEntry = res.data.queue.find((q) => q.report._id === freshReport._id.toString());
  assert.ok(oldEntry, 'Old report must be in queue');
  assert.equal(oldEntry.slaBreached, true, 'QUEUED > 15min must set slaBreached');
  assert.ok(oldEntry.waitingMin >= 19);
  assert.equal(freshEntry.slaBreached, false);
});

test('UC-03: Queue requires DMC role (403 for citizen, 401 unauthenticated)', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');

  const citizenRes = await api('/api/reports/queue', { token: citizen.token });
  assert.equal(citizenRes.status, 403);

  const anonRes = await api('/api/reports/queue');
  assert.equal(anonRes.status, 401);
});

// ============================================================
// 2. LOCK — UC-03 rule 2 pessimistic 5-min lease (verify.js:38-70)
// ============================================================

test('UC-03: DMC can acquire lock; second officer gets 423; holder can re-lock', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  const officerA = await dmcActor();
  const officerB = await dmcActor();
  const report = await createReportViaApi(citizen);

  const lockA = await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: officerA.token });
  assert.equal(lockA.status, 200);
  assert.ok(lockA.data.lockedUntil);
  const leaseMs = new Date(lockA.data.lockedUntil).getTime() - Date.now();
  assert.ok(leaseMs > 4 * 60 * 1000 && leaseMs <= 5 * 60 * 1000 + 10_000, `Lease should be ~5min, got ${leaseMs}ms`);

  const lockB = await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: officerB.token });
  assert.equal(lockB.status, 423, 'Second officer must be blocked with 423');
  assert.match(lockB.data.error, /Locked by another officer/);

  const relockA = await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: officerA.token });
  assert.equal(relockA.status, 200, 'Holder re-lock should succeed (lease renewal)');
});

test('UC-03: Lock release is holder-only; expired lease allows takeover', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  const officerA = await dmcActor();
  const officerB = await dmcActor();
  const report = await createReportViaApi(citizen);

  await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: officerA.token });

  // Non-holder release -> 403
  const badRelease = await api(`/api/reports/${report._id}/lock`, { method: 'DELETE', token: officerB.token });
  assert.equal(badRelease.status, 403);
  assert.match(badRelease.data.error, /Only the lock holder/);

  // Holder release -> ok
  const goodRelease = await api(`/api/reports/${report._id}/lock`, { method: 'DELETE', token: officerA.token });
  assert.equal(goodRelease.status, 200);
  assert.equal(goodRelease.data.released, true);

  const afterRelease = await GroundReport.findById(report._id);
  assert.equal(afterRelease.lockedBy, null);
  assert.equal(afterRelease.lockedUntil, null);

  // Expired lease: simulate abandonment, other officer can take over
  await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: officerA.token });
  await GroundReport.findByIdAndUpdate(report._id, { lockedUntil: new Date(Date.now() - 1000) });
  const takeover = await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: officerB.token });
  assert.equal(takeover.status, 200, 'Expired lease must allow takeover');
  assert.equal(takeover.data.lockedBy, officerB.user._id.toString());
});

test('UC-03: Lock requires DMC role and existing report (403/401/404)', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  const dmc = await dmcActor();
  const report = await createReportViaApi(citizen);

  const citizenLock = await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: citizen.token });
  assert.equal(citizenLock.status, 403);

  const anonLock = await api(`/api/reports/${report._id}/lock`, { method: 'POST' });
  assert.equal(anonLock.status, 401);

  const fakeId = new mongoose.Types.ObjectId().toString();
  const missing = await api(`/api/reports/${fakeId}/lock`, { method: 'POST', token: dmc.token });
  assert.equal(missing.status, 404);
});

// ============================================================
// 3. VERIFY positive — UC-03 rule 4 rubric + record (verify.js:73-155)
// ============================================================

test('UC-03: Verify VERIFIED with fresh sensor + photo succeeds and clears lock', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  const dmc = await dmcActor();
  const report = await createReportViaApi(citizen); // has PHOTO evidence

  await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: dmc.token });

  const res = await api(`/api/reports/${report._id}/verify`, {
    method: 'POST',
    token: dmc.token,
    body: { decision: 'VERIFIED', score: 80, remarks: 'Clear photo, gauge breach confirmed', ...freshSensor() }
  });

  assert.equal(res.status, 200);
  assert.equal(res.data.report.status, 'VERIFIED');
  assert.deepEqual(res.data.sources.sort(), ['photo', 'sensor'].sort());
  assert.equal(res.data.record.decision, 'VERIFIED');
  assert.equal(res.data.record.score, 80);
  assert.equal(res.data.record.sensorStale, false);
  assert.equal(res.data.record.officerId, dmc.user._id.toString());

  const dbReport = await GroundReport.findById(report._id);
  assert.equal(dbReport.status, 'VERIFIED');
  assert.equal(dbReport.lockedBy, null, 'Verify must clear the lock');

  const recordInDb = await VerificationRecord.findOne({ reportId: report._id });
  assert.ok(recordInDb, 'VerificationRecord must be persisted');
});

test('UC-03: Verify UNDER_REVIEW / REJECTED with stale sensor succeeds when capped + noted', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  const dmc = await dmcActor();
  const report = await createReportViaApi(citizen);

  await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: dmc.token });

  // No sensor fields at all -> sensorStale=true; score<=60 + STALE_SENSOR remark required
  const res = await api(`/api/reports/${report._id}/verify`, {
    method: 'POST',
    token: dmc.token,
    body: { decision: 'UNDER_REVIEW', score: 50, remarks: 'STALE_SENSOR: gauge offline, photo unclear, needs field check' }
  });

  assert.equal(res.status, 200);
  assert.equal(res.data.report.status, 'UNDER_REVIEW');
  assert.equal(res.data.record.sensorStale, true);
  assert.ok(res.data.sources.includes('photo'));
});

test('UC-03: Verify writes REPORT_VERIFY audit entry', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  const dmc = await dmcActor();
  const report = await createReportViaApi(citizen);

  await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: dmc.token });
  await api(`/api/reports/${report._id}/verify`, {
    method: 'POST',
    token: dmc.token,
    body: { decision: 'VERIFIED', score: 75, remarks: 'Confirmed', ...freshSensor() }
  });

  await new Promise((r) => setTimeout(r, 20));
  const logs = await AuditLog.find({ entityId: report._id.toString(), action: 'REPORT_VERIFY' });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].entity, 'GroundReport');
});

// ============================================================
// 4. STALE-SENSOR cap — UC-03 rule 5 (verify.js:86-94)
// ============================================================

test('UC-03: Stale sensor caps score at 60 (422 when score > 60)', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  const dmc = await dmcActor();
  const report = await createReportViaApi(citizen);

  await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: dmc.token });

  const res = await api(`/api/reports/${report._id}/verify`, {
    method: 'POST',
    token: dmc.token,
    body: { decision: 'VERIFIED', score: 85, remarks: 'STALE_SENSOR: old reading but looks bad' }
  });

  assert.equal(res.status, 422);
  assert.match(res.data.error, /Stale sensor: score capped at 60/);
});

test('UC-03: Stale sensor requires STALE_SENSOR note in remarks (422 otherwise)', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  const dmc = await dmcActor();
  const report = await createReportViaApi(citizen);

  await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: dmc.token });

  // Old reading (>30min) -> stale even though station id is present
  const oldRead = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const res = await api(`/api/reports/${report._id}/verify`, {
    method: 'POST',
    token: dmc.token,
    body: { decision: 'VERIFIED', score: 55, remarks: 'Gauge offline, photo reviewed', sensorStationId: 'ARANAYAKE-RG-01', sensorReadAt: oldRead }
  });

  assert.equal(res.status, 422);
  assert.match(res.data.error, /remarks must note STALE_SENSOR/);
});

// ============================================================
// 5. TWO-SOURCE escalation + event — UC-03 rule 1 (verify.js:96-143)
// ============================================================

test('UC-03: Escalation needs >=2 sources (422 with photo alone)', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle'); // not volunteer
  const dmc = await dmcActor();
  const report = await createReportViaApi(citizen); // photo only, stale sensor, no 2nd report

  await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: dmc.token });

  const res = await api(`/api/reports/${report._id}/verify`, {
    method: 'POST',
    token: dmc.token,
    body: { decision: 'VERIFIED', score: 55, remarks: 'STALE_SENSOR: single photo only', escalate: 'WARNING' }
  });

  assert.equal(res.status, 422);
  assert.match(res.data.error, /Escalation needs/);
  assert.deepEqual(res.data.sources, ['photo']);
});

test('UC-03: Escalation requires VERIFIED decision (422 for UNDER_REVIEW + escalate)', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  const dmc = await dmcActor();
  const report = await createReportViaApi(citizen);

  await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: dmc.token });

  const res = await api(`/api/reports/${report._id}/verify`, {
    method: 'POST',
    token: dmc.token,
    body: { decision: 'UNDER_REVIEW', score: 80, remarks: 'Needs corroboration', escalate: 'WARNING', ...freshSensor() }
  });

  assert.equal(res.status, 422);
  assert.match(res.data.error, /Escalation requires a VERIFIED decision/);
});

test('UC-03: Escalation with photo + fresh sensor creates ACTIVE HazardEvent', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  const dmc = await dmcActor();
  const report = await createReportViaApi(citizen, { hazardType: 'LANDSLIDE' });

  await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: dmc.token });

  const res = await api(`/api/reports/${report._id}/verify`, {
    method: 'POST',
    token: dmc.token,
    body: { decision: 'VERIFIED', score: 85, remarks: 'Photo + fresh gauge breach', escalate: 'WARNING', ...freshSensor() }
  });

  assert.equal(res.status, 200);
  assert.ok(res.data.event, 'Escalation must return the event');
  assert.equal(res.data.event.level, 'WARNING');
  assert.equal(res.data.event.status, 'ACTIVE');
  assert.equal(res.data.event.district, 'Kegalle', 'Event district follows reporter district');
  assert.equal(res.data.record.escalatedTo, 'WARNING');
  assert.equal(res.data.record.eventId, res.data.event._id);

  const dbEvent = await HazardEvent.findById(res.data.event._id);
  assert.ok(dbEvent);
  assert.equal(dbEvent.level, 'WARNING');
});

test('UC-03: Volunteer corroboration counts as 2nd source (photo + volunteer escalates)', async () => {
  const volunteer = await citizenActor('VOLUNTEER', 'Kegalle');
  const dmc = await dmcActor();
  const report = await createReportViaApi(volunteer); // PHOTO + volunteer reporter

  await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: dmc.token });

  // Stale path (no sensor): sources = photo + volunteer = 2, so escalate passes with capped score
  const res = await api(`/api/reports/${report._id}/verify`, {
    method: 'POST',
    token: dmc.token,
    body: { decision: 'VERIFIED', score: 60, remarks: 'STALE_SENSOR: volunteer + clear photo', escalate: 'WARNING' }
  });

  assert.equal(res.status, 200);
  assert.ok(res.data.sources.includes('photo'));
  assert.ok(res.data.sources.includes('volunteer'));
  assert.equal(res.data.event.level, 'WARNING');
});

test('UC-03: Second independent report counts as 2nd source (photo + second_report)', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  const other = await citizenActor('CITIZEN', 'Kegalle');
  const dmc = await dmcActor();
  const report = await createReportViaApi(citizen);
  const second = await createReportViaApi(other);

  await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: dmc.token });

  const res = await api(`/api/reports/${report._id}/verify`, {
    method: 'POST',
    token: dmc.token,
    body: {
      decision: 'VERIFIED',
      score: 55,
      remarks: 'STALE_SENSOR: two independent photos',
      escalate: 'EVACUATE',
      secondReportIds: [second._id]
    }
  });

  assert.equal(res.status, 200);
  assert.ok(res.data.sources.includes('second_report'));
  assert.equal(res.data.event.level, 'EVACUATE');
});

test('UC-03: Escalation rejects unknown secondReportIds (422)', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  const dmc = await dmcActor();
  const report = await createReportViaApi(citizen);

  await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: dmc.token });

  const fakeId = new mongoose.Types.ObjectId().toString();
  const res = await api(`/api/reports/${report._id}/verify`, {
    method: 'POST',
    token: dmc.token,
    body: {
      decision: 'VERIFIED',
      score: 80,
      remarks: 'Photo + sensor + bad ref',
      escalate: 'WARNING',
      ...freshSensor(),
      secondReportIds: [fakeId]
    }
  });

  assert.equal(res.status, 422);
  assert.match(res.data.error, /Unknown secondReportIds/);
});

test('UC-03: Escalation is raise-only (never downgrades EVACUATE to WARNING)', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  const dmc = await dmcActor();
  const report = await createReportViaApi(citizen, { hazardType: 'FLOOD' });

  // Pre-existing higher-level event in the reporter's district
  await HazardEvent.create({ name: 'Existing flood', hazardType: 'FLOOD', district: 'Kegalle', level: 'EVACUATE', createdBy: dmc.user._id });

  await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: dmc.token });

  const res = await api(`/api/reports/${report._id}/verify`, {
    method: 'POST',
    token: dmc.token,
    body: { decision: 'VERIFIED', score: 85, remarks: 'Corroborated', escalate: 'WARNING', ...freshSensor() }
  });

  assert.equal(res.status, 200);
  assert.equal(res.data.event.level, 'EVACUATE', 'Raise-only: WARNING must not downgrade EVACUATE');
});

// ============================================================
// 6. VERIFY guards — lock, status, auth, validation
// ============================================================

test('UC-03: Verify without lock returns 423; other-officer lock returns 423', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  const officerA = await dmcActor();
  const officerB = await dmcActor();
  const report = await createReportViaApi(citizen);

  const noLock = await api(`/api/reports/${report._id}/verify`, {
    method: 'POST',
    token: officerA.token,
    body: { decision: 'VERIFIED', score: 70, remarks: 'No lock yet', ...freshSensor() }
  });
  assert.equal(noLock.status, 423);
  assert.match(noLock.data.error, /Acquire the lock/);

  await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: officerA.token });
  const wrongHolder = await api(`/api/reports/${report._id}/verify`, {
    method: 'POST',
    token: officerB.token,
    body: { decision: 'VERIFIED', score: 70, remarks: 'Wrong holder', ...freshSensor() }
  });
  assert.equal(wrongHolder.status, 423);
});

test('UC-03: Re-verifying a decided report returns 409', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  const dmc = await dmcActor();
  const report = await createReportViaApi(citizen);

  await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: dmc.token });
  const first = await api(`/api/reports/${report._id}/verify`, {
    method: 'POST',
    token: dmc.token,
    body: { decision: 'VERIFIED', score: 75, remarks: 'First decision', ...freshSensor() }
  });
  assert.equal(first.status, 200);

  // Lock again (lock endpoint allows it) then verify must fail on status
  await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: dmc.token });
  const second = await api(`/api/reports/${report._id}/verify`, {
    method: 'POST',
    token: dmc.token,
    body: { decision: 'REJECTED', score: 20, remarks: 'STALE_SENSOR: second look' }
  });
  assert.equal(second.status, 409);
  assert.match(second.data.error, /already VERIFIED/);
});

test('UC-03: Verify requires DMC role and valid report (403/401/404)', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  const dmc = await dmcActor();
  const report = await createReportViaApi(citizen);
  await api(`/api/reports/${report._id}/lock`, { method: 'POST', token: dmc.token });

  const citizenRes = await api(`/api/reports/${report._id}/verify`, {
    method: 'POST',
    token: citizen.token,
    body: { decision: 'VERIFIED', score: 70, remarks: 'Citizen attempt', ...freshSensor() }
  });
  assert.equal(citizenRes.status, 403);

  const anonRes = await api(`/api/reports/${report._id}/verify`, {
    method: 'POST',
    body: { decision: 'VERIFIED', score: 70, remarks: 'Anon', ...freshSensor() }
  });
  assert.equal(anonRes.status, 401);

  const fakeId = new mongoose.Types.ObjectId().toString();
  // Lock check happens after findById, so missing id -> 404 even with valid body
  await api(`/api/reports/${fakeId}/lock`, { method: 'POST', token: dmc.token }).then((r) => assert.equal(r.status, 404));
  const missing = await api(`/api/reports/${fakeId}/verify`, {
    method: 'POST',
    token: dmc.token,
    body: { decision: 'VERIFIED', score: 70, remarks: 'Missing', ...freshSensor() }
  });
  assert.equal(missing.status, 404);
});

test('UC-03: Verify validation rejects bad score / missing remarks / bad decision (422)', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  const dmc = await dmcActor();

  async function freshLockedReport() {
    const r = await createReportViaApi(citizen, { clientUUID: freshUUID('v') });
    await api(`/api/reports/${r._id}/lock`, { method: 'POST', token: dmc.token });
    return r;
  }

  const r1 = await freshLockedReport();
  const badScore = await api(`/api/reports/${r1._id}/verify`, {
    method: 'POST',
    token: dmc.token,
    body: { decision: 'VERIFIED', score: 150, remarks: 'Too high', ...freshSensor() }
  });
  assert.equal(badScore.status, 422);

  const r2 = await createReportViaApi(await citizenActor('CITIZEN', 'Kegalle'));
  await api(`/api/reports/${r2._id}/lock`, { method: 'POST', token: dmc.token });
  const missingRemarks = await api(`/api/reports/${r2._id}/verify`, {
    method: 'POST',
    token: dmc.token,
    body: { decision: 'VERIFIED', score: 70, remarks: '', ...freshSensor() }
  });
  assert.equal(missingRemarks.status, 422);

  const r3 = await createReportViaApi(await citizenActor('CITIZEN', 'Kegalle'));
  await api(`/api/reports/${r3._id}/lock`, { method: 'POST', token: dmc.token });
  const badDecision = await api(`/api/reports/${r3._id}/verify`, {
    method: 'POST',
    token: dmc.token,
    body: { decision: 'MAYBE', score: 70, remarks: 'Bad enum', ...freshSensor() }
  });
  assert.equal(badDecision.status, 422);
});
