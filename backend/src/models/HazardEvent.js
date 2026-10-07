import mongoose from 'mongoose';

export const WARNING_LEVELS = ['WATCH', 'WARNING', 'EVACUATE', 'ALL_CLEAR'];
export const HAZARD_TYPES = ['FLOOD', 'LANDSLIDE', 'CYCLONE', 'TSUNAMI', 'OTHER'];

// Severity rank for raise-only level changes. ALL_CLEAR closes the event instead.
export const LEVEL_RANK = { WATCH: 0, WARNING: 1, EVACUATE: 2, ALL_CLEAR: -1 };

const hazardEventSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    hazardType: { type: String, enum: HAZARD_TYPES, required: true },
    district: { type: String, required: true, trim: true, index: true },
    level: { type: String, enum: WARNING_LEVELS, default: 'WATCH' },
    status: { type: String, enum: ['ACTIVE', 'CLOSED'], default: 'ACTIVE' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

export default mongoose.model('HazardEvent', hazardEventSchema);
