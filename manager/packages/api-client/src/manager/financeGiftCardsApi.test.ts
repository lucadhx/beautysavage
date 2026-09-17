// RX2.6 — Gift Card Finance api-client : endpoints liste + détail.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { listFinanceGiftCards, getFinanceGiftCardDetail } from './finance';

const calls: string[] = [];
function installFetch(payload: unknown) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe('gift card finance api-client (RX2.6)', () => {
  it('listFinanceGiftCards → /finance/gift-cards avec filtres', async () => {
    installFetch({ ok: true, summary: { count: 1 }, cards: [] });
    await listFinanceGiftCards({ creationMode: 'manual_institute', status: 'active' });
    expect(calls[0]).toContain('/api/gestion/finance/gift-cards');
    expect(calls[0]).toContain('creationMode=manual_institute');
    expect(calls[0]).toContain('status=active');
  });

  it('getFinanceGiftCardDetail → /finance/gift-cards/:id', async () => {
    installFetch({ ok: true, giftCard: { maskedCode: '••••1234' }, qr: { available: true, maskedToken: '••••' } });
    const res = await getFinanceGiftCardDetail('GC1');
    expect(calls[0]).toContain('/api/gestion/finance/gift-cards/GC1');
    expect(res.giftCard.maskedCode).toBe('••••1234');
  });
});
