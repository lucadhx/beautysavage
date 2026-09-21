import mongoose from 'mongoose';
import {
  PAYMENT_TYPE_VALUES,
  INVOICE_STATUS_VALUES,
  INVOICE_STATUS,
  CURRENCY,
} from '../utils/contractConstants.js';

/**
 * Facture — miroir interne d'une facture Stripe (source juridique = Stripe).
 * On conserve les liens hébergés (hostedInvoiceUrl / invoicePdfUrl) + un snapshot.
 * Montants en CENTIMES. Jamais de suppression physique.
 */
const invoiceSchema = new mongoose.Schema(
  {
    contractId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', required: true, index: true },
    provider: { type: String, default: 'STRIPE' },
    externalInvoiceId: { type: String, required: true },
    number: { type: String, default: '' }, // numéro Stripe (ex. INV-0001)
    type: { type: String, enum: PAYMENT_TYPE_VALUES, default: null },
    amountExcludingTax: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    amountIncludingTax: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: CURRENCY },
    status: { type: String, enum: INVOICE_STATUS_VALUES, default: INVOICE_STATUS.OPEN },
    invoiceDate: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    hostedInvoiceUrl: { type: String, default: '' },
    invoicePdfUrl: { type: String, default: '' },
    // Nom libre, saisi par le DEV lors d'un rattachement manuel (« Migration »,
    // « Mise à jour »…). SEUL champ non dérivé de Stripe : tout le reste
    // (montants, statut, dates, numéro, liens) vient de la facture réelle.
    label: { type: String, default: '' },
    // Rattachée à la main par un DEV (vs reflétée par webhook/synchronisation).
    // Sert uniquement à l'affichage — la facture reste une vraie facture Stripe.
    addedManually: { type: Boolean, default: false },
    snapshot: { type: mongoose.Schema.Types.Mixed, default: null }, // sous-ensemble sûr du payload
    environment: { type: String, enum: ['TEST', 'PROD'], required: true },
  },
  { timestamps: true }
);

// Une facture Stripe est unique par identifiant externe (idempotence d'upsert).
invoiceSchema.index({ provider: 1, externalInvoiceId: 1 }, { unique: true });

export const Invoice = mongoose.model('Invoice', invoiceSchema);
export default Invoice;
