import mongoose from 'mongoose';
import { HAZARD_TYPES } from './HazardEvent.js';

export const REPORT_STATUS = ['SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED'];

const groundReportSchema = new mongoose.Schema(
  {
    ref: { type: String, unique: true, index: true },
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    hazardType: { type: String, enum: HAZARD_TYPES, required: true },
    description: { type: String, required: true, trim: true },
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
    status: { type: String, enum: REPORT_STATUS, default: 'SUBMITTED', index: true },
    credibility: { type: Number, default: 50, min: 0, max: 100 },
    sensorCorroborated: { type: Boolean, default: false },
    clientUUID: { type: String, required: true, unique: true, index: true },
    // Step 4 (UC-03) verification lock. Set when an officer opens the report.
    lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lockedUntil: { type: Date, default: null }
  },
  { timestamps: true }
);

groundReportSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model('GroundReport', groundReportSchema);
