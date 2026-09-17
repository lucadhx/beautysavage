// M9 — Base d'animation partagée (React UX Motion Guideline). Les valeurs miroir des
// tokens CSS `--bs-motion-*` (tokens.css). Animations légères (opacity/transform), durées
// courtes, easing doux ; toujours conditionnées par `prefers-reduced-motion`.

export const MotionTokens = {
  transitionFast: 'var(--bs-motion-fast)',
  transitionNormal: 'var(--bs-motion-normal)',
  transitionSlow: 'var(--bs-motion-slow)',
  easeOut: 'var(--bs-motion-ease-out)',
  easeInOut: 'var(--bs-motion-ease-in-out)',
  // Valeurs numériques (ms) pour les timers JS (auto-dismiss de bandeau, etc.).
  fastMs: 140,
  normalMs: 240,
  slowMs: 360,
} as const;

/**
 * Vrai si l'utilisateur préfère réduire les animations. SSR/tests sans matchMedia → false.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Helper de transition CSS prêt à l'emploi. Renvoie '' si reduced-motion (aucune transition).
 * @example style={{ transition: motionTransition('opacity, transform') }}
 */
export function motionTransition(
  properties = 'opacity, transform',
  speed: 'fast' | 'normal' | 'slow' = 'normal',
): string {
  if (prefersReducedMotion()) return '';
  const duration =
    speed === 'fast' ? MotionTokens.transitionFast
      : speed === 'slow' ? MotionTokens.transitionSlow
        : MotionTokens.transitionNormal;
  return properties
    .split(',')
    .map((p) => `${p.trim()} ${duration} ${MotionTokens.easeOut}`)
    .join(', ');
}
