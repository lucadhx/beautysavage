import { Link } from 'react-router-dom';
import { ArrowRight, Clock, Image as ImageIcon, PawPrint } from 'lucide-react';
import { PromoBadge, PromoPrice } from '@/components/Promotion';
import { type CommerceProduct } from '@/lib/api';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { richTextToPlain } from '@/lib/richText';

const formatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

export type ProductReviewSummary = {
  count: number;
  average: number;
};

/** « 1 h 45 », « 2 h », « 45 min » — la durée d'une prestation, lisible d'un coup d'œil. */
export function durationText(minutes?: number) {
  const total = Math.round(Number(minutes) || 0);
  if (total <= 0) return '';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

function price(product: CommerceProduct) {
  if (product.kind === 'GIFT_CARD') {
    const amount = Number(product.price?.amountCents || 0);
    return amount > 0 ? `À partir de ${formatter.format(amount / 100)}` : '';
  }
  return formatter.format(product.price.amountCents / 100);
}

function kindLabel(kind: CommerceProduct['kind']) {
  if (kind === 'SERVICE') return 'Prestation';
  if (kind === 'DISTANCE_TRAINING') return 'Formation en ligne';
  if (kind === 'IN_PERSON_TRAINING') return 'Formation présentielle';
  if (kind === 'GIFT_CARD') return 'Carte cadeau';
  return 'Produit';
}

function cover(product: CommerceProduct) {
  if (product.kind === 'GIFT_CARD') return '/gift-card-master.jpg?v=2';
  return resolvePreviewMediaUrl(product.coverUrl || product.gallery?.[0] || '');
}

export function buildReviewSummaries(reviews: any[] = []) {
  const grouped = new Map<string, { total: number; count: number }>();
  for (const review of reviews) {
    const productId = String(review.productId?._id || review.productId || '');
    if (!productId) continue;
    const rating = Number(review.rating || 0);
    if (!Number.isFinite(rating) || rating <= 0) continue;
    const current = grouped.get(productId) || { total: 0, count: 0 };
    grouped.set(productId, { total: current.total + rating, count: current.count + 1 });
  }
  const result: Record<string, ProductReviewSummary> = {};
  grouped.forEach((value, key) => {
    result[key] = { count: value.count, average: value.total / value.count };
  });
  return result;
}

export function CommerceProductCard({
  item,
  review,
  showKind = true,
}: {
  item: CommerceProduct;
  review?: ProductReviewSummary;
  showKind?: boolean;
}) {
  const image = cover(item);
  const roundedAverage = Math.round(review?.average || 0);

  return (
    <Link
      to={`/catalogue/${item.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-lg border transition-transform hover:-translate-y-1"
      style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}
    >
      <div className="relative aspect-square w-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--v-foreground) 5%, var(--v-background))' }}>
        <PromoBadge product={item} />
        {image ? (
          <img
            src={image}
            alt={item.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center" style={{ color: 'var(--v-muted-foreground)' }}>
            <div className="flex h-16 w-16 items-center justify-center rounded-full border" style={{ borderColor: 'var(--v-border)', background: 'var(--v-background)' }}>
              <ImageIcon className="h-7 w-7" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-[0.14em]">Image à venir</span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex min-h-5 items-center justify-between gap-3">
          {showKind ? (
            <span className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--v-accent)' }}>
              {kindLabel(item.kind)}
            </span>
          ) : (
            <span />
          )}
          {review && review.count > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold" aria-label={`${review.average.toFixed(1)} sur 5`}>
              {Array.from({ length: 5 }).map((_, index) => (
                <PawPrint
                  key={index}
                  className="h-3.5 w-3.5"
                  fill={index < roundedAverage ? 'currentColor' : 'none'}
                  style={{ color: 'var(--v-accent)' }}
                />
              ))}
              <span style={{ color: 'var(--v-muted-foreground)' }}>({review.count})</span>
            </span>
          )}
        </div>
        <h3 className="mt-4 text-xl font-semibold tracking-normal">{item.title}</h3>
        <p className="mt-2 line-clamp-2 min-h-12 text-sm leading-6" style={{ color: 'var(--v-muted-foreground)' }}>
          {item.subtitle || richTextToPlain(item.description)}
        </p>
        {item.kind === 'SERVICE' && durationText(item.durationMinutes) && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold" data-testid="card-duration">
            <Clock className="h-4 w-4" style={{ color: 'var(--v-accent)' }} aria-hidden />
            <span>{durationText(item.durationMinutes)}</span>
          </p>
        )}
        <div className="mt-auto flex items-center justify-between gap-4 pt-6">
          {item.kind === 'GIFT_CARD' ? <strong>{price(item)}</strong> : <PromoPrice product={item} />}
          <span className="inline-flex items-center gap-2 text-sm font-semibold">
            Voir <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </span>
        </div>
      </div>
    </Link>
  );
}
