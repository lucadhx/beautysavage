// tests/p1/financeTimelineSummary.test.js
// RX2.2 — Résumé financier : computeSummary (in/out/net/balanceDue/count/refundCount).
import { describe, it, expect } from 'vitest';
import { computeSummary } from '../../services/finance/financeTimelineService.js';

function mv(type, direction, amount) {
  return { type, direction, amount };
}

describe('RX2.2 — computeSummary', () => {
  it('agrège in/out/net', () => {
    const s = computeSummary([
      mv('sale', 'in', 80),
      mv('deposit', 'in', 30),
      mv('refund', 'out', 25),
      mv('commission', 'out', 100),
    ]);
    expect(s.grossIn).toBe(110);
    expect(s.grossOut).toBe(125);
    expect(s.netAmount).toBe(-15);
    expect(s.count).toBe(4);
    expect(s.refundCount).toBe(1);
  });

  it('balance_due compté séparément, neutral exclu du gross', () => {
    const s = computeSummary([
      mv('sale', 'in', 100),
      mv('balance_due', 'neutral', 50),
      mv('gift_card_usage', 'neutral', 20),
      mv('invoice', 'neutral', 100),
    ]);
    expect(s.grossIn).toBe(100); // neutrals exclus
    expect(s.grossOut).toBe(0);
    expect(s.netAmount).toBe(100);
    expect(s.balanceDueAmount).toBe(50);
  });

  it('arrondit au centime', () => {
    const s = computeSummary([mv('sale', 'in', 10.005), mv('refund', 'out', 0.001)]);
    expect(s.grossIn).toBe(10.01);
    expect(s.grossOut).toBe(0);
  });

  it('ensemble vide', () => {
    const s = computeSummary([]);
    expect(s).toEqual({ netAmount: 0, grossIn: 0, grossOut: 0, count: 0, refundCount: 0, balanceDueAmount: 0 });
  });
});
