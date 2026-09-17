import { useQuery } from '@tanstack/react-query';
import { PawRating, SectionHeader } from '@bs/ui';
import { getTrainingReviews, getTrainingReviewStats } from '@bs/api-client';

// RX3 S4 — Témoignages d'accueil = avis PUBLIÉS d'une formation mise en avant (backend anonymise).
// LIMITE : pas d'endpoint d'avis agrégés cross-formations → on affiche ceux d'une formation vedette
// (stopgap front-only, documenté). N'affiche RIEN si aucun avis publié (jamais d'avis inventé).

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long' });
  } catch {
    return '';
  }
}

export function HomeReviews({ formationId }: { formationId?: string }) {
  const enabled = Boolean(formationId);
  const stats = useQuery({
    queryKey: ['home', 'reviews', 'stats', formationId],
    queryFn: ({ signal }) => getTrainingReviewStats(formationId as string, signal),
    enabled,
    staleTime: 300_000,
  });
  const list = useQuery({
    queryKey: ['home', 'reviews', 'list', formationId],
    queryFn: ({ signal }) => getTrainingReviews(formationId as string, 1, 'best', signal),
    enabled,
    staleTime: 300_000,
  });

  const reviews = (list.data?.reviews ?? []).filter((r) => r.comment?.trim()).slice(0, 6);
  // Pas d'avis (ou pas encore chargés / erreur) → pas de section (jamais de faux témoignage).
  if (!enabled || reviews.length === 0) return null;

  return (
    <section className="home-section" aria-label="Avis clients">
      <SectionHeader
        title="Ils nous font confiance"
        action={stats.data && stats.data.reviewCount > 0 ? <PawRating value={stats.data.averageRating} count={stats.data.reviewCount} /> : undefined}
      />
      <div className="home-reviews">
        {reviews.map((r, i) => (
          <figure key={i} className="home-review">
            <PawRating value={r.rating} compact />
            <blockquote className="home-review__text">« {r.comment} »</blockquote>
            <figcaption className="home-review__date">{fmtDate(r.createdAt)}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
