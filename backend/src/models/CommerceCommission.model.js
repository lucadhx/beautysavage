import mongoose from 'mongoose';

const commerceCommissionSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    periodKey: { type: String, default: '', index: true },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    status: { type: String, enum: ['DUE', 'PAYMENT_PENDING', 'PAID', 'CANCELLED'], default: 'DUE', index: true },
    amountCents: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'EUR' },
    saleIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CommerceSale' }],
    basisCents: { type: Number, default: 0, min: 0 },
    rateBps: { type: Number, default: 0, min: 0 },
    sourceSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    dueAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    paymentReference: { type: String, default: '' },
  },
  { timestamps: true }
);

commerceCommissionSchema.index({ status: 1, dueAt: 1, createdAt: -1 });
commerceCommissionSchema.index({ periodKey: 1, label: 1 }, { unique: true, sparse: true });

export const CommerceCommission = mongoose.model('CommerceCommission', commerceCommissionSchema);
export default CommerceCommission;
