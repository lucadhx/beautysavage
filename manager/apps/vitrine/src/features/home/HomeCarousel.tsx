import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MediaImage, PriceLabel } from '@bs/ui';
import type { PriceLabelProps, ReviewCarouselItem } from '@bs/ui';
import { HomeFeatured } from './HomeFeatured';

/** Média-query réactive, sûre en SSR (matches=false avant hydratation). */
export function useMediaQuery(query: string): boolean {
  const read = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState<boolean>(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

// RX-HOME — Vitrine des prestations / formations. Cartes carrées premium.
// • ≥ 2 éléments : carrousel 3D « coverflow » horizontal (rotateY + scale + opacity recalculés au
//   scroll via rAF), scroll tactile + snap, flèches sur desktop.
// • ≤ 1 élément : pas de carrousel (inutile) → carte unique centrée, sans flèches ni effet 3D.
// Mobile-first, CTA direct, respect de prefers-reduced-motion.

export interface CarouselItem {
  id: string;
  to: string;
  title: string;
  media?: string | null;
  mediaAlt?: string;
  badge?: string | null;
  meta?: string | null;
  price?: PriceLabelProps;
  ctaLabel?: string;
  /** Description enrichie (panneau vedette grand écran). */
  description?: string | null;
  /** Note moyenne d'avis publiés (panneau vedette grand écran). */
  rating?: { average: number; count: number };
}

export interface HomeCarouselProps {
  title: string;
  subtitle?: string;
  titleIcon?: string;
  viewAllTo?: string;
  viewAllLabel?: string;
  items: CarouselItem[];
  emptyLabel?: string;
  emptyIcon?: string;
  ariaLabel: string;
  /** Grand écran : bascule vers le panneau vedette (photo à gauche, détails + avis à droite). */
  featured?: boolean;
  /** Chargeur d'avis (paresseux) pour l'élément vedette actif. */
  reviewsFor?: (item: CarouselItem) => Promise<ReviewCarouselItem[]>;
  /** `primary` = bloc au fond couleur du header (texte adapté en on-primary). */
  tone?: 'default' | 'primary';
}

const REDUCED = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

function SectionHead({ title, subtitle, titleIcon, viewAllTo, viewAllLabel }: {
  title: string; subtitle?: string; titleIcon?: string; viewAllTo?: string; viewAllLabel: string;
}) {
  return (
    <div className="home-cf__head">
      <div className="home-cf__heading">
        {titleIcon ? <span className="home-cf__title-icon" aria-hidden="true"><i className={titleIcon} /></span> : null}
        <div className="home-cf__headings">
          <h2 className="home-cf__title">{title}</h2>
          {subtitle ? <p className="home-cf__subtitle">{subtitle}</p> : null}
        </div>
      </div>
      {viewAllTo ? (
        <Link className="home-cf__viewall" to={viewAllTo}>
          <span>{viewAllLabel}</span>
          <i className="bi bi-arrow-right" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

export function HomeCarousel({
  title, subtitle, titleIcon, viewAllTo, viewAllLabel = 'Voir tout', items,
  emptyLabel = 'Découvrez bientôt notre sélection.', emptyIcon = 'bi-stars', ariaLabel,
  featured = false, reviewsFor, tone = 'default',
}: HomeCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const frame = useRef<number>(0);
  // Panneau vedette réservé aux grands écrans qui offrent la largeur nécessaire.
  const wide = useMediaQuery('(min-width: 1024px)');
  const useFeatured = featured && wide && items.length > 0;
  const isCarousel = items.length > 1;

  // Transformation « coverflow » : chaque cellule se replie selon sa distance au centre du track.
  const paint = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const reduced = REDUCED?.matches ?? false;
    const trackRect = track.getBoundingClientRect();
    const center = trackRect.left + trackRect.width / 2;
    const cells = track.querySelectorAll<HTMLElement>('.home-cf__cell');
    cells.forEach((cell) => {
      if (reduced) {
        cell.style.transform = '';
        cell.style.opacity = '';
        cell.style.zIndex = '';
        return;
      }
      const rect = cell.getBoundingClientRect();
      const cellCenter = rect.left + rect.width / 2;
      const dist = (cellCenter - center) / trackRect.width; // -0.5 .. 0.5 environ
      const clamped = Math.max(-1, Math.min(1, dist * 2));
      const rotate = clamped * -22; // degrés
      const scale = 1 - Math.min(Math.abs(clamped) * 0.16, 0.28);
      const translateZ = -Math.abs(clamped) * 120;
      const opacity = 1 - Math.min(Math.abs(clamped) * 0.5, 0.5);
      cell.style.transform = `translateZ(${translateZ}px) rotateY(${rotate}deg) scale(${scale})`;
      cell.style.opacity = String(opacity);
      cell.style.zIndex = String(100 - Math.round(Math.abs(clamped) * 100));
    });
  }, []);

  const onScroll = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(paint);
  }, [paint]);

  useEffect(() => {
    if (!isCarousel || useFeatured) return;
    paint();
    const onResize = () => onScroll();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frame.current);
    };
  }, [paint, onScroll, isCarousel, useFeatured, items.length]);

  const scrollBy = (dir: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    const cell = track.querySelector<HTMLElement>('.home-cf__cell');
    const step = cell ? cell.getBoundingClientRect().width + 16 : track.clientWidth * 0.8;
    track.scrollBy({ left: dir * step, behavior: 'smooth' });
  };

  return (
    <section className={`home-section home-cf-section${tone === 'primary' ? ' home-cf-section--primary' : ''}`} aria-label={ariaLabel}>
      <SectionHead title={title} subtitle={subtitle} titleIcon={titleIcon} viewAllTo={viewAllTo} viewAllLabel={viewAllLabel} />

      {items.length === 0 ? (
        <div className="home-cf__empty">
          <i className={`bi ${emptyIcon}`} aria-hidden="true" />
          <span>{emptyLabel}</span>
        </div>
      ) : useFeatured ? (
        <HomeFeatured items={items} ariaLabel={ariaLabel} reviewsFor={reviewsFor} />
      ) : isCarousel ? (
        <div className="home-cf">
          <button type="button" className="home-cf__nav home-cf__nav--prev" aria-label="Précédent" onClick={() => scrollBy(-1)}>
            <i className="bi bi-chevron-left" aria-hidden="true" />
          </button>
          <div className="home-cf__track" ref={trackRef} onScroll={onScroll}>
            {items.map((item) => (
              <div className="home-cf__cell" key={item.id}>
                <CarouselCard item={item} />
              </div>
            ))}
          </div>
          <button type="button" className="home-cf__nav home-cf__nav--next" aria-label="Suivant" onClick={() => scrollBy(1)}>
            <i className="bi bi-chevron-right" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="home-cf-single">
          <CarouselCard item={items[0]} />
        </div>
      )}
    </section>
  );
}

function CarouselCard({ item }: { item: CarouselItem }): ReactNode {
  return (
    <article className="bs-card home-card">
      <Link to={item.to} className="home-card__media" aria-label={item.title}>
        <MediaImage src={item.media} alt={item.mediaAlt ?? item.title} ratio="1 / 1" />
        {item.badge ? <span className="home-card__badge">{item.badge}</span> : null}
      </Link>
      <div className="home-card__body">
        <h3 className="home-card__title">{item.title}</h3>
        <div className="home-card__row">
          {item.meta ? <span className="home-card__meta">{item.meta}</span> : <span />}
          {item.price ? <span className="home-card__price"><PriceLabel {...item.price} /></span> : null}
        </div>
        <Link className="bs-btn home-card__cta" to={item.to}>
          <i className="bi bi-calendar-heart" aria-hidden="true" /> {item.ctaLabel ?? 'Réserver'}
        </Link>
      </div>
    </article>
  );
}
