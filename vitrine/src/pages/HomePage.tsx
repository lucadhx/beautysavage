import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, PawPrint } from 'lucide-react';
import { useSiteData } from '@/context/SiteDataContext';
import { CommerceProductCard, buildReviewSummaries, type ProductReviewSummary } from '@/components/CommerceProductCard';
import { commerceApi, type CommerceProduct } from '@/lib/api';
import { resolvePreviewMediaUrl } from '@/lib/media';

function byKind(items: CommerceProduct[], kinds: CommerceProduct['kind'][]) {
  return items.filter((item) => kinds.includes(item.kind));
}

export default function HomePage() {
  const { data } = useSiteData();
  const [catalog, setCatalog] = React.useState<CommerceProduct[]>([]);
  const [reviews, setReviews] = React.useState<Record<string, ProductReviewSummary>>({});
  const [reviewItems, setReviewItems] = React.useState<any[]>([]);

  React.useEffect(() => {
    commerceApi.catalog().then(setCatalog).catch(() => setCatalog([]));
    commerceApi.reviews(undefined).then((items) => {
      setReviewItems(items as any[]);
      setReviews(buildReviewSummaries(items));
    }).catch(() => {
      setReviewItems([]);
      setReviews({});
    });
  }, []);

  const company = data?.company;
  const name = company?.name || 'BeautySavage';
  const trainings = byKind(catalog, ['DISTANCE_TRAINING', 'IN_PERSON_TRAINING']).slice(0, 3);
  const services = byKind(catalog, ['SERVICE']).slice(0, 3);
  const heroImage = resolvePreviewMediaUrl(company?.heroImage || services[0]?.coverUrl || trainings[0]?.coverUrl || '');

  return (
    <>
      <section className="px-5 pb-12 pt-28 md:px-8" style={{ background: 'var(--v-background)' }}>
        <div className="mx-auto max-w-7xl">
          <div className="relative min-h-[520px] overflow-hidden rounded-lg">
            {heroImage ? (
              <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <div className="absolute inset-0" style={{ background: 'var(--v-menu-background)' }} />
            )}
            <div className="absolute inset-0 bg-black/45" />
            <div className="relative flex min-h-[520px] max-w-5xl flex-col justify-center px-7 py-14 text-white md:px-16">
              <p className="text-sm font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--v-accent)' }}>
                Le geste. La certification. L'institut.
              </p>
              <h1 className="mt-6 max-w-4xl text-5xl font-semibold leading-[1.02] tracking-normal md:text-7xl">
                {name}
              </h1>
              <p className="mt-6 max-w-3xl text-xl leading-8 text-white/88">
                Ongles, regard, prestations institut et formations beaute a Nice.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to="/formations" className="inline-flex items-center gap-2 rounded-md px-6 py-3 text-sm font-semibold" style={{ background: 'var(--v-accent)', color: '#111111' }}>
                  Je veux me former <ArrowRight className="h-4 w-4" />
                </Link>
                <Link to="/prestations" className="inline-flex items-center gap-2 rounded-md bg-white px-6 py-3 text-sm font-semibold text-black">
                  Reserver une prestation
                </Link>
                <Link to="/cartes-cadeaux" className="inline-flex items-center gap-2 rounded-md border border-white/45 px-6 py-3 text-sm font-semibold text-white">
                  Offrir une carte cadeau
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <CatalogBand
        title="Prestations institut"
        subtitle="Des soins presentes comme en institut : visuel, prix, disponibilite et reservation."
        items={services}
        reviews={reviews}
        fallbackTo="/prestations"
        mobileCarousel
        ctaLabel="Voir les prestations"
        showKind={false}
      />

      <FormationBand items={trainings} reviews={reviews} />

      <ReviewsCarousel reviews={reviewItems} />

      <section className="mx-auto max-w-6xl px-5 py-20 md:px-8">
        <div className="grid gap-6 rounded-lg border p-6 md:grid-cols-[1fr_auto] md:items-center md:p-8" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--v-accent)' }}>Espace client</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-normal">Achats, paniers et factures au meme endroit.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6" style={{ color: 'var(--v-muted-foreground)' }}>
              Chaque cliente peut creer son compte, reprendre son panier, suivre ses commandes et consulter ses factures.
            </p>
          </div>
          <Link
            to="/espace-client"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold"
            style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)', borderRadius: 'var(--v-radius)' }}
          >
            Espace client <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </>
  );
}

