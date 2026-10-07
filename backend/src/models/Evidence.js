import mongoose from 'mongoose';

export const MEDIA_TYPES = ['PHOTO', 'VOICE', 'VIDEO'];

const evidenceSchema = new mongoose.Schema(
  {
    reportId: { type: mongoose.Schema.Types.ObjectId, ref: 'GroundReport', required: true, index: true },
    mediaType: { type: String, enum: MEDIA_TYPES, default: 'PHOTO' },
    // v1: base64 payload inline. Moved to object storage in a later step.
    data: { type: String, select: false },
    sizeKb: { type: Number, default: 0 },
    capturedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

evidenceSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    delete ret.data;
    return ret;
  }
});

export default mongoose.model('Evidence', evidenceSchema);
