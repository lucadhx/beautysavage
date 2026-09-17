// RX2 — Finance api-client : endpoints corrects + propagation des données.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getFinanceDashboard, updateRefundStatus } from './finance';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
const calls: { url: string; method: string; body: string | null }[] = [];
function installFetch(payload: unknown, status = 200) {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method || 'GET', body: (init?.body as string) ?? null });
      return json(payload, status);
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe('finance api-client (RX2)', () => {
  it('getFinanceDashboard appelle /api/gestion/finance/dashboard avec le range', async () => {
    installFetch({
      ok: true,
      range: '7d',
      rangeLabel: '7 derniers jours',
      today: { salesCount: 3, revenue: 240, breakdown: { prestations: 1, formations: 1, giftCards: 1, products: 0 }, giftCardConsumption: 0 },
      actions: { balancesToCollect: { count: 2, total: 80 }, refundsToProcess: { count: 1, total: 30 }, unpaidInvoices: { count: 0, total: 0 } },
    });
    const res = await getFinanceDashboard('7d');
    expect(calls[0].url).toContain('/api/gestion/finance/dashboard');
    expect(calls[0].url).toContain('range=7d');
    expect(res.today.salesCount).toBe(3);
    expect(res.actions.balancesToCollect.count).toBe(2);
  });

  it('getFinanceDashboard défaut today', async () => {
    installFetch({ ok: true, range: 'today', today: {}, actions: {} });
    await getFinanceDashboard();
    expect(calls[0].url).toContain('range=today');
  });

  it('updateRefundStatus POST /api/gestion/refunds/:id/status avec statut + raison', async () => {
    installFetch({ ok: true, refund: { refundId: 'REF-1', status: 'succeeded' } });
    const res = await updateRefundStatus('REF-1', 'succeeded', 'Demande client');
    expect(calls[0].url).toContain('/api/gestion/refunds/REF-1/status');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toContain('succeeded');
    expect(calls[0].body).toContain('Demande client');
    expect(res.ok).toBe(true);
  });
});
