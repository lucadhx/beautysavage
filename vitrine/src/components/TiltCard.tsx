import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * UNE SURFACE QUI RÉPOND AU POINTEUR — inclinaison réelle, pas une ombre.
 *
 * ══ CE QU'ELLE APPORTE, ET POURQUOI CE N'EST PAS UN GADGET ══════════════════
 *
 * Le plan de site demande que le visiteur RESSENTE la maîtrise avant qu'on la
 * lui explique. Une carte qui s'incline vers le pointeur et dont la lumière
 * suit le curseur dit, sans un mot, que quelqu'un s'est occupé du détail. La
 * même carte plate avec une ombre qui grossit ne dit rien du tout.
 *
 * ══ POURQUOI AUCUN ÉTAT REACT ═══════════════════════════════════════════════
 *
 * Suivre le pointeur avec `useState` re-rend le composant à chaque pixel — et
 * comme ces cartes portent du texte, c'est tout un paragraphe qui est
 * réconcilié soixante fois par seconde pour incliner un conteneur de six
 * degrés. On écrit donc trois variables CSS sur le nœud, dans une frame
 * d'animation, et le compositeur fait le travail hors du fil principal.
 *
 * ══ CE QUI DÉSACTIVE L'EFFET, ET C'EST VOULU ════════════════════════════════
 *
 *   · `pointer: coarse` — au doigt, il n'y a pas de survol : l'effet ne se
 *     déclencherait qu'au moment du tap, c'est-à-dire au moment où la page
 *     change. Un mouvement juste avant une navigation se lit comme un bug ;
 *   · `prefers-reduced-motion` — une inclinaison est un mouvement, et une
 *     grille de six cartes qui bougent au passage de la souris est exactement
 *     ce que ce réglage demande d'éviter.
 *
 * Dans les deux cas la carte reste : ce sont les degrés qui disparaissent, pas
 * le contenu ni la bordure.
 */
export function TiltCard({
  children,
  className,
  /** L'amplitude, en degrés. Au-delà de 8, la carte se déforme au lieu de répondre. */
  amplitude = 6,
}: {
  children: React.ReactNode;
  className?: string;
  amplitude?: number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [actif, setActif] = React.useState(false);

  React.useEffect(() => {
    const fin = window.matchMedia('(pointer: fine)').matches;
    const sobre = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setActif(fin && !sobre);
  }, []);

  const frame = React.useRef(0);
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!actif || frame.current) return;
    const { clientX, clientY } = e;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const n = ref.current;
      if (!n) return;
      const r = n.getBoundingClientRect();
      const x = (clientX - r.left) / r.width;
      const y = (clientY - r.top) / r.height;
      n.style.setProperty('--tilt-x', `${((0.5 - y) * amplitude).toFixed(2)}deg`);
      n.style.setProperty('--tilt-y', `${((x - 0.5) * amplitude).toFixed(2)}deg`);
      n.style.setProperty('--tilt-lx', `${(x * 100).toFixed(1)}%`);
      n.style.setProperty('--tilt-ly', `${(y * 100).toFixed(1)}%`);
    });
  };

  const reset = () => {
    const n = ref.current;
    if (!n) return;
    n.style.setProperty('--tilt-x', '0deg');
    n.style.setProperty('--tilt-y', '0deg');
  };

  React.useEffect(() => () => {
    if (frame.current) cancelAnimationFrame(frame.current);
  }, []);

  return (
    <div style={{ perspective: '1100px' }} className={cn('h-full', className)}>
      <div
        ref={ref}
        onPointerMove={onMove}
        onPointerLeave={reset}
        className="group relative h-full overflow-hidden"
        style={{
          transform: 'rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg))',
          transformStyle: 'preserve-3d',
          transition: 'transform 350ms cubic-bezier(0.22, 1, 0.36, 1)',
          border: '1px solid var(--v-border)',
          borderRadius: 'var(--v-radius)',
          background: 'color-mix(in srgb, var(--v-foreground) 3%, var(--v-background))',
        }}
      >
        {/*
          LA LUMIÈRE SUIT LE POINTEUR — et n'existe qu'au survol.

          Posée en permanence, elle ferait une tache immobile au centre de
          chaque carte : douze halos figés sur une page qui revendique la
          sobriété. `opacity` au survol coûte une transition, pas un rendu.
        */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            background:
              'radial-gradient(420px circle at var(--tilt-lx, 50%) var(--tilt-ly, 50%),'
              + ' color-mix(in srgb, var(--v-accent) 14%, transparent), transparent 62%)',
          }}
        />
        <div className="relative h-full">{children}</div>
      </div>
    </div>
  );
}
