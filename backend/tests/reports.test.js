import { after, afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import GroundReport from '../src/models/GroundReport.js';
import Evidence from '../src/models/Evidence.js';
import AuditLog from '../src/models/AuditLog.js';
import { scoreCredibility, generateReportRef, DEMO_GAUGE } from '../src/utils/credibility.js';
import { distanceM } from '../src/utils/geo.js';
import { api, createUser, resetDb, startTestServer, stopTestServer, tokenFor } from './helpers.js';

before(startTestServer, { timeout: 120_000 });
after(async () => {
  await resetDb();
  await stopTestServer();
});
beforeEach(resetDb);
afterEach(resetDb);

// Helper fixture for creating citizen/volunteer actors with auth tokens
async function citizenActor(role = 'CITIZEN', district = 'Kegalle') {
  const user = await createUser({ role, district });
  return { user, token: tokenFor(user) };
}

// Sample 1x1 transparent PNG base64 for testing evidence payload
const SAMPLE_BASE64_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Standard valid report payload generator
function sampleReportPayload(overrides = {}) {
  const uniqueId = `uuid-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  return {
    hazardType: 'LANDSLIDE',
    description: 'Fresh cracks observed on slope along Aranayake road after heavy rains.',
    lat: 7.15,
    lng: 80.45,
    mediaType: 'PHOTO',
    evidenceBase64: SAMPLE_BASE64_IMAGE,
    clientUUID: uniqueId,
    ...overrides
  };
}

// ============================================================================
// 1. POSITIVE TEST CASES (Happy Path & Core Functionality)
// ============================================================================

test('UC-02: Citizen submits a valid ground report with photo evidence', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  const payload = sampleReportPayload({
    hazardType: 'LANDSLIDE',
    description: 'Active mudslide blocking road near Aranayake hill.',
    lat: 7.15,
    lng: 80.45
  });

  const res = await api('/api/reports', {
    method: 'POST',
    token: citizen.token,
    body: payload
  });

  assert.equal(res.status, 201, 'Expected HTTP 201 Created');
  assert.ok(res.data.report, 'Report object should be returned');
  assert.match(res.data.report.ref, /^GR-\d{4}$/, 'Report reference should match GR-XXXX format');
  assert.equal(res.data.report.hazardType, 'LANDSLIDE');
  assert.equal(res.data.report.description, payload.description);
  assert.equal(res.data.report.lat, 7.15);
  assert.equal(res.data.report.lng, 80.45);
  assert.equal(res.data.report.status, 'SUBMITTED', 'With evidence, status must be SUBMITTED');
  assert.equal(res.data.report.credibility, 50, 'Standard citizen credibility baseline is 50');
  assert.equal(res.data.report.sensorCorroborated, false, 'Far from sensor should not be sensor-corroborated');
  assert.equal(res.data.report.clientUUID, payload.clientUUID);

  // Verify evidence metadata
  assert.ok(Array.isArray(res.data.evidence), 'Evidence list should be an array');
  assert.equal(res.data.evidence.length, 1);
  assert.equal(res.data.evidence[0].mediaType, 'PHOTO');
  assert.ok(res.data.evidence[0].sizeKb >= 0);
  assert.equal(res.data.evidence[0].reportId, res.data.report._id);

  // Verify credibility reasons breakdown
  assert.deepEqual(res.data.credibilityReasons, ['base:50']);
  assert.deepEqual(res.data.possibleDuplicateOf, [], 'No nearby duplicates should exist');

  // Verify DB persistence
  const savedReport = await GroundReport.findById(res.data.report._id);
  assert.ok(savedReport, 'Report must be persisted in database');
  assert.equal(savedReport.reporterId.toString(), citizen.user._id.toString());

  // Verify Audit Log entry
  await new Promise((r) => setTimeout(r, 20));
  const auditLogs = await AuditLog.find({ entityId: res.data.report._id });
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].action, 'REPORT_SUBMIT');
  assert.equal(auditLogs[0].entity, 'GroundReport');
});

test('UC-02: Volunteer submission receives higher credibility score (+20)', async () => {
  const volunteer = await citizenActor('VOLUNTEER', 'Ratnapura');
  const payload = sampleReportPayload({ hazardType: 'FLOOD', description: 'River overflow observed.' });

  const res = await api('/api/reports', {
    method: 'POST',
    token: volunteer.token,
    body: payload
  });

  assert.equal(res.status, 201);
  assert.equal(res.data.report.credibility, 70, 'Volunteer reports receive +20 credibility bonus (50 + 20 = 70)');
  assert.ok(res.data.credibilityReasons.includes('volunteer:+20'));
});

test('UC-02: Report submitted near rain gauge sensor is corroborated and boosted (+15)', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  // Coordinates within ~150m of DEMO_GAUGE (lat: 7.05, lng: 80.23)
  const payload = sampleReportPayload({
    lat: DEMO_GAUGE.lat + 0.001,
    lng: DEMO_GAUGE.lng + 0.001
  });

  const res = await api('/api/reports', {
    method: 'POST',
    token: citizen.token,
    body: payload
  });

  assert.equal(res.status, 201);
  assert.equal(res.data.report.sensorCorroborated, true, 'Report near rain gauge should be sensor-corroborated');
  assert.equal(res.data.report.credibility, 65, 'Sensor proximity adds +15 credibility (50 + 15 = 65)');
  assert.ok(res.data.credibilityReasons.includes('sensor-nearby:+15'));
});

test('UC-02: Volunteer report near sensor receives combined credibility boost (+35)', async () => {
  const volunteer = await citizenActor('VOLUNTEER', 'Kegalle');
  const payload = sampleReportPayload({
    lat: DEMO_GAUGE.lat,
    lng: DEMO_GAUGE.lng
  });

  const res = await api('/api/reports', {
    method: 'POST',
    token: volunteer.token,
    body: payload
  });

  assert.equal(res.status, 201);
  assert.equal(res.data.report.sensorCorroborated, true);
  assert.equal(res.data.report.credibility, 85, 'Volunteer (+20) + Sensor (+15) + Base (50) = 85');
  assert.ok(res.data.credibilityReasons.includes('volunteer:+20'));
  assert.ok(res.data.credibilityReasons.includes('sensor-nearby:+15'));
});

test('UC-02: Report with NO evidence is allowed, marked UNDER_REVIEW, and penalised (-30)', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  // Per UC-02 rule 1: No evidence allowed (e.g. at night/in danger/low-battery)
  const payload = sampleReportPayload({
    evidenceBase64: undefined
  });
  delete payload.evidenceBase64;

  const res = await api('/api/reports', {
    method: 'POST',
    token: citizen.token,
    body: payload
  });

  assert.equal(res.status, 201);
  assert.equal(res.data.report.status, 'UNDER_REVIEW', 'Zero-evidence reports transition to UNDER_REVIEW');
  assert.equal(res.data.report.credibility, 20, 'Zero-evidence reports receive -30 penalty (50 - 30 = 20)');
  assert.ok(res.data.credibilityReasons.includes('no-evidence:-30'));
  assert.deepEqual(res.data.evidence, [], 'No evidence entries should be returned');
});

test('UC-02: Support for alternative media types (VOICE and VIDEO)', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');

  for (const mediaType of ['VOICE', 'VIDEO']) {
    const payload = sampleReportPayload({
      mediaType,
      evidenceBase64: Buffer.from(`sample-${mediaType}-data`).toString('base64'),
      clientUUID: `uuid-${mediaType}-${Date.now()}`
    });

    const res = await api('/api/reports', {
      method: 'POST',
      token: citizen.token,
      body: payload
    });

    assert.equal(res.status, 201);
    assert.equal(res.data.evidence[0].mediaType, mediaType);
  }
});

test('UC-02: Citizen can attach additional evidence to an existing report', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  const payload = sampleReportPayload();
  const createRes = await api('/api/reports', { method: 'POST', token: citizen.token, body: payload });
  assert.equal(createRes.status, 201);
  const reportId = createRes.data.report._id;

  const voicePayload = {
    mediaType: 'VOICE',
    evidenceBase64: Buffer.from('voice-note-evidence-audio').toString('base64')
  };

  const attachRes = await api(`/api/reports/${reportId}/evidence`, {
    method: 'POST',
    token: citizen.token,
    body: voicePayload
  });

  assert.equal(attachRes.status, 201);
  assert.equal(attachRes.data.evidence.mediaType, 'VOICE');
  assert.equal(attachRes.data.evidence.reportId, reportId);

  const totalEvidence = await Evidence.countDocuments({ reportId });
  assert.equal(totalEvidence, 2, 'Report should now have 2 evidence attachments');
});

// ============================================================================
// 2. IDEMPOTENCY & DEDUPLICATION TESTS (UC-02 Rule 2 & 5)
// ============================================================================

test('UC-02: Resending duplicate clientUUID returns the original report idempotently (deduped: true)', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');
  const payload = sampleReportPayload({ clientUUID: 'client-idempotent-key-100' });

  const firstRes = await api('/api/reports', { method: 'POST', token: citizen.token, body: payload });
  assert.equal(firstRes.status, 201);
  assert.equal(firstRes.data.deduped, undefined);

  // Exact retry (e.g. network disconnect retry from offline mobile queue)
  const retryRes = await api('/api/reports', { method: 'POST', token: citizen.token, body: payload });
  assert.equal(retryRes.status, 200, 'Idempotent resend should return HTTP 200 OK');
  assert.equal(retryRes.data.deduped, true, 'Response must indicate report was deduped');
  assert.equal(retryRes.data.report._id, firstRes.data.report._id);
  assert.equal(retryRes.data.report.ref, firstRes.data.report.ref);

  const count = await GroundReport.countDocuments({ clientUUID: 'client-idempotent-key-100' });
  assert.equal(count, 1, 'Only one database document should exist for the clientUUID');
});

test('UC-02: Dedupe advisory flags nearby reports within 500m and 6h with same hazard type', async () => {
  const citizen1 = await citizenActor('CITIZEN', 'Kegalle');
  const citizen2 = await citizenActor('CITIZEN', 'Kegalle');

  // Existing report at (7.1500, 80.4500)
  const report1 = await api('/api/reports', {
    method: 'POST',
    token: citizen1.token,
    body: sampleReportPayload({
      hazardType: 'LANDSLIDE',
      lat: 7.1500,
      lng: 80.4500,
      clientUUID: 'uuid-report-1'
    })
  });
  assert.equal(report1.status, 201);

  // Second citizen submits ~200m away with same hazard type -> should flag duplicate candidate
  const report2 = await api('/api/reports', {
    method: 'POST',
    token: citizen2.token,
    body: sampleReportPayload({
      hazardType: 'LANDSLIDE',
      lat: 7.1515, // ~166m north
      lng: 80.4500,
      clientUUID: 'uuid-report-2'
    })
  });
  assert.equal(report2.status, 201);
  assert.equal(report2.data.possibleDuplicateOf.length, 1, 'Should find 1 duplicate candidate');
  assert.equal(report2.data.possibleDuplicateOf[0].id, report1.data.report._id);
  assert.equal(report2.data.possibleDuplicateOf[0].ref, report1.data.report.ref);
  assert.ok(report2.data.possibleDuplicateOf[0].distanceM <= 500);
});

test('UC-02: Dedupe advisory ignores reports >500m away, of different hazard type, or older than 6h', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');

  // 1. Report far away (>2km away)
  await api('/api/reports', {
    method: 'POST',
    token: citizen.token,
    body: sampleReportPayload({ hazardType: 'LANDSLIDE', lat: 7.20, lng: 80.50, clientUUID: 'uuid-far' })
  });

  // 2. Report nearby but DIFFERENT hazard type (FLOOD instead of LANDSLIDE)
  await api('/api/reports', {
    method: 'POST',
    token: citizen.token,
    body: sampleReportPayload({ hazardType: 'FLOOD', lat: 7.1501, lng: 80.4501, clientUUID: 'uuid-diff-hazard' })
  });

  // 3. Report nearby with same hazard type but OLDER than 6 hours
  const oldReport = new GroundReport({
    ref: 'GR-8888',
    reporterId: citizen.user._id,
    hazardType: 'LANDSLIDE',
    description: 'Old landslide',
    lat: 7.1501,
    lng: 80.4501,
    status: 'SUBMITTED',
    clientUUID: 'uuid-old-6h',
    createdAt: new Date(Date.now() - 7 * 3600 * 1000) // 7 hours ago
  });
  await oldReport.save();

  // Now submit new report at (7.1500, 80.4500)
  const newReport = await api('/api/reports', {
    method: 'POST',
    token: citizen.token,
    body: sampleReportPayload({ hazardType: 'LANDSLIDE', lat: 7.1500, lng: 80.4500, clientUUID: 'uuid-new' })
  });

  assert.equal(newReport.status, 201);
  assert.deepEqual(newReport.data.possibleDuplicateOf, [], 'None of the existing reports should match dedupe criteria');
});

// ============================================================================
// 3. THROTTLING & RATE LIMITING TESTS (UC-02 Rule 2)
// ============================================================================

test('UC-02: Citizen report throttle limits submissions to 5 per hour (6th receives HTTP 429)', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');

  // Submit 5 valid reports in succession
  for (let i = 1; i <= 5; i++) {
    const res = await api('/api/reports', {
      method: 'POST',
      token: citizen.token,
      body: sampleReportPayload({ clientUUID: `uuid-throttle-${i}` })
    });
    assert.equal(res.status, 201, `Report ${i} should succeed`);
  }

  // 6th submission within the hour must be blocked with 429 Too Many Requests
  const blockedRes = await api('/api/reports', {
    method: 'POST',
    token: citizen.token,
    body: sampleReportPayload({ clientUUID: 'uuid-throttle-6' })
  });

  assert.equal(blockedRes.status, 429, '6th report must be throttled');
  assert.match(blockedRes.data.error, /Report limit reached \(5\/hour\)/i);

  // Verify only 5 reports exist in database
  const totalReports = await GroundReport.countDocuments({ reporterId: citizen.user._id });
  assert.equal(totalReports, 5);
});

test('UC-02: Throttle resets after 1 hour and is isolated per user', async () => {
  const citizenA = await citizenActor('CITIZEN', 'Kegalle');
  const citizenB = await citizenActor('CITIZEN', 'Kegalle');

  // Populate 5 reports created >1 hour ago for citizenA
  for (let i = 1; i <= 5; i++) {
    const oldReport = new GroundReport({
      ref: `GR-900${i}`,
      reporterId: citizenA.user._id,
      hazardType: 'FLOOD',
      description: 'Older report',
      lat: 7.15,
      lng: 80.45,
      clientUUID: `uuid-old-throttle-${i}`,
      createdAt: new Date(Date.now() - 3700 * 1000) // 1 hour 1 minute ago
    });
    await oldReport.save();
  }

  // CitizenA can now submit because old reports are outside the 1-hour window
  const resA = await api('/api/reports', {
    method: 'POST',
    token: citizenA.token,
    body: sampleReportPayload({ clientUUID: 'uuid-fresh-a' })
  });
  assert.equal(resA.status, 201, 'Citizen A should be able to submit after hourly window passes');

  // CitizenB is unaffected by CitizenA's report count
  const resB = await api('/api/reports', {
    method: 'POST',
    token: citizenB.token,
    body: sampleReportPayload({ clientUUID: 'uuid-fresh-b' })
  });
  assert.equal(resB.status, 201, 'Citizen B should have independent rate limit');
});

// ============================================================================
// 4. QUERYING & CITIZEN VIEWS (Mine, Notifications, Details, Community)
// ============================================================================

test('UC-02: Citizen can fetch their own reports list via GET /api/reports/mine', async () => {
  const citizen1 = await citizenActor('CITIZEN', 'Kegalle');
  const citizen2 = await citizenActor('CITIZEN', 'Ratnapura');

  // Citizen 1 submits 2 reports
  await api('/api/reports', {
    method: 'POST',
    token: citizen1.token,
    body: sampleReportPayload({ hazardType: 'FLOOD', clientUUID: 'c1-rep-1' })
  });
  await api('/api/reports', {
    method: 'POST',
    token: citizen1.token,
    body: sampleReportPayload({ hazardType: 'LANDSLIDE', clientUUID: 'c1-rep-2' })
  });

  // Citizen 2 submits 1 report
  await api('/api/reports', {
    method: 'POST',
    token: citizen2.token,
    body: sampleReportPayload({ hazardType: 'CYCLONE', clientUUID: 'c2-rep-1' })
  });

  // Citizen 1 retrieves their reports
  const res = await api('/api/reports/mine', { token: citizen1.token });
  assert.equal(res.status, 200);
  assert.equal(res.data.reports.length, 2, 'Citizen 1 should only see their 2 reports');
  assert.ok(res.data.reports[0].report.ref);
  assert.ok(Array.isArray(res.data.reports[0].evidence));
  assert.ok(res.data.reports.every((item) => item.report.reporterId === citizen1.user._id.toString()));
});

test('UC-02: Citizen notifications track status transitions (UNDER_REVIEW -> VERIFIED / REJECTED)', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');

  const rep1 = await api('/api/reports', {
    method: 'POST',
    token: citizen.token,
    body: sampleReportPayload({ hazardType: 'LANDSLIDE', clientUUID: 'notif-1' })
  });
  const rep2 = await api('/api/reports', {
    method: 'POST',
    token: citizen.token,
    body: sampleReportPayload({ hazardType: 'FLOOD', clientUUID: 'notif-2' })
  });

  // Manually update statuses to simulate officer review
  await GroundReport.findByIdAndUpdate(rep1.data.report._id, { status: 'VERIFIED' });
  await GroundReport.findByIdAndUpdate(rep2.data.report._id, { status: 'REJECTED' });

  const res = await api('/api/reports/notifications', { token: citizen.token });
  assert.equal(res.status, 200);
  assert.equal(res.data.notifications.length, 2);

  const verifiedNotif = res.data.notifications.find((n) => n.reportId === rep1.data.report._id);
  assert.equal(verifiedNotif.type, 'ACCEPTED');
  assert.equal(verifiedNotif.title, 'Report Accepted');
  assert.match(verifiedNotif.message, /verified by the DMC Duty Officer/i);

  const rejectedNotif = res.data.notifications.find((n) => n.reportId === rep2.data.report._id);
  assert.equal(rejectedNotif.type, 'REJECTED');
  assert.equal(rejectedNotif.title, 'Report Unverified');
});

test('UC-02: Citizen can view own report details, but other citizens are forbidden', async () => {
  const citizenOwner = await citizenActor('CITIZEN', 'Kegalle');
  const citizenOther = await citizenActor('CITIZEN', 'Colombo');
  const dmcOfficer = await createUser({ role: 'DMC_OFFICER', district: 'Ratnapura' });

  const createRes = await api('/api/reports', {
    method: 'POST',
    token: citizenOwner.token,
    body: sampleReportPayload({ clientUUID: 'owner-rep-1' })
  });
  const reportId = createRes.data.report._id;

  // Owner access -> 200
  const ownerRes = await api(`/api/reports/${reportId}`, { token: citizenOwner.token });
  assert.equal(ownerRes.status, 200);
  assert.equal(ownerRes.data.report._id, reportId);
  assert.ok(Array.isArray(ownerRes.data.evidence));

  // DMC Officer access -> 200
  const dmcRes = await api(`/api/reports/${reportId}`, { token: tokenFor(dmcOfficer) });
  assert.equal(dmcRes.status, 200);

  // Other citizen access -> 403 Forbidden
  const otherRes = await api(`/api/reports/${reportId}`, { token: citizenOther.token });
  assert.equal(otherRes.status, 403);
  assert.match(otherRes.data.error, /Forbidden for role CITIZEN/);
});

test('UC-02: Community reports feed only displays VERIFIED reports', async () => {
  const citizen = await citizenActor('CITIZEN', 'Kegalle');

  const repSubmitted = await api('/api/reports', {
    method: 'POST',
    token: citizen.token,
    body: sampleReportPayload({ clientUUID: 'feed-sub' })
  });
  const repVerified = await api('/api/reports', {
    method: 'POST',
    token: citizen.token,
    body: sampleReportPayload({ clientUUID: 'feed-ver' })
  });

  await GroundReport.findByIdAndUpdate(repVerified.data.report._id, { status: 'VERIFIED' });

  const res = await api('/api/reports/community', { token: citizen.token });
  assert.equal(res.status, 200);
  const reportIds = res.data.reports.map((r) => r.report._id);
  assert.ok(reportIds.includes(repVerified.data.report._id), 'Verified report should appear in community feed');
  assert.ok(!reportIds.includes(repSubmitted.data.report._id), 'Unverified report must NOT appear in community feed');
});

// ============================================================================
// 5. NEGATIVE, VALIDATION & ERROR CASES
// ============================================================================

test('UC-02: Submission rejected when unauthenticated (401)', async () => {
  const res = await api('/api/reports', {
    method: 'POST',
    body: sampleReportPayload()
  });
  assert.equal(res.status, 401);
});

test('UC-02: Submission rejected when role is not CITIZEN or VOLUNTEER (403)', async () => {
  const officerUser = await createUser({ role: 'DMC_OFFICER', district: 'Ratnapura' });
  const res = await api('/api/reports', {
    method: 'POST',
    token: tokenFor(officerUser),
    body: sampleReportPayload()
  });
  assert.equal(res.status, 403);
  assert.match(res.data.error, /Forbidden for role DMC_OFFICER/);
});

test('UC-02: Submission rejected for invalid hazard type (422)', async () => {
  const citizen = await citizenActor('CITIZEN');
  const res = await api('/api/reports', {
    method: 'POST',
    token: citizen.token,
    body: sampleReportPayload({ hazardType: 'ALIEN_INVASION' })
  });
  assert.equal(res.status, 422);
  assert.equal(res.data.error, 'Validation failed');
});

test('UC-02: Submission rejected for missing or empty description (422)', async () => {
  const citizen = await citizenActor('CITIZEN');

  const emptyRes = await api('/api/reports', {
    method: 'POST',
    token: citizen.token,
    body: sampleReportPayload({ description: '' })
  });
  assert.equal(emptyRes.status, 422);

  const missingPayload = sampleReportPayload();
  delete missingPayload.description;
  const missingRes = await api('/api/reports', {
    method: 'POST',
    token: citizen.token,
    body: missingPayload
  });
  assert.equal(missingRes.status, 422);
});

test('UC-02: Submission rejected for description exceeding 2000 characters (422)', async () => {
  const citizen = await citizenActor('CITIZEN');
  const res = await api('/api/reports', {
    method: 'POST',
    token: citizen.token,
    body: sampleReportPayload({ description: 'A'.repeat(2001) })
  });
  assert.equal(res.status, 422);
  assert.equal(res.data.error, 'Validation failed');
});

test('UC-02: Submission rejected for invalid GPS coordinates (422)', async () => {
  const citizen = await citizenActor('CITIZEN');

  const badLatRes = await api('/api/reports', {
    method: 'POST',
    token: citizen.token,
    body: sampleReportPayload({ lat: 95.0 }) // > 90
  });
  assert.equal(badLatRes.status, 422);

  const badLngRes = await api('/api/reports', {
    method: 'POST',
    token: citizen.token,
    body: sampleReportPayload({ lng: 185.0 }) // > 180
  });
  assert.equal(badLngRes.status, 422);
});

test('UC-02: Submission rejected for invalid media type (422)', async () => {
  const citizen = await citizenActor('CITIZEN');
  const res = await api('/api/reports', {
    method: 'POST',
    token: citizen.token,
    body: sampleReportPayload({ mediaType: 'HOLOGRAM' })
  });
  assert.equal(res.status, 422);
});

test('UC-02: Submission rejected when clientUUID is missing (422)', async () => {
  const citizen = await citizenActor('CITIZEN');
  const payload = sampleReportPayload();
  delete payload.clientUUID;

  const res = await api('/api/reports', {
    method: 'POST',
    token: citizen.token,
    body: payload
  });
  assert.equal(res.status, 422);
});

test('UC-02: Attaching evidence to non-existent report returns 404', async () => {
  const citizen = await citizenActor('CITIZEN');
  const fakeId = new GroundReport()._id.toString();

  const res = await api(`/api/reports/${fakeId}/evidence`, {
    method: 'POST',
    token: citizen.token,
    body: { mediaType: 'PHOTO', evidenceBase64: SAMPLE_BASE64_IMAGE }
  });
  assert.equal(res.status, 404);
  assert.equal(res.data.error, 'Report not found');
});

test('UC-02: Fetching non-existent report returns 404', async () => {
  const citizen = await citizenActor('CITIZEN');
  const fakeId = new GroundReport()._id.toString();

  const res = await api(`/api/reports/${fakeId}`, { token: citizen.token });
  assert.equal(res.status, 404);
  assert.equal(res.data.error, 'Report not found');
});

// ============================================================================
// 6. UNIT TESTS FOR CREDIBILITY SCORING & GEO UTILITIES
// ============================================================================

test('Unit: scoreCredibility calculates correct scores across all matrix permutations', () => {
  // 1. Citizen + Evidence + Far from sensor = 50
  const c1 = scoreCredibility({ role: 'CITIZEN', hasEvidence: true, lat: 6.9, lng: 79.8 });
  assert.equal(c1.score, 50);
  assert.equal(c1.nearSensor, false);
  assert.deepEqual(c1.reasons, ['base:50']);

  // 2. Citizen + No Evidence + Far = 20
  const c2 = scoreCredibility({ role: 'CITIZEN', hasEvidence: false, lat: 6.9, lng: 79.8 });
  assert.equal(c2.score, 20);
  assert.equal(c2.nearSensor, false);
  assert.deepEqual(c2.reasons, ['base:50', 'no-evidence:-30']);

  // 3. Citizen + Evidence + Near sensor = 65
  const c3 = scoreCredibility({ role: 'CITIZEN', hasEvidence: true, lat: DEMO_GAUGE.lat, lng: DEMO_GAUGE.lng });
  assert.equal(c3.score, 65);
  assert.equal(c3.nearSensor, true);
  assert.deepEqual(c3.reasons, ['base:50', 'sensor-nearby:+15']);

  // 4. Volunteer + Evidence + Far = 70
  const v1 = scoreCredibility({ role: 'VOLUNTEER', hasEvidence: true, lat: 6.9, lng: 79.8 });
  assert.equal(v1.score, 70);
  assert.deepEqual(v1.reasons, ['base:50', 'volunteer:+20']);

  // 5. Volunteer + Evidence + Near sensor = 85
  const v2 = scoreCredibility({ role: 'VOLUNTEER', hasEvidence: true, lat: DEMO_GAUGE.lat, lng: DEMO_GAUGE.lng });
  assert.equal(v2.score, 85);
  assert.deepEqual(v2.reasons, ['base:50', 'volunteer:+20', 'sensor-nearby:+15']);

  // 6. Volunteer + No Evidence + Near sensor = 55 (50 + 20 - 30 + 15)
  const v3 = scoreCredibility({ role: 'VOLUNTEER', hasEvidence: false, lat: DEMO_GAUGE.lat, lng: DEMO_GAUGE.lng });
  assert.equal(v3.score, 55);
  assert.deepEqual(v3.reasons, ['base:50', 'volunteer:+20', 'no-evidence:-30', 'sensor-nearby:+15']);

  // 7. Score clamping [0, 100]
  assert.ok(c2.score >= 0 && c2.score <= 100);
  assert.ok(v2.score >= 0 && v2.score <= 100);
});

test('Unit: generateReportRef generates valid GR-XXXX format references', () => {
  const refs = new Set();
  for (let i = 0; i < 50; i++) {
    const ref = generateReportRef();
    assert.match(ref, /^GR-\d{4}$/, `Reference ${ref} must match format GR-XXXX`);
    const num = parseInt(ref.replace('GR-', ''), 10);
    assert.ok(num >= 1000 && num <= 9999, 'Number must be 4 digits');
    refs.add(ref);
  }
  assert.ok(refs.size > 40, 'Should generate diverse random references');
});

test('Unit: distanceM calculates Haversine distance correctly', () => {
  // Distance to same point is 0
  assert.equal(distanceM(7.05, 80.23, 7.05, 80.23), 0);

  // Distance between Colombo (6.9271, 79.8612) and Kandy (7.2906, 80.6337) is approx 95km - 105km
  const dist = distanceM(6.9271, 79.8612, 7.2906, 80.6337);
  assert.ok(dist > 90_000 && dist < 110_000, `Expected distance ~100km, got ${dist}`);
});
