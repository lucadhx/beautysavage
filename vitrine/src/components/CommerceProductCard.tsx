import { Link } from 'react-router-dom';
import { ArrowRight, Clock, GraduationCap, Image as ImageIcon, MonitorPlay, PawPrint } from 'lucide-react';
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

/** Les pattes d'une note moyenne — l'icône de la maison, jamais des étoiles. */
function Paws({ review, tone }: { review?: ProductReviewSummary; tone: 'light' | 'dark' }) {
  if (!review || review.count <= 0) return null;
  const rounded = Math.round(review.average || 0);
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold sm:text-xs" aria-label={`${review.average.toFixed(1)} sur 5`}>
      {Array.from({ length: 5 }).map((_, index) => (
        <PawPrint key={index} className="h-3 w-3 sm:h-3.5 sm:w-3.5" fill={index < rounded ? 'currentColor' : 'none'} style={{ color: 'var(--v-accent)' }} />
      ))}
      <span className="ml-0.5" style={{ color: tone === 'dark' ? 'color-mix(in srgb, var(--v-menu-foreground) 60%, transparent)' : 'var(--v-muted-foreground)' }}>({review.count})</span>
    </span>
  );
}

function Cover({ item, className = '' }: { item: CommerceProduct; className?: string }) {
  const image = cover(item);
  return image ? (
    <img
      src={image}
      alt={item.title}
      loading="lazy"
      decoding="async"
      className={`h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04] ${className}`}
    />
  ) : (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: 'var(--v-muted-foreground)' }}>
      <ImageIcon className="h-6 w-6" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">Image à venir</span>
    </div>
  );
}

/**
 * LES CARTES DU CATALOGUE — deux familles, reconnaissables d'un coup d'œil.
 *
 *   · PRESTATION (et carte cadeau) : éditoriale et légère — la photo en
 *     portrait, arrondie, la durée posée dessus ; le texte en dessous, sans
 *     encadré. C'est la photo qui vend un soin.
 *   · FORMATION : une carte sombre, la photo fondue dans le noir, la modalité
 *     (en ligne / présentiel) en pastille et le prix en couleur d'accent —
 *     un parcours, pas un rendez-vous.
 *
 * Aucune dépendance ni animation lourde : du CSS, des images en chargement
 * différé, le même poids de page qu'avant.
 */
export function CommerceProductCard({
  item,
  review,
  showKind = true,
}: {
  item: CommerceProduct;
  review?: ProductReviewSummary;
  showKind?: boolean;
}) {
  const training = item.kind === 'DISTANCE_TRAINING' || item.kind === 'IN_PERSON_TRAINING';
  return training
    ? <TrainingCard item={item} review={review} />
    : <ServiceCard item={item} review={review} showKind={showKind} />;
}

function ServiceCard({ item, review, showKind }: { item: CommerceProduct; review?: ProductReviewSummary; showKind: boolean }) {
  const duration = item.kind === 'SERVICE' ? durationText(item.durationMinutes) : '';
  return (
    <Link to={`/catalogue/${item.slug}`} className="group flex h-full flex-col" data-card="service">
      <div
        className="relative aspect-[4/5] w-full overflow-hidden rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-black/5 sm:rounded-2xl"
        style={{ background: 'color-mix(in srgb, var(--v-foreground) 5%, var(--v-background))' }}
      >
        <PromoBadge product={item} />
        <Cover item={item} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/35 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
        {duration && (
          <span
            className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-black shadow-sm backdrop-blur sm:bottom-3 sm:left-3 sm:px-2.5 sm:py-1 sm:text-xs"
            data-testid="card-duration"
          >
            <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5" style={{ color: 'var(--v-accent)' }} aria-hidden />
            {duration}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col pt-2.5 sm:pt-4">
        <div className="flex min-h-0 flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
          {showKind && (
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] sm:text-[11px]" style={{ color: 'var(--v-accent)' }}>
              {kindLabel(item.kind)}
            </span>
          )}
          <Paws review={review} tone="light" />
        </div>
        <h3 className="mt-1 line-clamp-2 text-[0.95rem] font-semibold leading-snug tracking-normal sm:text-lg" style={{ fontFamily: 'var(--font-heading)' }}>
          {item.title}
        </h3>
        <p className="mt-1.5 line-clamp-2 text-sm leading-6 max-sm:!hidden" style={{ color: 'var(--v-muted-foreground)' }}>
          {item.subtitle || richTextToPlain(item.description)}
        </p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-1.5 text-sm sm:pt-3 sm:text-base">
          {item.kind === 'GIFT_CARD' ? <strong>{price(item)}</strong> : <PromoPrice product={item} />}
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] max-sm:!hidden" style={{ color: 'var(--v-accent)' }}>
            {item.kind === 'GIFT_CARD' ? 'Offrir' : 'Réserver'} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function TrainingCard({ item, review }: { item: CommerceProduct; review?: ProductReviewSummary }) {
  const online = item.kind === 'DISTANCE_TRAINING';
  const days = Number(item.training?.durationDays || 0);
  const detail = online ? 'Modules en ligne' : days ? `${days} jour${days > 1 ? 's' : ''} en institut` : 'En institut';
  return (
    <Link
      to={`/catalogue/${item.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl ring-1 ring-black/10 transition-transform duration-300 hover:-translate-y-0.5 sm:rounded-2xl"
      style={{ background: 'var(--v-menu-background)', color: 'var(--v-menu-foreground)' }}
      data-card="training"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        <PromoBadge product={item} />
        <Cover item={item} className="opacity-90" />
        <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(to top, var(--v-menu-background) 2%, transparent 55%)' }} />
        <span
          className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] backdrop-blur sm:left-3 sm:top-3 sm:px-2.5 sm:py-1 sm:text-[10px]"
          style={{ borderColor: 'color-mix(in srgb, var(--v-accent) 70%, transparent)', color: 'var(--v-accent)', background: 'color-mix(in srgb, var(--v-menu-background) 55%, transparent)' }}
        >
          {online ? <MonitorPlay className="h-3 w-3" aria-hidden /> : <GraduationCap className="h-3 w-3" aria-hidden />}
          {online ? 'En ligne' : 'Présentiel'}
        </span>
      </div>
      <div className="flex flex-1 flex-col px-3 pb-3 sm:px-5 sm:pb-5">
        <Paws review={review} tone="dark" />
        <h3 className="mt-1 line-clamp-2 text-[0.95rem] font-semibold leading-snug tracking-normal sm:text-xl" style={{ fontFamily: 'var(--font-heading)' }}>
          {item.title}
        </h3>
        <p className="mt-1 text-[11px] sm:text-xs" style={{ color: 'color-mix(in srgb, var(--v-menu-foreground) 62%, transparent)' }}>{detail}</p>
        <div
          className="mt-auto flex items-center justify-between gap-2 border-t pt-2.5 text-sm sm:pt-4 sm:text-base"
          style={{ borderColor: 'color-mix(in srgb, var(--v-menu-foreground) 14%, transparent)', }}
        >
          <span style={{ color: 'var(--v-accent)' }}><PromoPrice product={item} /></span>
          <span
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full border transition-colors group-hover:bg-white/10 sm:h-9 sm:w-9"
            style={{ borderColor: 'color-mix(in srgb, var(--v-menu-foreground) 25%, transparent)' }}
            aria-hidden
          >
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 sm:h-4 sm:w-4" />
          </span>
        </div>
      </div>
    </Link>
  );
}
