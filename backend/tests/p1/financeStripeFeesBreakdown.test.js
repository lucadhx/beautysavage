// tests/p1/financeStripeFeesBreakdown.test.js
// RX2.3 — Frais Stripe : statut dérivé des champs réels (available/pending/not_applicable),
// jamais recalculé par formule. stripeFee est en CENTIMES.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Sale from '../../models/Sale.js';
import { buildFinanceMovementDetail } from '../../services/finance/financeMovementDetailService.js';

const oid = () => new mongoose.Types.ObjectId();
async function seedSale(id, extra) {
  return Sale.create({ saleId: id, userId: oid(), totalAmount: 100, itemCount: 1, items: [{ type: 'service', itemId: oid(), name: 'Soin', finalPrice: 100 }], createdAt: new Date(), ...extra });
}

describe('RX2.3 — frais Stripe', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('frais connus → available, montant en € (centimes/100)', async () => {
    await seedSale('S-FEE-1', { stripePaymentIntentId: 'pi_a', stripeFee: 337 });
    const d = await buildFinanceMovementDetail({ sourceModel: 'Sale', sourceId: 'S-FEE-1' });
    expect(d.paymentBreakdown.stripeFeesStatus).toBe('available');
    expect(d.paymentBreakdown.stripeFeesAmount).toBe(3.37);
    expect(d.lines.some((l) => l.kind === 'fee' && l.amount === -3.37)).toBe(true);
  });

  it('paiement en ligne sans frais encore synchronisés → pending (jamais d\'estimation)', async () => {
    await seedSale('S-FEE-2', { stripePaymentIntentId: 'pi_b', stripeFee: null });
    const d = await buildFinanceMovementDetail({ sourceModel: 'Sale', sourceId: 'S-FEE-2' });
    expect(d.paymentBreakdown.stripeFeesStatus).toBe('pending');
    expect(d.paymentBreakdown.stripeFeesAmount).toBe(0);
    const feeLine = d.lines.find((l) => l.kind === 'fee');
    expect(feeLine.amount).toBeNull();
    expect(feeLine.status).toBe('pending');
  });

  it('paiement sur place (pas de PI) → not_applicable', async () => {
    await seedSale('S-FEE-3', { stripePaymentIntentId: null });
    const d = await buildFinanceMovementDetail({ sourceModel: 'Sale', sourceId: 'S-FEE-3' });
    expect(d.paymentBreakdown.stripeFeesStatus).toBe('not_applicable');
  });

  it('commande 0 € « free_ » → not_applicable', async () => {
    await seedSale('S-FEE-4', { stripePaymentIntentId: 'free_123' });
    const d = await buildFinanceMovementDetail({ sourceModel: 'Sale', sourceId: 'S-FEE-4' });
    expect(d.paymentBreakdown.stripeFeesStatus).toBe('not_applicable');
  });
});
