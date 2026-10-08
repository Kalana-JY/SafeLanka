import mongoose from 'mongoose';

const targetAreaSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Canonical coverage. UC-01 resolves recipients from this list.
    districts: {
      type: [String],
      required: true,
      index: true,
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length > 0 && new Set(value).size === value.length;
        },
        message: 'Target area requires at least one unique district'
      }
    },
    // Legacy single-district field. Always districts[0], kept for existing queries.
    district: { type: String, required: true, trim: true, index: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'HazardEvent', required: true },
    // Optional polygon string for the later map UI. Not used for recipient matching.
    polygon: { type: String },
    estPopulation: { type: Number, default: 0 }
  },
  { timestamps: true }
);

targetAreaSchema.pre('validate', function syncDistricts() {
  if (Array.isArray(this.districts) && this.districts.length) {
    this.districts = this.districts.map((d) => String(d).trim()).filter(Boolean);
    this.district = this.districts[0];
  } else if (this.district) {
    this.district = String(this.district).trim();
    this.districts = this.district ? [this.district] : [];
  }
});

export function areaDistricts(area) {
  const listed = Array.isArray(area?.districts) ? area.districts.map((d) => String(d).trim()).filter(Boolean) : [];
  if (listed.length) return listed;
  return area?.district ? [String(area.district).trim()] : [];
}

export function sharesDistrict(area, districts) {
  const wanted = new Set(areaDistricts({ districts: Array.isArray(districts) ? districts : [districts] }));
  return areaDistricts(area).some((d) => wanted.has(d));
}

// districts is canonical. A legacy `district` string is accepted as a one-item list.
export function normalizeDistrictList({ district, districts } = {}) {
  if (Array.isArray(districts)) {
    if (districts.length === 0) return { error: 'At least one district is required' };
    const cleaned = districts.map((d) => String(d).trim());
    if (cleaned.some((d) => !d)) return { error: 'At least one district is required' };
    if (new Set(cleaned).size !== cleaned.length) return { error: 'Duplicate district' };
    return { districts: cleaned };
  }
  if (typeof district === 'string' && district.trim()) return { districts: [district.trim()] };
  return { error: 'At least one district is required' };
}

export default mongoose.model('TargetArea', targetAreaSchema);
