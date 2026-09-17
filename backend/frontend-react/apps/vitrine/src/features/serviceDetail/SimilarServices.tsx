import { Link } from 'react-router-dom';
import { CatalogueCard, MediaImage, PriceLabel } from '@bs/ui';
import { resolveMediaUrl, formatDuration } from '@bs/api-client';
import { usePublicServices } from '../catalog/hooks/usePublicServices';
import { servicePriceProps } from '../catalog/priceProps';

// RX3 — Prestations similaires : cards catalogue en scroll horizontal (mobile) / rangée (desktop).
// Réutilise usePublicServices + CatalogueCard (aucune nouvelle carte). Silencieux si rien à montrer.

export function SimilarServices({ currentId, max = 6 }: { currentId: string; max?: number }) {
  const { data } = usePublicServices();
  const others = (data ?? []).filter((s) => s.id !== currentId).slice(0, max);
  if (others.length === 0) return null;

  return (
    <section className="sd-section" aria-label="Prestations similaires">
      <h2 className="sd-section__title">Vous aimerez aussi</h2>
      <div className="sd-similar">
        {others.map((s) => (
          <div key={s.id} className="sd-similar__item">
            <CatalogueCard
              media={<MediaImage src={resolveMediaUrl(s.photos?.[0])} alt={s.name} />}
              badge={s.hasPromo ? s.promotionLabel ?? 'Promo' : undefined}
              title={s.name}
              meta={formatDuration(s.duration) || undefined}
              price={<PriceLabel {...servicePriceProps(s)} />}
              action={
                <Link className="bs-btn bs-btn--secondary" to={`/prestations/${s.slug}`}>
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
