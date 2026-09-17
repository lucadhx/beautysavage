// tests/p1/mailEventDeliveryIdempotence.test.js
// M2 — Idempotence du ledger : un event rejoué ne crée qu'UNE livraison (pas de double e-mail).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import MailEventDelivery from '../../models/MailEventDelivery.js';
import { dispatchMailForEvent } from '../../services/mail/mailEventDispatchService.js';

describe('MailEventDelivery idempotence', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await MailEventDelivery.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await MailEventDelivery.syncIndexes(); });

  // NB : on utilise sale.finalized (règle SHADOW) pour tester l'idempotence du ledger sans
  // déclencher d'envoi réel (booking.confirmed/refund.succeeded sont désormais ACTIVES — M3C/M3D).
  it('rejouer le même event (même contexte) → 1 seule entrée', async () => {
    const evt = { eventName: 'sale.finalized', contextType: 'sale', contextId: 'B1' };
    await dispatchMailForEvent(evt);
    await dispatchMailForEvent(evt);
    await dispatchMailForEvent(evt);
    expect(await MailEventDelivery.countDocuments({ eventName: 'sale.finalized', contextId: 'B1' })).toBe(1);
  });

  it('contextes différents → entrées distinctes', async () => {
    await dispatchMailForEvent({ eventName: 'sale.finalized', contextType: 'sale', contextId: 'B1' });
    await dispatchMailForEvent({ eventName: 'sale.finalized', contextType: 'sale', contextId: 'B2' });
    expect(await MailEventDelivery.countDocuments({ eventName: 'sale.finalized' })).toBe(2);
  });

  it('index unique appliqué (insertion directe en double → E11000)', async () => {
    const base = { eventName: 'refund.succeeded', contextType: 'refund_request', contextId: 'R1', templateKey: 'refund_confirmed', status: 'shadow' };
    await MailEventDelivery.create(base);
    await expect(MailEventDelivery.create(base)).rejects.toMatchObject({ code: 11000 });
  });

  it('dispatch concurrent du même event → 1 seule entrée', async () => {
    const evt = { eventName: 'sale.finalized', contextType: 'sale', contextId: 'BC' };
    await Promise.all([dispatchMailForEvent(evt), dispatchMailForEvent(evt), dispatchMailForEvent(evt)]);
    expect(await MailEventDelivery.countDocuments({ eventName: 'sale.finalized', contextId: 'BC' })).toBe(1);
  });
});
