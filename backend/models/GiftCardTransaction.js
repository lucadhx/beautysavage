import mongoose from 'mongoose';

const giftCardTransactionItemSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['product', 'formation', 'gift-card', 'formation-option', 'service', 'service-option'],
      required: true
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    price: {
      type: Number,
      default: 0
    }
  },
  { _id: false }
);

const giftCardTransactionSchema = new mongoose.Schema(
  {
    giftCardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GiftCard',
      required: true
    },
    transactionType: {
      type: String,
      // M13 — `manual_issued` = émission initiale d'une carte créée à la main par l'institut.
      enum: ['redeem', 'manual_debit', 'credit', 'manual_issued', 'pin_reset'],
      default: 'redeem'
    },
    // M13 — provenance de l'opération (le client en ligne vs l'institut au comptoir vs système).
    source: {
      type: String,
      enum: ['client', 'manual_institute', 'system'],
      default: 'client'
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    actorRole: {
      type: String,
      enum: ['client', 'admin', 'dev', 'system'],
      default: 'client'
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    balanceBefore: {
      type: Number,
      required: true,
      min: 0
    },
    balanceAfter: {
      type: Number,
      required: true,
      min: 0
    },
    saleId: {
      type: String,
      trim: true,
      default: ''
    },
    note: {
      type: String,
      trim: true,
      default: ''
    },
    items: {
      type: [giftCardTransactionItemSchema],
      default: []
    }
  },
  {
    collection: 'giftCardTransactions',
    timestamps: true
  }
);

giftCardTransactionSchema.index({ giftCardId: 1 });
giftCardTransactionSchema.index({ userId: 1 });

const GiftCardTransaction = mongoose.model('GiftCardTransaction', giftCardTransactionSchema);
export default GiftCardTransaction;
