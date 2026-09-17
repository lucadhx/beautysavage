// tests/p1/financeDevCommissionFormationOnly.test.js
// RX2.3 — Commission Dev = FORMATIONS UNIQUEMENT. Prestation → 0. Source : CommissionTransaction.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Sale from '../../models/Sale.js';
import CommissionTransaction from '../../models/CommissionTransaction.js';
import { buildFinanceMovementDetail } from '../../services/finance/financeMovementDetailService.js';

const oid = () => new mongoose.Types.ObjectId();

describe('RX2.3 — commission Dev formation only', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('formation : commission Dev visible (ligne commission)', async () => {
    await Sale.create({ saleId: 'S-FORM', userId: oid(), totalAmount: 100, itemCount: 1, items: [{ type: 'formation', itemId: oid(), name: 'Formation', finalPrice: 100 }], stripePaymentIntentId: 'pi_f', stripeFee: 0, createdAt: new Date() });
    await CommissionTransaction.create({ saleId: 'S-FORM', formationId: oid(), formationName: 'Formation', sourceType: 'sale', commissionType: 'percentage', commissionValue: 10, commissionAmount: 10 });
    const d = await buildFinanceMovementDetail({ sourceModel: 'Sale', sourceId: 'S-FORM' });
    expect(d.paymentBreakdown.devCommissionAmount).toBe(10);
    expect(d.lines.some((l) => l.kind === 'commission' && l.amount === -10)).toBe(true);
  });

  it('prestation : aucune commission Dev (0, pas de ligne)', async () => {
    await Sale.create({ saleId: 'S-SERV', userId: oid(), totalAmount: 100, itemCount: 1, items: [{ type: 'service', itemId: oid(), name: 'Soin', finalPrice: 100 }], stripePaymentIntentId: 'pi_s', stripeFee: 0, createdAt: new Date() });
    const d = await buildFinanceMovementDetail({ sourceModel: 'Sale', sourceId: 'S-SERV' });
    expect(d.paymentBreakdown.devCommissionAmount).toBe(0);
    expect(d.lines.some((l) => l.kind === 'commission')).toBe(false);
  });

  it('le badge « Commission formation » apparaît sur le mouvement formation, pas prestation', async () => {
    await Sale.create({ saleId: 'S-F2', userId: oid(), totalAmount: 100, itemCount: 1, items: [{ type: 'formation', itemId: oid(), name: 'F', finalPrice: 100 }], createdAt: new Date() });
    await Sale.create({ saleId: 'S-S2', userId: oid(), totalAmount: 100, itemCount: 1, items: [{ type: 'service', itemId: oid(), name: 'S', finalPrice: 100 }], createdAt: new Date() });
    const form = await buildFinanceMovementDetail({ sourceModel: 'Sale', sourceId: 'S-F2' });
    const serv = await buildFinanceMovementDetail({ sourceModel: 'Sale', sourceId: 'S-S2' });
    expect(form.movement.badges.some((b) => b.label === 'Commission formation')).toBe(true);
    expect(serv.movement.badges.some((b) => b.label === 'Commission formation')).toBe(false);
  });
});
