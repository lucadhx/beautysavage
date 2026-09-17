// tests/p1/notificationRuntimeCategorySnapshot.test.js
// M8 — La notification créée depuis un template capture un snapshot immuable de la
// catégorie (name/slug/icon/color). Modifier la catégorie ensuite ne change pas le snapshot.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Notification from '../../models/Notification.js';
import NotificationCategory from '../../models/NotificationCategory.js';
import { createTemplate } from '../../services/notificationTemplateVersioningService.js';
import { triggerNotification } from '../../services/notificationService.js';

describe('notification runtime category snapshot (M8)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('capture name/slug/icon/color et reste figé après modification de la catégorie', async () => {
    const cat = await NotificationCategory.create({ name: 'Technique', slug: 'technique', icon: 'bi-cpu', color: '#ff0000' });
    await createTemplate('system_error', { title: 'Erreur', body: 'détail {{detail}}', categoryId: cat._id }, 'tester');

    await triggerNotification('system_error', { detail: 'boom' });
    const n = await Notification.findOne({ eventType: 'system_error' }).lean();
    expect(n.categorySnapshot).toMatchObject({ name: 'Technique', slug: 'technique', icon: 'bi-cpu', color: '#ff0000' });

    // la catégorie change → le snapshot déjà persisté ne bouge pas
    await NotificationCategory.findByIdAndUpdate(cat._id, { color: '#00ff00', icon: 'bi-bug' });
    const again = await Notification.findOne({ eventType: 'system_error' }).lean();
    expect(again.categorySnapshot.color).toBe('#ff0000');
    expect(again.categorySnapshot.icon).toBe('bi-cpu');
  });

  it('template sans catégorie → categorySnapshot null, pas d\'échec de validation', async () => {
    await createTemplate('job_failed', { title: 'Job KO', body: '{{jobName}}' }, 'tester');
    await triggerNotification('job_failed', { jobName: 'reminder' });
    const n = await Notification.findOne({ eventType: 'job_failed' }).lean();
    expect(n).toBeTruthy();
    expect(n.categoryId).toBeNull();
    // categorySnapshot non défini / null (jamais d'objet partiel invalide)
    expect(n.categorySnapshot == null || n.categorySnapshot.slug == null).toBe(true);
    // enum legacy par défaut (pas de slug injecté)
    expect(['prestations', 'formations', 'ventes', 'système', 'remboursements', 'clients']).toContain(n.category);
  });
});
