import mongoose from 'mongoose';
import { WARNING_LEVELS } from './HazardEvent.js';

export const ALERT_STATUS = ['DRAFT', 'PUBLISHED', 'EXPIRED', 'CANCELLED'];
export const CHANNELS = ['SMS', 'PUSH', 'SIREN'];

const langText = { si: { type: String, default: '' }, ta: { type: String, default: '' }, en: { type: String, default: '' } };

const alertSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'HazardEvent', required: true, index: true },
    targetAreaId: { type: mongoose.Schema.Types.ObjectId, ref: 'TargetArea', required: true },
    version: { type: Number, default: 1 },
    level: { type: String, enum: WARNING_LEVELS, required: true },
    headline: langText,
    body: langText,
    status: { type: String, enum: ALERT_STATUS, default: 'DRAFT', index: true },
    expiresAt: { type: Date, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    secondConfirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    publishedAt: { type: Date },
    cancelledReason: { type: String },
    previousAlertId: { type: mongoose.Schema.Types.ObjectId, ref: 'Alert' },
    delivery: {
      attempted: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      perChannel: [
        {
          channel: { type: String, enum: CHANNELS },
          attempted: Number,
          delivered: Number,
          failed: Number
        }
      ]
    }
  },
  { timestamps: true }
);

alertSchema.methods.isComplete = function () {
  return ['si', 'ta', 'en'].every((l) => this.headline[l]?.trim() && this.body[l]?.trim());
};

export default mongoose.model('Alert', alertSchema);
