import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, stubFetch, jsonResponse } from './test/utils';
import { App } from './App';

afterEach(() => vi.unstubAllGlobals());

describe('Vitrine App', () => {
  it("affiche la page d'accueil (hero) à la racine", async () => {
    stubFetch((url) => {
      if (url.includes('/api/vitrine/shop')) return jsonResponse({ ok: true, formations: [], products: [] });
      if (url.includes('/api/vitrine/services')) return jsonResponse({ ok: true, services: [] });
      if (url.includes('/api/site-status')) return jsonResponse({ ok: true, status: 'active' });
      return jsonResponse({ ok: true }, 404);
    });
    renderWithProviders(<App />, '/');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Beauty Savage', level: 1 })).toBeInTheDocument(),
    );
  });

  it('affiche un bandeau quand le site est en maintenance', async () => {
    stubFetch((url) => {
      if (url.includes('/api/site-status')) {
        return jsonResponse({ ok: true, status: 'maintenance', reason: 'MAJ en cours.' });
      }
      if (url.includes('/api/vitrine/shop')) return jsonResponse({ ok: true, formations: [], products: [] });
      if (url.includes('/api/vitrine/services')) return jsonResponse({ ok: true, services: [] });
      return jsonResponse({ ok: true }, 404);
    });
    renderWithProviders(<App />, '/');
    await waitFor(() => expect(screen.getByText(/maintenance/i)).toBeInTheDocument());
  });
});
