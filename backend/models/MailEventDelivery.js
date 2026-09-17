import mongoose from 'mongoose';

// M2 — Ledger idempotent des dispatchs e-mail par event. Évite le double envoi au REPLAY d'un event.
// Statuts propres au moteur M2 (SendLog reste inchangé : queued/sent/delivered/opened/bounced/failed).
export const MAIL_EVENT_DELIVERY_STATUSES = [
  'shadow', // flag on mais envoi inhibé (mode shadow générique)
  'skipped_duplicate_direct_sender', // un envoi direct existe déjà → pas de doublon
  'skipped_rule_disabled', // règle désactivée
  'skipped_template_missing', // template publié introuvable
  'identity_missing', // identité support/commerciale absente/non vérifiée
  'client_missing', // destinataire client absent du contexte
  'sent', // e-mail réellement envoyé via la gateway
  'failed' // échec provider/gateway
];

const mailEventDeliverySchema = new mongoose.Schema(
  {
    eventName: { type: String, required: true },
    templateKey: { type: String, default: '' },
    fromRole: { type: String, default: '' },
    toRole: { type: String, default: '' },
    contextType: { type: String, default: null },
    contextId: { type: String, default: null },
    status: { type: String, enum: MAIL_EVENT_DELIVERY_STATUSES, required: true },
    sendLogId: { type: String, default: null },
    detailSafe: { type: String, default: '' } // message sûr (jamais de secret)
  },
  { timestamps: true, collection: 'mail_event_deliveries' }
);

// Idempotence : au plus une livraison par (event, contexte, template).
mailEventDeliverySchema.index(
  { eventName: 1, contextType: 1, contextId: 1, templateKey: 1 },
  { name: 'mail_event_delivery_idempotent', unique: true }
);

const MailEventDelivery = mongoose.model('MailEventDelivery', mailEventDeliverySchema);
export default MailEventDelivery;
