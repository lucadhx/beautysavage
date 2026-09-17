import mongoose from 'mongoose';

const commissionTransactionSchema = new mongoose.Schema(
  {
    saleId: {
      type: String,
      required: true,
      trim: true
    },
    formationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Formation',
      required: true
    },
    formationName: {
      type: String,
      required: true,
      trim: true
    },
    sourceType: {
      type: String,
      enum: ['sale', 'refund_adjustment', 'refund_reversal'],
      default: 'sale'
    },
    refundId: {
      type: String,
      trim: true,
      default: ''
    },
    commissionType: {
      type: String,
      enum: ['percentage', 'fixed'],
      required: true
    },
    commissionValue: {
      type: Number,
      required: true,
      min: 0
    },
    commissionAmount: {
      type: Number,
      required: true
    },
    createdAt: {
      type: Date,
      default: () => new Date()
    }
  },
  {
    collection: 'commissiontransactions'
  }
);

commissionTransactionSchema.index({ createdAt: -1 });
commissionTransactionSchema.index(
  { refundId: 1, sourceType: 1 },
  {
    unique: true,
    partialFilterExpression: { refundId: { $type: 'string', $ne: '' } }
  }
);

const CommissionTransaction = mongoose.model('CommissionTransaction', commissionTransactionSchema);
export default CommissionTransaction;
