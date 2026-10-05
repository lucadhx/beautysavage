import mongoose from 'mongoose';

const saleLineSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceProduct', required: true },
    productSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPriceCents: { type: Number, required: true, min: 0 },
    optionsTotalCents: { type: Number, default: 0, min: 0 },
    /** Les options CHOISIES, photographiées au paiement (libellé, prix) : facture et Stripe les détaillent. */
    optionsSnapshot: { type: [{ key: String, label: String, priceCents: Number, _id: false }], default: [] },
    /** Encaissé en ligne pour cette ligne (acompte compris) — c'est lui que Stripe facture. */
    totalCents: { type: Number, required: true, min: 0 },
    /** Prix complet de la ligne, et ce qu'il reste à régler sur place (règle « acompte » ou « gratuit »). */
    fullTotalCents: { type: Number, default: null },
    balanceDueCents: { type: Number, default: 0, min: 0 },
    paymentRule: { type: String, default: 'FULL' },
    /** Annulation par la cliente depuis son espace : quand, et ce qui a été remboursé. */
    cancellation: { type: mongoose.Schema.Types.Mixed, default: null },
    sessionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    bookingSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    consentSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    giftCardSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: true }
);

const commerceSaleSchema = new mongoose.Schema(
  {
    saleNumber: { type: String, required: true, unique: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    status: {
      type: String,
      enum: ['DRAFT', 'CHECKOUT_PENDING', 'PAID', 'CANCELLED', 'REFUNDED'],
      default: 'DRAFT',
      index: true,
    },
    paymentStatus: {
      type: String,
      // PROCESSING : paiement différé (virement, prélèvement…) en attente de Stripe.
      // EXPIRED : la page de paiement Stripe a expiré sans paiement.
      enum: ['UNPAID', 'REQUIRES_INSTITUTE_STRIPE', 'CHECKOUT_CREATED', 'PROCESSING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED'],
      default: 'UNPAID',
    },
    currency: { type: String, default: 'EUR' },
    totalCents: { type: Number, required: true, min: 0 },
    stripeAmountCents: { type: Number, default: 0, min: 0 },
    giftCardAmountCents: { type: Number, default: 0, min: 0 },
    /** Le site sur lequel la commande a été passée (recette ou production) : la carte cadeau y renvoie. */
    siteUrl: { type: String, default: '' },
    /** Créneaux et places RETENUS pendant le paiement en ligne, jusqu'à cette échéance. */
    holdExpiresAt: { type: Date, default: null },
    /** Les places de formation de cette vente sont déjà comptées dans `reservedCount` (retenue). */
    seatsHeld: { type: Boolean, default: false },
    lines: [saleLineSchema],
    giftCardAllocations: [{
      giftCardId: { type: mongoose.Schema.Types.ObjectId, ref: 'GiftCard', default: null },
      codeMasked: { type: String, default: '' },
      amountCents: { type: Number, default: 0, min: 0 },
      appliedAt: { type: Date, default: null },
    }],
    stripe: {
      checkoutSessionId: { type: String, default: '' },
      paymentIntentId: { type: String, default: '' },
      mode: { type: String, enum: ['TEST', 'PROD'], default: 'TEST' },
      checkoutUrl: { type: String, default: '' },
      /** La facture Stripe de la cliente (émise après paiement) : c'est elle que « Ma facture » ouvre. */
      invoiceId: { type: String, default: '' },
      hostedInvoiceUrl: { type: String, default: '' },
    },
    /** Remboursements partiels (annulations depuis l'espace client). */
    partialRefunds: { type: [mongoose.Schema.Types.Mixed], default: [] },
    invoice: {
      number: { type: String, default: '' },
      issuedAt: { type: Date, default: null },
      pdfUrl: { type: String, default: '' },
    },
    refund: {
      amountCents: { type: Number, default: 0, min: 0 },
      reason: { type: String, default: '' },
      refundedAt: { type: Date, default: null },
      requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      stripeRefundId: { type: String, default: '' },
    },
    creditNote: {
      number: { type: String, default: '' },
      issuedAt: { type: Date, default: null },
      pdfUrl: { type: String, default: '' },
    },
    finalizedAt: { type: Date, default: null },
    /**
     * FINALISATION SÛRE — un verrou (une seule finalisation à la fois, même si
     * le webhook, la page de succès et le rattrapage arrivent ensemble) et des
     * étapes marquées : une finalisation interrompue reprend là où elle
     * s'était arrêtée, sans rien refaire deux fois (débit de carte cadeau,
     * place de session, rendez-vous).
     */
    finalizing: { at: { type: Date, default: null } },
    finalizeSteps: {
      giftCards: { type: Boolean, default: false },
      sessions: { type: Boolean, default: false },
      bookings: { type: Boolean, default: false },
      giftIssued: { type: Boolean, default: false },
      commission: { type: Boolean, default: false },
      cart: { type: Boolean, default: false },
    },
    /** Ce qui a coincé APRÈS encaissement (créneau déjà pris, session pleine…) : à traiter à la main, jamais bloquant. */
    finalizeIssues: { type: [String], default: [] },
    /**
     * LA COMMISSION DE CETTE VENTE — photographiée au paiement : règle
     * appliquée (taux, base HT/TTC, types assujettis) et montant. Le détail
     * des ventes et la facture du mois restent justes même si la règle change.
     */
    commission: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Dernière vérification auprès de Stripe (rattrapage automatique). */
    lastStripeCheckAt: { type: Date, default: null },
    /**
     * D'où vient la commande. Un ACHAT RAPIDE ne passe pas par le panier : le
     * vider au paiement effacerait ce que la cliente y avait mis à côté.
     */
    checkoutSource: { type: String, enum: ['CART', 'QUICK_BUY'], default: 'CART' },
    idempotencyKey: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);

export const CommerceSale = mongoose.model('CommerceSale', commerceSaleSchema);
export default CommerceSale;
