// M9 — Motion helpers : reduced-motion coupe les transitions (animation forte désactivée).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { prefersReducedMotion, motionTransition, MotionTokens } from './motion';

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches, media: '', addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}
afterEach(() => vi.unstubAllGlobals());

describe('motion (M9)', () => {
  it('prefersReducedMotion reflète matchMedia', () => {
    mockMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    mockMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('motionTransition renvoie une transition normale, vide si reduced motion', () => {
    mockMatchMedia(false);
    const t = motionTransition('opacity, transform', 'normal');
    expect(t).toContain('opacity');
    expect(t).toContain(MotionTokens.transitionNormal);
    mockMatchMedia(true);
    expect(motionTransition('opacity')).toBe(''); // animation forte désactivée
  });
});
