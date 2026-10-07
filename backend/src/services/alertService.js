import Alert, { CHANNELS } from '../models/Alert.js';
import DeliveryReceipt from '../models/DeliveryReceipt.js';
import HazardEvent, { LEVEL_RANK } from '../models/HazardEvent.js';
import { resolveRecipients } from '../utils/geo.js';
import { recordAudit } from '../utils/audit.js';

// Dev-only failure injection: POST /publish { simulateFailure: ['SMS'] }
// exercises the E1 partial-failure path (UC-01 exception flow E1).
function channelFails(channel, simulateFailure) {
  return (simulateFailure || []).includes(channel);
}

export async function broadcastAlert(alert, { district, simulateFailure = [], actorId } = {}) {
  const recipients = await resolveRecipients(district);
  const docs = [];
  const summary = { attempted: 0, delivered: 0, failed: 0, perChannel: [] };

  for (const channel of CHANNELS) {
    let delivered = 0;
    for (const r of recipients) {
      const failed = channelFails(channel, simulateFailure);
      docs.push({ alertId: alert._id, userId: r._id, channel, state: failed ? 'FAILED' : 'DELIVERED' });
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
