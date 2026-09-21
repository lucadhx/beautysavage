import * as React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

/* Section wrapper with consistent spacing + reveal-on-scroll */
export function Section({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn('py-16 md:py-24', className)}>
      <div className="mx-auto max-w-6xl px-5 md:px-8">{children}</div>
    </section>
  );
}

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-12">
      {eyebrow && (
        <div className="mb-5">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] md:text-base">{eyebrow}</p>
          <span className="mt-2 block h-px w-12" style={{ background: 'var(--v-accent)' }} />
        </div>
      )}
      <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{title}</h2>
      {subtitle && <p className="mt-3 max-w-2xl text-base text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

type ButtonProps = {
  children: React.ReactNode;
  variant?: 'primary' | 'accent' | 'outline';
  size?: 'md' | 'lg';
  to?: string;
  href?: string;
  onClick?: () => void;
  className?: string;
};

export function CTAButton({
  children,
  variant = 'accent',
  size = 'md',
  to,
  href,
  onClick,
  className,
}: ButtonProps) {
  const base = cn(
    'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-all active:scale-[0.98]',
    size === 'lg' ? 'px-7 py-3.5 text-base' : 'px-5 py-2.5 text-sm',
    className
  );
  const style: React.CSSProperties =
    variant === 'accent'
      ? { background: 'var(--v-accent)', color: 'var(--v-accent-foreground)' }
      : variant === 'primary'
        ? { background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }
        : { border: '1px solid var(--v-border)', color: 'var(--v-foreground)' };

  const content = (
    <span className={cn(base, 'hover:opacity-90 hover:shadow-lg')} style={style}>
      {children}
    </span>
  );

  if (to) return <Link to={to}>{content}</Link>;
  if (href)
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {content}
      </a>
    );
  return (
    <button onClick={onClick} className="contents">
      {content}
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   UNE GRILLE QUI CENTRE SA DERNIÈRE RANGÉE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ LE DÉFAUT QUE CE COMPOSANT FERME ════════════════════════════════════════
 *
 * Les cartes — karts, tracés, vidéos — étaient posées dans une grille CSS à
 * deux ou trois colonnes. Une grille remplit ses colonnes de gauche à droite :
 * quand il y a moins d'éléments que de colonnes, ils se collent à gauche et
 * laissent un vide à droite, sous un titre centré. C'est le cas courant sur ce
 * projet — deux tracés pour trois colonnes, deux karts pour trois — et la
 * section paraît alors mal cadrée, ou pire, comme s'il manquait une carte qui
 * n'a pas chargé.
 *
 * ══ POURQUOI PAS `justify-center` SUR LA GRILLE ═════════════════════════════
 *
 * Parce qu'il centre les PISTES, pas les éléments : les colonnes gardent leur
 * largeur intrinsèque et les cartes rétrécissent au lieu de se centrer. Deux
 * cartes deviennent alors deux vignettes étroites au milieu de l'écran, ce qui
 * est un second défaut plutôt qu'une correction.
 *
 * ══ CE QUI EST FAIT À LA PLACE ══════════════════════════════════════════════
 *
 * Un `flex-wrap` centré, dont chaque enfant reçoit EXACTEMENT la largeur qu'il
 * aurait eue dans la grille (`calc`, gouttière déduite). Rangée pleine : c'est
 * indistinguable d'une grille. Rangée incomplète — la dernière, ou la seule —
 * ses cartes gardent leur taille et se centrent.
 *
 * Les largeurs sont des CLASSES LITTÉRALES et non calculées : Tailwind lit les
 * sources pour décider ce qu'il génère, et une classe assemblée à l'exécution
 * ne serait jamais produite.
 */
const LARGEURS_CARTE = {
  /** Deux colonnes à partir de `sm`. Gouttière 1,5 rem → 50 % − 0,75 rem. */
  2: 'w-full sm:w-[calc(50%-0.75rem)]',
  /** Deux colonnes à partir de `md`, trois à partir de `xl`. */
  3: 'w-full md:w-[calc(50%-0.75rem)] xl:w-[calc(33.333%-1rem)]',
} as const;

export function GrilleCentree({
  colonnes = 3,
  className,
  children,
}: {
  /** Le nombre de colonnes VISÉ sur grand écran. Deux ou trois. */
  colonnes?: 2 | 3;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-wrap justify-center gap-6', className)}>
      {React.Children.map(children, (enfant) =>
        /* `null` et `false` sont des enfants légitimes (une carte conditionnée) :
           les envelopper produirait une case vide qui décalerait toute la
           rangée. */
        enfant == null || enfant === false ? enfant : (
          <div className={LARGEURS_CARTE[colonnes]}>{enfant}</div>
        ))}
    </div>
  );
}
