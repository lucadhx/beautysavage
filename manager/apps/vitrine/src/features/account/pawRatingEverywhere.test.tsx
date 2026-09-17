import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@bs/auth';
import { ReviewDrawer } from './ReviewDrawer';
import { HomeReviews } from '../home/HomeReviews';
import { TrainingReviews } from '../catalog/components/TrainingReviews';
import { ServiceReviews } from '../serviceDetail/ServiceReviews';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/api/vitrine/formations/f1/reviews/stats')) {
        return json({ ok: true, averageRating: 4.5, reviewCount: 2 });
      }
      if (u.includes('/api/vitrine/formations/f1/reviews')) {
        return json({
          ok: true,
          reviews: [{ rating: 5, comment: 'Top formation', createdAt: '2026-07-01T00:00:00.000Z' }],
          page: 1,
          hasMore: false,
          total: 1,
        });
      }
      if (u.includes('/api/vitrine/services/s1/reviews/stats')) {
        return json({ ok: true, averageRating: 4, reviewCount: 1 });
      }
      if (u.includes('/api/vitrine/services/s1/reviews')) {
        return json({
          ok: true,
          reviews: [{ rating: 4, comment: 'Top soin', createdAt: '2026-07-02T00:00:00.000Z' }],
          page: 1,
          hasMore: false,
          total: 1,
        });
      }
      return json({ ok: true });
    }),
  );
}

function renderAll() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider loader={async () => null}>
        <MemoryRouter>
          <div>
            <ReviewDrawer formationId="f1" formationName="Maquillage" onClose={() => {}} />
            <HomeReviews formationId="f1" />
            <TrainingReviews trainingId="f1" />
            <ServiceReviews serviceId="s1" />
          </div>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('PawRating everywhere', () => {
  it('uses paw-based review UI without visible star glyphs/icons', async () => {
    installFetch();
    const { container } = renderAll();

    await waitFor(() => {
      expect(container.querySelectorAll('.bs-paws, .bs-paw-input').length).toBeGreaterThan(0);
    });

    expect(container.querySelector('.bi-star, .bi-star-fill, .bi-stars')).toBeNull();
    expect(container.textContent || '').not.toContain('★');
    expect(container.textContent || '').not.toContain('☆');
  });
});
