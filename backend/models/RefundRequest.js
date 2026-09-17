import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {
  REFUND_REQUEST_STATUSES,
  ACTIVE_REFUND_REQUEST_STATUSES,
  REFUND_REQUEST_ACTIVE_UNIQUE_INDEX_NAME
} from '../constants/refundRequest.js';

const STRIPE_REFUND_STATUSES = ['not_applicable', 'pending', 'succeeded', 'failed'];
const GIFT_CARD_REFUND_STATUSES = [
  'not_applicable',
  'pending',
  'succeeded',
  'failed',
  'rollback_needed'
];

const refundRequestSchema = new mongoose.Schema(
  {
    refundId: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },
    saleId: {
      type: String,
      required: true,
      trim: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    itemType: {
      type: String,
      enum: ['formation', 'product', 'gift-card', 'service'],
      required: true
    },
    formationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Formation',
      default: null
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      trim: true,
      default: 'EUR'
    },
    status: {
      type: String,
      enum: REFUND_REQUEST_STATUSES,
      default: 'requested'
    },
    requestedAt: {
      type: Date,
      default: () => new Date()
    },
    processedAt: {
      type: Date,
      default: null
    },
    reason: {
      type: String,
      trim: true,
      default: 'client_cancel_presentiel'
    },
    clientIp: {
      type: String,
      trim: true,
      default: '0.0.0.0'
    },
    purchaseAcceptedText: {
      type: String,
      trim: true,
      default: ''
    },
    sessionStartAt: {
      type: Date,
      default: null
    },
    eligibleRefund: {
      type: Boolean,
      default: false
    },
    meta: {
      notes: {
        type: String,
        trim: true,
        default: ''
      },
      formationTitle: {
        type: String,
        trim: true,
        default: ''
      },
      formationCoverImage: {
        type: String,
        trim: true,
        default: ''
      },
      saleCreatedAt: {
        type: Date,
        default: null
      }
    },
    stripeRefundId: { type: String, default: null },
    trackingToken: { type: String },
    trackingTokenExpiresAt: { type: Date },
    stripeRefundStatus: {
      type: String,
      enum: STRIPE_REFUND_STATUSES,
      default: 'not_applicable'
    },
    giftCardRefundStatus: {
      type: String,
      enum: GIFT_CARD_REFUND_STATUSES,
      default: 'not_applicable'
    },
    stripeRefundAmount: { type: Number, default: null },
    giftCardRefundAmount: { type: Number, default: null },
    stripeRefundConfirmedAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    giftCardRecredited: { type: Boolean, default: false },
    giftCardRecreditInProgress: { type: Boolean, default: false },
    giftCardRecreditAmount: { type: Number, default: null },
    // Pré-React C1 — nombre de tentatives de reprise du recrédit carte cadeau
    // (moteur giftCardRecreditRecoveryService). Limite raisonnable avant abandon manuel.
    giftCardRecreditAttempts: { type: Number, default: 0 },
    // LOT2 — Cycle de reprise du remboursement STRIPE (empêche les réessais infinis d'erreurs
    // terminales — credential manquant, transaction introuvable — qui polluaient les logs à chaque
    // démarrage). Additif : les documents existants prennent les défauts (retryable, 0 tentative).
    stripeRefundAttempts: { type: Number, default: 0 },
    lastRefundAttemptAt: { type: Date, default: null },
    nextRefundRetryAt: { type: Date, default: null }, // le job ignore un remboursement pas encore dû
    lastRefundErrorCode: { type: String, default: null }, // MISSING_CREDENTIAL|TRANSACTION_NOT_FOUND|…
    refundRetryable: { type: Boolean, default: true },
    refundFailedFinalAt: { type: Date, default: null }, // posé → plus jamais retenté par le job
    creditNoteId: { type: String, default: null },
    creditNotePdfUrl: { type: String, default: null }
  },
  {
    collection: 'refundrequests'
  }
);

refundRequestSchema.pre('save', function (next) {
  if (this.isNew && !this.trackingToken) {
    this.trackingToken = crypto.randomBytes(32).toString('hex');
    this.trackingTokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
  next();
});

refundRequestSchema.index({ userId: 1, requestedAt: -1 });
refundRequestSchema.index({ saleId: 1, itemId: 1, reason: 1 });
refundRequestSchema.index(
  { saleId: 1, itemId: 1, itemType: 1 },
  {
    unique: true,
    name: REFUND_REQUEST_ACTIVE_UNIQUE_INDEX_NAME,
    partialFilterExpression: {
      status: { $in: ACTIVE_REFUND_REQUEST_STATUSES }
    }
  }
);
refundRequestSchema.index({ status: 1, requestedAt: -1 });
refundRequestSchema.index({ trackingToken: 1 }, { sparse: true });
refundRequestSchema.index({ stripeRefundId: 1 }, { sparse: true });

const RefundRequest = mongoose.model('RefundRequest', refundRequestSchema);
export default RefundRequest;
