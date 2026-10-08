import Alert, { CHANNELS, asLocalized, contentForRecipient, publishLanguageError } from '../models/Alert.js';
import DeliveryReceipt from '../models/DeliveryReceipt.js';
import HazardEvent, { LEVEL_RANK } from '../models/HazardEvent.js';
import TargetArea, { areaDistricts, sharesDistrict } from '../models/TargetArea.js';
import User from '../models/User.js';
import { resolveRecipients, summarizeReach } from '../utils/geo.js';
import { recordAudit } from '../utils/audit.js';

const MAX_EXPIRY_MS = 12 * 3600 * 1000;

export class AlertRuleError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'AlertRuleError';
    this.status = status;
    this.details = details;
  }
}

export function checkExpiry(expiresAt) {
  const exp = new Date(expiresAt);
  if (Number.isNaN(exp.getTime())) return 'expiresAt must be a valid datetime';
  if (exp <= new Date()) return 'expiresAt must be in the future';
  if (exp - new Date() > MAX_EXPIRY_MS) return 'expiresAt must be within 12h (usecase.md UC-01 rule 1)';
  return null;
}

function rejectExpiry(expiresAt) {
  const expiryErr = checkExpiry(expiresAt);
  if (expiryErr) throw new AlertRuleError(422, expiryErr);
}

// Overlap guard (v1 simplification, documented): same event + same district +
// an already PUBLISHED alert that has not expired => treated as >30% overlap.
async function findOverlap(eventId, districts, excludeId = null) {
  const candidates = await Alert.find({
    eventId,
    status: 'PUBLISHED',
    expiresAt: { $gt: new Date() },
    ...(excludeId ? { _id: { $ne: excludeId } } : {})
  }).populate('targetAreaId', 'district districts');
  return candidates.find((a) => sharesDistrict(a.targetAreaId, districts)) || null;
}

async function loadActiveEvent(eventId) {
  const event = await HazardEvent.findById(eventId);
  if (!event || event.status !== 'ACTIVE') {
    throw new AlertRuleError(404, 'Active HazardEvent not found');
  }
  return event;
}

async function loadAreaForEvent(areaId, eventId) {
  const area = await TargetArea.findById(areaId);
  if (!area || area.eventId.toString() !== eventId.toString()) {
    throw new AlertRuleError(404, 'TargetArea not found for this event');
  }
  return area;
}

export async function createDraft({ eventId, targetAreaId, level, headline, body, expiresAt, actorId }) {
  rejectExpiry(expiresAt);
  await loadActiveEvent(eventId);
  const area = await loadAreaForEvent(targetAreaId, eventId);

  const alert = await Alert.create({
    eventId,
    targetAreaId,
    level,
    headline: asLocalized(headline),
    body: asLocalized(body),
    expiresAt,
    createdBy: actorId
  });
  recordAudit(String(actorId), 'ALERT_DRAFT', 'Alert', alert._id.toString());
  const reach = (await summarizeReach(areaDistricts(area))).reach;
  return { alert, reach };
}

async function confirmEvacuation(alert, secondConfirmedBy, actorId) {
  if (alert.level !== 'EVACUATE') return;
  if (!secondConfirmedBy) {
    throw new AlertRuleError(422, 'EVACUATE requires second officer confirmation (maker-checker)');
  }
  const second = await User.findById(secondConfirmedBy);
  if (!second || second.role !== 'DMC_OFFICER' || second._id.toString() === String(actorId)) {
    throw new AlertRuleError(422, 'secondConfirmedBy must be a different active DMC officer');
  }
  alert.secondConfirmedBy = second._id;
}

export async function publishAlert(alertId, { actorId, secondConfirmedBy, simulateFailure } = {}) {
  const alert = await Alert.findById(alertId).populate('targetAreaId');
  if (!alert) throw new AlertRuleError(404, 'Alert not found');
  if (alert.status !== 'DRAFT') {
    throw new AlertRuleError(409, `Only DRAFT alerts can be published (is ${alert.status})`);
  }
  const languageError = publishLanguageError(alert.headline, alert.body);
  if (languageError) throw new AlertRuleError(422, languageError);
  rejectExpiry(alert.expiresAt);
  await confirmEvacuation(alert, secondConfirmedBy, actorId);

  const districts = areaDistricts(alert.targetAreaId);
  const overlap = await findOverlap(alert.eventId.toString(), districts, alert._id);
  if (overlap) {
    throw new AlertRuleError(409, 'Overlapping active alert exists for this event+district', {
      conflictingAlertId: overlap._id
    });
  }

  alert.status = 'PUBLISHED';
  alert.publishedAt = new Date();
  await alert.save();

  const event = await HazardEvent.findById(alert.eventId);
  if (event) await applyLevelToEvent(event, alert.level);

  const summary = await broadcastAlert(alert, {
    districts,
    simulateFailure,
    actorId: String(actorId)
  });
  recordAudit(String(actorId), 'ALERT_PUBLISH', 'Alert', alert._id.toString(), { status: 'DRAFT' }, { status: 'PUBLISHED', version: alert.version });
  return { alert, summary };
}

export async function cancelAlert(alertId, { reason, actorId }) {
  const alert = await Alert.findById(alertId);
  if (!alert) throw new AlertRuleError(404, 'Alert not found');
  if (!['DRAFT', 'PUBLISHED'].includes(alert.status)) {
    throw new AlertRuleError(409, `Cannot cancel alert in status ${alert.status}`);
  }
  alert.status = 'CANCELLED';
  alert.cancelledReason = reason;
  await alert.save();
  recordAudit(String(actorId), 'ALERT_CANCEL', 'Alert', alert._id.toString(), null, { reason });
  return { alert };
}

