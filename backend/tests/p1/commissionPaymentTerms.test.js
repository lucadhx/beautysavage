// tests/p1/commissionPaymentTerms.test.js
// RX2.5 — Termes de paiement : resolver depuis CommissionSettings + dates d'échéance + grace.
import { describe, it, expect } from 'vitest';
import {
  resolveCommissionPaymentTerms, computeCommissionDueDates,
} from '../../services/finance/commissionFinanceService.js';

describe('RX2.5 — termes de paiement', () => {
  it('resolveCommissionPaymentTerms : défauts sûrs', () => {
    const t = resolveCommissionPaymentTerms({});
    expect(t.paymentDueDays).toBe(15);
    expect(t.gracePeriodDays).toBe(0);
    expect(t.blockingMode).toBe('none');
  });

  it('resolveCommissionPaymentTerms : lit les valeurs settings', () => {
    const t = resolveCommissionPaymentTerms({ latePaymentDays: 20, gracePeriodDays: 5, blockingMode: 'warning_only', suspensionWarningAfterDays: 3 });
    expect(t).toEqual({ paymentDueDays: 20, gracePeriodDays: 5, blockingMode: 'warning_only', suspensionWarningAfterDays: 3 });
  });

  it('computeCommissionDueDates : availability = periodEnd, due = +paymentDueDays, grace = +gracePeriodDays', () => {
    const payment = { periodEnd: new Date(2026, 6, 1) }; // 1 juillet 2026
    const { availabilityAt, dueAt, graceEndsAt } = computeCommissionDueDates(payment, { paymentDueDays: 15, gracePeriodDays: 5 });
    expect(availabilityAt.getTime()).toBe(new Date(2026, 6, 1).getTime());
    expect(Math.round((dueAt - availabilityAt) / 86400000)).toBe(15);
    expect(Math.round((graceEndsAt - dueAt) / 86400000)).toBe(5);
  });

  it('computeCommissionDueDates : respecte le snapshot s\'il existe', () => {
    const snap = new Date(2026, 7, 10);
    const { dueAt } = computeCommissionDueDates({ periodEnd: new Date(2026, 6, 1), dueAt: snap }, { paymentDueDays: 15, gracePeriodDays: 0 });
    expect(dueAt.getTime()).toBe(snap.getTime());
  });
});
