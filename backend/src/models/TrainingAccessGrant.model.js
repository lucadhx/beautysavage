import mongoose from 'mongoose';

/**
 * ACCÈS OFFERT À UNE FORMATION EN LIGNE — l'institut inscrit une cliente sans
 * qu'elle paie sur le site.
 *
 * Volontairement HORS des ventes : une fausse vente à 0 € fausserait le chiffre
 * d'affaires, les commissions et les factures. La règle d'accès commune
 * (`services/trainingAccess.js`) lit ces accès comme un achat.
 *
 * Un retrait garde la trace (`active: false`, `revokedAt`) ; une cliente n'a
 * qu'un accès offert ACTIF par formation (index partiel).
 */
const trainingAccessGrantSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceProduct', required: true, index: true },
    /** Titre au moment de l'ajout (la fiche peut être renommée ensuite). */
    productTitle: { type: String, default: '' },
    grantedAt: { type: Date, default: () => new Date() },
    grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /** Le compte a été créé par cet ajout (la cliente reçoit aussi le lien « choisir mon mot de passe »). */
    accountCreated: { type: Boolean, default: false },
    /** Faux une fois l'accès retiré (la trace reste). */
    active: { type: Boolean, default: true, index: true },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

trainingAccessGrantSchema.index(
  { customerId: 1, productId: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);

export const TrainingAccessGrant = mongoose.model('TrainingAccessGrant', trainingAccessGrantSchema);
export default TrainingAccessGrant;
