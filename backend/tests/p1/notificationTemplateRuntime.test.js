// tests/p1/notificationTemplateRuntime.test.js
// M8 — Service runtime des templates : rendu {{var}}, snapshot de catégorie, sanitize
// des variables, build du payload depuis un template publié.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import NotificationCategory from '../../models/NotificationCategory.js';
import { createTemplate } from '../../services/notificationTemplateVersioningService.js';
import {
  renderNotificationTemplate,
  sanitizeVariablesSnapshot,
  getPublishedNotificationTemplate,
  getCategorySnapshot,
  buildNotificationPayloadFromTemplate
} from '../../services/notificationTemplateRuntimeService.js';

describe('notification template runtime (M8)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('renderNotificationTemplate interpole, ignore les clés inconnues et strip le HTML', () => {
    const out = renderNotificationTemplate(
      { title: 'Vente {{saleId}}', body: 'Montant {{amount}} de <b>{{clientName}}</b>{{unknown}}' },
      { saleId: 'S-1', amount: '120', clientName: 'Jane' }
    );
    expect(out.title).toBe('Vente S-1');
    expect(out.body).toBe('Montant 120 de Jane'); // {{unknown}} → '' + balises retirées
    expect(out.usedVariables).toContain('saleid');
    expect(out.missingVariables).toContain('unknown');
  });

  it('sanitizeVariablesSnapshot retire les clés sensibles et les valeurs e-mail', () => {
    const snap = sanitizeVariablesSnapshot({
      saleId: 'S-1', amount: 120, persistent: true,
      clientEmail: 'jane@example.com', token: 'abc', apiKey: 'k',
      note: 'contact jane@example.com please', nested: { a: 1 }
    });
    expect(snap.saleId).toBe('S-1');
    expect(snap.amount).toBe(120);
    expect(snap.persistent).toBe(true);
    expect(snap.clientEmail).toBeUndefined();
    expect(snap.token).toBeUndefined();
    expect(snap.apiKey).toBeUndefined();
    expect(snap.note).toBeUndefined(); // valeur ressemblant à un e-mail
    expect(snap.nested).toBeUndefined(); // pas de scalaire
  });

  it('getPublishedNotificationTemplate retourne le publié, null si absent', async () => {
    expect(await getPublishedNotificationTemplate('new_sale')).toBeNull();
    await createTemplate('new_sale', { title: 'T', body: 'B' }, 'tester');
    const tpl = await getPublishedNotificationTemplate('new_sale');
    expect(tpl).toBeTruthy();
    expect(tpl.status).toBe('published');
  });

  it('getCategorySnapshot ne renvoie que name/slug/icon/color', async () => {
    const cat = await NotificationCategory.create({ name: 'Ventes', slug: 'ventes', icon: 'bi-cash', color: '#123456' });
    const snap = await getCategorySnapshot(cat._id);
    expect(snap).toEqual({ name: 'Ventes', slug: 'ventes', icon: 'bi-cash', color: '#123456' });
    expect(await getCategorySnapshot(null)).toBeNull();
  });

  it('buildNotificationPayloadFromTemplate assemble contenu + catégorie + métadonnées', async () => {
    const cat = await NotificationCategory.create({ name: 'Ventes', slug: 'ventes', icon: 'bi-cash', color: '#abc' });
    await createTemplate('new_sale', {
      title: 'Vente {{saleId}}', body: 'Montant {{amount}}',
      categoryId: cat._id, priority: 'high', persistent: true, action: 'refund_details',
      variables: ['saleid', 'amount']
    }, 'tester');

    const payload = await buildNotificationPayloadFromTemplate('new_sale', { saleId: 'S-9', amount: '300', link: '/x', linkLabel: 'L' });
    expect(payload.templateKey).toBe('new_sale');
    expect(payload.title).toBe('Vente S-9');
    expect(payload.message).toBe('Montant 300');
    expect(payload.priority).toBe('high');
    expect(payload.persistent).toBe(true);
    expect(payload.action).toBe('refund_details');
    expect(payload.categorySnapshot.slug).toBe('ventes');
    expect(payload.link).toBe('/x');
    expect(payload.templateRuntimeStatus).toBe('template');

    // null si aucun template publié pour la clé
    expect(await buildNotificationPayloadFromTemplate('does_not_exist', {})).toBeNull();
  });
});