export async function retryFailedDeliveries(alertId, { actorId }) {
  const alert = await Alert.findById(alertId);
  if (!alert) throw new AlertRuleError(404, 'Alert not found');
  const res2 = await DeliveryReceipt.updateMany(
    { alertId: alert._id, state: 'FAILED' },
    { $set: { state: 'DELIVERED', sentAt: new Date() } }
  );
  const [attempted, delivered, failed] = await Promise.all([
    DeliveryReceipt.countDocuments({ alertId: alert._id }),
    DeliveryReceipt.countDocuments({ alertId: alert._id, state: 'DELIVERED' }),
    DeliveryReceipt.countDocuments({ alertId: alert._id, state: 'FAILED' })
  ]);
  const perChannel = await DeliveryReceipt.aggregate([
    { $match: { alertId: alert._id } },
    { $group: { _id: '$channel', attempted: { $sum: 1 }, delivered: { $sum: { $cond: [{ $eq: ['$state', 'DELIVERED'] }, 1, 0] } } } }
  ]);
  alert.delivery = {
    attempted,
    delivered,
    failed,
    perChannel: perChannel.map((c) => ({ channel: c._id, attempted: c.attempted, delivered: c.delivered, failed: c.attempted - c.delivered }))
  };
  await alert.save();
  recordAudit(String(actorId), 'ALERT_RETRY', 'Alert', alert._id.toString(), null, { retried: res2.modifiedCount });
  return { alert, retried: res2.modifiedCount };
}

export async function reissueAlert(alertId, { level, headline, body, expiresAt, actorId }) {
  const prev = await Alert.findById(alertId);
  if (!prev) throw new AlertRuleError(404, 'Alert not found');
  if (prev.status !== 'PUBLISHED') {
    throw new AlertRuleError(409, 'Only PUBLISHED alerts can be reissued');
  }
  rejectExpiry(expiresAt);

  prev.status = 'CANCELLED';
  prev.cancelledReason = 'superseded by reissue';
  await prev.save();

  const next1 = await Alert.create({
    eventId: prev.eventId,
    targetAreaId: prev.targetAreaId,
    version: prev.version + 1,
    level: level || prev.level,
    headline: asLocalized(headline || prev.headline),
    body: asLocalized(body || prev.body),
    expiresAt,
    createdBy: actorId,
    previousAlertId: prev._id
  });
  recordAudit(String(actorId), 'ALERT_REISSUE', 'Alert', next1._id.toString(), { version: prev.version }, { version: next1.version });
  return { alert: next1, previousAlertId: prev._id };
}

// Dev-only failure injection: POST /publish { simulateFailure: ['SMS'] }
// exercises the E1 partial-failure path (UC-01 exception flow E1).
function channelFails(channel, simulateFailure) {
  return (simulateFailure || []).includes(channel);
}

export async function broadcastAlert(alert, { district, districts, simulateFailure = [], actorId } = {}) {
  const recipients = await resolveRecipients(districts?.length ? districts : district);
  const docs = [];
  const summary = { attempted: 0, delivered: 0, failed: 0, perChannel: [] };

  for (const channel of CHANNELS) {
    let delivered = 0;
    for (const r of recipients) {
      const failed = channelFails(channel, simulateFailure);
      const content = contentForRecipient(alert.headline, alert.body, r.preferredLanguage);
      docs.push({
        alertId: alert._id,
        userId: r._id,
        channel,
        state: failed ? 'FAILED' : 'DELIVERED',
        language: content.language,
        headline: content.headline
      });
      if (failed) summary.failed += 1;
      else {
        delivered += 1;
        summary.delivered += 1;
      }
      summary.attempted += 1;
    }
    summary.perChannel.push({
      channel,
      attempted: recipients.length,
      delivered,
      failed: recipients.length - delivered
    });
  }

  if (docs.length) await DeliveryReceipt.insertMany(docs, { ordered: false });
  alert.delivery = summary;
  await alert.save();
  recordAudit(actorId, 'ALERT_BROADCAST', 'Alert', alert._id.toString(), null, summary);
  return summary;
}

export async function applyLevelToEvent(event, level) {
  if (level === 'ALL_CLEAR') {
    event.status = 'CLOSED';
    event.level = 'ALL_CLEAR';
  } else if (LEVEL_RANK[level] > LEVEL_RANK[event.level]) {
    event.level = level; // raise-only; publishing never lowers the event level
  }
  await event.save();
  return event;
}

export async function expireDueAlerts() {
  const now = new Date();
  const res = await Alert.updateMany(
    { status: 'PUBLISHED', expiresAt: { $lte: now } },
    { $set: { status: 'EXPIRED' } }
  );
  if (res.modifiedCount) {
    recordAudit('system', 'ALERT_AUTO_EXPIRE', 'Alert', `${res.modifiedCount} expired`, null, { at: now });
  }
  return res.modifiedCount;
}

export function startExpiryJob(intervalMs = 60000) {
  const timer = setInterval(() => {
    expireDueAlerts().catch((err) => console.error('[expiry]', err.message));
  }, intervalMs);
  timer.unref?.();
  return timer;
}

export { HazardEvent };
