import mongoose from 'mongoose';

export const ROLES = [
  'CITIZEN',
  'VOLUNTEER',
  'DMC_OFFICER',
  'DISTRICT_OFFICER',
  'WARDEN',
  'TEAM_LEADER'
];

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    mobileNo: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'CITIZEN', index: true },
    preferredLanguage: { type: String, enum: ['en'], default: 'en' },
    alertOptIn: { type: Boolean, default: true },
    district: { type: String, required: true, trim: true },
    employeeNo: { type: String, unique: true, sparse: true, trim: true },
    volunteerDivision: { type: String, trim: true },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model('User', userSchema);
