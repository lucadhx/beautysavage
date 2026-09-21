import mongoose from 'mongoose';
import {
  WEBHOOK_PROVIDER_VALUES,
  WEBHOOK_PROCESSING_STATUS,
} from '../utils/contractConstants.js';

/**
 * Journal d'événements webhook — garantit l'IDEMPOTENCE. Un événement
 * (provider + externalEventId) déjà traité ne produit jamais une seconde
 * transaction métier. L'insertion sert de verrou : l'index unique fait échouer
 * (E11000) le second traitement concurrent du même événement.
 *
 * Ne contient JAMAIS le corps brut complet du webhook (données sensibles) :
 * seulement le type, l'id externe et un contexte sûr minimal.
 */
const webhookEventSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: WEBHOOK_PROVIDER_VALUES, required: true },
    externalEventId: { type: String, required: true },
    eventType: { type: String, default: '' },
    receivedAt: { type: Date, default: Date.now },
    processedAt: { type: Date, default: null },
    processingStatus: {
      type: String,
      enum: Object.values(WEBHOOK_PROCESSING_STATUS),
      default: WEBHOOK_PROCESSING_STATUS.PENDING,
    },
    relatedContractId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', default: null },
    errorMessage: { type: String, default: '' },
    environment: { type: String, enum: ['TEST', 'PROD'], default: null },

    /* ── LE BAIL — ce qui distingue « en cours » de « abandonné » ─────────── */

    /**
     * QUI travaille dessus, en ce moment. `hôte:pid:démarrage`.
     *
     * Le nonce de démarrage est la seule partie sérieuse : un processus
     * redémarré peut réutiliser un pid sur le même hôte, et se croirait alors
     * titulaire d'un bail qu'il a perdu en mourant.
     */
    leaseOwner: { type: String, default: null },

    /** Début de la tentative en cours. Diagnostic : « depuis quand ? ». */
    processingStartedAt: { type: Date, default: null },

    /**
     * Au-delà de cet instant, le travail est réputé ABANDONNÉ — et l'événement
     * redevient reprenable. Voir `webhookLease.js` pour le choix de la durée.
     */
    leaseExpiresAt: { type: Date, default: null },

    /**
     * Nombre de RÉCLAMATIONS, pas de livraisons.
     *
     * Un fournisseur qui rejoue vingt fois un événement déjà `PROCESSED`
     * n'incrémente rien : il n'a rien réclamé. Ce compteur ne monte que quand
     * quelqu'un s'est engagé à faire le travail — c'est ce qui en fait un
     * détecteur d'événement toxique plutôt qu'un compteur de trafic.
     */
    processingAttempts: { type: Number, default: 0 },

    /**
     * Le dernier échec, avec sa CLASSIFICATION.
     *
     * `retryable` est le champ qui décide : sans lui, un corps illisible et une
     * base momentanément injoignable auraient le même destin — soit la boucle
     * infinie, soit l'abandon d'un événement parfaitement rattrapable.
     */
    lastError: {
      code: { type: String, default: null },
      retryable: { type: Boolean, default: null },
      at: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

webhookEventSchema.index({ provider: 1, externalEventId: 1 }, { unique: true });

/**
 * LA FILE DE REPRISE — « qu'est-ce qui traîne, et depuis quand ? ».
 *
 * La question de l'amorçage à chaque démarrage. La file utile est minuscule
 * (vide, la plupart du temps) alors que la collection ne cesse de grandir :
 * sans index, la poser coûterait un parcours complet à chaque redémarrage.
 */
webhookEventSchema.index(
  { processingStatus: 1, leaseExpiresAt: 1, receivedAt: 1 },
  { name: 'reprise_par_etat' },
);

export const WebhookEvent = mongoose.model('WebhookEvent', webhookEventSchema);
export default WebhookEvent;
