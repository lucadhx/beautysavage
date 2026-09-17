// tests/p1/customer360Privacy.test.js
// M12 — Confidentialité : la fiche Customer 360 n'expose AUCUN secret/PII technique (passwordHash,
// passwordSalt, sessionTokenHash, recipientHash, e-mail d'autrui, sk_/whsec_/xkeysib-). Les
// communications (SendLog) n'exposent jamais l'e-mail ni le hash.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import { seedTestData } from '../setup/seedTestData.js';
import Sale from '../../models/Sale.js';
import SendLog from '../../models/SendLog.js';
import EventLog from '../../models/EventLog.js';
import { hashRecipient } from '../../services/sendLogService.js';
import { buildCustomer360 } from '../../services/customer360/customer360Service.js';

let fx;
describe('M12 — privacy', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    fx = await seedTestData();
    await Sale.create({ saleId: 'S-PRIV-1', userId: fx.client1._id, totalAmount: 80, itemCount: 1, createdAt: new Date() });
    await SendLog.create({
      channel: 'email', templateKey: 'booking_confirmed', recipientHash: hashRecipient(fx.client1.email),
      subject: 'Confirmation de réservation', status: 'sent', sentAt: new Date(), contextType: 'sale', contextId: 'S-PRIV-1'
    });
    await EventLog.create({ eventName: 'sale.finalized', contextType: 'sale', contextId: 'S-PRIV-1', payloadSafe: { saleId: 'S-PRIV-1' } });
  });

  it('ne contient aucun secret ni PII technique', async () => {
    const data = await buildCustomer360(fx.client1._id);
    const raw = JSON.stringify(data);
    expect(raw).not.toMatch(/passwordHash|passwordSalt|sessionTokenHash/);
    expect(raw).not.toMatch(/recipientHash/);
    expect(raw).not.toMatch(/sk_live_|sk_test_|whsec_|xkeysib-/);
    expect(raw).not.toMatch(/mongodb\+srv:\/\//);
    // l'e-mail du hash ne doit jamais réapparaître via le SendLog
    expect(raw).not.toContain(hashRecipient(fx.client1.email));
  });

  it('communications n\'exposent jamais e-mail ni hash', async () => {
    const { communications } = await buildCustomer360(fx.client1._id);
    expect(communications.length).toBeGreaterThan(0);
    for (const c of communications) {
      expect(c).not.toHaveProperty('recipientHash');
      expect(c).not.toHaveProperty('email');
      expect(JSON.stringify(c)).not.toContain(fx.client1.email);
    }
  });

  it('expose bien l\'identité du client consulté (sa propre fiche)', async () => {
    const { customer } = await buildCustomer360(fx.client1._id);
    expect(customer.email).toBe(fx.client1.email); // sa fiche → autorisé
    expect(customer).not.toHaveProperty('passwordHash');
    expect(customer).not.toHaveProperty('sessionTokenHash');
  });
});
