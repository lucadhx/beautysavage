// tests/p1/notificationRuntimePrivacy.test.js
// M8 — variablesSnapshot persisté est SANITIZÉ : jamais d'e-mail client complet, de
// secret, de token. Le rendu peut afficher un nom, mais le snapshot stocké est nettoyé.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Notification from '../../models/Notification.js';
import { createTemplate } from '../../services/notificationTemplateVersioningService.js';
import { triggerNotification } from '../../services/notificationService.js';

describe('notification runtime privacy (M8)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    await createTemplate('new_sale', { title: 'Vente {{saleId}}', body: 'Client {{clientName}}' }, 'tester');
  });

  it('variablesSnapshot ne contient ni e-mail ni secret', async () => {
    await triggerNotification('new_sale', {
      saleId: 'S-1', clientName: 'Jane', amount: 120,
      clientEmail: 'jane@example.com', token: 'sk_secret', apiKey: 'k'
    });
    const n = await Notification.findOne({ eventType: 'new_sale' }).lean();
    expect(n.variablesSnapshot).toBeTruthy();
    expect(n.variablesSnapshot.saleId).toBe('S-1');
    expect(n.variablesSnapshot.clientName).toBe('Jane');
    expect(n.variablesSnapshot.amount).toBe(120);
    expect(n.variablesSnapshot.clientEmail).toBeUndefined();
    expect(n.variablesSnapshot.token).toBeUndefined();
    expect(n.variablesSnapshot.apiKey).toBeUndefined();
    expect(JSON.stringify(n.variablesSnapshot)).not.toContain('jane@example.com');
    expect(JSON.stringify(n.variablesSnapshot)).not.toContain('sk_secret');
  });
});
