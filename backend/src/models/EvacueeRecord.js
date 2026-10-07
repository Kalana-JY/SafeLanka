import mongoose from 'mongoose';

const evacueeRecordSchema = new mongoose.Schema(
  {
    evacueeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Evacuee', required: true },
    shelterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shelter', required: true, index: true },
    checkInAt: { type: Date, default: Date.now },
    checkOutAt: { type: Date, default: null },
    // Flagged at entry so UC-05 dispatch can prioritize without re-triage.
    specialNeeds: { type: String, trim: true },
    clientUUID: { type: String, required: true, unique: true, index: true }
  },
  { timestamps: true }
);

evacueeRecordSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model('EvacueeRecord', evacueeRecordSchema);
