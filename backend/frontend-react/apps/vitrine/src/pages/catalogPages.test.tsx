import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders, stubFetch, jsonResponse } from '../test/utils';
import { ServicesPage } from './ServicesPage';
import { ServiceDetailPage } from './ServiceDetailPage';
import { TrainingsPage } from './TrainingsPage';
import { ProductsPage } from './ProductsPage';
import { HomePage } from './HomePage';

afterEach(() => vi.unstubAllGlobals());

describe('ServicesPage', () => {
  it('affiche le loading puis les cartes', async () => {
    stubFetch((url) => {
      if (url.includes('/api/vitrine/services')) {
        return jsonResponse({ ok: true, services: [{ id: 's1', slug: 'soin', name: 'Soin visage', price: 50 }] });
      }
      return jsonResponse({ ok: true }, 404);
    });
    renderWithProviders(<ServicesPage />);
    expect(screen.getByText('Chargement des prestations…')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Soin visage')).toBeInTheDocument());
  });
});

describe('TrainingsPage', () => {
  it('affiche un empty state quand aucune formation', async () => {
    stubFetch((url) => {
      if (url.includes('/api/vitrine/shop')) {
        return jsonResponse({ ok: true, formations: [], products: [] });
      }
      return jsonResponse({ ok: true }, 404);
    });
    renderWithProviders(<TrainingsPage />);
    await waitFor(() =>
      expect(screen.getByText('Aucune formation disponible pour le moment.')).toBeInTheDocument(),
    );
  });
});

describe('ProductsPage', () => {
  it('affiche un error state quand le fetch échoue', async () => {
    stubFetch(() => jsonResponse({ ok: false, error: 'boom' }, 500));
    renderWithProviders(<ProductsPage />);
    await waitFor(() =>
      expect(screen.getByText('Impossible de charger les produits.')).toBeInTheDocument(),
    );
  });
});

describe('HomePage', () => {
  it('rend les sections du catalogue', async () => {
    stubFetch((url) => {
      if (url.includes('/api/vitrine/shop')) {
        return jsonResponse({
          ok: true,
          formations: [{ id: 'f1', name: 'Formation A', price: 100 }],
          products: [{ id: 'p1', name: 'Produit A', price: 20 }],
        });
      }
      if (url.includes('/api/vitrine/services')) {
        return jsonResponse({ ok: true, services: [{ id: 's1', slug: 'soin', name: 'Soin', price: 50 }] });
      }
      return jsonResponse({ ok: true }, 404);
    });
    renderWithProviders(<HomePage />);
    expect(screen.getByRole('heading', { name: 'Beauty Savage', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nos prestations' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nos formations' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Formation A')).toBeInTheDocument());
  });
});

describe('ServiceDetailPage (route détail)', () => {
  it('charge une prestation par slug', async () => {
    stubFetch((url) => {
      if (url.includes('/api/vitrine/services/soin')) {
        return jsonResponse({ ok: true, service: { id: 's1', slug: 'soin', name: 'Soin visage', price: 50, duration: 60 } });
      }
      return jsonResponse({ ok: true }, 404);
    });
    renderWithProviders(
      <Routes>
        <Route path="/prestations/:slug" element={<ServiceDetailPage />} />
      </Routes>,
      '/prestations/soin',
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Soin visage' })).toBeInTheDocument(),
    );
  });
});
