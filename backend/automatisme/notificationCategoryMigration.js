// automatisme/notificationCategoryMigration.js
// M7 — Seed des catégories de notification par défaut (additif : uniquement si la collection est
// vide). N'écrase jamais des catégories existantes (le dev les gère ensuite via le studio).
import NotificationCategory from '../models/NotificationCategory.js';

const DEFAULT_CATEGORIES = [
  { name: 'Business', slug: 'business', icon: 'bi-graph-up', color: '#5f4ff7', description: 'Activité commerciale', sortOrder: 10 },
  { name: 'Paiement', slug: 'paiement', icon: 'bi-cash-stack', color: '#1f7a3a', description: 'Paiements et finances', sortOrder: 20 },
  { name: 'Planning', slug: 'planning', icon: 'bi-calendar-event', color: '#2563eb', description: 'Réservations et sessions', sortOrder: 30 },
  { name: 'Communication', slug: 'communication', icon: 'bi-envelope', color: '#f24692', description: 'E-mails et messages', sortOrder: 40 },
  { name: 'Formation', slug: 'formation', icon: 'bi-mortarboard', color: '#a8876b', description: 'Formations', sortOrder: 50 },
  { name: 'Système', slug: 'systeme', icon: 'bi-gear', color: '#6b7280', description: 'Technique et plateforme', sortOrder: 60 },
  { name: 'Marketing', slug: 'marketing', icon: 'bi-megaphone', color: '#b45309', description: 'Promotions et campagnes', sortOrder: 70 },
  { name: 'Client', slug: 'client', icon: 'bi-people', color: '#0ea5e9', description: 'Clients', sortOrder: 80 },
];

export async function runNotificationCategoryMigration() {
  try {
    const count = await NotificationCategory.estimatedDocumentCount();
    if (count > 0) return;
    await NotificationCategory.insertMany(DEFAULT_CATEGORIES.map((c) => ({ ...c, active: true })));
    console.log('[NotificationCategory] Catégories par défaut créées :', DEFAULT_CATEGORIES.length);
  } catch (err) {
    console.error('[NotificationCategory] Erreur migration :', err?.message || err);
  }
}

export { DEFAULT_CATEGORIES };
