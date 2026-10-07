import mongoose from 'mongoose';

export const SHELTER_STATUS = ['PLANNED', 'OPEN', 'NEARLY_FULL', 'FULL', 'CLOSED'];

const shelterSchema = new mongoose.Schema(
  {
    buildingName: { type: String, required: true, trim: true },
    district: { type: String, required: true, trim: true, index: true },
    address: { type: String, trim: true },
    capacity: { type: Number, required: true, min: 1 },
    occupancy: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: SHELTER_STATUS, default: 'PLANNED', index: true },
    wardenId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'HazardEvent' }
  },
  { timestamps: true }
);

// Auto-transition on occupancy change. PLANNED/CLOSED are managed explicitly.
export function occupancyStatus(occupancy, capacity) {
  if (occupancy >= capacity) return 'FULL';
  if (occupancy >= 0.9 * capacity) return 'NEARLY_FULL';
  return 'OPEN';
}

export default mongoose.model('Shelter', shelterSchema);
