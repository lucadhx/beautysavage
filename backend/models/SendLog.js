// models/SendLog.js
// Observability log for outbound communications (email V1, via Brevo).
//
// PRIVACY: never stores the full recipient email — only a salted-less SHA-256
// hash (recipientHash). Never stores any secret/API key. The subject is kept for
// diagnostics (template-derived, not a credential).
//
// Lifecycle: queued -> sent -> delivered -> opened   (or -> bounced / failed)

import mongoose from 'mongoose';

const STATUSES = ['queued', 'sent', 'delivered', 'opened', 'bounced', 'failed'];

const sendLogSchema = new mongoose.Schema(
  {
    channel: { type: String, default: 'email' },
    provider: { type: String, default: 'brevo' },
    templateKey: { type: String, default: '' },

    recipientHash: { type: String, default: '' }, // SHA-256 of the lowercased email — never the email

    status: { type: String, enum: STATUSES, default: 'queued' },

    providerMessageId: { type: String, default: '' },

    subject: { type: String, default: '' },

    contextType: { type: String, default: null }, // e.g. "sale", "booking" (optional)
    contextId: { type: String, default: null },

    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    queuedAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    openedAt: { type: Date, default: null },
    bouncedAt: { type: Date, default: null },

    errorCode: { type: String, default: '' },
    errorMessageSafe: { type: String, default: '' } // never a secret / never raw provider payload
  },
  { timestamps: true }
);

// Webhook correlation (delivered/opened/bounce events arrive by providerMessageId)
sendLogSchema.index({ providerMessageId: 1 });
// Diagnostic queries
sendLogSchema.index({ status: 1, createdAt: -1 });
sendLogSchema.index({ createdAt: -1 });
sendLogSchema.index({ contextType: 1, contextId: 1 });

const SendLog = mongoose.models.SendLog || mongoose.model('SendLog', sendLogSchema);

export default SendLog;
export { STATUSES as SEND_LOG_STATUSES };
