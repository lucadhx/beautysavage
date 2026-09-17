// RX4 S2 — Parcours avis formation : note + commentaire → envoi → confirmation ; 409 = déjà noté.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReviewDrawer } from '../features/account';

function stubFetch(status = 200, body: unknown = { ok: true }) {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  ));
}

function renderDrawer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReviewDrawer formationId="f1" formationName="Volume russe" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('ReviewDrawer (RX4 S2)', () => {
  it('envoi désactivé tant qu\'aucune note ; puis succès', async () => {
    stubFetch();
    renderDrawer();
    const submit = screen.getByRole('button', { name: 'Envoyer mon avis' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: '5 sur 5' }));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(await screen.findByText(/bien été envoyé/)).toBeInTheDocument();
  });

  it('409 : indique un avis déjà laissé', async () => {
    stubFetch(409, { ok: false, error: 'Déjà noté.' });
    renderDrawer();
    fireEvent.click(screen.getByRole('radio', { name: '4 sur 5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer mon avis' }));
    expect(await screen.findByText(/déjà laissé un avis/)).toBeInTheDocument();
  });
});
