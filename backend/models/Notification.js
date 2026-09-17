import crypto from 'node:crypto';
import mongoose from 'mongoose';

function buildNotificationId() {
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `NOTIF-${suffix}`;
}

const notificationSchema = new mongoose.Schema({
  notificationId: {
    type: String,
    unique: true,
    default: buildNotificationId
  },

  // Contenu
  title: { type: String, required: true },
  message: { type: String, required: true },
  category: {
    type: String,
    enum: ['prestations', 'formations', 'ventes', 'système', 'remboursements', 'clients'],
    default: 'système'
  },

  // Destinataires
  targetType: {
    type: String,
    enum: ['all', 'role', 'user'],
    default: 'all'
  },
  // M3A — Cible métier / audience (panel). Élève l'ancien champ "rôle de livraison"
  // au rang de partition d'audience : admin = panel Manager/Admin, dev = espace Dev.
  // default 'admin' pour compat historique. JAMAIS de cible client ici.
  // (targetType reste la granularité de livraison intra-audience : all / role / user.)
  targetRole: {
    type: String,
    enum: ['admin', 'dev'],
    default: 'admin',
    index: true
  },
  targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Lien cliquable
  link: { type: String, default: null },
  linkLabel: { type: String, default: null },

  // Métadonnées
  eventType: { type: String, default: null },
  variables: { type: mongoose.Schema.Types.Mixed, default: {} },

  // M3B — Corrélation event → notification (champs SAFE uniquement : IDs/noms, jamais
  // d'e-mail/secret). Permet l'audit et la traçabilité event↔notification.
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'EventLog', default: null },
  eventName: { type: String, default: null },
  contextType: { type: String, default: null },
  contextId: { type: String, default: null },

  // M8 — Provenance « template runtime ». Le moteur (triggerNotification) consomme
  // désormais les NotificationTemplate publiés (M7). Champs ADDITIFS : une notification
  // créée par le chemin legacy (NotificationConfig) les laisse à leur défaut.
  // INVARIANT : le template ne porte JAMAIS de scope/targetRole — la cible reste M3A.
  templateKey: { type: String, default: null },
  templateVersion: { type: Number, default: null },
  // Catégorie M7 (vrai modèle). NE PAS confondre avec `category` (enum legacy ci-dessus) :
  // le slug d'une NotificationCategory n'appartient pas à l'enum, on le stocke ici.
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'NotificationCategory', default: null },
  // Snapshot immuable de la catégorie au moment de l'envoi (centre = icône/couleur stables).
  categorySnapshot: {
    name: { type: String, default: null },
    slug: { type: String, default: null },
    icon: { type: String, default: null },
    color: { type: String, default: null }
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'critical'],
    default: 'normal'
  },
  persistent: { type: Boolean, default: false },
  // Action MÉTIER (jamais une URL/route) : ex. booking_details, refund_details, none.
  action: { type: String, default: null },
  // Traçabilité : 'template' (rendu depuis un NotificationTemplate publié),
  // 'fallback_template_missing' (legacy car aucun template publié),
  // 'legacy_runtime_disabled' (flag runtime OFF), null (chemin historique non instrumenté).
  templateRuntimeStatus: { type: String, default: null },
  // Copie SANITIZÉE des variables (jamais e-mail client complet / secret / token).
  variablesSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },

  // Statuts de lecture
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  // Expiration
  expiresAt: { type: Date, default: null },

  createdAt: { type: Date, default: Date.now }
});

notificationSchema.index({ targetType: 1, targetRole: 1, targetUserId: 1, createdAt: -1 });
notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { sparse: true, expireAfterSeconds: 0 });
// M3A — lecture par audience.
notificationSchema.index({ targetRole: 1, createdAt: -1 });
notificationSchema.index({ targetRole: 1, expiresAt: 1 });

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;
