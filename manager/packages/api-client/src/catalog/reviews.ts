// C1 — Avis publics (vitrine). Lecture seule, anonymisée côté backend.
// Endpoints :
//  - formations    : GET /api/vitrine/formations/:id/reviews/stats et /reviews?page&sort
//  - prestations   : GET /api/vitrine/services/:id/reviews/stats et /reviews?page&sort
import { apiFetch } from '../apiFetch';

export interface PublicReviewStats {
  averageRating: number;
  reviewCount: number;
}

export interface PublicReview {
  rating: number;
  comment: string;
  createdAt: string | null;
  authorName?: string;
}

export interface PublicReviewsPage {
  reviews: PublicReview[];
  page: number;
  hasMore: boolean;
  total: number;
}

export type ReviewSort = 'recent' | 'best';

async function getReviewStats(basePath: string, signal?: AbortSignal): Promise<PublicReviewStats> {
  const res = await apiFetch<{ ok?: boolean; averageRating?: number; reviewCount?: number }>(
    `${basePath}/reviews/stats`,
    { signal },
  );
  return { averageRating: Number(res.averageRating) || 0, reviewCount: Number(res.reviewCount) || 0 };
}

async function getReviewsPage(
  basePath: string,
  page = 1,
  sort: ReviewSort = 'recent',
  signal?: AbortSignal,
): Promise<PublicReviewsPage> {
  const res = await apiFetch<{
    ok?: boolean;
    reviews?: PublicReview[];
    page?: number;
    hasMore?: boolean;
    total?: number;
  }>(`${basePath}/reviews`, {
    params: { page, sort },
    signal,
  });
  return {
    reviews: res.reviews ?? [],
    page: res.page ?? page,
    hasMore: Boolean(res.hasMore),
    total: res.total ?? (res.reviews?.length ?? 0),
  };
}

export async function getTrainingReviewStats(
  trainingId: string,
  signal?: AbortSignal,
): Promise<PublicReviewStats> {
  return getReviewStats(`/api/vitrine/formations/${encodeURIComponent(trainingId)}`, signal);
}

export async function getTrainingReviews(
  trainingId: string,
  page = 1,
  sort: ReviewSort = 'recent',
  signal?: AbortSignal,
): Promise<PublicReviewsPage> {
  return getReviewsPage(`/api/vitrine/formations/${encodeURIComponent(trainingId)}`, page, sort, signal);
}

export async function getServiceReviewStats(
  serviceId: string,
  signal?: AbortSignal,
): Promise<PublicReviewStats> {
  return getReviewStats(`/api/vitrine/services/${encodeURIComponent(serviceId)}`, signal);
}

export async function getServiceReviews(
  serviceId: string,
  page = 1,
  sort: ReviewSort = 'recent',
  signal?: AbortSignal,
): Promise<PublicReviewsPage> {
  return getReviewsPage(`/api/vitrine/services/${encodeURIComponent(serviceId)}`, page, sort, signal);
}
