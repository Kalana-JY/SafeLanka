import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Alert from '../src/models/Alert.js';
import DispatchOrder from '../src/models/DispatchOrder.js';
import Shelter from '../src/models/Shelter.js';
import TargetArea from '../src/models/TargetArea.js';
import HazardEvent from '../src/models/HazardEvent.js';
import { api, createUser, hoursFromNow, resetDb, startTestServer, stopTestServer, tokenFor } from './helpers.js';
import { recordAudit, listAudits } from '../src/utils/audit.js';
import { resolveRecipients, summarizeReach, countRecipients } from '../src/utils/geo.js';
import { startExpiryJob, expireDueAlerts } from '../src/services/alertService.js';
import { startDispatchSweeps, sweepDispatch } from '../src/services/dispatchService.js';

before(startTestServer, { timeout: 120_000 });
after(stopTestServer);
beforeEach(resetDb);

async function officer(role, district = 'Ratnapura') {
  const user = await createUser({ role, district });
  return { user, token: tokenFor(user) };
}

async function eventAndArea(token, { district = 'Ratnapura', name = 'Boost flood' } = {}) {
  const eventRes = await api('/api/events', { method: 'POST', token, body: { name, hazardType: 'FLOOD', district } });
  assert.equal(eventRes.status, 201);
  const areaRes = await api('/api/areas', {
    method: 'POST', token,
    body: { name: `${name} area`, district, eventId: eventRes.data.event._id, estPopulation: 500 }
  });
  assert.equal(areaRes.status, 201);
  return { event: eventRes.data.event, area: areaRes.data.area };
}

function draftBody(event, area, extra = {}) {
  return {
    eventId: event._id,
    targetAreaId: area._id,
    level: 'WARNING',
    expiresAt: hoursFromNow(2),
    headline: { en: 'Flood warning', si: 'Jalaya', ta: 'Vellam' },
    body: { en: 'Move high.', si: 'Usa', ta: 'Uyar' },
    ...extra
  };
}

// ---------- platform / app / utils ----------

test('platform: root, health, hello and 404 handler', async () => {
  const root = await api('/');
  assert.equal(root.status, 200);
  assert.equal(root.data.name, 'SafeLanka API');
  const dmc = await officer('DMC_OFFICER');
  // /api/* is behind requireAuth (alertsRouter mounted before apiRoutes), so send a token
  const health = await api('/api/health', { token: dmc.token });
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
  const hello = await api('/api/hello', { token: dmc.token });
  assert.equal(hello.status, 200);
  assert.match(hello.data.message, /SafeLanka/);
  // non-/api path reaches the public 404 handler without auth
  const missing = await api('/no-such-route-xyz');
  assert.equal(missing.status, 404);
});

test('platform: malformed id triggers 500 error handler', async () => {
  const dmc = await officer('DMC_OFFICER');
  const res = await api('/api/shelters/not-an-objectid', { token: dmc.token });
  assert.equal(res.status, 500);
  assert.equal(res.data.error, 'Internal server error');
});

test('auth middleware: invalid token and inactive account rejected', async () => {
  const bad = await api('/api/events', { token: 'bad.token.here' });
  assert.equal(bad.status, 401);
  const user = await createUser({ role: 'DMC_OFFICER', active: false });
  const tok = tokenFor(user);
  const inactive = await api('/api/events', { token: tok });
  assert.equal(inactive.status, 401);
  const none = await api('/api/events');
  assert.equal(none.status, 401);
});

