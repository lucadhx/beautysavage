// tests/p1/commissionLateStatus.test.js
// RX2.5 — Statut de retard : pending_due | due | grace | overdue | suspension_risk | paid | settled_zero.
import { describe, it, expect } from 'vitest';
import { resolveCommissionLateStatus } from '../../services/finance/commissionFinanceService.js';

const TERMS = { paymentDueDays: 15, gracePeriodDays: 5, blockingMode: 'none', suspensionWarningAfterDays: 0 };
// periodEnd = 1 juillet → due = 16 juillet → grace fin = 21 juillet
const payment = { periodEnd: new Date(2026, 6, 1), netAmountDue: 100, settledReason: null };

describe('RX2.5 — resolveCommissionLateStatus', () => {
  it('payée', () => {
    expect(resolveCommissionLateStatus({ ...payment, settledReason: 'paid' }, TERMS, new Date(2026, 6, 25))).toBe('paid');
  });
  it('soldé à 0 €', () => {
    expect(resolveCommissionLateStatus({ ...payment, netAmountDue: 0, settledReason: 'settled_zero' }, TERMS, new Date(2026, 6, 25))).toBe('settled_zero');
  });
  it('avant disponibilité → pending_due', () => {
    expect(resolveCommissionLateStatus(payment, TERMS, new Date(2026, 5, 30))).toBe('pending_due');
  });
  it('disponible, avant échéance → due', () => {
    expect(resolveCommissionLateStatus(payment, TERMS, new Date(2026, 6, 5))).toBe('due');
  });
  it('après échéance, dans la grace → grace', () => {
    expect(resolveCommissionLateStatus(payment, TERMS, new Date(2026, 6, 18))).toBe('grace');
  });
  it('après la grace → overdue', () => {
    expect(resolveCommissionLateStatus(payment, TERMS, new Date(2026, 6, 25))).toBe('overdue');
  });
  it('risque de suspension si blockingMode actif + seuil dépassé', () => {
    const terms = { ...TERMS, blockingMode: 'warning_only', suspensionWarningAfterDays: 3 };
    // grace fin = 21 juillet ; +3 j = 24 juillet ; now = 26 juillet → overdueDays 5 ≥ 3
    expect(resolveCommissionLateStatus(payment, terms, new Date(2026, 6, 26))).toBe('suspension_risk');
  });
});
