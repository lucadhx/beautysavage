import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PawRating, LoadingState, EmptyState, ReviewCarousel, Dropdown } from '@bs/ui';
import { getServiceReviewStats, getServiceReviews, type ReviewSort } from '@bs/api-client';

const SORT_OPTIONS = [
  { value: 'recent', label: 'Plus récents' },
  { value: 'best', label: 'Mieux notés' },
];

export function ServiceReviews({ serviceId }: { serviceId: string }) {
  const [sort, setSort] = useState<ReviewSort>('recent');

  const stats = useQuery({
    queryKey: ['reviews', 'stats', 'service', serviceId],
    queryFn: ({ signal }) => getServiceReviewStats(serviceId, signal),
    staleTime: 60_000,
  });
  const list = useQuery({
    queryKey: ['reviews', 'list', 'service', serviceId, sort],
    queryFn: ({ signal }) => getServiceReviews(serviceId, 1, sort, signal),
    staleTime: 60_000,
  });

  if (stats.isPending) return <LoadingState label="Chargement des avis…" />;
  const count = stats.data?.reviewCount ?? 0;

  return (
    <section className="bs-reviews" aria-label="Avis clients">
      <div className="bs-reviews__head">
        <h2 className="bs-reviews__title">Avis</h2>
        {count > 0 ? <PawRating value={stats.data?.averageRating ?? 0} count={count} /> : null}
      </div>

      {count === 0 ? (
        <EmptyState label="Aucun avis pour le moment." />
      ) : (
        <>
          <div className="bs-reviews__sort">
            <Dropdown
              ariaLabel="Trier les avis"
              icon="bi-sort-down"
              value={sort}
              options={SORT_OPTIONS}
              onChange={(v) => setSort(v as ReviewSort)}
            />
          </div>
          {list.isPending ? (
            <LoadingState label="Chargement…" />
          ) : (
            <ReviewCarousel reviews={list.data?.reviews ?? []} />
          )}
          {list.data?.hasMore ? (
            <p className="bs-reviews__more">Affichage des avis les plus pertinents.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
