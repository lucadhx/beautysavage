// models/UnifiedCheckout.js
// Sprint U1 — Modèle du moteur de checkout unifié (achats institut). Persiste un "checkout"
// avec ses snapshots SERVEUR (pricing/tax/legal) et l'état de paiement/finalisation. NE STOCKE
// JAMAIS de secret (mots de passe carte cadeau retirés des inputs ; aucune clé Stripe/Brevo).
// En U1, ce modèle vit EN PARALLÈLE des flux existants (ne les modifie pas).

import mongoose from 'mongoose';
import {
  UNIFIED_CHECKOUT_KINDS,
  UNIFIED_CHECKOUT_STATUSES,
  UNIFIED_PAYMENT_MODES
} from '../services/checkout/unified/unifiedCheckoutTypes.js';

const paymentSchema = new mongoose.Schema(
  {
    mode: { type: String, enum: UNIFIED_PAYMENT_MODES, default: 'stripe' },
    amountToPay: { type: Number, default: 0 },
    giftCardPaymentAmount: { type: Number, default: 0 },
    stripePaymentIntentId: { type: String, default: null },
    stripeCheckoutSessionId: { type: String, default: null },
    provider: { type: String, default: 'stripe' },
    status: { type: String, default: 'pending' }
  },
  { _id: false }
);

const finalizationSchema = new mongoose.Schema(
  {
    saleId: { type: String, default: null },
    bookingId: { type: String, default: null },
    purchaseIds: { type: [String], default: [] },
    accessDeliveryStatus: { type: String, default: null },
    finalizedAt: { type: Date, default: null }
  },
  { _id: false }
);

const unifiedCheckoutSchema = new mongoose.Schema(
  {
    checkoutId: { type: String, required: true, unique: true, index: true },
    kind: { type: String, enum: UNIFIED_CHECKOUT_KINDS, required: true },
    status: { type: String, enum: UNIFIED_CHECKOUT_STATUSES, default: 'draft', index: true },

    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    source: { type: String, default: null }, // ex: vitrine_checkout | finalize_free | stripe_checkout
    origin: { type: mongoose.Schema.Types.Mixed, default: null }, // { slug, query } éventuel

    // Snapshots SAFE (aucun secret). inputSnapshot = sous-ensemble sanitisé du checkoutState client.
    inputSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    pricingSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    taxSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    legalConsentSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },

    payment: { type: paymentSchema, default: () => ({}) },
    finalization: { type: finalizationSchema, default: () => ({}) },

    // PAS de default:null — un champ ABSENT n'est pas indexé (index partiel ci-dessous),
    // donc plusieurs checkouts sans idempotencyKey coexistent sans conflit.
    idempotencyKey: { type: String },
    expiresAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  { timestamps: true }
);

// Idempotence : une clé → un checkout. Index PARTIEL (n'indexe que les docs où idempotencyKey
// est une chaîne) → plusieurs checkouts sans clé coexistent.
unifiedCheckoutSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);
// Balayage des checkouts par état / expiration (cleanup, dev view).
unifiedCheckoutSchema.index({ status: 1, expiresAt: 1 });

const UnifiedCheckout = mongoose.model('UnifiedCheckout', unifiedCheckoutSchema);

export default UnifiedCheckout;
