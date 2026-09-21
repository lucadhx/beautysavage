import mongoose from 'mongoose';

/**
 * PRESTATION À RÉGLER — la PROJECTION locale de ce que le Panel réclame (L10.5).
 *
 * ══ CE N'EST PAS UNE SOURCE DE VÉRITÉ ═══════════════════════════════════════
 *
 * Rien ici n'est décidé par le projet. Le montant, le taux de TVA, l'état :
 * tout vient du Panel par le canal de synchronisation, et tout y est REMPLACÉ
 * à chaque livraison. Le projet ne fait qu'AFFICHER, et demander à payer.
 *
 * C'est délibéré, et c'est la même règle que pour le contrat : celui qui
 * facture est celui qui décide du montant. Laisser le projet écrire ici aurait
 * rouvert la porte que L6.2B a fermée — un client qui choisit ce qu'il paie.
 *
 * ══ POURQUOI UNE COLLECTION LOCALE PLUTÔT QU'UN APPEL AU PANEL ══════════════
 *
 * Parce que la page de facturation doit s'afficher quand le Panel est
 * indisponible. Une lecture distante à chaque rendu aurait fait dépendre
 * l'espace client de la disponibilité d'un autre service — et le premier
 * incident aurait effacé les factures du client au lieu de les montrer.
 *
 * ══ CE QU'ELLE NE PORTE PAS ═════════════════════════════════════════════════
 *
 * Aucun identifiant Stripe, aucune URL de session. La session est périssable :
 * la stocker ferait afficher un bouton menant à une page morte. Elle se demande
 * au clic, et le Panel en ouvre — ou en retrouve — une.
 */
const paymentRequestSchema = new mongoose.Schema(
  {
    /** L'identité que le Panel lui donne. C'est elle qu'on lui présente. */
    paymentRequestId: { type: String, required: true, unique: true },

    label: { type: String, required: true },
    description: { type: String, default: '' },

    /**
     * LA VENTILATION, TELLE QUE LE PANEL L'A FIGÉE À LA CRÉATION.
     *
     * En CENTIMES entiers, comme tout montant de ce projet. Le taux est un
     * POURCENTAGE (20 vaut 20 %) — même convention que `contract.taxRate`,
     * dont il est d'ailleurs issu.
     *
     * Le projet ne recalcule RIEN : si le contrat change de taux demain, cette
     * prestation garde le sien. C'est une facture, pas une estimation.
     */
    netAmountCents: { type: Number, required: true, min: 0 },
    taxRate: { type: Number, required: true, min: 0 },
    taxAmountCents: { type: Number, required: true, min: 0 },
    grossAmountCents: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'EUR' },

    /** L'état, décidé par le Panel. `payable` en est la lecture directe. */
    status: { type: String, required: true },
    payable: { type: Boolean, default: false },

    /**
     * LA VRAIE FACTURE STRIPE, une fois le paiement fait.
     *
     * Des ADRESSES hébergées par Stripe, jamais un fichier copié ici. Le
     * document juridique appartient au fournisseur qui l'a émis ; en garder une
     * copie locale créerait une seconde vérité qui divergerait au premier avoir.
     */
    invoiceUrl: { type: String, default: null },
    invoicePdfUrl: { type: String, default: null },

    issuedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },

    /** Quand le projet a reçu cette version. Diagnostic de convergence. */
    receivedAt: { type: String, required: true },
  },
  { timestamps: true, minimize: false, versionKey: false },
);

/** L'écran de facturation : les prestations, de la plus récente à la plus ancienne. */
paymentRequestSchema.index({ issuedAt: -1 }, { name: 'recent_first' });
/** « Que reste-t-il à payer ? » — la question du bandeau d'accueil. */
paymentRequestSchema.index({ payable: 1, issuedAt: -1 }, { name: 'payable_first' });

export const PaymentRequest = mongoose.model('PaymentRequest', paymentRequestSchema);
export default PaymentRequest;
