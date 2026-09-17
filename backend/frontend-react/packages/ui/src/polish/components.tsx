// Sprint P1 — Primitives partagées harmonisées (opt-in). Stylées par polish.css (classes bs-*).
// Aucune couleur en dur : uniquement des classes utilitaires reliées aux tokens --bs-*.
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'muted';

const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  neutral: '',
  success: 'bs-badge--success',
  warning: 'bs-badge--warning',
  danger: 'bs-badge--danger',
  info: 'bs-badge--info',
  accent: 'bs-badge--accent',
  muted: 'bs-badge--muted',
};

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}

/** Badge de statut/état harmonisé (pilule). */
export function Badge({ children, tone = 'neutral', className = '' }: BadgeProps) {
  return <span className={['bs-badge', BADGE_TONE_CLASS[tone], className].filter(Boolean).join(' ')}>{children}</span>;
}

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  /** Cible tactile pleine (44px) — pour les filtres tapables sur mobile. */
  tap?: boolean;
  children: ReactNode;
}

/** Chip (filtre/tag) interactif. */
export function Chip({ active = false, tap = false, className = '', children, ...rest }: ChipProps) {
  const cls = ['bs-chip', active ? 'bs-chip--active' : '', tap ? 'bs-chip--tap' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} aria-pressed={active} {...rest}>
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Obligatoire : bouton icône → toujours un libellé pour les lecteurs d'écran. */
  label: string;
  children: ReactNode;
}

/** Bouton icône avec cible tactile 44px garantie + aria-label obligatoire. */
export function IconButton({ label, className = '', children, ...rest }: IconButtonProps) {
  return (
    <button type="button" aria-label={label} className={['bs-icon-btn', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </button>
  );
}

export interface SkeletonProps {
  variant?: 'text' | 'line' | 'block';
  width?: string;
  height?: string;
  className?: string;
  count?: number;
}

/** Skeleton shimmer harmonisé (perçu). `count` répète la ligne. */
export function Skeleton({ variant = 'line', width, height, className = '', count = 1 }: SkeletonProps) {
  const cls = ['bs-skeleton', `bs-skeleton--${variant}`, className].filter(Boolean).join(' ');
  const items = Array.from({ length: Math.max(1, count) });
  return (
    <span role="status" aria-live="polite" aria-busy="true" aria-label="Chargement">
      {items.map((_, i) => (
        <span key={i} className={cls} style={{ width, height, display: 'block' }} aria-hidden="true" />
      ))}
    </span>
  );
}

/** Indicateur de chargement animé (rotation). */
export function Spinner({ label = 'Chargement…', className = '' }: { label?: string; className?: string }) {
  return (
    <span role="status" aria-live="polite" className={className}>
      <span className="bs-spinner" aria-hidden="true" />
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{label}</span>
    </span>
  );
}

export default { Badge, Chip, IconButton, Skeleton, Spinner };
