import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BadgeCheck, CheckCircle2, GraduationCap, PawPrint } from 'lucide-react';
import { useSiteData } from '@/context/SiteDataContext';
import { CommerceProductCard, buildReviewSummaries, type ProductReviewSummary } from '@/components/CommerceProductCard';
import { type CommerceProduct } from '@/lib/api';
import { useCatalog, useReviews } from '@/lib/catalogCache';
import { resolvePreviewMediaUrl } from '@/lib/media';

function byKind(items: CommerceProduct[], kinds: CommerceProduct['kind'][]) {
  return items.filter((item) => kinds.includes(item.kind));
}

/**
 * LES FICHES DE L'ACCUEIL : celles que l'institut met en avant depuis la page
 * de gestion, dans son ordre. Sans choix, les trois premières du catalogue.
 */
function featured(items: CommerceProduct[]) {
  const chosen = items.filter((item) => item.homeFeatured)
    .sort((a, b) => (a.homeFeaturedRank ?? Infinity) - (b.homeFeaturedRank ?? Infinity));
  // Toutes les fiches choisies, sans plafond ; sans choix, les trois premières du catalogue.
  return chosen.length ? chosen : items.slice(0, 3);
}

export default function HomePage() {
  const { data } = useSiteData();
  // Chargés en amont, dès le démarrage de l'application : voir lib/catalogCache.
  const catalog = useCatalog();
  const reviewItems = useReviews() as any[];
  const reviews = React.useMemo<Record<string, ProductReviewSummary>>(() => buildReviewSummaries(reviewItems), [reviewItems]);

  const company = data?.company;
  const name = company?.name || 'BeautySavage';
  const trainings = featured(byKind(catalog, ['DISTANCE_TRAINING', 'IN_PERSON_TRAINING']));
  const services = featured(byKind(catalog, ['SERVICE']));
  const heroImage = resolvePreviewMediaUrl(company?.heroImage || services[0]?.coverUrl || trainings[0]?.coverUrl || '');

  return (
    <>
      <section className="pb-8 pt-16 sm:px-5 sm:pb-12 sm:pt-28 md:px-8" style={{ background: 'var(--v-background)' }}>
        <div className="mx-auto max-w-7xl">
          <div className="relative overflow-hidden sm:min-h-[520px] sm:rounded-lg">
            {heroImage ? (
              <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <div className="absolute inset-0" style={{ background: 'var(--v-menu-background)' }} />
            )}
            {/* Téléphone : l'image respire en haut, le noir monte seulement sous le texte. */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/0 sm:hidden" />
            <div className="absolute inset-0 hidden bg-black/45 sm:block" />
            <div className="relative flex min-h-[calc(100svh-4rem-1.75rem)] max-w-5xl flex-col justify-end px-5 pb-6 pt-28 text-white sm:min-h-[520px] sm:justify-center sm:px-7 sm:py-14 md:px-16">
              {/* Accroche, titre et slogan : ceux de la page « Informations » du Manager, en direct. */}
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] sm:text-sm sm:tracking-[0.18em]" style={{ color: 'var(--v-accent)' }} data-testid="hero-kicker">
                {company?.heroKicker?.trim() || "Le geste. La certification. L'institut."}
              </p>
              <h1 className="mt-2 max-w-4xl text-[1.85rem] font-semibold leading-[1.05] tracking-normal sm:mt-6 sm:text-5xl md:text-7xl" data-testid="hero-title">
                {name}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-snug text-white/88 sm:mt-6 sm:text-xl sm:leading-8" data-testid="hero-tagline">
                {company?.tagline?.trim() || 'Ongles, regard, prestations institut et formations beauté à Nice.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 sm:mt-8 sm:gap-3">
                <Link to="/formations" className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold sm:gap-2 sm:px-6 sm:py-3 sm:text-sm" style={{ background: 'var(--v-accent)', color: '#111111' }}>
                  Je veux me former <ArrowRight className="h-4 w-4" />
                </Link>
                <Link to="/prestations" className="inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 text-xs font-semibold text-black sm:px-6 sm:py-3 sm:text-sm">
                  Réserver une prestation
                </Link>
                <Link to="/cartes-cadeaux" className="inline-flex items-center gap-2 rounded-md border border-white/45 px-3 py-2 text-xs font-semibold text-white sm:px-6 sm:py-3 sm:text-sm">
                  Offrir une carte cadeau
                </Link>
              </div>
              <TrainingDeclarationBadge declaration={company?.trainingDeclaration} />
            </div>
          </div>
          {company?.homeIntro?.trim() && (
            <p className="mx-auto mt-5 max-w-3xl whitespace-pre-line px-4 text-center text-sm leading-6 sm:mt-8 sm:px-0 sm:text-lg sm:leading-8" style={{ color: 'var(--v-muted-foreground)' }} data-testid="home-intro">
              {company.homeIntro}
            </p>
          )}
        </div>
      </section>

      <CatalogBand
        title="Prestations institut"
        subtitle="Des soins présentés comme en institut : visuel, prix, disponibilité et réservation."
        items={services}
        reviews={reviews}
        fallbackTo="/prestations"
        mobileCarousel
        ctaLabel="Voir les prestations"
        showKind={false}
      />

      <FormationBand items={trainings} reviews={reviews} />

      <ReviewsCarousel reviews={reviewItems} />

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-5 sm:py-20 md:px-8">
        <div className="grid gap-6 rounded-lg border p-6 md:grid-cols-[1fr_auto] md:items-center md:p-8" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] sm:text-sm sm:tracking-[0.18em]" style={{ color: 'var(--v-accent)' }}>Espace client</p>
            <h2 className="mt-1.5 text-xl font-semibold leading-tight tracking-normal sm:mt-3 sm:text-3xl">Achats, paniers et factures au même endroit.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6" style={{ color: 'var(--v-muted-foreground)' }}>
              Chaque cliente peut créer son compte, reprendre son panier, suivre ses commandes et consulter ses factures.
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

/**
 * LES AVIS — une bande SOMBRE, couleurs inversées : le titre à gauche, les
 * avis en colonnes séparées d'un filet, comme une page de magazine. Les
 * pattes de la maison restent la note. Téléphone : un défilement horizontal
 * aimanté qui démarre bien aligné à gauche.
 */
function ReviewsCarousel({ reviews }: { reviews: any[] }) {
  const visible = reviews
    .filter((review) => Number(review.rating || 0) > 0 && String(review.comment || '').trim())
    .slice(0, 6);
  if (visible.length === 0) return null;
  const filet = 'color-mix(in srgb, var(--v-menu-foreground) 18%, transparent)';
  const muet = 'color-mix(in srgb, var(--v-menu-foreground) 58%, transparent)';
  return (
    <section id="avis" className="py-12 sm:py-20" style={{ background: 'var(--v-menu-background)', color: 'var(--v-menu-foreground)' }} data-testid="home-reviews">
      <div className="mx-auto max-w-6xl px-4 sm:px-5 md:px-8">
        <div className="grid gap-7 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,2.6fr)] lg:gap-0">
          <div className="lg:pr-10">
            <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--v-accent)' }}>
              Avis clientes <span className="h-px w-8" style={{ background: 'var(--v-accent)' }} aria-hidden />
            </p>
            <h2 className="mt-3 text-[1.75rem] font-normal leading-[1.1] tracking-[-0.01em] sm:mt-4 sm:text-4xl" style={{ fontFamily: 'var(--font-heading)' }}>
              Elles ont testé BeautySavage.
            </h2>
          </div>
          <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 overflow-x-auto px-4 sm:-mx-5 sm:scroll-px-5 sm:px-5 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-y-10 lg:overflow-visible lg:px-0">
            {visible.map((review, index) => {
              const rating = Math.round(Number(review.rating || 0));
              const productTitle = review.productId?.title || '';
              return (
                <figure
                  key={review._id || index}
                  className="w-[74vw] max-w-[300px] shrink-0 snap-start border-l px-5 lg:w-auto lg:max-w-none lg:px-8"
                  style={{ borderColor: filet }}
                  data-testid="home-review"
                >
                  <div className="flex items-center gap-1" aria-label={`${rating} sur 5`}>
                    {Array.from({ length: 5 }).map((_, pawIndex) => (
                      <PawPrint key={pawIndex} className="h-3.5 w-3.5" fill={pawIndex < rating ? 'currentColor' : 'none'} style={{ color: 'var(--v-accent)' }} />
                    ))}
                  </div>
                  <blockquote className="mt-4 line-clamp-6 text-[14px] leading-6" style={{ color: 'color-mix(in srgb, var(--v-menu-foreground) 86%, var(--v-menu-background))' }}>
                    « {String(review.comment).trim()} »
                  </blockquote>
                  <figcaption className="mt-4 text-[13px] font-medium">
                    {review.displayName || 'Cliente BeautySavage'}
                    {productTitle && <span className="mt-0.5 block text-[11px] font-normal" style={{ color: muet }}>{productTitle}</span>}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </div>
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
    <section className="mx-auto max-w-6xl px-4 py-9 sm:px-5 sm:py-16 md:px-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] sm:text-sm sm:tracking-[0.18em]" style={{ color: 'var(--v-accent)' }}>BeautySavage</p>
          <h2 className="mt-1.5 text-2xl font-semibold leading-tight tracking-normal sm:mt-3 sm:text-4xl">{title}</h2>
          <p className="mt-1.5 text-xs leading-5 sm:mt-3 sm:text-sm" style={{ color: 'var(--v-muted-foreground)' }}>{subtitle}</p>
        </div>
        <Link to={fallbackTo} className="hidden items-center gap-2 text-sm font-semibold md:inline-flex">
          {ctaLabel} <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <div className={mobileCarousel ? 'no-scrollbar -mx-4 mt-5 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:-mx-5 sm:mt-8 sm:scroll-px-5 sm:gap-4 sm:px-5 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pb-0' : 'mt-8 grid gap-4 md:grid-cols-3'}>
        {items.length === 0 ? (
          <p className="w-full rounded-lg border border-dashed p-5 text-sm text-muted-foreground md:col-span-3">
            Les offres seront visibles ici dès qu'elles seront publiées depuis le manager.
          </p>
        ) : items.map((item) => (
          <div key={item.id} className={mobileCarousel ? 'w-[44vw] max-w-[220px] shrink-0 snap-start sm:w-[42vw] sm:max-w-[330px] md:w-auto md:max-w-none' : ''}>
            <CommerceProductCard item={item} review={reviews[item.id]} showKind={showKind} />
          </div>
        ))}
      </div>
      {mobileCarousel && items.length > 0 && (
        <Link
          to={fallbackTo}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-sm font-semibold md:hidden"
          style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)', borderRadius: 'var(--v-radius)' }}
        >
          {ctaLabel} <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </section>
  );
}

function FormationBand({ items, reviews }: { items: CommerceProduct[]; reviews: Record<string, ProductReviewSummary> }) {
  return (
    <section className="py-9 sm:py-16" style={{ background: 'color-mix(in srgb, var(--v-primary) 10%, var(--v-background))' }}>
      <div className="mx-auto max-w-6xl px-4 sm:px-5 md:px-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] sm:text-sm sm:tracking-[0.18em]" style={{ color: 'var(--v-accent)' }}>Academy</p>
            <h2 className="mt-1.5 text-2xl font-semibold leading-tight tracking-normal sm:mt-3 sm:text-4xl">Se former aux techniques BeautySavage.</h2>
            <p className="mt-1.5 max-w-2xl text-xs leading-5 sm:mt-4 sm:text-sm sm:leading-7" style={{ color: 'var(--v-muted-foreground)' }}>
              Des parcours pour apprendre, pratiquer et suivre ses contenus depuis son compte client après achat.
            </p>
          </div>
          <Link to="/formations" className="hidden items-center gap-2 text-sm font-semibold md:inline-flex">
            Je veux être formée <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="no-scrollbar -mx-4 mt-5 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:-mx-5 sm:mt-8 sm:scroll-px-5 sm:gap-4 sm:px-5 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pb-0">
          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground md:col-span-3">
              Les formations publiées apparaîtront ici.
            </div>
          ) : items.map((item) => (
            <div key={item.id} className="w-[44vw] max-w-[220px] shrink-0 snap-start sm:w-[42vw] sm:max-w-[330px] md:w-auto md:max-w-none">
              <CommerceProductCard item={item} review={reviews[item.id]} />
            </div>
          ))}
        </div>
        {items.length > 0 && (
          <Link
            to="/formations"
            className="mt-5 inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-sm font-semibold md:hidden"
            style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)', borderRadius: 'var(--v-radius)' }}
          >
            Je veux être formée <ArrowRight className="h-4 w-4" />
          </Link>
        )}
        <div className="mt-5 grid gap-2.5 rounded-lg border p-4 sm:mt-8 sm:gap-4 sm:p-5 md:grid-cols-3" style={{ borderColor: 'var(--v-border)', background: 'color-mix(in srgb, var(--v-background) 58%, transparent)' }}>
          {['Programmes structurés', 'Accès client après achat', 'Suivi des évaluations'].map((text) => (
            <p key={text} className="flex items-center gap-2.5 text-xs font-medium sm:gap-3 sm:text-sm">
              <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--v-accent)' }} />
              {text}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}

/** « 93061262606 » → « 93 06 12626 06 », la présentation usuelle d'un NDA. */
function formatNda(raw: string) {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 11 ? `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 9)} ${digits.slice(9)}` : raw.trim();
}

/**
 * ORGANISME DE FORMATION DÉCLARÉ — le numéro de déclaration d'activité, bien
 * visible dans la bannière.
 *
 * Aucun logo « officiel » n'existe pour un NDA : le logo Qualiopi est réservé
 * aux organismes CERTIFIÉS Qualiopi, et l'utiliser sans l'être est interdit.
 * Le badge porte donc un pictogramme neutre et le numéro. La mention « cet
 * enregistrement ne vaut pas agrément de l'État » a été retirée de l'accueil
 * à la demande de l'institut (2026-09-27).
 */
function TrainingDeclarationBadge({ declaration }: { declaration?: { number: string; region: string } }) {
  const number = declaration?.number?.trim();
  if (!number) return null;
  return (
    <div className="mt-4 max-w-xl sm:mt-8" data-testid="nda-badge">
      <div className="inline-flex items-center gap-2 rounded-lg border border-white/35 bg-white/95 px-2.5 py-1.5 text-left text-black shadow-lg backdrop-blur sm:gap-3 sm:px-4 sm:py-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full sm:h-11 sm:w-11" style={{ background: 'var(--v-accent)', color: '#111111' }}>
          <GraduationCap className="h-4 w-4 sm:h-6 sm:w-6" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-black/60 sm:text-[11px] sm:tracking-[0.16em]">Organisme de formation déclaré</span>
          <span className="block text-sm font-semibold tabular-nums sm:text-lg">NDA {formatNda(number)}</span>
        </span>
        <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-600 sm:h-5 sm:w-5" aria-hidden />
      </div>
    </div>
  );
}
