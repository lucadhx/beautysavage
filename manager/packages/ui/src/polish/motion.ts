// Sprint P1 — Motion presets (extension de la Motion Guideline M9).
// Source unique des durées/easings/presets d'animation. Tout est dérivé des tokens CSS `--bs-motion-*`
// (voir tokens.css) et neutralisé par `prefers-reduced-motion` (reset global tokens.css + helpers ici).
import { MotionTokens, prefersReducedMotion } from '../motion';

/** Durées (ms) — alignées sur les tokens CSS. `shimmer` = boucle de skeleton. */
export const Durations = {
  fast: MotionTokens.fastMs, // 140
  normal: MotionTokens.normalMs, // 240
  slow: MotionTokens.slowMs, // 360
  shimmer: 1200,
} as const;

/** Courbes d'easing. `spring` = léger dépassement (success/badge pop). */
export const Easings = {
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  spring: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
} as const;

/**
 * Presets d'animation = noms de classes CSS (définies dans polish.css via @keyframes).
 * Usage : `<div className={motionPreset('entrance')}>`. Renvoie '' si reduced-motion.
 */
export const MOTION_PRESET_CLASS = {
  entrance: 'bs-anim-entrance',
  exit: 'bs-anim-exit',
  drawer: 'bs-anim-sheet', // bottom-sheet mobile ; desktop = bs-anim-slide via CSS responsive
  drawerSlide: 'bs-anim-slide',
  dialog: 'bs-anim-dialog',
  accordion: 'bs-anim-accordion',
  hover: 'bs-anim-hover',
  press: 'bs-anim-press',
  loading: 'bs-skeleton',
  success: 'bs-anim-pop',
  error: 'bs-anim-shake',
  toast: 'bs-anim-toast',
  notification: 'bs-anim-notif',
  badge: 'bs-anim-badge-pop',
} as const;

export type MotionPresetName = keyof typeof MOTION_PRESET_CLASS;

/** Classe d'animation du preset, ou '' si l'utilisateur préfère réduire les animations. */
export function motionPreset(name: MotionPresetName): string {
  if (prefersReducedMotion()) return '';
  return MOTION_PRESET_CLASS[name];
}

/**
 * Transition CSS prête à l'emploi pour les micro-interactions (hover/press/focus).
 * Renvoie '' si reduced-motion.
 */
export function microTransition(
  properties = 'opacity, transform, background-color, border-color',
  speed: 'fast' | 'normal' | 'slow' = 'fast',
): string {
  if (prefersReducedMotion()) return '';
  const duration =
    speed === 'slow' ? MotionTokens.transitionSlow : speed === 'normal' ? MotionTokens.transitionNormal : MotionTokens.transitionFast;
  return properties
    .split(',')
    .map((p) => `${p.trim()} ${duration} ${MotionTokens.easeOut}`)
    .join(', ');
}

export default { Durations, Easings, MOTION_PRESET_CLASS, motionPreset, microTransition };
