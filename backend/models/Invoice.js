import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema(
  {
    invoiceId: {
      type: String,
      default: null
    },
    invoiceNumber: {
      type: String,
      default: null
    },
    saleId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      trim: true,
      default: 'draft'
    },
    totalAmount: {
      type: Number,
      default: 0
    },
    fileName: {
      type: String,
      default: null,
      trim: true
    },
    pdfPath: {
      type: String,
      default: null,
      trim: true
    },
    htmlContent: {
      type: String,
      default: ''
    },
    invoiceDate: {
      type: Date,
      default: () => new Date()
    },
    stripeInvoiceId: {
      type: String,
      default: null,
      sparse: true
    },
    stripeInvoiceNumber: {
      type: String,
      default: null
    },
    stripeInvoicePdfUrl: {
      type: String,
      default: null
    },
    stripeHostedUrl: {
      type: String,
      default: null
    },
    // Pré-React C2 — la facture OFFICIELLE (fiscale) est la facture Stripe. Le PDF interne
    // (pdfPath/htmlContent) est un snapshot opérationnel NON fiscal (fallback admin).
    //   documentKind: 'internal_snapshot' (défaut) → non officiel ;
    //                 'stripe_official' → la facture Stripe est attachée (officielle).
    //   official: true uniquement quand un stripeInvoiceId est présent.
    documentKind: {
      type: String,
      // D2 — gift_card_usage_receipt : reçu d'utilisation carte cadeau (commande réglée 100 %
      // en carte cadeau), NON fiscal. internal_snapshot : PDF interne non fiscal.
      // stripe_official : facture Stripe officielle (fiscale).
      enum: ['internal_snapshot', 'gift_card_usage_receipt', 'stripe_official'],
      default: 'internal_snapshot'
    },
    official: {
      type: Boolean,
      default: false
    },
    createdAt: {
      type: Date,
      default: () => new Date()
    }
  },
  {
    collection: 'invoices'
  }
);

const Invoice = mongoose.model('Invoice', invoiceSchema);
export default Invoice;
