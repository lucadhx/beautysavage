// C1 — Catalogue Studio (UI) : dashboard, liste, ModuleStepper + drawer de validation.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CatalogueDashboard, ServicesListPage } from './pages';
import { ServiceEditor } from './ServiceEditor';
import { GiftCardCatalogueEditor } from './GiftCardCatalogueEditor';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
function installFetch(router: (url: string) => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => json(router(String(url)))));
}
afterEach(() => vi.unstubAllGlobals());

function wrap(node: React.ReactNode, initial = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CatalogueDashboard', () => {
  it('affiche les sections et désactive Produits', async () => {
    installFetch((u) => {
      if (u.includes('/services')) return { ok: true, services: [{ id: 's1' }, { id: 's2' }] };
      if (u.includes('/formations')) return { ok: true, formations: [{ id: 'f1' }] };
      return { ok: true };
    });
    wrap(<CatalogueDashboard />);
    expect(await screen.findByText('Prestations')).toBeInTheDocument();
    expect(screen.getByText('Formations')).toBeInTheDocument();
    expect(screen.getByText('Bientôt')).toBeInTheDocument(); // Produits désactivé
  });
});

describe('ServicesListPage', () => {
  it('rend une ligne par prestation (cards, pas de table)', async () => {
    installFetch(() => ({ ok: true, services: [
      { id: 's1', name: 'Soin visage', duration: 60, price: 50, isActive: true, paymentType: 'full' },
    ] }));
    const { container } = wrap(<ServicesListPage />);
    expect(await screen.findByText('Soin visage')).toBeInTheDocument();
    expect(container.querySelector('table')).toBeNull();
  });
});

describe('ServiceEditor — ModuleStepper + validation', () => {
  it('navigue entre modules et ouvre le drawer de blocages', async () => {
    installFetch(() => ({ ok: true }));
    wrap(<ServiceEditor />, '/catalogue/prestations/new');

    // Stepper présent
    expect(screen.getByTestId('cat-step-identite')).toBeInTheDocument();
    expect(screen.getByTestId('cat-step-prix')).toBeInTheDocument();

    // Bascule sur le module Prix
    fireEvent.click(screen.getByTestId('cat-step-prix'));
    expect(screen.getByText('Type de paiement')).toBeInTheDocument();

    // Une prestation vide a des bloquants → ouvrir le drawer de validation
    fireEvent.click(screen.getByText(/bloquant/i));
    const drawer = await screen.findByTestId('cat-validation-drawer');
    expect(drawer).toBeInTheDocument();
    expect(drawer.textContent).toContain('nom est obligatoire');
  });
});

describe('GiftCardCatalogueEditor', () => {
  it('signale l’absence de template actif comme bloquant', async () => {
    installFetch((u) => {
      if (u.includes('/templates/active')) return { ok: true, template: null };
      if (u.includes('/config')) return { ok: true, config: { minAmount: 50, maxAmount: 0, presetAmounts: [], description: '', image: '' } };
      return { ok: true };
    });
    wrap(<GiftCardCatalogueEditor />);
    await waitFor(() => expect(screen.getByText('Montants')).toBeInTheDocument());
    // Le header indique au moins un bloquant (template manquant)
    expect(await screen.findByText(/bloquant/i)).toBeInTheDocument();
  });
});
