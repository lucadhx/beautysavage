/// <reference types="vite/client" />
// Sprint P1 — Tests de la couche polish (@bs/ui). Presets de motion (+ reduced-motion), primitives
// harmonisées (rôles/aria/classes), et garde "zéro couleur en dur" sur les composants.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  Durations,
  Easings,
  MOTION_PRESET_CLASS,
  motionPreset,
  microTransition,
  Badge,
  Chip,
  IconButton,
  Skeleton,
  Spinner,
} from './index';

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches, media: '', addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}
afterEach(() => vi.unstubAllGlobals());

describe('polish — motion presets', () => {
  it('expose des durées alignées sur les tokens', () => {
    expect(Durations.fast).toBe(140);
    expect(Durations.normal).toBe(240);
    expect(Durations.slow).toBe(360);
    expect(Easings.out).toContain('cubic-bezier');
  });

  it('motionPreset renvoie la classe d’animation, vide si reduced-motion', () => {
    mockMatchMedia(false);
    expect(motionPreset('entrance')).toBe(MOTION_PRESET_CLASS.entrance);
    expect(motionPreset('drawer')).toBe('bs-anim-sheet');
    mockMatchMedia(true);
    expect(motionPreset('entrance')).toBe(''); // animations coupées
  });

  it('microTransition est vide en reduced-motion', () => {
    mockMatchMedia(false);
    expect(microTransition('opacity')).toContain('opacity');
    mockMatchMedia(true);
    expect(microTransition('opacity')).toBe('');
  });
});

describe('polish — primitives', () => {
  it('Badge applique la tonalité sémantique', () => {
    const { container } = render(<Badge tone="success">Actif</Badge>);
    const el = container.querySelector('.bs-badge');
    expect(el).toBeTruthy();
    expect(el?.className).toContain('bs-badge--success');
    expect(el?.textContent).toBe('Actif');
  });

  it('Chip est un bouton avec aria-pressed', () => {
    render(<Chip active>Filtre</Chip>);
    const btn = screen.getByRole('button', { name: 'Filtre' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn.className).toContain('bs-chip--active');
  });

  it('IconButton impose un aria-label (accessibilité)', () => {
    render(
      <IconButton label="Fermer">
        <i className="bi-x" aria-hidden="true" />
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Fermer' })).toHaveClass('bs-icon-btn');
  });

  it('Skeleton est annoncé comme chargement (aria-busy)', () => {
    const { container } = render(<Skeleton variant="line" count={3} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('.bs-skeleton').length).toBe(3);
  });

  it('Spinner expose un statut', () => {
    const { container } = render(<Spinner label="Chargement…" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(container.querySelector('.bs-spinner')).toBeTruthy();
  });
});

describe('polish — zéro couleur en dur', () => {
  it('aucun .tsx polish (hors tests) ne contient de couleur hexadécimale', () => {
    const sources = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.endsWith('.test.tsx'))
      .filter(([, src]) => HEX_COLOR.test(src))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
