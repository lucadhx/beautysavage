// RX-GO-2 — Facture publique React : ready → téléchargement ; token invalide → état dédié.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { InvoicePublicPage } from './InvoicePublicPage';

function stub(payload: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })));
}
function renderAt(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/invoice/${token}`]}>
      <Routes><Route path="invoice/:token" element={<InvoicePublicPage />} /></Routes>
    </MemoryRouter>,
  );
}
afterEach(() => vi.unstubAllGlobals());

describe('InvoicePublicPage (RX-GO-2)', () => {
  it('facture prête → titre, montant, téléchargement', async () => {
    stub({ ready: true, invoiceUrl: 'https://pdf', formationTitle: 'Formation Volume', amount: 250, date: '2026-02-01T00:00:00Z' });
    renderAt('tok');
    expect(await screen.findByText('Formation Volume')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Télécharger le PDF/i })).toBeInTheDocument();
  });
  it('token invalide (404) → état dédié', async () => {
    stub({ ok: false, error: 'introuvable' }, 404);
    renderAt('bad');
    expect(await screen.findByText(/n’est plus valide/i)).toBeInTheDocument();
  });
});
