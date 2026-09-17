// tests/p1/commissionFinanceOverview.test.js
// RX2.5 — Overview/historique/détail premium : réutilise le moteur, expose breakdown + termes + snapshot.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Sale from '../../models/Sale.js';
import Contract from '../../models/Contract.js';
import CommissionPayment from '../../models/CommissionPayment.js';
import {
  getCurrentCommissionOverview, getCommissionPaymentHistory, getCommissionPaymentDetail,
  buildCommissionBreakdown,
} from '../../services/finance/commissionFinanceService.js';

const oid = () => new mongoose.Types.ObjectId();

async function seedActiveContract(activatedAt) {
  return Contract.create({ status: 'active', activatedAt, file: 'contract.pdf', createdBy: oid(), updatedBy: oid() });
}
async function seedFormationSale(amount, commission, when) {
  return Sale.create({
    saleId: `S-${Math.random().toString(36).slice(2, 8)}`, userId: oid(),
    customer: { firstName: 'A', lastName: 'B' }, totalAmount: amount, itemCount: 1,
    items: [{ type: 'formation', itemId: oid(), name: 'Formation', finalPrice: amount }],
    commissionAmount: commission, createdAt: when,
  });
}

describe('RX2.5 — commission overview/history/detail', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('buildCommissionBreakdown : lignes Formations vendues / Remboursements / Report / À payer', () => {
    const lines = buildCommissionBreakdown({ grossCommissionAmount: 150, refundDeductionAmount: 20, carryOverAppliedAmount: 10, netAmountDue: 120, negativeCarryOverAmount: 0 });
    expect(lines[0]).toEqual({ label: 'Formations vendues', amount: 150, kind: 'income' });
    expect(lines.some((l) => l.label === 'Remboursements' && l.amount === -20)).toBe(true);
    expect(lines.some((l) => l.label === 'Report précédent' && l.amount === -10)).toBe(true);
    expect(lines.find((l) => l.kind === 'net')).toEqual({ label: 'À payer', amount: 120, kind: 'net' });
  });

  it('overview : sans contrat actif → hasContract false', async () => {
    const ov = await getCurrentCommissionOverview(new Date());
    expect(ov.hasContract).toBe(false);
    expect(ov.current).toBeNull();
  });

  it('overview : avec contrat + vente formation du mois → commission du mois', async () => {
    const now = new Date();
    await seedActiveContract(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    await seedFormationSale(500, 50, now);
    const ov = await getCurrentCommissionOverview(now);
    expect(ov.hasContract).toBe(true);
    expect(ov.current.grossCommission).toBe(50);
    expect(ov.current.netAmountDue).toBe(50);
    expect(ov.current.dueAt).toBeTruthy();
    expect(ov.current.lateStatus).toBeTruthy();
    // snapshot dueAt persisté sur le CommissionPayment
    const cp = await CommissionPayment.findOne({ month: now.getMonth(), year: now.getFullYear() }).lean();
    expect(cp.dueAt).toBeTruthy();
  });

  it('history : liste les mois depuis activation (plus récent en premier)', async () => {
    const now = new Date();
    await seedActiveContract(new Date(now.getFullYear(), now.getMonth() - 2, 1));
    const hist = await getCommissionPaymentHistory(now);
    expect(hist.hasContract).toBe(true);
    expect(hist.items.length).toBeGreaterThanOrEqual(3);
    // ordre décroissant
    expect(hist.items[0].year * 12 + hist.items[0].month).toBeGreaterThanOrEqual(hist.items[1].year * 12 + hist.items[1].month);
  });

  it('detail : mois précis (month 1-12) → mapping premium', async () => {
    const now = new Date();
    await seedActiveContract(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    await seedFormationSale(200, 20, now);
    const res = await getCommissionPaymentDetail(now.getFullYear(), now.getMonth() + 1, now);
    expect(res.detail.netAmountDue).toBe(20);
    expect(res.detail.lines.some((l) => l.kind === 'net')).toBe(true);
    expect(await getCommissionPaymentDetail(2026, 13, now)).toBeNull();
  });
});