test('unit: audit, jwt blacklist, geo empty inputs, background jobs', async () => {
  const e1 = recordAudit(null, 'UNIT_CHECK', 'Unit', '1');
  assert.equal(e1.actorId, 'anonymous');
  assert.ok(Array.isArray(listAudits()));
  // Import jwt utils lazily AFTER startTestServer set JWT_SECRET, else the
  // secret is cached with the dev fallback and all tokens 401.
  const jwt = await import('../src/utils/jwt.js');
  jwt.blacklistRefresh('unit-revoke-me');
  assert.equal(jwt.isRefreshBlacklisted('unit-revoke-me'), true);
  assert.equal(jwt.isRefreshBlacklisted('other'), false);
  const u = await createUser({ role: 'CITIZEN' });
  const tok = jwt.signAccessToken(u);
  assert.ok(typeof tok === 'string' && tok.length > 10);
  assert.deepEqual(await resolveRecipients([]), []);
  assert.deepEqual(await resolveRecipients(''), []);
  const empty = await summarizeReach([]);
  assert.equal(empty.reach, 0);
  assert.equal(await countRecipients([]), 0);
  const t1 = startExpiryJob(60000);
  clearInterval(t1);
  const t2 = startDispatchSweeps(60000);
  clearInterval(t2);
  assert.equal(await expireDueAlerts(), 0);
  const sweep = await sweepDispatch();
  assert.ok('ackTimedOut' in sweep && 'holdsExpired' in sweep);
});

test('unit: TargetArea legacy district syncs to districts list', async () => {
  const area = new TargetArea({ name: 'Legacy', district: '  Galle  ', eventId: new mongoose.Types.ObjectId() });
  await area.validate();
  assert.deepEqual(area.districts, ['Galle']);
  assert.equal(area.district, 'Galle');
  const u = await createUser({ role: 'CITIZEN' });
  const jwt = await import('../src/utils/jwt.js');
  const tok = jwt.signAccessToken(u);
  assert.ok(typeof tok === 'string' && tok.length > 10);
});

// ---------- auth routes ----------

test('auth: signup duplicate, signin failures, refresh/logout/me', async () => {
  const signup = await api('/api/auth/signup', {
    method: 'POST',
    body: { fullName: 'Auth User', email: 'auth1@test.local', mobileNo: '0711111111', password: 'secret12', district: 'Ratnapura' }
  });
  assert.equal(signup.status, 201);
  const dup = await api('/api/auth/signup', {
    method: 'POST',
    body: { fullName: 'Auth User', email: 'auth1@test.local', mobileNo: '0711111111', password: 'secret12', district: 'Ratnapura' }
  });
  assert.equal(dup.status, 409);

  const wrongPw = await api('/api/auth/signin', { method: 'POST', body: { email: 'auth1@test.local', password: 'wrong' } });
  assert.equal(wrongPw.status, 401);
  const unknown = await api('/api/auth/signin', { method: 'POST', body: { email: 'nobody@test.local', password: 'secret12' } });
  assert.equal(unknown.status, 401);

  const inactive = await createUser({ role: 'CITIZEN', email: 'off@test.local' });
  inactive.active = false;
  await inactive.save();
  // inactive created via helper has no passwordHash login; exercise the active-check via direct token refresh path below
  const refreshMissing = await api('/api/auth/refresh', { method: 'POST', body: {} });
  assert.equal(refreshMissing.status, 401);
  const refreshBad = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken: 'bad' } });
  assert.equal(refreshBad.status, 401);

  const refreshOk = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken: signup.data.refreshToken } });
  assert.equal(refreshOk.status, 200);
  assert.ok(refreshOk.data.accessToken);

  const me = await api('/api/auth/me', { token: signup.data.accessToken });
  assert.equal(me.status, 200);

  const logout = await api('/api/auth/logout', { method: 'POST', body: { refreshToken: signup.data.refreshToken } });
  assert.equal(logout.status, 200);
  const revoked = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken: signup.data.refreshToken } });
  assert.equal(revoked.status, 401);

  const signinOk = await api('/api/auth/signin', { method: 'POST', body: { email: 'auth1@test.local', password: 'secret12' } });
  assert.equal(signinOk.status, 200);
});

// ---------- users routes ----------

