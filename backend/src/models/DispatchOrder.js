import mongoose from 'mongoose';

export const ORDER_STATUS = ['CREATED', 'RESERVED', 'SENT', 'ACKED', 'EN_ROUTE', 'ON_SITE', 'FULFILLED', 'ABORTED'];
export const ORDER_PRIORITY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const ITEM_STATUS = ['PENDING', 'RESERVED', 'PARTNER_REQUESTED', 'FULFILLED'];

const itemSchema = new mongoose.Schema(
  {
    resourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource' },
    type: { type: String, default: 'OTHER' },
    description: { type: String, trim: true },
    status: { type: String, enum: ITEM_STATUS, default: 'PENDING' },
    // Partner Organisation System is an external actor: v1 records the
    // request as a stub note; real org-to-org messaging arrives later.
    partnerNote: { type: String, trim: true }
  },
  { _id: true }
);

const dispatchOrderSchema = new mongoose.Schema(
  {
    ref: { type: String, unique: true, index: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'HazardEvent' },
    district: { type: String, required: true, trim: true, index: true },
    priority: { type: String, enum: ORDER_PRIORITY, default: 'MEDIUM' },
    items: { type: [itemSchema], default: [] },
    teamLeadId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ORDER_STATUS, default: 'CREATED', index: true },
    fulfillment: { type: String, enum: ['FULL', 'PARTIAL'], default: 'FULL' },
    notifiedAt: { type: Date, default: null },
    reservationExpiresAt: { type: Date, default: null },
    unacked: { type: Boolean, default: false },
    needsAttention: { type: Boolean, default: false },
    abortReason: { type: String, trim: true },
    safetyCheck: {
      routeChecked: Boolean,
      weatherChecked: Boolean,
      checkedAt: Date,
      checkedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    },
    clientUUID: { type: String, required: true, unique: true, index: true }
  },
  { timestamps: true }
);

dispatchOrderSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model('DispatchOrder', dispatchOrderSchema);
