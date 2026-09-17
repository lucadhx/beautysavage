import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReviewModerationPage } from './ReviewModerationPage';

const calls: { url: string; method: string; body?: string }[] = [];

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetch() {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({
        url: u,
        method: init?.method || 'GET',
        body: init?.body ? String(init.body) : undefined,
      });

      if (u.includes('/api/gestion/services')) {
        return json({ ok: true, services: [{ id: 's1', name: 'Soin visage', isActive: true }] });
      }
      if (u.includes('/api/gestion/formations')) {
        return json({ ok: true, formations: [{ id: 'f1', name: 'Maquillage' }] });
      }
      if (init?.method === 'PATCH') {
        return json({ ok: true, review: { id: 'r1', status: 'rejected' } });
      }
      if (init?.method === 'POST' && u.includes('/reviews/manual')) {
        return json({
          ok: true,
          review: {
            id: 'r2',
            targetType: 'service',
            targetId: 's1',
            targetName: 'Soin visage',
            formationId: null,
            formationName: null,
            serviceId: 's1',
            serviceName: 'Soin visage',
            authorName: 'Institut',
            rating: 4,
            comment: 'Tres bien',
            status: 'published',
            createdAt: null,
            moderatedAt: null,
            sourceType: 'manual_institute',
            isManual: true,
            sourceLabel: "Ajoute manuellement par l'institut",
          },
        });
      }

      return json({
        ok: true,
        reviews: [{
          id: 'r1',
          targetType: 'formation',
          targetId: 'f1',
          targetName: 'Maquillage',
          formationId: 'f1',
          formationName: 'Maquillage',
          serviceId: null,
          serviceName: null,
          authorName: 'Camille M.',
          rating: 5,
          comment: 'Top',
          status: 'published',
          createdAt: null,
          moderatedAt: null,
          sourceType: 'client',
          isManual: false,
          sourceLabel: 'Avis client',
        }],
        counts: { pending: 0, published: 1, rejected: 0 },
        countsByType: { formation: 1, service: 0 },
      });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  installFetch();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ReviewModerationPage />
    </QueryClientProvider>,
  );
}

describe('ReviewModerationPage', () => {
  it('renders cards with PawRating and can reject a review', async () => {
    const { container } = renderPage();

    expect(await screen.findByText('Camille M.')).toBeInTheDocument();
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('.bs-paws')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Refuser/i }));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH' && c.url.includes('/reviews/r1'))).toBe(true);
    });
  });

  it('filters by type and creates a manual review with PawInput', async () => {
    const { container } = renderPage();

    await screen.findByText('Camille M.');

    // Le filtre par type est un dropdown custom : ouvrir puis choisir « Prestations ».
    fireEvent.click(screen.getByRole('button', { name: 'Filtrer par type' }));
    fireEvent.click(screen.getByRole('button', { name: 'Prestations' }));
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes('/api/gestion/learning/reviews?type=service'))).toBe(true);
    });

    // La création passe désormais par un CTA qui ouvre le formulaire dans un drawer.
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un avis' }));

    fireEvent.change(await screen.findByPlaceholderText('Ex. Camille M.'), {
      target: { value: 'Institut' },
    });
    // Le sélecteur de note « pattes de chien » est bien présent dans le formulaire.
    expect(container.querySelector('.bs-paw-input')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '4 sur 5' }));
    fireEvent.change(screen.getByPlaceholderText(/Retour client/i), {
      target: { value: 'Tres bien' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Créer/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.includes('/reviews/manual'));
      expect(post).toBeTruthy();
      expect(post?.body).toContain('"targetType":"service"');
      expect(post?.body).toContain('"displayName":"Institut"');
      expect(post?.body).toContain('"rating":4');
      // Statut d'office « published » (plus de sélecteur de statut).
      expect(post?.body).toContain('"status":"published"');
    });
  });
});
