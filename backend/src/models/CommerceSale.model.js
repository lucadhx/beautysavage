import mongoose from 'mongoose';

const saleLineSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceProduct', required: true },
    productSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPriceCents: { type: Number, required: true, min: 0 },
    optionsTotalCents: { type: Number, default: 0, min: 0 },
    totalCents: { type: Number, required: true, min: 0 },
    sessionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    bookingSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    consentSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    giftCardSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: true }
);

const commerceSaleSchema = new mongoose.Schema(
  {
    saleNumber: { type: String, required: true, unique: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    status: {
      type: String,
      enum: ['DRAFT', 'CHECKOUT_PENDING', 'PAID', 'CANCELLED', 'REFUNDED'],
      default: 'DRAFT',
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ['UNPAID', 'REQUIRES_INSTITUTE_STRIPE', 'CHECKOUT_CREATED', 'PAID', 'FAILED', 'REFUNDED'],
      default: 'UNPAID',
    },
    currency: { type: String, default: 'EUR' },
    totalCents: { type: Number, required: true, min: 0 },
    stripeAmountCents: { type: Number, default: 0, min: 0 },
    giftCardAmountCents: { type: Number, default: 0, min: 0 },
    lines: [saleLineSchema],
    giftCardAllocations: [{
      giftCardId: { type: mongoose.Schema.Types.ObjectId, ref: 'GiftCard', default: null },
      codeMasked: { type: String, default: '' },
      amountCents: { type: Number, default: 0, min: 0 },
      appliedAt: { type: Date, default: null },
    }],
    stripe: {
      checkoutSessionId: { type: String, default: '' },
      paymentIntentId: { type: String, default: '' },
      mode: { type: String, enum: ['TEST', 'PROD'], default: 'TEST' },
      checkoutUrl: { type: String, default: '' },
    },
    invoice: {
      number: { type: String, default: '' },
      issuedAt: { type: Date, default: null },
      pdfUrl: { type: String, default: '' },
    },
    refund: {
      amountCents: { type: Number, default: 0, min: 0 },
      reason: { type: String, default: '' },
      refundedAt: { type: Date, default: null },
      requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      stripeRefundId: { type: String, default: '' },
    },
    creditNote: {
      number: { type: String, default: '' },
      issuedAt: { type: Date, default: null },
      pdfUrl: { type: String, default: '' },
    },
    finalizedAt: { type: Date, default: null },
    idempotencyKey: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);

export const CommerceSale = mongoose.model('CommerceSale', commerceSaleSchema);
export default CommerceSale;
