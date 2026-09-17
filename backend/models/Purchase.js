import mongoose from 'mongoose';

export const PURCHASE_ITEM_TYPES = Object.freeze(['product', 'formation']);
export const PURCHASE_STATUSES = Object.freeze(['paid']);

const purchaseSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    formationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Formation',
      default: null
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FormationSession',
      default: null
    },
    paymentProvider: {
      type: String,
      required: true,
      default: 'mock'
    },
    paymentStatus: {
      type: String,
      required: true,
      enum: PURCHASE_STATUSES,
      default: 'paid'
    },
    paymentRef: {
      type: String,
      required: true,
      trim: true
    },
    itemType: {
      type: String,
      enum: PURCHASE_ITEM_TYPES,
      required: true
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    saleId: {
      type: String,
      trim: true,
      default: ''
    },
    participationStatus: {
      type: String,
      enum: ['active', 'canceled'],
      default: 'active'
    },
    canceledAt: {
      type: Date,
      default: null
    },
    cancellationReason: {
      type: String,
      trim: true,
      default: ''
    },
    cancellationEligibleRefund: {
      type: Boolean,
      default: false
    },
    cancellationSessionStartAt: {
      type: Date,
      default: null
    },
    refundRequestId: {
      type: String,
      trim: true,
      default: ''
    },
    instituteDecisionFlowId: {
      type: String,
      trim: true,
      default: ''
    },
    instituteDecisionType: {
      type: String,
      trim: true,
      default: ''
    },
    instituteDecisionStatus: {
      type: String,
      trim: true,
      default: ''
    },
    giftCardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GiftCard',
      default: null
    },
    giftCardAmount: {
      type: Number,
      default: 0
    },
    selectedOptions: {
      type: [
        {
          optionId: {
            type: mongoose.Schema.Types.ObjectId
          },
          name: {
            type: String,
            trim: true,
            default: ''
          },
          price: {
            type: Number,
            default: 0
          }
        }
      ],
      default: []
    },
    createdAt: {
      type: Date,
      default: () => new Date()
    }
  },
  { collection: 'purchases' }
);

purchaseSchema.index(
  { userId: 1, itemType: 1, itemId: 1 },
  {
    unique: true,
    name: 'purchase_unique_product',
    partialFilterExpression: { itemType: 'product' }
  }
);

purchaseSchema.index(
  { userId: 1, itemType: 1, itemId: 1 },
  {
    unique: true,
    name: 'purchase_unique_active_distanciel_formation',
    partialFilterExpression: {
      itemType: 'formation',
      participationStatus: 'active',
      sessionId: null
    }
  }
);

purchaseSchema.index(
  { userId: 1, itemType: 1, itemId: 1, sessionId: 1 },
  {
    unique: true,
    name: 'purchase_unique_active_presentiel_session',
    partialFilterExpression: {
      itemType: 'formation',
      participationStatus: 'active',
      sessionId: { $type: 'objectId' }
    }
  }
);

purchaseSchema.index(
  { userId: 1, itemType: 1, formationId: 1, createdAt: -1 },
  { name: 'purchase_user_formation_recent' }
);

const Purchase = mongoose.model('Purchase', purchaseSchema);

export async function ensurePurchaseIndexes() {
  await Purchase.syncIndexes();
}

export default Purchase;
