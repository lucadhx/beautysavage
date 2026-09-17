// models/EventLog.js
// Persistent, append-only log of backend domain events (Phase 3).
//
// PRIVACY: payloadSafe must never contain a full email, secret, or token. The
// event bus redacts payloads before persistence, but emitters must also pass
// only safe data.

import mongoose from 'mongoose';

const eventLogSchema = new mongoose.Schema(
  {
    eventName: { type: String, required: true },
    domain: { type: String, default: 'unknown' },
    version: { type: Number, default: 1 },

    actorType: { type: String, default: 'system' }, // system | user | webhook | scheduler | ai_agent
    actorId: { type: String, default: null },
    source: { type: String, default: null }, // e.g. "mailService", "brevoWebhook"

    contextType: { type: String, default: null }, // e.g. "sale", "service_booking"
    contextId: { type: String, default: null },

    payloadSafe: { type: mongoose.Schema.Types.Mixed, default: {} }, // redacted, no email/secret

    traceId: { type: String, default: null },

    emittedAt: { type: Date, default: Date.now }
  },
  { timestamps: true } // adds createdAt / updatedAt
);

eventLogSchema.index({ eventName: 1, createdAt: -1 });
eventLogSchema.index({ contextType: 1, contextId: 1 });
eventLogSchema.index({ createdAt: -1 });
eventLogSchema.index({ domain: 1, createdAt: -1 });

const EventLog = mongoose.models.EventLog || mongoose.model('EventLog', eventLogSchema);

export default EventLog;
