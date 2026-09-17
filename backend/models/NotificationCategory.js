// models/NotificationCategory.js
// M7 — Vrai modèle métier de catégorie de notification (PAS une enum). Source unique des
// icône/couleur/nom/description/ordre pour le centre de notifications. Les templates ne portent
// AUCUNE couleur : ils référencent une catégorie.
import mongoose from 'mongoose';

const notificationCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    icon: { type: String, default: 'bi-bell', trim: true },
    color: { type: String, default: '', trim: true },
    description: { type: String, default: '', trim: true },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'notification_categories' },
);

notificationCategorySchema.index({ sortOrder: 1, name: 1 });

const NotificationCategory = mongoose.model('NotificationCategory', notificationCategorySchema);
export default NotificationCategory;
