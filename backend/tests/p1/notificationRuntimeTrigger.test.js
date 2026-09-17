// tests/p1/notificationRuntimeTrigger.test.js
// M8 — Quand un template publié existe pour le type, le moteur rend la notification
// depuis le template (title/body/priority/persistent/action) ; la cible reste M3A.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Notification from '../../models/Notification.js';
import NotificationConfig from '../../models/NotificationConfig.js';
import NotificationCategory from '../../models/NotificationCategory.js';
import { createTemplate } from '../../services/notificationTemplateVersioningService.js';
import { triggerNotification } from '../../services/notificationService.js';

describe('notification runtime trigger (M8)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    await NotificationConfig.create({
      notificationLifetimeDays: 30,
      events: [{ eventType: 'new_sale', label: 'Vente', isActive: true, category: 'ventes', targetType: 'all', titleTemplate: 'LEGACY {{saleId}}', messageTemplate: 'LEGACY' }]
    });
  });

  it('template publié prioritaire sur la config legacy', async () => {
    const cat = await NotificationCategory.create({ name: 'Ventes', slug: 'ventes', icon: 'bi-cash', color: '#abc' });
    await createTemplate('new_sale', {
      title: 'TPL Vente {{saleId}}', body: 'Montant {{amount}}',
      categoryId: cat._id, priority: 'high', persistent: true, action: 'refund_details'
    }, 'tester');

    await triggerNotification('new_sale', { saleId: 'S-1', amount: '120' });
    const n = await Notification.findOne({ eventType: 'new_sale' }).lean();
    expect(n.title).toBe('TPL Vente S-1'); // template, pas legacy
    expect(n.message).toBe('Montant 120');
    expect(n.priority).toBe('high');
    expect(n.persistent).toBe(true);
    expect(n.action).toBe('refund_details');
    expect(n.templateKey).toBe('new_sale');
    expect(n.templateVersion).toBe(1);
    expect(n.templateRuntimeStatus).toBe('template');
    expect(n.targetRole).toBe('admin'); // M3A : choisi par le moteur, pas le template
    // enum legacy `category` non corrompue par le slug
    expect(n.category).toBe('ventes');
    expect(String(n.categoryId)).toBe(String(cat._id));
  });

  it('le moteur applique targetRole=dev pour un type dev même avec template publié', async () => {
    await createTemplate('webhook_failure', { title: 'Webhook KO', body: 'détail {{detail}}' }, 'tester');
    await triggerNotification('webhook_failure', { detail: 'x' });
    const n = await Notification.findOne({ eventType: 'webhook_failure' }).lean();
    expect(n).toBeTruthy();
    expect(n.title).toBe('Webhook KO');
    expect(n.targetRole).toBe('dev'); // mapping M3A
    expect(n.templateRuntimeStatus).toBe('template');
  });
});
