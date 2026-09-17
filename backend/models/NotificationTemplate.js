// models/NotificationTemplate.js
// M7 — Template de notification = CONTENU PUR + versioning. NE CONNAÎT PAS le scope (admin/dev/both),
// ni targetRole, ni e-mail : le moteur (NotificationEngine) choisit le scope au moment de la création
// de la Notification. Aucune couleur ici (la couleur vient de la catégorie référencée).
import mongoose from 'mongoose';

export const NOTIFICATION_PRIORITIES = ['low', 'normal', 'high', 'critical'];

const notificationTemplateSchema = new mongoose.Schema(
  {
    templateKey: { type: String, required: true, lowercase: true, trim: true },
    title: { type: String, default: '' },
    body: { type: String, default: '' },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'NotificationCategory', default: null },

    // Variables AUTORISÉES (noms uniquement). Le studio affiche utilisées/inconnues à partir de là.
    variables: { type: [String], default: [] },

    priority: { type: String, enum: NOTIFICATION_PRIORITIES, default: 'normal', lowercase: true, trim: true },
    persistent: { type: Boolean, default: false },
    // Action MÉTIER (jamais une URL/route) : ex. booking_details, refund_details, none.
    action: { type: String, default: '', trim: true },

    // --- Versioning (mêmes invariants que EmailTemplate, M5A) ---
    version: { type: Number, default: 1 },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'published' },
    publishedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    publishedBy: { type: String, default: '' },
    createdFromVersion: { type: Number, default: null },
    isSystemDefault: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'notification_templates' },
);

notificationTemplateSchema.index({ templateKey: 1, status: 1 });
// Au plus UNE version publiée par templateKey (index unique partiel).
notificationTemplateSchema.index(
  { templateKey: 1 },
  { unique: true, partialFilterExpression: { status: 'published' }, name: 'uniq_published_notification_template' },
);

const NotificationTemplate = mongoose.model('NotificationTemplate', notificationTemplateSchema);
export default NotificationTemplate;
