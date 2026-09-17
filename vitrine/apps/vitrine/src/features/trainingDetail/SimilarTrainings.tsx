import { Link } from 'react-router-dom';
import { CatalogueCard, MediaImage, PriceLabel } from '@bs/ui';
import { resolveMediaUrl } from '@bs/api-client';
import { usePublicTrainings } from '../catalog/hooks/usePublicTrainings';
import { trainingPriceProps } from '../catalog/priceProps';

const TYPE_LABEL: Record<string, string> = { distanciel: 'En ligne', presentiel: 'Présentiel' };

// RX3 — Formations similaires : cards catalogue (scroll horizontal mobile / rangée desktop). Réutilise
// usePublicTrainings + CatalogueCard. Silencieux si rien à montrer.
export function SimilarTrainings({ currentId, max = 6 }: { currentId: string; max?: number }) {
  const { data } = usePublicTrainings();
  const others = (data ?? []).filter((t) => t.id !== currentId).slice(0, max);
  if (others.length === 0) return null;

  return (
    <section className="td-section" aria-label="Formations similaires">
      <h2 className="td-section__title">Vous aimerez aussi</h2>
      <div className="td-similar">
        {others.map((t) => (
          <div key={t.id} className="td-similar__item">
            <CatalogueCard
              media={<MediaImage src={resolveMediaUrl(t.coverImage)} alt={t.name} />}
              badge={t.activePromotion ? t.activePromotion.label ?? 'Promo' : undefined}
              title={t.name}
              meta={t.type ? TYPE_LABEL[t.type] ?? t.type : undefined}
              price={<PriceLabel {...trainingPriceProps(t)} />}
              action={
                <Link className="bs-btn bs-btn--secondary-solid" to={`/formations/${t.id}`}>
                  Voir
                </Link>
              }
            />
          </div>
        ))}
      </div>
    </section>
  );
}
