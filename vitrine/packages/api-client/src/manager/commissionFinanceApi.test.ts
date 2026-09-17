// RX2.5 — Commission finance api-client : endpoints lecture + paiement hébergé.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getCommissionOverview, getCommissionHistory, getCommissionDetail,
  createCommissionPaymentIntent, checkCommissionPaymentStatus,
} from './commissionFinance';

function json(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
const calls: { url: string; method: string }[] = [];
function installFetch(payload: unknown) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method || 'GET' });
    return json(payload);
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe('commissionFinance api-client (RX2.5)', () => {
  it('getCommissionOverview → /finance/commissions/current', async () => {
    installFetch({ ok: true, hasContract: true, terms: {}, current: null });
    await getCommissionOverview();
    expect(calls[0].url).toContain('/api/gestion/finance/commissions/current');
  });
  it('getCommissionHistory → /finance/commissions/history', async () => {
    installFetch({ ok: true, hasContract: true, terms: {}, items: [] });
    await getCommissionHistory();
    expect(calls[0].url).toContain('/api/gestion/finance/commissions/history');
  });
  it('getCommissionDetail → /finance/commissions/:year/:month', async () => {
    installFetch({ ok: true, terms: {}, detail: {} });
    await getCommissionDetail(2026, 7);
    expect(calls[0].url).toContain('/api/gestion/finance/commissions/2026/7');
  });
  it('createCommissionPaymentIntent POST /api/commissions/payments/:id/create-intent', async () => {
    installFetch({ ok: true, mode: 'hosted', url: 'https://pay' });
    const r = await createCommissionPaymentIntent('PAY-1');
    expect(calls[0].url).toContain('/api/commissions/payments/PAY-1/create-intent');
    expect(calls[0].method).toBe('POST');
    expect(r.url).toBe('https://pay');
  });
  it('checkCommissionPaymentStatus GET /check-status', async () => {
    installFetch({ ok: true, status: 'succeeded' });
    await checkCommissionPaymentStatus('PAY-1');
    expect(calls[0].url).toContain('/api/commissions/payments/PAY-1/check-status');
  });
});
