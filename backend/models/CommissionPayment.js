import mongoose from 'mongoose';

const commissionSaleEntrySchema = new mongoose.Schema(
  {
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale' },
    formationType: { type: String, default: '' },
    saleDate: { type: Date, default: null },
    commissionType: { type: String, enum: ['fixed', 'percentage'], default: 'fixed' },
    commissionRate: { type: Number, default: null },
    commissionAmount: { type: Number, default: 0 }
  },
  { _id: false }
);

const commissionRefundEntrySchema = new mongoose.Schema(
  {
    refundId: { type: mongoose.Schema.Types.ObjectId, ref: 'RefundRequest' },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale' },
    refundedAt: { type: Date, default: null },
    commissionType: { type: String, enum: ['fixed', 'percentage'], default: 'fixed' },
    commissionRate: { type: Number, default: null },
    commissionAmount: { type: Number, default: 0 }
  },
  { _id: false }
);

const commissionPaymentSchema = new mongoose.Schema(
  {
    month: { type: Number, required: true, min: 0, max: 11 }, // 0=janvier … 11=décembre
    year: { type: Number, required: true },

    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },

    // `amount` = montant réellement dû ce mois (= netAmountDue). Conservé pour
    // compatibilité ascendante (frontend, anciens documents).
    amount: { type: Number, required: true, default: 0 },

    // Décomposition du calcul mensuel (source unique : computeCommissionsForPeriod).
    // Pré-React — correction commissions :
    //   netAmountDue = max(0, gross - refundDeduction - carryOverApplied)
    //   negativeCarryOverAmount = max(0, refundDeduction + carryOverApplied - gross)
    grossCommissionAmount: { type: Number, default: 0 },   // somme des commissions de ventes
    refundDeductionAmount: { type: Number, default: 0 },   // somme des déductions de remboursement du mois
    carryOverAppliedAmount: { type: Number, default: 0 },  // report négatif du mois précédent consommé
    negativeCarryOverAmount: { type: Number, default: 0 }, // report négatif transmis au mois suivant
    netAmountDue: { type: Number, default: 0 },            // montant facturé/à payer (>= 0)
    calculationSnapshot: { type: mongoose.Schema.Types.Mixed, default: null }, // trace du calcul

    stripePaymentIntentId: { type: String, default: null },
    // Verrou applicatif anti double-clic (idempotence paiement commission).
    paymentInProgress: { type: Boolean, default: false },
    paymentInProgressAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ['pending', 'succeeded', 'failed'],
      default: 'pending'
    },
    // Marque un mois soldé sans paiement (netAmountDue === 0). status reste 'succeeded'
    // pour compat ; settledReason distingue le 0 € du paiement effectif.
    settledReason: { type: String, enum: ['paid', 'settled_zero', null], default: null },
    paidAt: { type: Date, default: null },

    stripeInvoiceId: { type: String, default: null },
    stripeInvoicePdfUrl: { type: String, default: null },

    // RX2.5 — snapshot des termes de paiement (additif, nullable). Lazy-persisté UNIQUEMENT par
    // services/finance/commissionFinanceService (jamais par le moteur commissionPaymentService) →
    // le système commission unifié reste intact. dueAt/graceEndsAt figés au 1er affichage finance.
    dueAt: { type: Date, default: null },
    graceEndsAt: { type: Date, default: null },
    paymentTermsSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },

    sales: { type: [commissionSaleEntrySchema], default: [] },
    refunds: { type: [commissionRefundEntrySchema], default: [] },

    // Suivi des notifications automatiques (anti-doublon emails)
    availableMailSentAt: { type: Date, default: null },
    lastDayMailSentAt: { type: Date, default: null },
    reminderMailsSentDays: { type: [Number], default: [] },

    createdAt: { type: Date, default: Date.now }
  },
  { collection: 'commissionpayments' }
);

// Anti-doublon : impossible de payer deux fois le même mois/année
commissionPaymentSchema.index({ month: 1, year: 1 }, { unique: true });
commissionPaymentSchema.index({ status: 1 });
commissionPaymentSchema.index({ stripePaymentIntentId: 1 }, { sparse: true });
commissionPaymentSchema.index({ stripeInvoiceId: 1 }, { sparse: true });

const CommissionPayment = mongoose.model('CommissionPayment', commissionPaymentSchema);
export default CommissionPayment;
