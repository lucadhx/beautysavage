import mongoose from 'mongoose';

const launchFeeSchema = new mongoose.Schema(
  {
    amount: { type: Number, default: 0 },
    taxRate: { type: Number, default: 0.20 },
    paid: { type: Boolean, default: false },
    stripePaymentIntentId: { type: String }
  },
  { _id: false }
);

const monthlyFeeSchema = new mongoose.Schema(
  {
    amount: { type: Number, default: 0 },
    taxRate: { type: Number, default: 0.20 },
    active: { type: Boolean, default: false },
    stripeSubscriptionId: { type: String },
    stripeCustomerId: { type: String },
    currentPeriodEnd: { type: Date, default: null },
    gracePeriodDays: { type: Number, default: 3 },
    pendingPaymentIntentId: { type: String },
    pendingClientSecret: { type: String },
    cancelAtPeriodEnd: { type: Boolean, default: false }
  },
  { _id: false }
);

const cancellationPolicySchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['anytime', 'locked'], default: 'anytime' },
    lockedMonths: { type: Number, default: null }
  },
  { _id: false }
);

const contractSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['pending', 'active', 'cancelled'],
      default: 'pending'
    },

    file: { type: String, required: true },
    fileOriginalName: { type: String, default: '' },
    fileMimeType: { type: String, default: 'application/pdf' },
    fileDownloadedAt: { type: Date, default: null },

    lockedAt: { type: Date, default: null },

    launchFee: { type: launchFeeSchema, default: () => ({}) },
    monthlyFee: { type: monthlyFeeSchema, default: () => ({}) },

    cancellationPolicy: { type: cancellationPolicySchema, default: () => ({}) },

    commissions: {
      type: {
        type: String,
        enum: ['fixed', 'percentage'],
        default: null
      },
      value: {
        type: Number,
        default: null
      }
    },

    pendingMessage: {
      type: String,
      default: 'Site en cours de configuration. Revenez bientôt.'
    },

    activatedAt: { type: Date, default: null },
    activatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    cancelledAt: { type: Date, default: null },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  {
    collection: 'contracts',
    timestamps: true
  }
);

const Contract = mongoose.model('Contract', contractSchema);
export default Contract;
