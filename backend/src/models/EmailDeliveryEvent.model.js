import mongoose from 'mongoose';

/**
 * Timeline d'une livraison — une ligne par TRANSITION appliquée depuis un webhook.
 *
 * C'est la source affichable « Accepté → Différé → Délivré → Ouvert → Cliqué »
 * avec les dates. Distincte du journal fournisseur (`BrevoWebhookEvent`) : celui-ci
 * consigne CE QUI EST REÇU, celle-ci consigne CE QUI A CHANGÉ sur la livraison.
 *
 * Index unique sur `webhookEventId` : un même événement fournisseur ne produit
 * qu'UNE entrée de timeline, même si le webhook est rejoué ou la réconciliation
 * repassée.
 */
const emailDeliveryEventSchema = new mongoose.Schema(
  {
    /** Livraison concernée (`EmailDelivery.deliveryId`). */
    deliveryId: { type: String, required: true },
    /** Événement fournisseur d'origine (`BrevoWebhookEvent.webhookEventId`). */
    webhookEventId: { type: String, required: true, unique: true },

    /** Type normalisé (NORMALIZED_EVENT). */
    type: { type: String, required: true },

    occurredAt: { type: Date, default: null },
    receivedAt: { type: Date, default: () => new Date() },

    /** Statut de livraison avant / après cette transition (null pour engagement). */
    statusBefore: { type: String, default: null },
    statusAfter: { type: String, default: null },

    /** Diagnostic fournisseur SÛR (raison de rebond, code d'erreur borné). */
    diagnosticSafe: {
      code: { type: String, default: '' },
      message: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

/** Lecture chronologique de la timeline d'une livraison. */
emailDeliveryEventSchema.index({ deliveryId: 1, occurredAt: 1 });
emailDeliveryEventSchema.index({ deliveryId: 1, createdAt: 1 });

export const EmailDeliveryEvent = mongoose.model('EmailDeliveryEvent', emailDeliveryEventSchema);
export default EmailDeliveryEvent;