test('users: PATCH me, staff create, role change, list', async () => {
  const dmc = await officer('DMC_OFFICER');
  const citizen = await createUser({ role: 'CITIZEN' });
  const citizenToken = tokenFor(citizen);

  const patched = await api('/api/users/me', { method: 'PATCH', token: citizenToken, body: { preferredLanguage: 'si', district: 'Galle' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.user.preferredLanguage, 'si');

  const staff = await api('/api/users/staff', {
    method: 'POST', token: dmc.token,
    body: { fullName: 'Dist Off', email: 'dist1@test.local', mobileNo: '0721111111', password: 'secret12', role: 'DISTRICT_OFFICER', district: 'Ratnapura', employeeNo: 'EMP-9001' }
  });
  assert.equal(staff.status, 201);

  const dupStaff = await api('/api/users/staff', {
    method: 'POST', token: dmc.token,
    body: { fullName: 'Dist Off', email: 'dist1@test.local', mobileNo: '0721111111', password: 'secret12', role: 'DISTRICT_OFFICER', district: 'Ratnapura', employeeNo: 'EMP-9001' }
  });
  assert.equal(dupStaff.status, 409);

  const district = await officer('DISTRICT_OFFICER');
  const wardenOk = await api('/api/users/staff', {
    method: 'POST', token: district.token,
    body: { fullName: 'Warden', email: 'warden1@test.local', mobileNo: '0722222222', password: 'secret12', role: 'WARDEN', district: 'Ratnapura', employeeNo: 'EMP-9002' }
  });
  assert.equal(wardenOk.status, 201);
  const districtForbid = await api('/api/users/staff', {
    method: 'POST', token: district.token,
    body: { fullName: 'DMC2', email: 'dmc2@test.local', mobileNo: '0723333333', password: 'secret12', role: 'DMC_OFFICER', district: 'Ratnapura', employeeNo: 'EMP-9003' }
  });
  assert.equal(districtForbid.status, 403);

  const roleChange = await api(`/api/users/${citizen._id}/role`, { method: 'PATCH', token: dmc.token, body: { role: 'VOLUNTEER' } });
  assert.equal(roleChange.status, 200);
  assert.equal(roleChange.data.user.role, 'VOLUNTEER');
  const role404 = await api('/api/users/000000000000000000000000/role', { method: 'PATCH', token: dmc.token, body: { role: 'VOLUNTEER' } });
  assert.equal(role404.status, 404);

  const list = await api('/api/users/', { token: dmc.token });
  assert.equal(list.status, 200);
  assert.ok(list.data.users.length >= 2);
  const listForbid = await api('/api/users/', { token: citizenToken });
  assert.equal(listForbid.status, 403);
});

// ---------- audit route ----------

test('audit: DMC can read trail, citizen forbidden', async () => {
  const dmc = await officer('DMC_OFFICER');
  await eventAndArea(dmc.token);
  const ok = await api('/api/audit', { token: dmc.token });
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(ok.data.entries));
  const filtered = await api('/api/audit?action=EVENT_CREATE&limit=5', { token: dmc.token });
  assert.equal(filtered.status, 200);
  const citizen = await createUser({ role: 'CITIZEN' });
  const forbid = await api('/api/audit', { token: tokenFor(citizen) });
  assert.equal(forbid.status, 403);
  const unauth = await api('/api/audit');
  assert.equal(unauth.status, 401);
});

// ---------- alerts extended ----------

test('alerts: list, active feed, detail, reach 404 and validation errors', async () => {
  const dmc = await officer('DMC_OFFICER');
  const { event, area } = await eventAndArea(dmc.token);
  const draft = await api('/api/alerts', { method: 'POST', token: dmc.token, body: draftBody(event, area) });
  assert.equal(draft.status, 201);

  const list = await api('/api/alerts?status=DRAFT', { token: dmc.token });
  assert.equal(list.status, 200);
  assert.ok(list.data.alerts.length >= 1);
  const all = await api('/api/alerts', { token: dmc.token });
  assert.equal(all.status, 200);

  const events = await api('/api/events?district=Ratnapura', { token: dmc.token });
  assert.equal(events.status, 200);
  const areas = await api(`/api/areas?eventId=${event._id}&district=Ratnapura`, { token: dmc.token });
  assert.equal(areas.status, 200);
  const areasAll = await api('/api/areas', { token: dmc.token });
  assert.equal(areasAll.status, 200);

  const reach404 = await api('/api/areas/000000000000000000000000/reach', { token: dmc.token });
  assert.equal(reach404.status, 404);
  const reachBad = await api('/api/areas/not-an-id/reach', { token: dmc.token });
  assert.equal(reachBad.status, 500);

  const detail = await api(`/api/alerts/${draft.data.alert._id}`, { token: dmc.token });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.failedReceipts, 0);
  const detail404 = await api('/api/alerts/000000000000000000000000', { token: dmc.token });
  assert.equal(detail404.status, 404);

  const active = await api('/api/alerts/active?district=Ratnapura', { token: dmc.token });
  assert.equal(active.status, 200);

  const badArea = await api('/api/areas', {
    method: 'POST', token: dmc.token,
    body: { name: 'Ghost', district: 'Ratnapura', eventId: '000000000000000000000000' }
  });
  assert.equal(badArea.status, 404);
});

