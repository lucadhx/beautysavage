// tests/p1/unifiedCheckoutIdempotence.test.js
// Sprint U1 — Idempotence : un même idempotencyKey renvoie le MÊME checkout (aucun doublon),
// y compris sous appels concurrents.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../services/notificationService.js', async o => ({ ...(await o()), triggerNotification: async () => {} }));

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const UnifiedCheckout = (await import('../../models/UnifiedCheckout.js')).default;
const { createUnifiedCheckout } = await import('../../services/checkout/unified/unifiedCheckoutFactory.js');

describe('UnifiedCheckout — idempotence', () => {
  let fx;
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await UnifiedCheckout.syncIndexes(); fx = await seedTestData(); });

  function state() {
    return { item: { type: 'product', id: String(fx.product._id) }, legal: { acceptedCgv: true } };
  }

  it('même idempotencyKey → même checkout (created=false au 2e appel)', async () => {
    const key = 'idem-key-1';
    const a = await createUnifiedCheckout({ checkoutState: state(), userId: fx.client1._id, idempotencyKey: key });
    const b = await createUnifiedCheckout({ checkoutState: state(), userId: fx.client1._id, idempotencyKey: key });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.checkout.checkoutId).toBe(a.checkout.checkoutId);
    expect(await UnifiedCheckout.countDocuments({ idempotencyKey: key })).toBe(1);
  });

  it('appels concurrents même key → un seul checkout', async () => {
    const key = 'idem-key-concurrent';
    const results = await Promise.all([
      createUnifiedCheckout({ checkoutState: state(), userId: fx.client1._id, idempotencyKey: key }),
      createUnifiedCheckout({ checkoutState: state(), userId: fx.client1._id, idempotencyKey: key })
    ]);
    const ids = new Set(results.map(r => r.checkout.checkoutId));
    expect(ids.size).toBe(1);
    expect(await UnifiedCheckout.countDocuments({ idempotencyKey: key })).toBe(1);
  });

  it('clés différentes → checkouts distincts', async () => {
    const a = await createUnifiedCheckout({ checkoutState: state(), userId: fx.client1._id, idempotencyKey: 'kA' });
    const b = await createUnifiedCheckout({ checkoutState: state(), userId: fx.client1._id, idempotencyKey: 'kB' });
    expect(a.checkout.checkoutId).not.toBe(b.checkout.checkoutId);
    expect(await UnifiedCheckout.countDocuments({})).toBe(2);
  });
});
