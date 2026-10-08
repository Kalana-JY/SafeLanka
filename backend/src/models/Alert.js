import mongoose from 'mongoose';
import { WARNING_LEVELS } from './HazardEvent.js';

export const ALERT_STATUS = ['DRAFT', 'PUBLISHED', 'EXPIRED', 'CANCELLED'];
export const CHANNELS = ['SMS', 'PUSH', 'SIREN'];
export const ALERT_LANGUAGES = ['en', 'si', 'ta'];

const LANGUAGE_NAME = { en: 'English', si: 'Sinhala', ta: 'Tamil' };

const localizedSchema = new mongoose.Schema(
  {
    en: { type: String, trim: true, default: '' },
    si: { type: String, trim: true, default: '' },
    ta: { type: String, trim: true, default: '' }
  },
  { _id: false }
);

export function asLocalized(value) {
  if (typeof value === 'string') return { en: value.trim(), si: '', ta: '' };
  return {
    en: String(value?.en ?? '').trim(),
    si: String(value?.si ?? '').trim(),
    ta: String(value?.ta ?? '').trim()
  };
}

export function firstMissingLanguage(headline, body) {
  const h = asLocalized(headline);
  const b = asLocalized(body);
  return ALERT_LANGUAGES.find((lang) => !h[lang] || !b[lang]) || null;
}

export function publishLanguageError(headline, body) {
  const missing = firstMissingLanguage(headline, body);
  if (!missing) return null;
  return `Publish blocked: ${LANGUAGE_NAME[missing]} headline and body required`;
}

// Selects the warning text for one recipient. Unknown or empty language falls back to English.
export function contentForRecipient(headline, body, preferredLanguage) {
  const h = asLocalized(headline);
  const b = asLocalized(body);
  const requested = ALERT_LANGUAGES.includes(preferredLanguage) ? preferredLanguage : 'en';
  const language = h[requested] && b[requested] ? requested : 'en';
  return { language, headline: h[language] || h.en, body: b[language] || b.en };
}

const alertSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'HazardEvent', required: true, index: true },
    targetAreaId: { type: mongoose.Schema.Types.ObjectId, ref: 'TargetArea', required: true },
    version: { type: Number, default: 1 },
    level: { type: String, enum: WARNING_LEVELS, required: true },
    headline: { type: localizedSchema, required: true },
    body: { type: localizedSchema, required: true },
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
  return firstMissingLanguage(this.headline, this.body) === null;
};

export default mongoose.model('Alert', alertSchema);