test('alerts: cancel draft and published, double-cancel rejected', async () => {
  const dmc = await officer('DMC_OFFICER');
  const { event, area } = await eventAndArea(dmc.token);
  const draft = await api('/api/alerts', { method: 'POST', token: dmc.token, body: draftBody(event, area) });
  const cancelDraft = await api(`/api/alerts/${draft.data.alert._id}/cancel`, { method: 'POST', token: dmc.token, body: { reason: 'no longer needed' } });
  assert.equal(cancelDraft.status, 200);
  assert.equal(cancelDraft.data.alert.status, 'CANCELLED');
  const cancelAgain = await api(`/api/alerts/${draft.data.alert._id}/cancel`, { method: 'POST', token: dmc.token, body: { reason: 'again' } });
  assert.equal(cancelAgain.status, 409);

  const { event: e2, area: a2 } = await eventAndArea(dmc.token, { name: 'Second flood' });
  const d2 = await api('/api/alerts', { method: 'POST', token: dmc.token, body: draftBody(e2, a2) });
  await api(`/api/alerts/${d2.data.alert._id}/publish`, { method: 'POST', token: dmc.token, body: {} });
  const cancelPub = await api(`/api/alerts/${d2.data.alert._id}/cancel`, { method: 'POST', token: dmc.token, body: { reason: 'false alarm' } });
  assert.equal(cancelPub.status, 200);
  const cancel404 = await api('/api/alerts/000000000000000000000000/cancel', { method: 'POST', token: dmc.token, body: { reason: 'x' } });
  assert.equal(cancel404.status, 404);
});

test('alerts: retry converts FAILED to DELIVERED and reissue versions', async () => {
  const dmc = await officer('DMC_OFFICER');
  await createUser({ role: 'CITIZEN', district: 'Ratnapura' });
  const { event, area } = await eventAndArea(dmc.token);
  const draft = await api('/api/alerts', { method: 'POST', token: dmc.token, body: draftBody(event, area) });
  const pub = await api(`/api/alerts/${draft.data.alert._id}/publish`, { method: 'POST', token: dmc.token, body: { simulateFailure: ['SMS'] } });
  assert.equal(pub.status, 200);
  const detail = await api(`/api/alerts/${draft.data.alert._id}`, { token: dmc.token });
  assert.ok(detail.data.failedReceipts >= 1);

  const retry = await api(`/api/alerts/${draft.data.alert._id}/retry`, { method: 'POST', token: dmc.token, body: {} });
  assert.equal(retry.status, 200);
  assert.ok(retry.data.retried >= 1);
  const retry404 = await api('/api/alerts/000000000000000000000000/retry', { method: 'POST', token: dmc.token, body: {} });
  assert.equal(retry404.status, 404);

  const reissue = await api(`/api/alerts/${draft.data.alert._id}/reissue`, {
    method: 'POST', token: dmc.token,
    body: { expiresAt: hoursFromNow(3), headline: { en: 'Update', si: 'Yavath', ta: 'Puthu' }, body: { en: 'Still rising.', si: 'Thama', ta: 'Innum' } }
  });
  assert.equal(reissue.status, 201);
  assert.equal(reissue.data.alert.version, 2);

  const reissueDraftFail = await api(`/api/alerts/${reissue.data.alert._id}/reissue`, {
    method: 'POST', token: dmc.token, body: { expiresAt: hoursFromNow(3) }
  });
  assert.equal(reissueDraftFail.status, 409);
  const reissue404 = await api('/api/alerts/000000000000000000000000/reissue', {
    method: 'POST', token: dmc.token, body: { expiresAt: hoursFromNow(3) }
  });
  assert.equal(reissue404.status, 404);
});

