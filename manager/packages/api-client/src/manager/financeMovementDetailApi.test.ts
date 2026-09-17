// RX2.3 — api-client : détail mouvement + décision remboursement + encaissement solde.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getFinanceMovementDetail, processRefundStatus, markBookingBalancePaid } from './finance';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
const calls: { url: string; method: string; body: string | null }[] = [];
function installFetch(payload: unknown) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method || 'GET', body: (init?.body as string) ?? null });
    return json(payload);
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe('finance movement-detail api-client (RX2.3)', () => {
  it('getFinanceMovementDetail passe sourceModel/sourceId/type', async () => {
    installFetch({ ok: true, movement: {}, paymentBreakdown: {}, lines: [], actions: [] });
    await getFinanceMovementDetail({ sourceModel: 'Sale', sourceId: 'S1', type: 'sale' });
    expect(calls[0].url).toContain('/api/gestion/finance/movement-detail');
    expect(calls[0].url).toContain('sourceModel=Sale');
    expect(calls[0].url).toContain('sourceId=S1');
    expect(calls[0].url).toContain('type=sale');
  });

  it('processRefundStatus accepter → status succeeded', async () => {
    installFetch({ ok: true });
    await processRefundStatus('REF-1', 'accept', 'ok');
    expect(calls[0].url).toContain('/api/gestion/refunds/REF-1/status');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toContain('succeeded');
    expect(calls[0].body).toContain('ok');
  });

  it('processRefundStatus refuser → status canceled', async () => {
    installFetch({ ok: true });
    await processRefundStatus('REF-2', 'refuse');
    expect(calls[0].body).toContain('canceled');
  });

  it('markBookingBalancePaid POST balance-paid avec moyen de paiement', async () => {
    installFetch({ ok: true, balanceDueAmount: 0 });
    await markBookingBalancePaid('BKG-1', 'cash');
    expect(calls[0].url).toContain('/api/gestion/bookings/BKG-1/balance-paid');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toContain('cash');
  });
});
