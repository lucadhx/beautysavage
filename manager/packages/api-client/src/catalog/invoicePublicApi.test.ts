// RX-GO-2 — Facture publique par token : endpoint + normalisation (champs réels only).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getPublicInvoice, publicInvoiceDownloadUrl } from './invoicePublic';

function json(p: unknown, status = 200) { return new Response(JSON.stringify(p), { status, headers: { 'Content-Type': 'application/json' } }); }
afterEach(() => vi.unstubAllGlobals());

describe('invoice public api (RX-GO-2)', () => {
  it('normalise la réponse (ready + champs résumé)', async () => {
    let url = '';
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { url = String(u); return json({ ready: true, invoiceUrl: 'https://pdf', formationTitle: 'Cours', amount: 120, date: '2026-02-01T00:00:00Z' }); }));
    const res = await getPublicInvoice('tok');
    expect(res.ready).toBe(true);
    expect(res.invoiceUrl).toBe('https://pdf');
    expect(res.amount).toBe(120);
    expect(url).toContain('/api/invoice/tok');
  });
  it('tolère une réponse en cours (ready:false)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ready: false, invoiceUrl: null, formationTitle: 'X', amount: 0, date: null })));
    const res = await getPublicInvoice('tok');
    expect(res.ready).toBe(false);
    expect(res.invoiceUrl).toBeNull();
  });
  it('publicInvoiceDownloadUrl construit le lien', () => {
    expect(publicInvoiceDownloadUrl('t o')).toContain('/api/invoice/download/t%20o');
  });
});
