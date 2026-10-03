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
    /**
     * LE CODE, CHIFFRÉ — pour que sa propriétaire le retrouve dans son espace
     * client. Le hash reste la seule clé de recherche ; ce champ n'est déchiffré
     * que pour une cliente à qui la carte appartient (voir `listCustomerGiftCards`).
     */
    codeEncrypted: { type: String, default: '', select: false },
    /** Les clientes qui ont ajouté cette carte à leur portefeuille en saisissant son code. */
    walletCustomerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Customer', index: true }],
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

/**
 * Chiffrement du code (AES-256-GCM), clé dérivée du secret JWT : présent sur
 * toute instance, et propre à chacune — une copie de base ne suffit pas à lire
 * les codes d'une autre.
 */
function giftKey() {
  return crypto.createHash('sha256').update(`gift-card-code:${process.env.JWT_SECRET || ''}`).digest();
}

export function encryptGiftCode(code) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', giftKey(), iv);
  const data = Buffer.concat([cipher.update(String(code), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decryptGiftCode(payload) {
  try {
    const [iv, tag, data] = String(payload || '').split('.').map((p) => Buffer.from(p, 'base64'));
    if (!iv?.length || !tag?.length || !data?.length) return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', giftKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/** Saisie tolérante : espaces, minuscules et tirets oubliés n'empêchent pas de retrouver la carte. */
export function normalizeGiftCode(raw) {
  const clean = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = clean.match(/^BS([0-9A-F]{6})([0-9A-F]{6})$/);
  return m ? `BS-${m[1]}-${m[2]}` : String(raw || '').trim();
}

export function maskGiftCode(code) {
  const clean = String(code);
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

export const GiftCard = mongoose.model('GiftCard', giftCardSchema);
export default GiftCard;
