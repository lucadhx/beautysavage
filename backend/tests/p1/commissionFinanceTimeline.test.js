// tests/p1/commissionFinanceTimeline.test.js
// RX2.5 — Intégration timeline : le mouvement commission ouvre le détail (commission_view) ;
// badge À payer/Payée ; pas de double-count (la commission est comptée une seule fois en sortie).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import CommissionPayment from '../../models/CommissionPayment.js';
import {
  mapCommissionPaymentToFinanceMovement, buildFinanceTimeline,
} from '../../services/finance/financeTimelineService.js';

const oid = () => new mongoose.Types.ObjectId();

describe('RX2.5 — commission timeline', () => {
  it('mapper : commission_view → /finance/commissions/:year/:month (1-12), badge À payer', () => {
    const m = mapCommissionPaymentToFinanceMovement({ _id: oid(), month: 5, year: 2026, netAmountDue: 120, status: 'pending', paidAt: null });
    expect(m.type).toBe('commission');
    expect(m.direction).toBe('out');
    const view = m.actions.find((a) => a.kind === 'commission_view');
    expect(view.enabled).toBe(true);
    expect(view.to).toBe('/finance/commissions/2026/6'); // month 5 (juin, 0-indexé) → 6
    expect(m.badges.some((b) => b.label === 'À payer')).toBe(true);
  });

  it('mapper : commission payée → badge Payée', () => {
    const m = mapCommissionPaymentToFinanceMovement({ _id: oid(), month: 5, year: 2026, netAmountDue: 120, status: 'succeeded', settledReason: 'paid', paidAt: new Date() });
    expect(m.badges.some((b) => b.label === 'Payée')).toBe(true);
  });

  describe('intégration', () => {
    beforeAll(async () => {
      const uri = await startMemoryDb();
      await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    });
    afterAll(async () => { await stopMemoryDb(); });
    beforeEach(async () => { await clearDatabase(); });

    it('la commission apparaît une seule fois (pas de double-count) en sortie', async () => {
      const now = new Date();
      await CommissionPayment.create({ month: now.getMonth(), year: now.getFullYear(), periodStart: now, periodEnd: now, amount: 120, netAmountDue: 120, status: 'succeeded', settledReason: 'paid', paidAt: now });
      const { items, summary } = await buildFinanceTimeline({ type: 'commission', limit: 50 });
      const commissions = items.filter((i) => i.type === 'commission');
      expect(commissions.length).toBe(1);
      expect(summary.grossOut).toBe(120);
      expect(summary.grossIn).toBe(0);
    });
  });
});
