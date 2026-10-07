import mongoose from 'mongoose';

export const VERIFY_DECISIONS = ['VERIFIED', 'REJECTED', 'UNDER_REVIEW'];

const verificationRecordSchema = new mongoose.Schema(
  {
    reportId: { type: mongoose.Schema.Types.ObjectId, ref: 'GroundReport', required: true, index: true },
    officerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    decision: { type: String, enum: VERIFY_DECISIONS, required: true },
    score: { type: Number, required: true, min: 0, max: 100 },
    remarks: { type: String, required: true, trim: true },
    sensorStationId: { type: String },
    sensorReadAt: { type: Date },
    sensorStale: { type: Boolean, default: false },
    sources: [{ type: String }],
    escalatedTo: { type: String },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'HazardEvent' }
  },
  { timestamps: true }
);

export default mongoose.model('VerificationRecord', verificationRecordSchema);