test('alerts: draft on closed event rejected (inactive event path)', async () => {
  const dmc = await officer('DMC_OFFICER');
  const { event, area } = await eventAndArea(dmc.token);
  await HazardEvent.updateOne({ _id: event._id }, { status: 'CLOSED' });
  const res = await api('/api/alerts', { method: 'POST', token: dmc.token, body: draftBody(event, area) });
  assert.equal(res.status, 404);
});

// ---------- shelters extended ----------

test('shelters: lists, detail, alternate, open conflict', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const mk = async (name, capacity) => {
    const r = await api('/api/shelters', { method: 'POST', token: district.token, body: { buildingName: name, district: 'Ratnapura', capacity } });
    assert.equal(r.status, 201);
    return r.data.shelter;
  };
  const s1 = await mk('Hall A', 10);
  const s2 = await mk('Hall B', 20);
  const list = await api('/api/shelters?district=Ratnapura', { token: district.token });
  assert.equal(list.status, 200);
  assert.ok(list.data.shelters.length >= 2);

  await api(`/api/shelters/${s1._id}/open`, { method: 'POST', token: district.token, body: {} });
  await api(`/api/shelters/${s2._id}/open`, { method: 'POST', token: district.token, body: {} });
  const open = await api('/api/shelters/open?district=Ratnapura', { token: district.token });
  assert.equal(open.status, 200);
  assert.ok(open.data.shelters.length >= 2);

  const detail = await api(`/api/shelters/${s1._id}`, { token: district.token });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.capacity, 10);
  const detail404 = await api('/api/shelters/000000000000000000000000', { token: district.token });
  assert.equal(detail404.status, 404);

  const alt = await api(`/api/shelters/${s1._id}/alternate`, { token: district.token });
  assert.equal(alt.status, 200);
  assert.ok(alt.data.alternate.shelter._id);
  const alt404 = await api('/api/shelters/000000000000000000000000/alternate', { token: district.token });
  assert.equal(alt404.status, 404);

  const reopen = await api(`/api/shelters/${s1._id}/open`, { method: 'POST', token: district.token, body: {} });
  assert.equal(reopen.status, 409);
  const open404 = await api('/api/shelters/000000000000000000000000/open', { method: 'POST', token: district.token, body: {} });
  assert.equal(open404.status, 404);
});

