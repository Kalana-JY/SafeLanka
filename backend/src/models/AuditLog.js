import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: String, required: true, index: true },
    action: { type: String, required: true, index: true },
    entity: { type: String, required: true },
    entityId: { type: String, required: true },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    at: { type: Date, default: Date.now, index: true }
  },
  { timestamps: false }
);

export default mongoose.model('AuditLog', auditLogSchema);
