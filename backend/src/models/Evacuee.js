import mongoose from 'mongoose';

const evacueeSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    contactNo: { type: String, trim: true },
    householdSize: { type: Number, default: 1, min: 1 }
  },
  { timestamps: true }
);

evacueeSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model('Evacuee', evacueeSchema);
