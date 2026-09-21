/**
 * Illustrations vectorielles maison — modernes, sobres, cohérentes.
 *
 * Elles utilisent `currentColor` (piloté par une classe `text-*` sur le parent)
 * avec plusieurs niveaux d'opacité pour la profondeur : elles s'adaptent donc
 * automatiquement au thème (clair/sombre) et à la couleur d'accent. Aucune image
 * externe, aucun emoji.
 */
import * as React from 'react';

type P = React.SVGProps<SVGSVGElement>;

function Frame({ children, ...p }: P & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden {...p}>
      {children}
    </svg>
  );
}

/** Duplication : deux cartes qui se dédoublent. */
export function DuplicateArt(p: P) {
  return (
    <Frame {...p}>
      <rect x="26" y="30" width="56" height="64" rx="10" fill="currentColor" opacity="0.12" />
      <rect x="40" y="20" width="56" height="64" rx="10" fill="currentColor" opacity="0.18" />
      <rect x="40" y="20" width="56" height="64" rx="10" stroke="currentColor" strokeWidth="2.5" opacity="0.9" />
      <path d="M56 40h24M56 52h24M56 64h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.85" />
      <circle cx="96" cy="96" r="16" fill="currentColor" />
      <path d="M96 89v14M89 96h14" stroke="var(--card, #fff)" strokeWidth="3" strokeLinecap="round" />
    </Frame>
  );
}

/** Déploiement : une fusée qui publie le site. */
export function DeployArt(p: P) {
  return (
    <Frame {...p}>
      <circle cx="64" cy="64" r="46" fill="currentColor" opacity="0.10" />
      <path
        d="M64 24c14 8 20 22 20 38l-12 10H56L44 62c0-16 6-30 20-38Z"
        fill="currentColor"
        opacity="0.9"
      />
      <circle cx="64" cy="52" r="7" fill="var(--card, #fff)" />
      <path d="M56 82l-8 14 14-6M72 82l8 14-14-6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
      <path d="M64 100v8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.5" />
    </Frame>
  );
}

/** Serveur / cloud. */
export function ServerArt(p: P) {
  return (
    <Frame {...p}>
      <rect x="30" y="40" width="68" height="20" rx="6" fill="currentColor" opacity="0.18" />
      <rect x="30" y="68" width="68" height="20" rx="6" fill="currentColor" opacity="0.14" />
      <rect x="30" y="40" width="68" height="20" rx="6" stroke="currentColor" strokeWidth="2.5" opacity="0.9" />
      <rect x="30" y="68" width="68" height="20" rx="6" stroke="currentColor" strokeWidth="2.5" opacity="0.9" />
      <circle cx="44" cy="50" r="3.2" fill="currentColor" />
      <circle cx="44" cy="78" r="3.2" fill="currentColor" />
      <path d="M58 50h26M58 78h26" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
    </Frame>
  );
}

/** Succès : bouclier + coche. */
export function SuccessArt(p: P) {
  return (
    <Frame {...p}>
      <circle cx="64" cy="64" r="48" fill="currentColor" opacity="0.12" />
      <path d="M64 26l30 10v24c0 22-14 34-30 42-16-8-30-20-30-42V36l30-10Z" fill="currentColor" opacity="0.9" />
      <path d="M50 65l10 10 20-22" stroke="var(--card, #fff)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  );
}

/** Site web / navigateur. */
export function WebsiteArt(p: P) {
  return (
    <Frame {...p}>
      <rect x="24" y="30" width="80" height="60" rx="10" fill="currentColor" opacity="0.12" />
      <rect x="24" y="30" width="80" height="60" rx="10" stroke="currentColor" strokeWidth="2.5" opacity="0.9" />
      <path d="M24 46h80" stroke="currentColor" strokeWidth="2.5" opacity="0.6" />
      <circle cx="34" cy="38" r="2.4" fill="currentColor" />
      <circle cx="42" cy="38" r="2.4" fill="currentColor" />
      <circle cx="50" cy="38" r="2.4" fill="currentColor" />
      <rect x="36" y="56" width="30" height="24" rx="4" fill="currentColor" opacity="0.3" />
      <path d="M74 58h18M74 68h18M74 78h12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
      <path d="M62 98v6M50 104h28" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.5" />
    </Frame>
  );
}

/** Sauvegarde. */
export function BackupArt(p: P) {
  return (
    <Frame {...p}>
      <ellipse cx="64" cy="40" rx="34" ry="12" fill="currentColor" opacity="0.85" />
      <path d="M30 40v30c0 6.6 15.2 12 34 12s34-5.4 34-12V40" stroke="currentColor" strokeWidth="2.5" opacity="0.9" />
      <path d="M30 55c0 6.6 15.2 12 34 12s34-5.4 34-12" stroke="currentColor" strokeWidth="2.5" opacity="0.6" />
      <path d="M64 74v22M54 88l10 10 10-10" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  );
}

/** Petit motif décoratif de fond (halo doux). */
export function HeroGlow(p: P) {
  return (
    <svg viewBox="0 0 400 200" fill="none" aria-hidden {...p}>
      <defs>
        <radialGradient id="dg" cx="50%" cy="0%" r="80%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="200" fill="url(#dg)" />
    </svg>
  );
}
