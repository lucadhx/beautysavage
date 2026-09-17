// C2 — Confetti léger (fin de formation uniquement). Pur CSS (spans animés), coupé par
// prefers-reduced-motion. Auto-disparaît après ~1.6s.
import { useEffect } from 'react';
import { prefersReducedMotion } from '@bs/ui';

const PIECES = Array.from({ length: 18 }, (_, i) => i);

export function Confetti({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1700);
    return () => clearTimeout(t);
  }, [onDone]);

  if (prefersReducedMotion()) {
    // Pas d'animation : on notifie simplement la réussite (aria-live), pas de confetti.
    return (
      <p className="bs-lrn__done" role="status">
        <i className="bi bi-trophy" aria-hidden="true" /> Formation terminée — bravo !
      </p>
    );
  }
  return (
    <div className="bs-confetti" aria-hidden="true">
      {PIECES.map((i) => (
        <span key={i} className={`bs-confetti__piece bs-confetti__piece--${i % 6}`} style={{ left: `${(i / PIECES.length) * 100}%` }} />
      ))}
    </div>
  );
}
