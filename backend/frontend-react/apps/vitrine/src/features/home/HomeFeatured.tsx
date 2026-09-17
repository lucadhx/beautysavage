// RX-HOME — Panneau vedette grand écran. Au lieu d'une rangée de petites cartes, la carte active
// occupe tout l'espace : photo à gauche, panneau de détails à droite (note en pattes « secondaire »
// mise en évidence, titre, description, mini-carrousel d'avis, CTA). Les flèches font défiler avec
// une transition animée (sortie + entrée simultanées). Respecte prefers-reduced-motion (CSS).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MediaImage, PriceLabel, PawRating, ReviewCarousel } from '@bs/ui';
import type { ReviewCarouselItem } from '@bs/ui';
import type { CarouselItem } from './HomeCarousel';

interface HomeFeaturedProps {
  items: CarouselItem[];
  ariaLabel: string;
  reviewsFor?: (item: CarouselItem) => Promise<ReviewCarouselItem[]>;
}

export function HomeFeatured({ items, ariaLabel, reviewsFor }: HomeFeaturedProps) {
  const count = items.length;
  const [active, setActive] = useState(0);
  // Transition en cours : la carte `idx` sort dans la direction `dir`, l'active entre du côté opposé.
  const [leaving, setLeaving] = useState<{ idx: number; dir: 1 | -1 } | null>(null);
  const [reviews, setReviews] = useState<ReviewCarouselItem[]>([]);
  const reqId = useRef(0);

  // Si la liste rétrécit, on ramène l'index actif dans les bornes.
  useEffect(() => {
    if (active > count - 1) setActive(0);
  }, [count, active]);

  const safeActive = Math.min(active, count - 1);
  const activeItem = items[safeActive];
  const activeId = activeItem?.id;

  // Avis chargés paresseusement pour l'élément actif uniquement (jamais les 10 d'un coup).
  useEffect(() => {
    if (!reviewsFor || !activeId) {
      setReviews([]);
      return;
    }
    const my = ++reqId.current;
    setReviews([]);
    reviewsFor(items[safeActive])
      .then((r) => { if (my === reqId.current) setReviews(r); })
      .catch(() => { if (my === reqId.current) setReviews([]); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, reviewsFor]);

  const goTo = (next: number, dir: 1 | -1) => {
    if (leaving || next === active) return;
    setLeaving({ idx: active, dir });
    setActive(next);
  };
  const step = (dir: 1 | -1) => goTo((active + dir + count) % count, dir);

  if (!activeItem) return null;

  return (
    <div className="home-feat" role="group" aria-roledescription="carrousel" aria-label={ariaLabel}>
      {count > 1 ? (
        <button type="button" className="home-feat__nav home-feat__nav--prev" aria-label="Précédent" onClick={() => step(-1)}>
          <i className="bi bi-chevron-left" aria-hidden="true" />
        </button>
      ) : null}

      <div className="home-feat__stage">
        {leaving ? (
          <FeaturedPanel
            key={`out-${leaving.idx}`}
            item={items[leaving.idx]}
            reviews={[]}
            className={`home-feat__panel--leaving home-feat__panel--to-${leaving.dir > 0 ? 'left' : 'right'}`}
          />
        ) : null}
        <FeaturedPanel
          key={`in-${safeActive}`}
          item={activeItem}
          reviews={reviews}
          className={leaving ? `home-feat__panel--entering home-feat__panel--from-${leaving.dir > 0 ? 'right' : 'left'}` : ''}
          onSelfAnimEnd={() => setLeaving(null)}
        />
      </div>

      {count > 1 ? (
        <button type="button" className="home-feat__nav home-feat__nav--next" aria-label="Suivant" onClick={() => step(1)}>
          <i className="bi bi-chevron-right" aria-hidden="true" />
        </button>
      ) : null}

      {count > 1 ? (
        <div className="home-feat__dots" role="tablist" aria-label="Choisir un élément">
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              role="tab"
              aria-selected={i === safeActive}
              aria-label={it.title}
              className={`home-feat__dot${i === safeActive ? ' home-feat__dot--active' : ''}`}
              onClick={() => goTo(i, i > safeActive ? 1 : -1)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FeaturedPanel({
  item, reviews, className, onSelfAnimEnd,
}: {
  item: CarouselItem;
  reviews: ReviewCarouselItem[];
  className?: string;
  onSelfAnimEnd?: () => void;
}) {
  const rating = item.rating;
  return (
    <article
      className={`home-feat__panel ${className ?? ''}`.trim()}
      // animationend remonte depuis les enfants (avis, pattes) : ne réagir qu'à l'anim du panneau.
      onAnimationEnd={(e) => { if (e.target === e.currentTarget) onSelfAnimEnd?.(); }}
    >
      <Link to={item.to} className="home-feat__media" aria-label={item.title}>
        <MediaImage src={item.media} alt={item.mediaAlt ?? item.title} ratio="1 / 1" />
        {item.badge ? <span className="home-feat__badge">{item.badge}</span> : null}
      </Link>

      <div className="home-feat__side">
        {rating && rating.count > 0 ? (
          <span className="home-feat__rating" aria-label={`${rating.average.toFixed(1)} sur 5, ${rating.count} avis`}>
            <PawRating value={rating.average} compact />
            <strong className="home-feat__rating-score">{rating.average.toFixed(1)}</strong>
            <span className="home-feat__rating-count">· {rating.count} avis</span>
          </span>
        ) : null}

        <h3 className="home-feat__title">{item.title}</h3>
        {item.meta ? <span className="home-feat__meta">{item.meta}</span> : null}
        {item.description ? <p className="home-feat__desc">{item.description}</p> : null}

        {item.price ? <div className="home-feat__price"><PriceLabel {...item.price} /></div> : null}

        {reviews.length ? (
          <div className="home-feat__reviews">
            <ReviewCarousel reviews={reviews} />
          </div>
        ) : null}

        <Link className="bs-btn home-feat__cta" to={item.to}>
          <i className="bi bi-calendar-heart" aria-hidden="true" /> {item.ctaLabel ?? 'Réserver'}
        </Link>
      </div>
    </article>
  );
}
