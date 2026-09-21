// L'ANTI-REJEU — une assertion sert UNE fois (L12.B).
//
// docs/auth/PANEL_FEDERATED_DEV_IDENTITY_IMPLEMENTATION.md §« ANTI REPLAY ».
//
// ── CE QU'IL EMPÊCHE, ET POURQUOI L'EXPIRATION NE SUFFIT PAS ────────────────
//
// Une assertion vit trois minutes. Pendant ces trois minutes, elle est un
// laissez-passer au porteur : quiconque la lit — dans un historique de
// navigateur, un journal de reverse proxy, un `Referer` — peut s'en servir.
// L'expiration borne la fenêtre ; elle ne la ferme pas.
//
// La consommation la ferme : dès que l'assertion a établi UNE session, elle ne
// vaut plus rien. Une copie interceptée arrive trop tard, même à la seconde
// suivante.
//
// ── POURQUOI L'EMPREINTE, ET PAS LE `jti` BRUT ──────────────────────────────
//
// Le `jti` est un identifiant de laissez-passer. Le stocker en clair ferait de
// cette collection une liste de jetons ayant réellement existé — sans valeur
// opérationnelle pour nous, et d'une valeur certaine pour quelqu'un qui lirait
// une sauvegarde. Son EMPREINTE suffit à répondre « déjà vu ? », qui est la
// seule question posée.
//
// ── POURQUOI L'INDEX EST LA GARANTIE, ET NON UNE LECTURE PRÉALABLE ──────────
//
// Deux callbacks simultanés porteraient la même assertion et passeraient tous
// deux un `findOne` avant que l'un ait écrit. Seule la contrainte unique
// arbitre : la seconde insertion reçoit un E11000, et c'est CE refus qui prouve
// qu'une seule session a été ouverte.
import mongoose from 'mongoose';

const federatedAssertionConsumptionSchema = new mongoose.Schema(
  {
    /** SHA-256 du `jti`. Voir l'en-tête : jamais le `jti` lui-même. */
    jtiHash: { type: String, required: true },

    /** À qui elle a servi — utile au diagnostic, sans valeur d'accès. */
    panelUserId: { type: String, required: true },

    /** Horodatages du jeton, tels qu'il les portait. */
    issuedAt: { type: Date, default: null },
    /**
     * L'EXPIRATION DU JETON, PAS DE LA LIGNE — mais c'est elle qui gouverne la
     * purge : une assertion périmée est refusée par sa date bien avant de
     * l'être par cette liste. Garder sa trace au-delà n'ajoute rien, et faire
     * croître une collection sans fin est une panne différée.
     */
    expiresAt: { type: Date, required: true },

    consumedAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
);

/** L'UNICITÉ EST LA GARANTIE. Voir l'en-tête. */
federatedAssertionConsumptionSchema.index(
  { jtiHash: 1 },
  { unique: true, name: 'uniq_assertion_jti' },
);

/**
 * PURGE AUTOMATIQUE par MongoDB, une heure après l'expiration du jeton.
 *
 * L'heure de marge n'est pas de la prudence : `expireAfterSeconds` est évalué
 * par une tâche de fond qui passe environ chaque minute, et une horloge peut
 * dériver. Supprimer trop tôt rouvrirait la fenêtre de rejeu que cette
 * collection existe pour fermer.
 */
federatedAssertionConsumptionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 3600, name: 'ttl_assertion_consumption' },
);

export const FederatedAssertionConsumption = mongoose.model(
  'FederatedAssertionConsumption',
  federatedAssertionConsumptionSchema,
);
export default FederatedAssertionConsumption;
