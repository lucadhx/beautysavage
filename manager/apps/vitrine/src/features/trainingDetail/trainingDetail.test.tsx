// RX3 S2 — Fiche formation premium : présentiel (sessions réelles), distanciel (accès), avis, similaires.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders, stubFetch, jsonResponse } from '../../test/utils';
import { TrainingDetailPage } from '../../pages/TrainingDetailPage';

afterEach(() => vi.unstubAllGlobals());

function stubTraining(formation: Record<string, unknown>, sessions: unknown[] = []) {
  stubFetch((url) => {
    const u = new URL(url, 'http://x');
    if (u.pathname.endsWith('/reviews/stats')) return jsonResponse({ ok: true, averageRating: 0, reviewCount: 0 });
    if (u.pathname.endsWith('/reviews')) return jsonResponse({ ok: true, reviews: [], page: 1, hasMore: false, total: 0 });
    if (u.pathname.endsWith('/sessions')) return jsonResponse({ ok: true, sessions });
    if (u.pathname.endsWith('/api/vitrine/shop')) return jsonResponse({ ok: true, formations: [formation, { id: 'f2', name: 'Autre formation', price: 100 }], products: [] });
    if (u.pathname.includes('/api/vitrine/formations/')) return jsonResponse({ ok: true, formation });
    return jsonResponse({ ok: true }, 404);
  });
}

function renderPage(id: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/formations/:id" element={<TrainingDetailPage />} />
    </Routes>,
    `/formations/${id}`,
  );
}

describe('TrainingDetailPage premium', () => {
  it('présentiel : affiche les sessions réelles avec places restantes', async () => {
    stubTraining(
      { id: 'f1', name: 'Maquillage pro', price: 300, type: 'presentiel', coverImage: '/uploads/c.jpg', salesCount: 12 },
      [{ id: 'ss1', startDate: '2026-09-01T09:00:00Z', durationLabel: '2 jours', placesRemaining: 5, isAvailable: true, schedule: [{ dayIndex: 0, startTime: '09:00', endTime: '17:00' }] }],
    );
    renderPage('f1');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Maquillage pro', level: 1 })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Prochaines sessions' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('5 places')).toBeInTheDocument());
    expect(screen.getByText(/12 inscrits/)).toBeInTheDocument();
    // avis rendus (section présente même vide)
    expect(screen.getByRole('heading', { name: 'Avis' })).toBeInTheDocument();
  });

  it('distanciel : affiche l’accès en ligne (pas de sessions)', async () => {
    stubTraining({ id: 'f9', name: 'Onglerie en ligne', price: 120, type: 'distanciel', coverImage: '/uploads/d.jpg' });
    renderPage('f9');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Onglerie en ligne', level: 1 })).toBeInTheDocument());
    expect(screen.getByText(/Accès à vie au contenu/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Prochaines sessions' })).toBeNull();
  });
});
