import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders, stubFetch, jsonResponse } from '../../test/utils';
import { ServiceDetailPage } from '../../pages/ServiceDetailPage';

afterEach(() => vi.unstubAllGlobals());

const SERVICE = {
  id: 's1',
  slug: 'soin',
  name: 'Soin visage',
  price: 50,
  duration: 30,
  paymentType: 'deposit',
  isBookable: true,
  photos: ['/uploads/a.jpg', '/uploads/b.jpg'],
  options: [{ id: 'o1', name: 'Masque', description: 'Masque hydratant', price: 10 }],
  faq: [{ question: 'Faut-il venir démaquillée ?', answer: 'Oui, de préférence.' }],
};

function stubDetail() {
  stubFetch((url) => {
    const u = new URL(url, 'http://x');
    if (u.pathname.endsWith('/api/vitrine/services/soin')) {
      return jsonResponse({ ok: true, service: SERVICE });
    }
    if (u.pathname.endsWith('/api/vitrine/services')) {
      return jsonResponse({
        ok: true,
        services: [SERVICE, { id: 's2', slug: 'autre', name: 'Autre soin', price: 40 }],
      });
    }
    if (u.pathname.endsWith('/availability/days')) {
      const year = u.searchParams.get('year');
      const month = String(u.searchParams.get('month')).padStart(2, '0');
      return jsonResponse({ ok: true, availableDays: [`${year}-${month}-15`] });
    }
    if (u.pathname.endsWith('/availability/slots')) {
      return jsonResponse({ ok: true, slots: [] });
    }
    if (u.pathname.endsWith('/api/vitrine/services/s1/reviews/stats')) {
      return jsonResponse({ ok: true, averageRating: 4.5, reviewCount: 2 });
    }
    if (u.pathname.endsWith('/api/vitrine/services/s1/reviews')) {
      return jsonResponse({
        ok: true,
        reviews: [
          { rating: 5, comment: 'Super soin', createdAt: '2026-07-01T10:00:00Z' },
          { rating: 4, comment: 'Tres agreable', createdAt: '2026-06-20T10:00:00Z' },
        ],
        page: 1,
        hasMore: false,
        total: 2,
      });
    }
    return jsonResponse({ ok: true }, 404);
  });
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/prestations/:slug" element={<ServiceDetailPage />} />
    </Routes>,
    '/prestations/soin',
  );
}

describe('ServiceDetailPage premium', () => {
  it('affiche titre, galerie, options, FAQ et prestations similaires', async () => {
    stubDetail();
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Soin visage', level: 1 })).toBeInTheDocument(),
    );
    expect(screen.getByRole('listitem', { name: 'Photo 2 sur 2' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Masque/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Questions/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Autre soin')).toBeInTheDocument());
  });

  it('cocher une option augmente le prix total', async () => {
    stubDetail();
    renderPage();

    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Masque/ })).toBeInTheDocument());
    expect(screen.getAllByText(/50,00/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('checkbox', { name: /Masque/ }));
    await waitFor(() => expect(screen.getAllByText(/60,00/).length).toBeGreaterThan(0));
  });

  it('le CTA Reserve ouvre le drawer de reservation', async () => {
    stubDetail();
    renderPage();

    await waitFor(() => expect(screen.getAllByRole('button', { name: /Reserver|Réserver/i }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: /Reserver|Réserver/i })[0]);
    await waitFor(() => expect(screen.getByRole('dialog', { name: /Reserver|Réserver/i })).toBeInTheDocument());
  });

  it('affiche la section avis prestation avec la notation PawRating', async () => {
    stubDetail();
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Soin visage', level: 1 })).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Avis' })).toBeInTheDocument(),
    );
    // Le commentaire est affiché entre guillemets (« … ») dans le carrousel.
    expect(screen.getByText(/Super soin/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /4\.5 sur 5, 2 avis/i })).toBeInTheDocument();
  });
});
