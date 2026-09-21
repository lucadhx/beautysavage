import mongoose from 'mongoose';
import {
  PAYMENT_TYPE_VALUES,
  PAYMENT_STATUS_VALUES,
  PAYMENT_STATUS,
  CURRENCY,
} from '../utils/contractConstants.js';

/**
 * Paiement — JOURNAL FINANCIER interne (append-only en pratique : jamais de
 * suppression physique d'un paiement ayant une trace Stripe). Montants en
 * CENTIMES. Le contrat (`stripe.launchFee`) n'est qu'une PROJECTION lisible de ce
 * journal — la vérité vient d'ici (et des webhooks Stripe signés).
 *
 * Le MODE Stripe ayant servi (`providerMode`) est distinct de l'ENV applicatif
 * (`applicationEnvironment`) : un événement d'un mode ne doit jamais modifier un
 * paiement de l'autre mode.
 */
const paymentStripeSchema = new mongoose.Schema(
  {
    checkoutSessionId: { type: String, default: null },
    paymentIntentId: { type: String, default: null },
    customerId: { type: String, default: null },
    paymentStatus: { type: String, default: null }, // payment_status Stripe (paid/unpaid/no_payment_required)
    sessionStatus: { type: String, default: null }, // status Stripe (open/complete/expired)
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    contractId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', required: true, index: true },
    provider: { type: String, default: 'STRIPE' },
    providerMode: { type: String, enum: ['TEST', 'PROD'], required: true }, // mode Stripe ACTIF (source des clés)
    applicationEnvironment: { type: String, enum: ['TEST', 'PROD'], required: true }, // ENV app (informatif)
    type: { type: String, enum: PAYMENT_TYPE_VALUES, required: true },

    status: { type: String, enum: PAYMENT_STATUS_VALUES, default: PAYMENT_STATUS.PENDING, index: true },

    amountExcludingTax: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    amountIncludingTax: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: CURRENCY },

    stripe: { type: paymentStripeSchema, default: () => ({}) },

    // Références externes historiques (rétro-compat / factures d'abonnement).
    externalPaymentId: { type: String, default: null },
    externalInvoiceId: { type: String, default: null },

    // Clé d'idempotence Stripe stable (voir payment.service) — empêche la création
    // de deux Checkout Sessions pour la même tentative.
    idempotencyKey: { type: String, default: null },
    // Version du contrat au moment de la tentative (source du montant verrouillé).
    contractVersion: { type: Number, default: 0 },
    attempt: { type: Number, default: 1 },

    lastError: { type: String, default: null }, // message sûr (jamais de secret)

    paidAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },

    // ENV applicatif — conservé pour compatibilité (= applicationEnvironment).
    environment: { type: String, enum: ['TEST', 'PROD'], required: true },
  },
  { timestamps: true }
);

// Un identifiant de session Stripe est unique (quand présent) : garde-fou contre
// deux paiements distincts rattachés à la même Checkout Session.
paymentSchema.index(
  { 'stripe.checkoutSessionId': 1 },
  { unique: true, partialFilterExpression: { 'stripe.checkoutSessionId': { $type: 'string' } } }
);
// Recherche fréquente : la tentative courante d'un contrat pour un type donné.
paymentSchema.index({ contractId: 1, type: 1, status: 1 });

export const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;
