import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MediaImage, Card } from '@bs/ui';
import { resolveMediaUrl, formatDuration, getBoostedServices, getServiceReviews, getTrainingReviews } from '@bs/api-client';
import { usePublicServices } from '../features/catalog/hooks/usePublicServices';
import { usePublicShop } from '../features/catalog/hooks/usePublicShop';
import { usePublicGiftCards } from '../features/catalog/hooks/usePublicGiftCards';
import { servicePriceProps, trainingPriceProps } from '../features/catalog/priceProps';
import { HomeBanner } from '../features/home/HomeBanner';
import { HomeCarousel, type CarouselItem } from '../features/home/HomeCarousel';
import { HomeWhy } from '../features/home/HomeWhy';
import { HomeReviews } from '../features/home/HomeReviews';
import { HomeFaq } from '../features/home/HomeFaq';
import '../features/home/home.css';

const TYPE_LABEL: Record<string, string> = { distanciel: 'En ligne', presentiel: 'Présentiel' };

// Chargeurs d'avis paresseux (élément vedette actif uniquement) — meilleurs avis d'abord.
// Définis hors composant : identité stable, ne relance pas l'effet de chargement à chaque rendu.
const prestationReviews = (item: CarouselItem) => getServiceReviews(item.id, 1, 'best').then((p) => p.reviews);
const formationReviews = (item: CarouselItem) => getTrainingReviews(item.id, 1, 'best').then((p) => p.reviews);

export function HomePage() {
  const boosted = useQuery({ queryKey: ['home', 'boosted-services'], queryFn: ({ signal }) => getBoostedServices(signal), staleTime: 120_000 });
  const services = usePublicServices();
  const shop = usePublicShop();
  const giftCard = usePublicGiftCards();

  // Boostés en tête, puis le reste du catalogue (dédupliqué) — pas seulement les boostés.
  const boostedList = boosted.data ?? [];
  const boostedIds = new Set(boostedList.map((s) => s.id));
  const prestations = [...boostedList, ...(services.data ?? []).filter((s) => !boostedIds.has(s.id))].slice(0, 10);
  const formations = (shop.data?.formations ?? []).slice(0, 10);
  const featuredFormationId = shop.data?.formations?.[0]?.id;

  const prestationItems: CarouselItem[] = prestations.map((s) => ({
    id: s.id,
    to: `/prestations/${s.slug}`,
    title: s.name,
    media: resolveMediaUrl(s.photos?.[0]),
    mediaAlt: s.name,
    badge: s.hasPromo ? s.promotionLabel ?? 'Promo' : null,
    meta: formatDuration(s.duration) || null,
    price: servicePriceProps(s),
    ctaLabel: 'Réserver',
    description: s.shortDescription || s.description || null,
    rating: { average: s.averageRating ?? 0, count: s.reviewCount ?? 0 },
  }));

  const formationItems: CarouselItem[] = formations.map((t) => ({
    id: t.id,
    to: `/formations/${t.id}`,
    title: t.name,
    media: resolveMediaUrl(t.coverImage),
    mediaAlt: t.name,
    badge: t.activePromotion ? t.activePromotion.label ?? 'Promo' : null,
    meta: t.type ? TYPE_LABEL[t.type] ?? t.type : null,
    price: trainingPriceProps(t),
    ctaLabel: 'Voir',
    description: t.description || null,
    rating: { average: t.averageRating ?? 0, count: t.reviewCount ?? 0 },
  }));

  return (
    <div className="home">
      <HomeBanner />

      <HomeCarousel
        ariaLabel="Prestations"
        title="Nos prestations"
        subtitle="Cils, sourcils, regard et soins sur-mesure. Réservez votre moment beauté en quelques clics, entre des mains expertes et passionnées."
        titleIcon="bi bi-scissors"
        viewAllTo="/prestations"
        items={prestationItems}
        emptyLabel="Découvrez bientôt nos prestations."
        emptyIcon="bi-scissors"
        featured
        reviewsFor={prestationReviews}
      />

      <HomeCarousel
        ariaLabel="Formations"
        title="Nos formations"
        subtitle="Apprenez un métier de la beauté à votre rythme : cours en ligne accessibles à vie ou sessions en présentiel, avec évaluation et attestation à la clé."
        titleIcon="bi bi-mortarboard"
        viewAllTo="/formations"
        items={formationItems}
        emptyLabel="Découvrez bientôt nos formations."
        emptyIcon="bi-mortarboard"
        featured
        reviewsFor={formationReviews}
        tone="primary"
      />

      {/* Cartes cadeaux */}
      <section className="home-section" aria-label="Cartes cadeaux">
        <Card className="home-gift">
          <div className="home-gift__media">
            <MediaImage src={resolveMediaUrl(giftCard.data?.image)} alt="Carte cadeau Beauty Savage" ratio="4 / 3" />
            <span className="home-gift__ribbon" aria-hidden="true"><i className="bi bi-gift-fill" /></span>
          </div>
          <div className="home-gift__body">
            <span className="home-gift__eyebrow"><i className="bi bi-stars" aria-hidden="true" /> Idée cadeau</span>
            <h2 className="home-gift__title">Offrez la beauté</h2>
            <p className="home-gift__text">
              Une carte cadeau utilisable sur l’ensemble de nos prestations et formations. Le cadeau qui fait toujours plaisir.
            </p>
            <Link className="bs-btn home-gift__cta" to="/cartes-cadeaux">
              <i className="bi bi-gift" aria-hidden="true" /> Offrir une carte cadeau
            </Link>
          </div>
        </Card>
      </section>

      <HomeWhy />
      <HomeReviews formationId={featuredFormationId} />
      <HomeFaq />

      {/* CTA final — bloc minimaliste (aplat, filet, icônes couleur simples) */}
      <section className="home-cta" aria-label="Commencer">
        <div className="home-cta__inner">
          <span className="home-cta__badge"><i className="bi bi-heart-fill" aria-hidden="true" /> Beauty Savage</span>
          <h2 className="home-cta__title">Prête à commencer ?</h2>
          <p className="home-cta__lead">Réservez une prestation, formez-vous ou offrez un moment de beauté — en quelques clics.</p>
          <div className="home-cta__cards">
            <Link className="home-cta__card" to="/prestations">
              <span className="home-cta__card-icon"><i className="bi bi-calendar-heart" aria-hidden="true" /></span>
              <span className="home-cta__card-title">Réserver</span>
              <span className="home-cta__card-sub">Votre moment beauté</span>
              <i className="bi bi-arrow-right home-cta__card-go" aria-hidden="true" />
            </Link>
            <Link className="home-cta__card" to="/formations">
              <span className="home-cta__card-icon"><i className="bi bi-mortarboard" aria-hidden="true" /></span>
              <span className="home-cta__card-title">Se former</span>
              <span className="home-cta__card-sub">En ligne ou présentiel</span>
              <i className="bi bi-arrow-right home-cta__card-go" aria-hidden="true" />
            </Link>
            <Link className="home-cta__card" to="/cartes-cadeaux">
              <span className="home-cta__card-icon"><i className="bi bi-gift" aria-hidden="true" /></span>
              <span className="home-cta__card-title">Offrir</span>
              <span className="home-cta__card-sub">Une carte cadeau</span>
              <i className="bi bi-arrow-right home-cta__card-go" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
