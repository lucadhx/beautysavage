// tests/p1/unifiedCheckoutModel.test.js
// Sprint U1 — Modèle UnifiedCheckout : champs requis, enums, défauts, index uniques
// (checkoutId, idempotencyKey sparse), aucun secret stocké par construction.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import UnifiedCheckout from '../../models/UnifiedCheckout.js';

describe('UnifiedCheckout model', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await UnifiedCheckout.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await UnifiedCheckout.syncIndexes(); });

  it('crée un checkout valide avec défauts (payment/finalization)', async () => {
    const c = await UnifiedCheckout.create({ checkoutId: 'UC-1', kind: 'product' });
    expect(c.checkoutId).toBe('UC-1');
    expect(c.status).toBe('draft');
    expect(c.payment.mode).toBe('stripe');
    expect(c.payment.status).toBe('pending');
    expect(Array.isArray(c.finalization.purchaseIds)).toBe(true);
  });

  it('refuse un kind hors enum', async () => {
    await expect(UnifiedCheckout.create({ checkoutId: 'UC-bad', kind: 'not_a_real_kind' }))
      .rejects.toThrow();
  });

  it('refuse un status hors enum', async () => {
    await expect(UnifiedCheckout.create({ checkoutId: 'UC-bad2', kind: 'product', status: 'weird' }))
      .rejects.toThrow();
  });

  it('checkoutId unique', async () => {
    await UnifiedCheckout.create({ checkoutId: 'UC-dup', kind: 'product' });
    await expect(UnifiedCheckout.create({ checkoutId: 'UC-dup', kind: 'formation' }))
      .rejects.toMatchObject({ code: 11000 });
  });

  it('idempotencyKey unique (mais sparse : plusieurs null autorisés)', async () => {
    await UnifiedCheckout.create({ checkoutId: 'UC-a', kind: 'product', idempotencyKey: 'k1' });
    await expect(UnifiedCheckout.create({ checkoutId: 'UC-b', kind: 'product', idempotencyKey: 'k1' }))
      .rejects.toMatchObject({ code: 11000 });
    // deux sans idempotencyKey : OK (index partiel). UC-b a été rejeté → 3 docs au total (UC-a, UC-c, UC-d).
    await UnifiedCheckout.create({ checkoutId: 'UC-c', kind: 'product' });
    await UnifiedCheckout.create({ checkoutId: 'UC-d', kind: 'product' });
    expect(await UnifiedCheckout.countDocuments({})).toBe(3);
  });

  it('inputSnapshot ne contient jamais de password (par construction du stockage)', async () => {
    const c = await UnifiedCheckout.create({
      checkoutId: 'UC-safe',
      kind: 'product',
      inputSnapshot: { appliedGiftCards: [{ giftCardId: 'x', code: 'ABC', amount: 10 }] }
    });
    const raw = JSON.stringify(c.toObject());
    expect(raw).not.toMatch(/password/i);
  });
});