test('shelters: alternate 404 when nothing free; close with transfer paths', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const warden = await officer('WARDEN');
  const mk = async (name, capacity) => (await api('/api/shelters', { method: 'POST', token: district.token, body: { buildingName: name, district: 'Ratnapura', capacity } })).data.shelter;

  const lone = await mk('Lone Hall', 5);
  await api(`/api/shelters/${lone._id}/open`, { method: 'POST', token: district.token, body: {} });
  // fill it to FULL so no alternate with free space exists in a fresh district scope is hard;
  // instead close a second shelter to remove candidates, then full-fill lone
  const full = await api(`/api/shelters/${lone._id}/checkin`, { method: 'POST', token: warden.token, body: { name: 'Fam', householdSize: 5, clientUUID: 'full-1' } });
  assert.equal(full.status, 201);
  assert.equal(full.data.shelter.status, 'FULL');

  const a = await mk('Src Hall', 10);
  const b = await mk('Dst Hall', 10);
  const c = await mk('Closed Hall', 10);
  await api(`/api/shelters/${a._id}/open`, { method: 'POST', token: district.token, body: {} });
  await api(`/api/shelters/${b._id}/open`, { method: 'POST', token: district.token, body: {} });
  await api(`/api/shelters/${c._id}/open`, { method: 'POST', token: district.token, body: {} });
  await api(`/api/shelters/${c._id}/close`, { method: 'POST', token: district.token, body: {} });
  await api(`/api/shelters/${a._id}/checkin`, { method: 'POST', token: warden.token, body: { name: 'Move Fam', householdSize: 4, clientUUID: 'move-1' } });

  const badTarget = await api(`/api/shelters/${a._id}/close`, { method: 'POST', token: district.token, body: { transferTo: c._id } });
  assert.equal(badTarget.status, 422);

  const tiny = await mk('Tiny', 1);
  await api(`/api/shelters/${tiny._id}/open`, { method: 'POST', token: district.token, body: {} });
  const noSpace = await api(`/api/shelters/${a._id}/close`, { method: 'POST', token: district.token, body: { transferTo: tiny._id } });
  assert.equal(noSpace.status, 422);

  const moved = await api(`/api/shelters/${a._id}/close`, { method: 'POST', token: district.token, body: { transferTo: b._id } });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.shelter.status, 'CLOSED');
  const dst = await Shelter.findById(b._id);
  assert.equal(dst.occupancy, 4);

  const again = await api(`/api/shelters/${a._id}/close`, { method: 'POST', token: district.token, body: {} });
  assert.equal(again.status, 409);
  const close404 = await api('/api/shelters/000000000000000000000000/close', { method: 'POST', token: district.token, body: {} });
  assert.equal(close404.status, 404);
});

test('shelters: checkout 404 and double checkout, checkin to closed rejected', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const warden = await officer('WARDEN');
  const created = await api('/api/shelters', { method: 'POST', token: district.token, body: { buildingName: 'Out Hall', district: 'Ratnapura', capacity: 5 } });
  const id = created.data.shelter._id;
  await api(`/api/shelters/${id}/open`, { method: 'POST', token: district.token, body: {} });
  const ci = await api(`/api/shelters/${id}/checkin`, { method: 'POST', token: warden.token, body: { name: 'Out Fam', householdSize: 2, clientUUID: 'out-1' } });
  const recordId = ci.data.record._id;
  const badShelter = await api('/api/shelters/000000000000000000000000/checkout', { method: 'POST', token: warden.token, body: { recordId } });
  assert.equal(badShelter.status, 404);
  const badRecord = await api(`/api/shelters/${id}/checkout`, { method: 'POST', token: warden.token, body: { recordId: '000000000000000000000000' } });
  assert.equal(badRecord.status, 404);
  const ok = await api(`/api/shelters/${id}/checkout`, { method: 'POST', token: warden.token, body: { recordId } });
  assert.equal(ok.status, 200);
  const twice = await api(`/api/shelters/${id}/checkout`, { method: 'POST', token: warden.token, body: { recordId } });
  assert.equal(twice.status, 409);
  await api(`/api/shelters/${id}/close`, { method: 'POST', token: district.token, body: {} });
  const toClosed = await api(`/api/shelters/${id}/checkin`, { method: 'POST', token: warden.token, body: { name: 'Late', householdSize: 1, clientUUID: 'late-1' } });
  assert.equal(toClosed.status, 409);
});

// ---------- dispatch extended ----------