function ReviewsCarousel({ reviews }: { reviews: any[] }) {
  const visible = reviews.filter((review) => Number(review.rating || 0) > 0).slice(0, 12);
  if (visible.length === 0) return null;
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 md:px-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--v-accent)' }}>Avis clientes</p>
          <h2 className="mt-3 text-4xl font-semibold tracking-normal">Elles ont teste BeautySavage.</h2>
        </div>
      </div>
      <div className="no-scrollbar -mx-5 mt-8 flex snap-x gap-4 overflow-x-auto px-5 pb-2 md:mx-0 md:px-0">
        {visible.map((review, index) => {
          const rating = Math.round(Number(review.rating || 0));
          const productTitle = review.productId?.title || review.sourceLabel || 'BeautySavage';
          return (
            <article key={review._id || index} className="min-h-56 w-[82vw] max-w-[360px] shrink-0 snap-start rounded-lg border p-5" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
              <div className="flex items-center gap-1" aria-label={`${rating} sur 5`}>
                {Array.from({ length: 5 }).map((_, pawIndex) => (
                  <PawPrint
                    key={pawIndex}
                    className="h-4 w-4"
                    fill={pawIndex < rating ? 'currentColor' : 'none'}
                    style={{ color: 'var(--v-accent)' }}
                  />
                ))}
              </div>
              <p className="mt-4 line-clamp-4 text-sm leading-6">{review.comment || 'Tres belle experience institut.'}</p>
              <div className="mt-5 border-t pt-4 text-sm" style={{ borderColor: 'var(--v-border)' }}>
                <p className="font-semibold">{review.displayName || 'Cliente BeautySavage'}</p>
                <p className="mt-1 text-xs" style={{ color: 'var(--v-muted-foreground)' }}>{productTitle}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CatalogBand({
  title,
  subtitle,
  items,
  reviews,
  fallbackTo,
  mobileCarousel = false,
  ctaLabel = 'Tout voir',
  showKind = true,
}: {
  title: string;
  subtitle: string;
  items: CommerceProduct[];
  reviews: Record<string, ProductReviewSummary>;
  fallbackTo: string;
  mobileCarousel?: boolean;
  ctaLabel?: string;
  showKind?: boolean;
}) {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 md:px-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--v-accent)' }}>BeautySavage</p>
          <h2 className="mt-3 text-4xl font-semibold tracking-normal">{title}</h2>
          <p className="mt-3 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>{subtitle}</p>
        </div>
        <Link to={fallbackTo} className="hidden items-center gap-2 text-sm font-semibold md:inline-flex">
          {ctaLabel} <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <div className={mobileCarousel ? 'no-scrollbar -mx-5 mt-8 flex snap-x gap-4 overflow-x-auto px-5 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pb-0' : 'mt-8 grid gap-4 md:grid-cols-3'}>
        {items.length === 0 ? (
          <p className="w-full rounded-lg border border-dashed p-5 text-sm text-muted-foreground md:col-span-3">
            Les offres seront visibles ici des qu'elles seront publiees depuis le manager.
          </p>
        ) : items.map((item) => (
          <div key={item.id} className={mobileCarousel ? 'w-[78vw] max-w-[330px] shrink-0 snap-start md:w-auto md:max-w-none' : ''}>
            <CommerceProductCard item={item} review={reviews[item.id]} showKind={showKind} />
          </div>
        ))}
      </div>
      {mobileCarousel && items.length > 0 && (
        <Link
          to={fallbackTo}
          className="mt-7 inline-flex w-full items-center justify-center gap-2 px-6 py-4 text-base font-semibold md:hidden"
          style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)', borderRadius: 'var(--v-radius)' }}
        >
          {ctaLabel} <ArrowRight className="h-5 w-5" />
        </Link>
      )}
    </section>
  );
}

function FormationBand({ items, reviews }: { items: CommerceProduct[]; reviews: Record<string, ProductReviewSummary> }) {
  return (
    <section className="py-16" style={{ background: 'color-mix(in srgb, var(--v-primary) 10%, var(--v-background))' }}>
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--v-accent)' }}>Academy</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-normal">Se former aux techniques BeautySavage.</h2>
            <p className="mt-4 max-w-2xl text-sm leading-7" style={{ color: 'var(--v-muted-foreground)' }}>
              Des parcours pour apprendre, pratiquer et suivre ses contenus depuis son compte client apres achat.
            </p>
          </div>
          <Link to="/formations" className="hidden items-center gap-2 text-sm font-semibold md:inline-flex">
            Je veux etre formee <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="no-scrollbar -mx-5 mt-8 flex snap-x gap-4 overflow-x-auto px-5 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pb-0">
          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground md:col-span-3">
              Les formations publiees apparaitront ici.
            </div>
          ) : items.map((item) => (
            <div key={item.id} className="w-[78vw] max-w-[330px] shrink-0 snap-start md:w-auto md:max-w-none">
              <CommerceProductCard item={item} review={reviews[item.id]} />
            </div>
          ))}
        </div>
        {items.length > 0 && (
          <Link
            to="/formations"
            className="mt-7 inline-flex w-full items-center justify-center gap-2 px-6 py-4 text-base font-semibold md:hidden"
            style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)', borderRadius: 'var(--v-radius)' }}
          >
            Je veux etre formee <ArrowRight className="h-5 w-5" />
          </Link>
        )}
        <div className="mt-8 grid gap-4 rounded-lg border p-5 md:grid-cols-3" style={{ borderColor: 'var(--v-border)', background: 'color-mix(in srgb, var(--v-background) 58%, transparent)' }}>
          {['Programmes structures', 'Acces client apres achat', 'Suivi des evaluations'].map((text) => (
            <p key={text} className="flex items-center gap-3 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--v-accent)' }} />
              {text}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
