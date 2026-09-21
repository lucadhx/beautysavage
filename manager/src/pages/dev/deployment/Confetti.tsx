/**
 * Confettis légers, autonomes (aucune dépendance). Respecte
 * `prefers-reduced-motion` : si l'utilisateur réduit les animations, on
 * n'affiche rien.
 */
import * as React from 'react';
import { useReducedMotion } from 'framer-motion';

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#38bdf8'];

interface Piece {
  id: number;
  left: number;
  delay: number;
  duration: number;
  color: string;
  size: number;
  rotate: number;
}

export function Confetti({ count = 80 }: { count?: number }) {
  const reduce = useReducedMotion();
  const pieces = React.useMemo<Piece[]>(() => {
    if (reduce) return [];
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      duration: 2.4 + Math.random() * 1.8,
      color: COLORS[i % COLORS.length],
      size: 6 + Math.random() * 6,
      rotate: Math.random() * 360,
    }));
  }, [count, reduce]);

  if (reduce || pieces.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(-10%) rotate(0deg); opacity: 1; }
          100% { transform: translateY(120vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{
            position: 'absolute',
            top: '-5%',
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.4,
            background: p.color,
            borderRadius: 2,
            transform: `rotate(${p.rotate}deg)`,
            animation: `confetti-fall ${p.duration}s ${p.delay}s ease-in forwards`,
          }}
        />
      ))}
    </div>
  );
}

export default Confetti;