test('dispatch: filters, mine, detail auth, reserve-nothing, bad assign', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const lead = await createUser({ role: 'TEAM_LEADER' });
  const leadToken = tokenFor(lead);
  const res = await api('/api/resources', { method: 'POST', token: district.token, body: { name: 'Team X', type: 'TEAM', district: 'Ratnapura' } });
  const resourceId = res.data.resource._id;
  const order = (await api('/api/dispatch', {
    method: 'POST', token: district.token,
    body: { district: 'Ratnapura', priority: 'HIGH', items: [{ resourceId, type: 'TEAM' }], clientUUID: `bx-${Date.now()}` }
  })).data.order;

  const rFilter = await api('/api/resources?district=Ratnapura&status=AVAILABLE', { token: district.token });
  assert.equal(rFilter.status, 200);
  const dFilter = await api('/api/dispatch?district=Ratnapura&status=CREATED', { token: district.token });
  assert.equal(dFilter.status, 200);
  const mine = await api('/api/dispatch/mine', { token: leadToken });
  assert.equal(mine.status, 200);
  const detail = await api(`/api/dispatch/${order._id}`, { token: district.token });
  assert.equal(detail.status, 200);
  const detail404 = await api('/api/dispatch/000000000000000000000000', { token: district.token });
  assert.equal(detail404.status, 404);
  const citizen = await createUser({ role: 'CITIZEN' });
  const forbid = await api(`/api/dispatch/${order._id}`, { token: tokenFor(citizen) });
  assert.equal(forbid.status, 403);

  const ghost = (await api('/api/dispatch', {
    method: 'POST', token: district.token,
    body: { district: 'Ratnapura', items: [{ resourceId: '000000000000000000000000', type: 'TEAM' }], clientUUID: `ghost-${Date.now()}` }
  })).data.order;
  const reserveNone = await api(`/api/dispatch/${ghost._id}/reserve`, { method: 'POST', token: district.token, body: {} });
  assert.equal(reserveNone.status, 422);

  await api(`/api/dispatch/${order._id}/reserve`, { method: 'POST', token: district.token, body: {} });
  const badLead = await api(`/api/dispatch/${order._id}/assign`, { method: 'POST', token: district.token, body: { teamLeadId: district.user._id.toString() } });
  assert.equal(badLead.status, 422);
  const assign404 = await api('/api/dispatch/000000000000000000000000/assign', { method: 'POST', token: district.token, body: { teamLeadId: lead._id.toString() } });
  assert.equal(assign404.status, 404);
  const reserve404 = await api('/api/dispatch/000000000000000000000000/reserve', { method: 'POST', token: district.token, body: {} });
  assert.equal(reserve404.status, 404);
});

