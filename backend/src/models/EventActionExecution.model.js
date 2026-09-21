import mongoose from 'mongoose';
import {
  ACTION_TYPE_VALUES,
  EXECUTION_STATUS,
  EXECUTION_STATUS_VALUES,
  SINGLE_RECIPIENT_KEY,
} from '../utils/domainEventConstants.js';

/**
 * Exécution d'UNE action pour UN événement et UN destinataire.
 *
 * C'est le journal qui rend le système observable et rejouable : chaque tentative,
 * chaque échec, chaque abandon y est lisible.
 *
 * L'INDEX UNIQUE (eventId, actionId, recipientKey) est le cœur de l'idempotence :
 * il rend physiquement impossible de créer deux fois la même exécution, donc
 * d'envoyer deux fois le même e-mail au même destinataire — même si le dispatcher
 * est relancé, même en concurrence. On ne s'en remet pas à une vérification
 * applicative, qui perdrait la course.
 *
 * UNE EXÉCUTION PAR DESTINATAIRE : sans cela, un succès sur l'un masquerait un
 * échec sur l'autre, et un retry global renverrait à tout le monde.
 */
const eventActionExecutionSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true },
    eventType: { type: String, required: true },

    actionId: { type: String, required: true },
    actionType: { type: String, enum: ACTION_TYPE_VALUES, required: true },

    templateId: { type: String, default: null },
    recipientResolver: { type: String, default: null },
    /** Clé STABLE du destinataire. `_single` pour une action sans destinataire. */
    recipientKey: { type: String, required: true, default: SINGLE_RECIPIENT_KEY },

    status: { type: String, enum: EXECUTION_STATUS_VALUES, default: EXECUTION_STATUS.PENDING },

    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, required: true },

    /** Date à partir de laquelle l'exécution est éligible (backoff). */
    availableAt: { type: Date, required: true, default: Date.now },
    processingStartedAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },

    /**
     * Verrou de traitement. Un `lockId` aléatoire par prise, vérifié à la
     * finalisation : un processus qui a perdu son verrou (lock expiré, repris par
     * un autre) ne doit surtout pas écrire le résultat d'un travail périmé.
     */
    lockId: { type: String, default: null },
    lockExpiresAt: { type: Date, default: null },

    /** Identifiant renvoyé par le fournisseur (message id) — jamais un secret. */
    providerMessageId: { type: String, default: null },

    lastErrorSafe: {
      code: { type: String, default: '' },
      message: { type: String, default: '' },
      retryable: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

/** Idempotence structurelle — l'unique garantie « jamais deux fois ». */
eventActionExecutionSchema.index({ eventId: 1, actionId: 1, recipientKey: 1 }, { unique: true });

// Prise de travail : les éligibles, les plus anciennes d'abord.
eventActionExecutionSchema.index({ status: 1, availableAt: 1 });
// Détail d'un événement.
eventActionExecutionSchema.index({ eventId: 1 });

export const EventActionExecution = mongoose.model('EventActionExecution', eventActionExecutionSchema);
export default EventActionExecution;
