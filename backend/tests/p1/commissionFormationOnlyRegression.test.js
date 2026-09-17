// tests/p1/commissionFormationOnlyRegression.test.js
// RX2.5 — RÉGRESSION : commission = formations UNIQUEMENT. Une prestation n'ajoute aucune commission.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Sale from '../../models/Sale.js';
import Contract from '../../models/Contract.js';
import { getCurrentCommissionOverview } from '../../services/finance/commissionFinanceService.js';

const oid = () => new mongoose.Types.ObjectId();

describe('RX2.5 — commission formation only (régression)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('prestation (service) → 0 commission ; formation → commission comptée', async () => {
    const now = new Date();
    await Contract.create({ status: 'active', activatedAt: new Date(now.getFullYear(), now.getMonth() - 1, 1), file: 'c.pdf', createdBy: oid(), updatedBy: oid() });
    // Prestation : commissionAmount 0 (le moteur ne pose JAMAIS de commission sur un service).
    await Sale.create({ saleId: 'S-SERV', userId: oid(), totalAmount: 100, itemCount: 1, items: [{ type: 'service', itemId: oid(), name: 'Soin', finalPrice: 100 }], commissionAmount: 0, createdAt: now });
    // Formation : commissionAmount 30.
    await Sale.create({ saleId: 'S-FORM', userId: oid(), totalAmount: 300, itemCount: 1, items: [{ type: 'formation', itemId: oid(), name: 'Formation', finalPrice: 300 }], commissionAmount: 30, createdAt: now });

    const ov = await getCurrentCommissionOverview(now);
    // Seule la formation contribue.
    expect(ov.current.grossCommission).toBe(30);
    expect(ov.current.netAmountDue).toBe(30);
  });
});
