// RX2.2 — Finance Timeline api-client : endpoint + propagation des filtres.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getFinanceTimeline } from './finance';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
const calls: string[] = [];
function installFetch(payload: unknown) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(String(url)); return json(payload); }));
}
afterEach(() => vi.unstubAllGlobals());

const PAYLOAD = {
  ok: true, period: 'month', type: 'all', status: null,
  summary: { netAmount: 70, grossIn: 220, grossOut: 150, count: 8, refundCount: 1, balanceDueAmount: 50 },
  items: [{ id: 'sale:S1', type: 'sale', direction: 'in', amount: 80, currency: 'EUR', title: 'Paiement reçu', subtitle: 'Prestation', status: 'paid', occurredAt: '2026-06-30T10:00:00Z', customer: { id: 'c1', name: 'Jane' }, source: { model: 'Sale', id: 'S1' }, badges: [], actions: [] }],
};

describe('finance timeline api-client (RX2.2)', () => {
  it('getFinanceTimeline appelle /timeline avec period & type', async () => {
    installFetch(PAYLOAD);
    const res = await getFinanceTimeline({ period: 'month', type: 'refund' });
    expect(calls[0]).toContain('/api/gestion/finance/timeline');
    expect(calls[0]).toContain('period=month');
    expect(calls[0]).toContain('type=refund');
    expect(res.summary.grossIn).toBe(220);
    expect(res.items[0].type).toBe('sale');
  });

  it('défaut period=all type=all, status omis si vide', async () => {
    installFetch(PAYLOAD);
    await getFinanceTimeline({});
    expect(calls[0]).toContain('period=all');
    expect(calls[0]).toContain('type=all');
    expect(calls[0]).not.toContain('status=');
  });

  it('propage status + limit', async () => {
    installFetch(PAYLOAD);
    await getFinanceTimeline({ status: 'pending', limit: 25 });
    expect(calls[0]).toContain('status=pending');
    expect(calls[0]).toContain('limit=25');
  });
});
