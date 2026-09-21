import mongoose from 'mongoose';
import {
  WEBHOOK_PROCESSING_STATUS,
  WEBHOOK_PROCESSING_STATUS_VALUES,
} from '../utils/brevoWebhookConstants.js';

/**
 * Journal FOURNISSEUR des webhooks transactionnels Brevo — une ligne par
 * notification reçue, avant tout rapprochement métier.
 *
 * ═══ CE QU'ON NE STOCKE PAS ══════════════════════════════════════════════════
 *
 * Brevo n'expose AUCUN identifiant unique par événement (`id` = id du webhook, pas
 * de l'événement). L'idempotence repose donc sur une CLÉ COMPOSÉE stable — jamais
 * l'adresse en clair : le destinataire n'y entre que HACHÉ (`recipientHash`).
 *
 * `rawPayloadSafe` ne conserve QUE des champs curés et sûrs (cf. service d'ingest).
 * Jamais : tokens, en-têtes d'auth, cookies, HTML, variables complètes, URL brute
 * avec paramètres sensibles.
 */
const brevoWebhookEventSchema = new mongoose.Schema(
  {
    /** Identifiant public stable de la ligne. */
    webhookEventId: { type: String, required: true, unique: true },

    provider: { type: String, default: 'BREVO' },
    /** Déterminé par la ROUTE (`/:mode`), jamais par un champ du payload. */
    providerMode: { type: String, enum: ['TEST', 'PROD'], required: true },

    /** Réservé : Brevo ne fournit pas d'id d'événement unique aujourd'hui. */
    providerEventId: { type: String, default: null },
    /** Champ de rapprochement principal (`message-id` du payload, normalisé). */
    providerMessageId: { type: String, default: null },

    /** Type BRUT reçu (payload-time, snake_case). */
    eventType: { type: String, default: '' },
    /** Type normalisé (NORMALIZED_EVENT) ou `null` si inconnu. */
    normalizedEventType: { type: String, default: null },

    recipientEmailMasked: { type: String, default: '' },
    /** Empreinte stable du destinataire (keyHash) — jamais l'adresse. */
    recipientHash: { type: String, default: '' },

    /** Date fournisseur de l'événement (peut manquer). */
    occurredAt: { type: Date, default: null },
    receivedAt: { type: Date, default: () => new Date() },

    /** Livraison rapprochée (si trouvée). */
    deliveryId: { type: String, default: null },
    matched: { type: Boolean, default: false },

    processingStatus: {
      type: String,
      enum: WEBHOOK_PROCESSING_STATUS_VALUES,
      default: WEBHOOK_PROCESSING_STATUS.RECEIVED,
    },

    /**
     * CLÉ D'IDEMPOTENCE composée. Le même webhook rejoué N fois ne crée qu'une
     * ligne (index unique). Ne contient JAMAIS l'adresse en clair.
     */
    idempotencyKey: { type: String, required: true, unique: true },

    /** Champs curés et sûrs uniquement (jamais le payload brut complet). */
    rawPayloadSafe: { type: mongoose.Schema.Types.Mixed, default: null },

    lastErrorSafe: {
      code: { type: String, default: '' },
      message: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

/** Rapprochement / réconciliation par messageId et mode. */
brevoWebhookEventSchema.index({ provider: 1, providerMode: 1, providerMessageId: 1 });
/** Balayage des non-rapprochés pour réconciliation (les plus anciens d'abord). */
brevoWebhookEventSchema.index({ processingStatus: 1, createdAt: 1 });

export const BrevoWebhookEvent = mongoose.model('BrevoWebhookEvent', brevoWebhookEventSchema);
export default BrevoWebhookEvent;
