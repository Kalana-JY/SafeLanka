import mongoose from 'mongoose';

export const RESOURCE_TYPES = ['TEAM', 'VEHICLE', 'RELIEF', 'OTHER'];
export const RESOURCE_STATUS = ['AVAILABLE', 'RESERVED', 'DEPLOYED', 'MAINTENANCE'];

const resourceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: RESOURCE_TYPES, default: 'OTHER' },
    district: { type: String, required: true, trim: true, index: true },
    status: { type: String, enum: RESOURCE_STATUS, default: 'AVAILABLE', index: true },
    capacity: { type: Number, min: 0 },
    organization: { type: String, trim: true }
  },
  { timestamps: true }
);

export default mongoose.model('Resource', resourceSchema);
