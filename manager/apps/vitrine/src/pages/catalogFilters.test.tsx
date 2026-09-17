// RX3 — Test d'intégration : la barre d'outils catalogue filtre/recherche réellement les cartes.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders, stubFetch, jsonResponse } from '../test/utils';
import { TrainingsPage } from './TrainingsPage';

afterEach(() => vi.unstubAllGlobals());

function stubTrainings() {
  stubFetch((url) => {
    if (url.includes('/api/vitrine/shop')) {
      return jsonResponse({
        ok: true,
        formations: [
          { id: 'f1', name: 'Maquillage présentiel', price: 300, type: 'presentiel', createdAt: '2026-01-01' },
          { id: 'f2', name: 'Onglerie en ligne', price: 120, type: 'distanciel', createdAt: '2026-02-01' },
        ],
        products: [],
      });
    }
    return jsonResponse({ ok: true }, 404);
  });
}

describe('Catalogue — filtres partagés', () => {
  it('la recherche filtre les cartes', async () => {
    stubTrainings();
    renderWithProviders(<TrainingsPage />);
    await waitFor(() => expect(screen.getByText('Maquillage présentiel')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Rechercher dans le catalogue'), { target: { value: 'onglerie' } });
    expect(screen.queryByText('Maquillage présentiel')).toBeNull();
    expect(screen.getByText('Onglerie en ligne')).toBeInTheDocument();
    expect(screen.getByText('1 résultat')).toBeInTheDocument();
  });

  it('le filtre de type ne garde que le bon type', async () => {
    stubTrainings();
    renderWithProviders(<TrainingsPage />);
    await waitFor(() => expect(screen.getByText('Onglerie en ligne')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Présentiel' }));
    expect(screen.getByText('Maquillage présentiel')).toBeInTheDocument();
    expect(screen.queryByText('Onglerie en ligne')).toBeNull();
  });
});
