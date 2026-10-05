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
    /** La règle du mois (les lignes gardent chacune la leur dans `sourceSnapshot.lines`). */
    ratePercent: { type: Number, default: null },
    /** Taux exprimé HT ou TTC (TVA sur la commission incluse), et cette TVA. */
    rateType: { type: String, enum: ['HT', 'TTC', null], default: null },
    vatRate: { type: Number, default: null },
    /** `amountCents` est le HT ; voici la TVA et le TTC (somme des lignes, comme Stripe). */
    vatCents: { type: Number, default: 0, min: 0 },
    amountTtcCents: { type: Number, default: 0, min: 0 },
    basis: { type: String, enum: ['HT', 'TTC', null], default: null },
    /**
     * LA FACTURE STRIPE DU MOIS — émise par la plateforme, une ligne par vente
     * (avec son numéro). « Payer » ouvre sa page Stripe ; le webhook de la
     * plateforme (`invoice.paid`) la passe à « payée ».
     */
    /** Quand l'e-mail « commissions du mois à payer » est parti (une fois par mois). */
    notifiedAt: { type: Date, default: null },
    stripeInvoice: {
      id: { type: String, default: '' },
      number: { type: String, default: '' },
      status: { type: String, default: '' },
      hostedInvoiceUrl: { type: String, default: '' },
      invoicePdfUrl: { type: String, default: '' },
      amountDueCents: { type: Number, default: 0 },
      createdAt: { type: Date, default: null },
      paidAt: { type: Date, default: null },
      lastCheckedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

commerceCommissionSchema.index({ status: 1, dueAt: 1, createdAt: -1 });
commerceCommissionSchema.index({ periodKey: 1, label: 1 }, { unique: true, sparse: true });

export const CommerceCommission = mongoose.model('CommerceCommission', commerceCommissionSchema);
export default CommerceCommission;
