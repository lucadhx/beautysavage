import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  createManualReview,
  listReviewsForModeration,
  moderateReview,
  managerAttestationUrl,
} from './learning';
import { attestationDownloadUrl } from '../catalog/learning';

function json(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const calls: { url: string; method: string }[] = [];

function installFetch(payload: unknown) {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method || 'GET' });
      return json(payload);
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('review moderation api-client (C3)', () => {
  it('listReviewsForModeration unwrappe reviews, counts et countsByType', async () => {
    installFetch({
      ok: true,
      reviews: [{ id: 'r1', status: 'pending', targetType: 'service' }],
      counts: { pending: 1, published: 0, rejected: 0 },
      countsByType: { formation: 0, service: 1 },
    });
    const res = await listReviewsForModeration({ status: 'pending', type: 'service' });
    expect(res.reviews.length).toBe(1);
    expect(res.counts.pending).toBe(1);
    expect(res.countsByType.service).toBe(1);
    expect(calls[0].url).toContain('/api/gestion/learning/reviews');
    expect(calls[0].url).toContain('status=pending');
    expect(calls[0].url).toContain('type=service');
  });

  it('moderateReview PATCH', async () => {
    installFetch({ ok: true, review: { id: 'r1', status: 'rejected' } });
    await moderateReview('r1', 'rejected');
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url).toContain('/reviews/r1');
  });

  it('createManualReview POST /reviews/manual', async () => {
    installFetch({
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
        rating: 5,
        comment: 'Top',
        status: 'published',
        createdAt: null,
        moderatedAt: null,
        sourceType: 'manual_institute',
        isManual: true,
        sourceLabel: "Ajoute manuellement par l'institut",
      },
    });
    const res = await createManualReview({
      targetType: 'service',
      targetId: 's1',
      displayName: 'Institut',
      rating: 5,
      comment: 'Top',
      status: 'published',
    });
    expect(res.isManual).toBe(true);
    expect(res.targetType).toBe('service');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/api/gestion/learning/reviews/manual');
  });

  it('URLs attestation client + manager', () => {
    expect(attestationDownloadUrl('f1')).toContain('/api/client/learning/formations/f1/attestation');
    expect(managerAttestationUrl('c1', 'f1')).toContain('/api/gestion/learning/customers/c1/formations/f1/attestation');
  });
});
