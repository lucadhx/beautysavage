// tests/p1/mailEventSubscriber.test.js
// M2 — Subscriber : flag off → no-op (aucun dispatch) ; flag on → dispatch (ledger créé). Best-effort.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

const mongoose = (await import('mongoose')).default;
const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const MailEventDelivery = (await import('../../models/MailEventDelivery.js')).default;
const { handleMailEvent } = await import('../../subscribers/mailEventSubscriber.js');

describe('mailEventSubscriber', () => {
  const prev = process.env.MAIL_ROLE_RESOLVER_ENABLED;
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await MailEventDelivery.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); process.env.MAIL_ROLE_RESOLVER_ENABLED = prev; });
  beforeEach(async () => { await clearDatabase(); await MailEventDelivery.syncIndexes(); });
  afterEach(() => { process.env.MAIL_ROLE_RESOLVER_ENABLED = prev; });

  it('flag off → no-op (aucune entrée ledger)', async () => {
    process.env.MAIL_ROLE_RESOLVER_ENABLED = 'false';
    await handleMailEvent({ eventName: 'sale.finalized', contextType: 'sale', contextId: 'S1' });
    expect(await MailEventDelivery.countDocuments({})).toBe(0);
  });

  it('flag on → dispatch (ledger shadow créé)', async () => {
    process.env.MAIL_ROLE_RESOLVER_ENABLED = 'true';
    await handleMailEvent({ eventName: 'sale.finalized', contextType: 'sale', contextId: 'S2' });
    const ledger = await MailEventDelivery.findOne({ eventName: 'sale.finalized', contextId: 'S2' }).lean();
    expect(ledger.status).toBe('skipped_duplicate_direct_sender');
  });

  it('flag on + event hors règles → no-op silencieux', async () => {
    process.env.MAIL_ROLE_RESOLVER_ENABLED = 'true';
    await handleMailEvent({ eventName: 'email.opened', contextId: 'X' });
    expect(await MailEventDelivery.countDocuments({})).toBe(0);
  });

  it('ne throw jamais même si l’eventLog est vide', async () => {
    process.env.MAIL_ROLE_RESOLVER_ENABLED = 'true';
    await expect(handleMailEvent(undefined)).resolves.toBeUndefined();
  });
});
