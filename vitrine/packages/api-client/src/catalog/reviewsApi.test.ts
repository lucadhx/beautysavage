import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getServiceReviewStats,
  getServiceReviews,
  getTrainingReviewStats,
  getTrainingReviews,
} from './reviews';

function json(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const calls: string[] = [];

function installFetch(payload: unknown) {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(String(url));
      return json(payload);
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('reviews api-client (C1)', () => {
  it('getTrainingReviewStats cible /reviews/stats et normalise', async () => {
    installFetch({ ok: true, averageRating: 4.5, reviewCount: 12 });
    const res = await getTrainingReviewStats('f1');
    expect(res.averageRating).toBe(4.5);
    expect(res.reviewCount).toBe(12);
    expect(calls[0]).toContain('/api/vitrine/formations/f1/reviews/stats');
  });

  it('getTrainingReviews passe page + sort', async () => {
    installFetch({
      ok: true,
      reviews: [{ rating: 5, comment: 'Top', createdAt: null }],
      page: 1,
      hasMore: true,
      total: 9,
    });
    const res = await getTrainingReviews('f1', 1, 'best');
    expect(res.reviews.length).toBe(1);
    expect(res.hasMore).toBe(true);
    expect(calls[0]).toContain('/api/vitrine/formations/f1/reviews');
    expect(calls[0]).toContain('sort=best');
  });

  it('getTrainingReviewStats tolere une reponse vide', async () => {
    installFetch({ ok: true });
    const res = await getTrainingReviewStats('f1');
    expect(res.averageRating).toBe(0);
    expect(res.reviewCount).toBe(0);
  });

  it('getServiceReviewStats cible /services/:id/reviews/stats', async () => {
    installFetch({ ok: true, averageRating: 4.8, reviewCount: 7 });
    const res = await getServiceReviewStats('s1');
    expect(res.averageRating).toBe(4.8);
    expect(res.reviewCount).toBe(7);
    expect(calls[0]).toContain('/api/vitrine/services/s1/reviews/stats');
  });

  it('getServiceReviews passe page + sort sur le namespace service', async () => {
    installFetch({
      ok: true,
      reviews: [{ rating: 5, comment: 'Parfait', createdAt: null }],
      page: 2,
      hasMore: false,
      total: 1,
    });
    const res = await getServiceReviews('s1', 2, 'recent');
    expect(res.page).toBe(2);
    expect(res.reviews[0].comment).toBe('Parfait');
    expect(calls[0]).toContain('/api/vitrine/services/s1/reviews');
    expect(calls[0]).toContain('page=2');
    expect(calls[0]).toContain('sort=recent');
  });
});
