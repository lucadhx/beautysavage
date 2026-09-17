import mongoose from 'mongoose';

const commissionConfigSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['percentage', 'fixed'],
      required: true,
      default: 'percentage'
    },
    value: {
      type: Number,
      required: true,
      min: 0
    },
    isActive: {
      type: Boolean,
      default: true
    },
    deletedAt: {
      type: Date,
      default: null
    },
    createdAt: {
      type: Date,
      default: () => new Date()
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  {
    collection: 'commissionconfigs'
  }
);

commissionConfigSchema.index({ createdAt: -1 });
commissionConfigSchema.index({ isActive: 1, createdAt: -1 });

const CommissionConfig = mongoose.model('CommissionConfig', commissionConfigSchema);
export default CommissionConfig;
