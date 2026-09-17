// RX3 — Galerie photo partagée (fiche prestation/formation/produit). Remplace le « photos[0] » unique.
// Image principale + vignettes cliquables (clavier + aria-current). Tokens --bs-*, ratio configurable.
import { useState } from 'react';

export interface GalleryImage {
  src: string;
  alt?: string;
}

export interface GalleryProps {
  images: GalleryImage[];
  /** Ratio de l'image principale (ex. '4 / 3'). */
  ratio?: string;
  /** Texte alternatif de repli si une image n'en a pas. */
  fallbackAlt?: string;
}

/** Galerie premium : grande image + vignettes. Dégrade proprement à 0/1 image. */
export function Gallery({ images, ratio = '4 / 3', fallbackAlt = '' }: GalleryProps) {
  const [active, setActive] = useState(0);
  const clean = images.filter((img) => Boolean(img?.src));

  if (clean.length === 0) {
    return (
      <div className="bs-gallery">
        <div className="bs-media bs-gallery__main" style={{ aspectRatio: ratio }}>
          <div className="bs-media__placeholder" aria-hidden="true" />
        </div>
      </div>
    );
  }

  const idx = Math.min(active, clean.length - 1);
  const current = clean[idx];
  const go = (dir: number) => setActive((a) => ((a + dir) % clean.length + clean.length) % clean.length);
  return (
    <div className="bs-gallery">
      <div className="bs-media bs-gallery__main" style={{ aspectRatio: ratio }}>
        <img key={idx} className="bs-media__img bs-gallery__img" src={current.src} alt={current.alt || fallbackAlt} loading="lazy" />
        {clean.length > 1 ? (
          <>
            <button type="button" className="bs-gallery__nav bs-gallery__nav--prev" aria-label="Image précédente" onClick={() => go(-1)}>
              <i className="bi bi-chevron-left" aria-hidden="true" />
            </button>
            <button type="button" className="bs-gallery__nav bs-gallery__nav--next" aria-label="Image suivante" onClick={() => go(1)}>
              <i className="bi bi-chevron-right" aria-hidden="true" />
            </button>
            <span className="bs-gallery__counter" aria-hidden="true">{idx + 1}/{clean.length}</span>
          </>
        ) : null}
      </div>
      {clean.length > 1 ? (
        <div className="bs-gallery__thumbs" role="list">
          {clean.map((img, i) => (
            <button
              key={`${img.src}-${i}`}
              type="button"
              role="listitem"
              className={['bs-gallery__thumb', i === active ? 'bs-gallery__thumb--active' : ''].filter(Boolean).join(' ')}
              aria-current={i === active ? 'true' : undefined}
              aria-label={`Photo ${i + 1} sur ${clean.length}`}
              onClick={() => setActive(i)}
            >
              <img src={img.src} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default { Gallery };
