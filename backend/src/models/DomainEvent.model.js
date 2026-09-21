import mongoose from 'mongoose';
import {
  EVENT_ACTOR_TYPE_VALUES,
  EVENT_DISPATCH_STATUS,
  EVENT_DISPATCH_STATUS_VALUES,
  RETENTION_CLASS_VALUES,
} from '../utils/domainEventConstants.js';

/**
 * Événement métier — un FAIT, immuable.
 *
 * Ce document dit « ceci s'est produit », jamais « ceci doit se produire ». Les
 * conséquences vivent dans EventActionExecution : c'est cette séparation qui
 * permet à un échec d'action de ne jamais remettre en cause le métier.
 *
 * `payloadSafe` est RELU et exposé (routes DEV, Manager) : il ne contient que des
 * données sûres, garanties par `assertSafePayload` + le schéma du registre. Jamais
 * d'OTP, de clé API, de HTML, de payload fournisseur brut ni d'objet d'erreur.
 *
 * AUCUN index TTL : une purge aveugle effacerait des traces d'audit. Chaque
 * événement porte sa `retentionClass` pour qu'un script de purge explicite soit
 * trivial à écrire.
 */
const domainEventSchema = new mongoose.Schema(
  {
    /** Identifiant public stable (UUID). Sert de clé aux exécutions. */
    eventId: { type: String, required: true, unique: true }, // unique crée déjà l'index

    /** Type canonique. Validé contre DomainEventRegistry AVANT écriture. */
    type: { type: String, required: true },

    entityType: { type: String, required: true },
    /** Chaîne : l'entité n'est pas toujours un ObjectId (singleton, ressource externe). */
    entityId: { type: String, default: null },

    actor: {
      type: { type: String, enum: EVENT_ACTOR_TYPE_VALUES, required: true },
      id: { type: String, default: null },
      role: { type: String, default: null },
    },

    payloadSafe: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    occurredAt: { type: Date, required: true },

    /**
     * Clé d'idempotence OPTIONNELLE. Deux appels portant la même clé produisent un
     * seul événement.
     *
     * Volontairement PAS `type + entityId` : un même type peut légitimement se
     * reproduire sur une même entité (deux demandes de code successives sont deux
     * faits distincts). La clé doit inclure ce qui rend l'occurrence unique.
     */
    idempotencyKey: { type: String, default: null },

    retentionClass: { type: String, enum: RETENTION_CLASS_VALUES, required: true },

    dispatchStatus: {
      type: String,
      enum: EVENT_DISPATCH_STATUS_VALUES,
      default: EVENT_DISPATCH_STATUS.PENDING,
    },
    dispatchAttempts: { type: Number, default: 0 },
    lastDispatchAt: { type: Date, default: null },
    lastErrorSafe: {
      code: { type: String, default: '' },
      message: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

/**
 * Unicité de la clé d'idempotence QUAND ELLE EST PRÉSENTE. Le
 * `partialFilterExpression` est l'idiome du dépôt (cf. Payment.stripe.checkoutSessionId) :
 * sans lui, tous les événements sans clé (null) entreraient en collision.
 */
domainEventSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

// Lecture par type et par date : le filtre par défaut des routes DEV.
domainEventSchema.index({ type: 1, occurredAt: -1 });
// Historique d'une entité.
domainEventSchema.index({ entityType: 1, entityId: 1, occurredAt: -1 });
// Reprise : retrouver les événements non dispatchés.
domainEventSchema.index({ dispatchStatus: 1, occurredAt: 1 });
// Pagination par curseur (liste DEV, ordre stable).
domainEventSchema.index({ occurredAt: -1, _id: -1 });

export const DomainEvent = mongoose.model('DomainEvent', domainEventSchema);
export default DomainEvent;
