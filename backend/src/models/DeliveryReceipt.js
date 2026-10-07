import mongoose from 'mongoose';
import { CHANNELS } from './Alert.js';

const receiptSchema = new mongoose.Schema(
  {
    alertId: { type: mongoose.Schema.Types.ObjectId, ref: 'Alert', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    channel: { type: String, enum: CHANNELS, required: true },
    state: { type: String, enum: ['PENDING', 'DELIVERED', 'FAILED'], default: 'PENDING' },
    sentAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

receiptSchema.index({ alertId: 1, userId: 1, channel: 1 }, { unique: true });

export default mongoose.model('DeliveryReceipt', receiptSchema);
