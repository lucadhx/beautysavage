// models/WebhookFailureLog.js
// Sprint pré-React A6 — Journal persistant des pannes webhook (Stripe en priorité).
// Remplace les console.* éphémères : une panne « paiement échoué à 3h » devient
// interrogeable (par paymentIntentId / stripeEventId / période).
//
// PRIVACY : aucune donnée sensible. `errorMessageSafe` est un message tronqué et
// neutre ; ne JAMAIS y stocker un secret, un PAN/CVV, un email complet ou un payload
// Stripe brut. Seuls des identifiants techniques (event id, payment intent id) sont
// conservés.

import mongoose from 'mongoose';

const webhookFailureLogSchema = new mongoose.Schema(
  {
    provider: { type: String, default: 'stripe' }, // stripe | brevo | ...
    webhookType: { type: String, default: null }, // ex. "institut", "dev"
    eventType: { type: String, default: null }, // ex. "payment_intent.succeeded"
    failureStage: { type: String, default: null }, // ex. "signature", "processing"
    errorCode: { type: String, default: null },
    errorMessageSafe: { type: String, default: '' }, // tronqué, sans donnée sensible
    stripeEventId: { type: String, default: null },
    paymentIntentId: { type: String, default: null },
    status: {
      type: String,
      enum: ['failed', 'resolved'],
      default: 'failed'
    },
    retryable: { type: Boolean, default: false },
    createdAt: { type: Date, default: () => new Date() }
  },
  { collection: 'webhookfailurelogs' }
);

webhookFailureLogSchema.index({ provider: 1, createdAt: -1 });
webhookFailureLogSchema.index({ paymentIntentId: 1 });
webhookFailureLogSchema.index({ stripeEventId: 1 }, { sparse: true });
webhookFailureLogSchema.index({ status: 1, createdAt: -1 });

const WebhookFailureLog =
  mongoose.models.WebhookFailureLog || mongoose.model('WebhookFailureLog', webhookFailureLogSchema);

export default WebhookFailureLog;
