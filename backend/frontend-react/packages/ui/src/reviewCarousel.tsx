// Carrousel d'avis « coverflow » 3D (perspective). Zéro effet carrousel s'il y a 1 seul avis.
// Pattes de chien via PawRating (couleur secondaire). Tokens --bs-* only, ≥44px, reduced-motion (CSS).
import { useState, type CSSProperties } from 'react';
import { PawRating } from './catalog';

export interface ReviewCarouselItem {
  rating: number;
  comment: string;
  createdAt: string | null;
  authorName?: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return '';
  }
}

function ReviewSlideCard({ review }: { review: ReviewCarouselItem }) {
  const author = (review.authorName || '').trim();
  const score = Math.max(0, Math.min(5, Math.round(review.rating)));
  return (
    <div className="bs-rc-card">
      <span className="bs-rc-card__rate">
        <PawRating value={review.rating} compact />
        <span className="bs-rc-card__score">{score}/5</span>
      </span>
      <p className="bs-rc-card__comment">{review.comment ? `« ${review.comment} »` : '—'}</p>
      <div className="bs-rc-card__foot">
        {author ? <span className="bs-rc-card__author">{author}</span> : <span />}
        {fmtDate(review.createdAt) ? <span className="bs-rc-card__date">{fmtDate(review.createdAt)}</span> : null}
      </div>
    </div>
  );
}

export function ReviewCarousel({ reviews }: { reviews: ReviewCarouselItem[] }) {
  const [active, setActive] = useState(0);
  const count = reviews.length;

  if (count === 0) return null;
  // « Pas d'effet carrousel si pas + de 1 avis » : on rend simplement la carte.
  if (count === 1) {
    return (
      <div className="bs-rc bs-rc--single">
        <ReviewSlideCard review={reviews[0]} />
      </div>
    );
  }

  const current = Math.min(active, count - 1);
  const go = (dir: number) => setActive((a) => ((a + dir) % count + count) % count);

  return (
    <div className="bs-rc" role="group" aria-roledescription="carrousel" aria-label="Avis clients">
      <div className="bs-rc__stage">
        {reviews.map((review, i) => {
          // Décalage circulaire (chemin le plus court) pour l'effet coverflow.
          let offset = i - current;
          if (offset > count / 2) offset -= count;
          if (offset < -count / 2) offset += count;
          const abs = Math.abs(offset);
          const hidden = abs > 2;
          const scale = abs === 0 ? 1 : abs === 1 ? 0.86 : 0.72;
          const style: CSSProperties = {
            transform: `translateX(${offset * 52}%) rotateY(${offset * -34}deg) scale(${scale})`,
            opacity: hidden ? 0 : abs === 0 ? 1 : abs === 1 ? 0.7 : 0.32,
            zIndex: 10 - abs,
            pointerEvents: hidden ? 'none' : 'auto',
          };
          return (
            <div
              key={i}
              className={`bs-rc__slide${offset === 0 ? ' bs-rc__slide--active' : ''}`}
              style={style}
              aria-hidden={offset !== 0}
              onClick={() => offset !== 0 && setActive(i)}
            >
              <ReviewSlideCard review={review} />
            </div>
          );
        })}
      </div>

      <div className="bs-rc__nav">
        <button type="button" className="bs-rc__arrow" aria-label="Avis précédent" onClick={() => go(-1)}>
          <i className="bi bi-chevron-left" aria-hidden="true" />
        </button>
        <div className="bs-rc__dots" role="tablist" aria-label="Choisir un avis">
          {reviews.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === current}
              aria-label={`Avis ${i + 1}`}
              className={`bs-rc__dot${i === current ? ' bs-rc__dot--active' : ''}`}
              onClick={() => setActive(i)}
            />
          ))}
        </div>
        <button type="button" className="bs-rc__arrow" aria-label="Avis suivant" onClick={() => go(1)}>
          <i className="bi bi-chevron-right" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
