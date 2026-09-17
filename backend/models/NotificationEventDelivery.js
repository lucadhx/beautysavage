// models/NotificationEventDelivery.js
// Idempotence ledger for the EventBus -> Notification subscriber (Phase 4D).
// One row per (eventName, contextType, contextId, notificationType): guarantees a
// given business event never creates the same notification twice (re-emit safe).

import mongoose from 'mongoose';

const notificationEventDeliverySchema = new mongoose.Schema({
  eventName: { type: String, required: true },
  contextType: { type: String, default: null },
  contextId: { type: String, default: null },
  notificationType: { type: String, required: true },
  eventLogId: { type: mongoose.Schema.Types.ObjectId, ref: 'EventLog', default: null },
  notificationId: { type: String, default: null },
  status: { type: String, enum: ['created', 'shadow', 'skipped', 'failed'], default: 'created' },
  createdAt: { type: Date, default: Date.now }
});

// Logical idempotence key.
notificationEventDeliverySchema.index(
  { eventName: 1, contextType: 1, contextId: 1, notificationType: 1 },
  { unique: true, name: 'uniq_event_notification_delivery' }
);

const NotificationEventDelivery =
  mongoose.models.NotificationEventDelivery ||
  mongoose.model('NotificationEventDelivery', notificationEventDeliverySchema);

export default NotificationEventDelivery;
