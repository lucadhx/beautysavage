import crypto from 'node:crypto';
import mongoose from 'mongoose';

const giftCardLedgerSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['ISSUE', 'DEBIT', 'CREDIT', 'REFUND', 'VOID'], required: true },
    amountCents: { type: Number, required: true },
    balanceBeforeCents: { type: Number, required: true },
    balanceAfterCents: { type: Number, required: true },
    source: { type: String, default: '' },
    reason: { type: String, default: '' },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorCustomerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    idempotencyKey: { type: String, required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const giftCardSchema = new mongoose.Schema(
  {
    codeHash: { type: String, required: true, unique: true, select: false },
    codeMasked: { type: String, required: true, index: true },
    pinHash: { type: String, default: '', select: false },
    purchaserCustomerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceSale', default: null, index: true },
    senderName: { type: String, default: '' },
    recipientName: { type: String, default: '' },
    recipientEmail: { type: String, default: '' },
    message: { type: String, default: '' },
    initialAmountCents: { type: Number, required: true, min: 0 },
    balanceCents: { type: Number, required: true, min: 0 },
    reservedCents: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['ACTIVE', 'EMPTY', 'VOID', 'EXPIRED'], default: 'ACTIVE', index: true },
    pdfUrl: { type: String, default: '' },
    templateSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    ledger: [giftCardLedgerSchema],
  },
  { timestamps: true }
);

giftCardSchema.index({ 'ledger.idempotencyKey': 1 });

export function hashGiftSecret(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function maskGiftCode(code) {
  const clean = String(code);
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

export const GiftCard = mongoose.model('GiftCard', giftCardSchema);
export default GiftCard;
