/// <reference types="vite/client" />
// Sprint P1 — Garanties de la couche polish.css : focus visible global, cible tactile 44px,
// anti-overflow (clip, pas hidden → ne casse pas sticky), skip-link, shimmer tokenisé, presets motion.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// vitest tourne depuis la racine frontend-react ; on remonte si besoin pour trouver le fichier.
function loadPolishCss(): string {
  const candidates = [
    path.resolve('packages/ui/src/polish.css'),
    path.resolve('frontend-react/packages/ui/src/polish.css'),
  ];
  const found = candidates.find((p) => existsSync(p));
  return found ? readFileSync(found, 'utf8') : '';
}
const css = loadPolishCss();

describe('polish.css — contrats UX/a11y/responsive', () => {
  it('le fichier polish.css est lisible', () => {
    expect(css.length).toBeGreaterThan(500);
  });

  it('focus-visible global sur les éléments interactifs', () => {
    expect(css).toMatch(/:focus-visible/);
    expect(css).toContain('outline: 2px solid var(--bs-color-primary)');
  });

  it('cible tactile 44px (WCAG 2.1 AA)', () => {
    expect(css).toContain('--bs-tap-target: 44px');
    expect(css).toContain('min-height: var(--bs-tap-target)');
  });

  it('anti scroll horizontal via overflow-x: clip (préserve position: sticky)', () => {
    expect(css).toContain('overflow-x: clip');
    expect(css).not.toContain('overflow-x: hidden'); // hidden casserait sticky
  });

  it('skip-link clavier', () => {
    expect(css).toContain('.bs-skip-link');
  });

  it('shimmer du skeleton piloté par token', () => {
    expect(css).toContain('--bs-motion-shimmer');
    expect(css).toContain('@keyframes bs-shimmer');
  });

  it('presets de motion présents (entrée/sheet/dialog/pop/shake/toast)', () => {
    for (const kf of ['bs-entrance', 'bs-sheet', 'bs-dialog', 'bs-pop', 'bs-shake', 'bs-toast']) {
      expect(css).toContain(`@keyframes ${kf}`);
    }
  });

  it('état de navigation actif (vous êtes ici)', () => {
    expect(css).toMatch(/\.bs-nav-link\.active/);
    expect(css).toContain("aria-current='page'");
  });
});
