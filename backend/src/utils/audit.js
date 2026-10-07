// Audit log: console + in-memory (dev visibility) + persisted AuditLog docs.
// Fire-and-forget persistence keeps every existing call site synchronous.
import AuditLog from '../models/AuditLog.js';

const entries = [];

export function recordAudit(actorId, action, entity, entityId, before = null, after = null) {
  const entry = {
    actorId: actorId || 'anonymous',
    action,
    entity,
    entityId,
    before,
    after,
    at: new Date().toISOString()
  };
  entries.push(entry);
  console.log(`[AUDIT] ${entry.at} ${entry.actorId} ${action} ${entity}:${entityId}`);
  AuditLog.create({ ...entry, at: new Date(entry.at) }).catch((err) =>
    console.error('[audit-persist]', err.message)
  );
  return entry;
}

export function listAudits() {
  return entries;
}
