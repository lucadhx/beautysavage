// M13 — Client API cartes cadeaux : endpoints corrects + propagation.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  listGiftCards,
  getGiftCardDetail,
  createManualGiftCard,
  lookupGiftCardByCode,
  lookupGiftCardByQr,
  previewManualDebit,
  manualDebitGiftCard,
} from './giftCards';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
const calls: { url: string; method: string; body: unknown }[] = [];
function installFetch(payload: unknown, status = 200) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    return json(payload, status);
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe('giftCards api-client (M13)', () => {
  it('listGiftCards passe search + status', async () => {
    installFetch({ ok: true, cards: [{ id: 'g1', code: 'GC1', amount: 50, balance: 50, status: 'active', purchasedAt: null, createdAt: null }] });
    const res = await listGiftCards({ search: 'GC1', status: 'active' });
    expect(res.length).toBe(1);
    expect(calls[0].url).toContain('/api/gestion/gift-cards');
    expect(calls[0].url).toContain('search=GC1');
    expect(calls[0].url).toContain('status=active');
  });

  it('getGiftCardDetail renvoie card + transactions', async () => {
    installFetch({ ok: true, card: { id: 'g1', code: 'GC1', amount: 50, balance: 30, status: 'active', purchasedAt: null, createdAt: null }, transactions: [{ id: 't1', amount: 20, balanceBefore: 50, balanceAfter: 30, saleId: '', createdAt: null, transactionType: 'manual_debit', note: 'x' }] });
    const res = await getGiftCardDetail('g1');
    expect(calls[0].url).toContain('/api/gestion/gift-cards/g1');
    expect(res.transactions.length).toBe(1);
  });

  it('createManualGiftCard poste sur /manual et renvoie code + password', async () => {
    installFetch({ ok: true, giftCard: { id: 'g1', code: 'GC1', password: 'PIN', amount: 50, balance: 50, status: 'active', purchasedAt: null, createdAt: null, creationMode: 'manual_institute', paymentMode: 'on_site', paymentLabel: 'Paiement sur place', cardVisualUrl: null, generatedPdfUrl: null } }, 201);
    const res = await createManualGiftCard({ customerId: 'c1', recipientName: 'Marie', amount: 50, manualPaymentMethod: 'cash' });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/api/gestion/gift-cards/manual');
    expect(res.code).toBe('GC1');
    expect(res.password).toBe('PIN');
    expect(res.paymentLabel).toBe('Paiement sur place');
  });

  it('lookupGiftCardByCode utilise GET ?code=', async () => {
    installFetch({ ok: true, card: { id: 'g1', code: 'GC1', amount: 50, balance: 50, status: 'active', purchasedAt: null, createdAt: null } });
    const card = await lookupGiftCardByCode('GC1');
    expect(calls[0].url).toContain('/api/gestion/gift-cards/lookup');
    expect(calls[0].url).toContain('code=GC1');
    expect(card.code).toBe('GC1');
  });

  it('lookupGiftCardByQr poste qrPayload', async () => {
    installFetch({ ok: true, card: { id: 'g1', code: 'GC1', amount: 50, balance: 50, status: 'active', purchasedAt: null, createdAt: null } });
    await lookupGiftCardByQr('QR-PAYLOAD');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/lookup-qr');
    expect((calls[0].body as { qrPayload: string }).qrPayload).toBe('QR-PAYLOAD');
  });

  it('previewManualDebit poste preview:true', async () => {
    installFetch({ ok: true, preview: true, amount: 20, balanceBefore: 50, balanceAfter: 30 });
    const res = await previewManualDebit('g1', 20, 'erreur');
    expect((calls[0].body as { preview: boolean }).preview).toBe(true);
    expect(res.balanceAfter).toBe(30);
  });

  it('manualDebitGiftCard poste sans preview', async () => {
    installFetch({ ok: true, card: { id: 'g1', code: 'GC1', amount: 50, balance: 30, status: 'active', purchasedAt: null, createdAt: null }, transaction: { id: 't1', amount: 20, balanceBefore: 50, balanceAfter: 30, saleId: '', createdAt: null, transactionType: 'manual_debit', note: 'erreur' } });
    const res = await manualDebitGiftCard('g1', 20, 'erreur');
    expect(calls[0].url).toContain('/api/gestion/gift-cards/g1/manual-debit');
    expect((calls[0].body as { preview?: boolean }).preview).toBeUndefined();
    expect(res.card.balance).toBe(30);
  });
});
