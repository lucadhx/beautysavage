// tests/p1/notificationRuntimeFallback.test.js
// M8 — Non-régression : sans template publié, le moteur retombe sur le legacy
// (NotificationConfig) à l'identique. Flag OFF → legacy pur.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Notification from '../../models/Notification.js';
import NotificationConfig from '../../models/NotificationConfig.js';
import { triggerNotification } from '../../services/notificationService.js';

async function seedConfig() {
  await NotificationConfig.create({
    notificationLifetimeDays: 30,
    events: [
      { eventType: 'new_sale', label: 'Vente', isActive: true, category: 'ventes', targetType: 'all', titleTemplate: 'Vente {{saleId}}', messageTemplate: 'Montant {{amount}}' }
    ]
  });
}

describe('notification runtime fallback (M8)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await seedConfig(); });
  afterEach(() => { delete process.env.NOTIFICATION_TEMPLATE_RUNTIME_ENABLED; });

  it('aucun template publié → rendu legacy + status fallback_template_missing', async () => {
    await triggerNotification('new_sale', { saleId: 'S-1', amount: '120' });
    const n = await Notification.findOne({ eventType: 'new_sale' }).lean();
    expect(n.title).toBe('Vente S-1');
    expect(n.message).toBe('Montant 120');
    expect(n.category).toBe('ventes'); // enum legacy préservée
    expect(n.targetRole).toBe('admin'); // M3A préservé
    expect(n.templateRuntimeStatus).toBe('fallback_template_missing');
    expect(n.templateKey).toBeNull();
  });

  it('flag OFF → legacy pur + status legacy_runtime_disabled', async () => {
    process.env.NOTIFICATION_TEMPLATE_RUNTIME_ENABLED = 'false';
    await triggerNotification('new_sale', { saleId: 'S-2', amount: '50' });
    const n = await Notification.findOne({ eventType: 'new_sale' }).lean();
    expect(n.title).toBe('Vente S-2');
    expect(n.templateRuntimeStatus).toBe('legacy_runtime_disabled');
  });

  it('ni template ni eventConfig actif → aucune notification (comportement historique)', async () => {
    await triggerNotification('type_inconnu', { x: 1 });
    expect(await Notification.countDocuments({ eventType: 'type_inconnu' })).toBe(0);
  });
});
