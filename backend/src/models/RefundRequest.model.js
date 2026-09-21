import mongoose from 'mongoose';

const refundActionSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    at: { type: Date, default: Date.now },
    byCustomer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    byUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    comment: { type: String, default: '' },
  },
  { _id: false }
);

const refundRequestSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceSale', required: true, index: true },
    lineId: { type: mongoose.Schema.Types.ObjectId, required: true },
    status: {
      type: String,
      enum: ['REQUESTED', 'ACCEPTED', 'PROCESSING', 'REFUNDED', 'REJECTED', 'FAILED', 'CANCELLED'],
      default: 'REQUESTED',
      index: true,
    },
    requestedAmountCents: { type: Number, default: 0, min: 0 },
    eligibleAmountCents: { type: Number, default: 0, min: 0 },
    refundedAmountCents: { type: Number, default: 0, min: 0 },
    reason: { type: String, default: '' },
    managerComment: { type: String, default: '' },
    policySnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    paymentAllocationSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    idempotencyKey: { type: String, required: true, unique: true },
    actions: [refundActionSchema],
  },
  { timestamps: true }
);

refundRequestSchema.index(
  { saleId: 1, lineId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['REQUESTED', 'ACCEPTED', 'PROCESSING'] } },
  }
);

export const RefundRequest = mongoose.model('RefundRequest', refundRequestSchema);
export default RefundRequest;
