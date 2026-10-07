import mongoose from 'mongoose';

const reliefDistributionSchema = new mongoose.Schema(
  {
    // One distribution per order: unique orderId makes re-POSTs idempotent.
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'DispatchOrder', required: true, unique: true },
    teamLeadId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    beneficiaries: { type: Number, required: true, min: 1 },
    // Device timestamp from the field app (offline-first); server orders by it.
    distributedAt: { type: Date, default: Date.now },
    notes: { type: String, trim: true, maxlength: 1000 }
  },
  { timestamps: true }
);

export default mongoose.model('ReliefDistribution', reliefDistributionSchema);