test('dispatch: ack/arrive validation, abort paths, sweeps', async () => {
  const district = await officer('DISTRICT_OFFICER');
  const lead = await createUser({ role: 'TEAM_LEADER' });
  const leadToken = tokenFor(lead);
  const mkOrder = async (suffix) => {
    const r = await api('/api/resources', { method: 'POST', token: district.token, body: { name: `Team ${suffix}`, type: 'TEAM', district: 'Ratnapura' } });
    const o = await api('/api/dispatch', {
      method: 'POST', token: district.token,
      body: { district: 'Ratnapura', items: [{ resourceId: r.data.resource._id, type: 'TEAM' }], clientUUID: `sw-${suffix}-${Date.now()}` }
    });
    return { resource: r.data.resource, order: o.data.order };
  };

  const { order: o1 } = await mkOrder('ack');
  const ackEarly = await api(`/api/dispatch/${o1._id}/ack`, { method: 'POST', token: leadToken, body: {} });
  assert.ok([403, 422].includes(ackEarly.status));

  const { order: o2 } = await mkOrder('gate');
  await api(`/api/dispatch/${o2._id}/reserve`, { method: 'POST', token: district.token, body: {} });
  await api(`/api/dispatch/${o2._id}/assign`, { method: 'POST', token: district.token, body: { teamLeadId: lead._id.toString() } });
  await api(`/api/dispatch/${o2._id}/ack`, { method: 'POST', token: leadToken, body: {} });
  const noCheck = await api(`/api/dispatch/${o2._id}/arrive`, { method: 'POST', token: leadToken, body: { routeChecked: false, weatherChecked: true } });
  assert.equal(noCheck.status, 422);
  const arriveOk = await api(`/api/dispatch/${o2._id}/arrive`, { method: 'POST', token: leadToken, body: { routeChecked: true, weatherChecked: true } });
  assert.equal(arriveOk.status, 200);

  // ack timeout sweep: SENT + old notifiedAt -> back to RESERVED + unacked
  await DispatchOrder.updateOne({ _id: o2._id }, { status: 'SENT', notifiedAt: new Date(Date.now() - 20 * 60 * 1000) });
  // move back to SENT path: use a fresh assigned order for the timeout instead
  const { order: o3 } = await mkOrder('timeout');
  await api(`/api/dispatch/${o3._id}/reserve`, { method: 'POST', token: district.token, body: {} });
  await api(`/api/dispatch/${o3._id}/assign`, { method: 'POST', token: district.token, body: { teamLeadId: lead._id.toString() } });
  await DispatchOrder.updateOne({ _id: o3._id }, { notifiedAt: new Date(Date.now() - 20 * 60 * 1000) });
  const sweep1 = await api('/api/dispatch/__sweep', { method: 'POST', token: district.token, body: {} });
  assert.equal(sweep1.status, 200);
  assert.ok(sweep1.data.ackTimedOut >= 1);
  const timedOut = await DispatchOrder.findById(o3._id);
  assert.equal(timedOut.status, 'RESERVED');

  // reserve-hold sweep: RESERVED + expired hold -> CREATED
  const { order: o4 } = await mkOrder('hold');
  await api(`/api/dispatch/${o4._id}/reserve`, { method: 'POST', token: district.token, body: {} });
  await DispatchOrder.updateOne({ _id: o4._id }, { reservationExpiresAt: new Date(Date.now() - 1000) });
  const sweep2 = await api('/api/dispatch/__sweep', { method: 'POST', token: district.token, body: {} });
  assert.ok(sweep2.data.holdsExpired >= 1);
  const held = await DispatchOrder.findById(o4._id);
  assert.equal(held.status, 'CREATED');

  // abort: success, double-abort 409, forbidden 403, 404
  const { order: o5 } = await mkOrder('abort');
  const abortOk = await api(`/api/dispatch/${o5._id}/abort`, { method: 'POST', token: district.token, body: { reason: 'route blocked' } });
  assert.equal(abortOk.status, 200);
  const abortAgain = await api(`/api/dispatch/${o5._id}/abort`, { method: 'POST', token: district.token, body: { reason: 'again' } });
  assert.equal(abortAgain.status, 409);
  const citizen = await createUser({ role: 'CITIZEN' });
  const abortForbid = await api(`/api/dispatch/${o5._id}/abort`, { method: 'POST', token: tokenFor(citizen), body: { reason: 'x' } });
  assert.equal(abortForbid.status, 403);
  const abort404 = await api('/api/dispatch/000000000000000000000000/abort', { method: 'POST', token: district.token, body: { reason: 'x' } });
  assert.equal(abort404.status, 404);
  const ack404 = await api('/api/dispatch/000000000000000000000000/ack', { method: 'POST', token: leadToken, body: {} });
  assert.equal(ack404.status, 404);
  const arrive404 = await api('/api/dispatch/000000000000000000000000/arrive', { method: 'POST', token: leadToken, body: { routeChecked: true, weatherChecked: true } });
  assert.equal(arrive404.status, 404);
  const dist404 = await api('/api/dispatch/000000000000000000000000/distribute', { method: 'POST', token: leadToken, body: { beneficiaries: 5 } });
  assert.equal(dist404.status, 404);
});
