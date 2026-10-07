import mongoose from 'mongoose';

const targetAreaSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    district: { type: String, required: true, trim: true, index: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'HazardEvent', required: true },
    // Simplified geography for v1: district match + optional GeoJSON polygon string.
    // Full GIS polygon ops (National GIS Map Service) arrive in a later step.
    polygon: { type: String },
    estPopulation: { type: Number, default: 0 }
  },
  { timestamps: true }
);

export default mongoose.model('TargetArea', targetAreaSchema);
