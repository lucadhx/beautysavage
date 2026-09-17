// Mapping tokens → CSS variables `--bs-*` + application sur un élément + fusion de thème.
import type { ThemeTokens, PartialThemeTokens } from './themeTypes';
import { defaultVitrineTheme } from './defaultVitrineTheme';

/**
 * Mapping canonique tokens → CSS variables. Les composants `@bs/ui` lisent EXCLUSIVEMENT ces vars.
 * | token              | CSS variable                |
 * | colors.background  | --bs-color-background        |
 * | colors.surface     | --bs-color-surface           |
 * | colors.surfaceElev | --bs-color-surface-elevated  |
 * | colors.text        | --bs-color-text              |
 * | colors.textMuted   | --bs-color-muted             |
 * | colors.primary     | --bs-color-primary           |
 * | colors.primaryHover| --bs-color-primary-hover     |
 * | colors.secondary   | --bs-color-secondary         |
 * | colors.accent      | --bs-color-accent            |
 * | colors.border      | --bs-color-border            |
 * | colors.success     | --bs-color-success           |
 * | colors.warning     | --bs-color-warning           |
 * | colors.danger      | --bs-color-danger            |
 * | radius             | --bs-radius                  |
 * | shadow             | --bs-shadow                  |
 * | font               | --bs-font-sans               |
 * | spacing.x1..x4     | --bs-space-1..4              |
 */
export function themeToCssVars(tokens: ThemeTokens): Record<string, string> {
  const c = tokens.colors;
  return {
    '--bs-color-background': c.background,
    '--bs-color-surface': c.surface,
    '--bs-color-surface-elevated': c.surfaceElevated,
    '--bs-color-text': c.text,
    '--bs-color-muted': c.textMuted,
    '--bs-color-primary': c.primary,
    '--bs-color-primary-hover': c.primaryHover,
    '--bs-color-secondary': c.secondary,
    '--bs-color-accent': c.accent,
    '--bs-color-border': c.border,
    '--bs-color-success': c.success,
    '--bs-color-warning': c.warning,
    '--bs-color-danger': c.danger,
    '--bs-radius': tokens.radius,
    '--bs-shadow': tokens.shadow,
    '--bs-font-sans': tokens.font,
    '--bs-space-1': tokens.spacing.x1,
    '--bs-space-2': tokens.spacing.x2,
    '--bs-space-3': tokens.spacing.x3,
    '--bs-space-4': tokens.spacing.x4,
  };
}

/** Applique les CSS variables d'un thème sur un élément (défaut : <html>). */
export function applyThemeVars(tokens: ThemeTokens, el?: HTMLElement | null): void {
  const target = el ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!target) return;
  const vars = themeToCssVars(tokens);
  for (const [name, value] of Object.entries(vars)) {
    target.style.setProperty(name, value);
  }
}

/** Fusionne une surcharge partielle (ex. backend) sur un thème de base. */
export function mergeTheme(base: ThemeTokens, override?: PartialThemeTokens | null): ThemeTokens {
  if (!override) return base;
  return {
    colors: { ...base.colors, ...(override.colors ?? {}) },
    radius: override.radius ?? base.radius,
    shadow: override.shadow ?? base.shadow,
    font: override.font ?? base.font,
    spacing: { ...base.spacing, ...(override.spacing ?? {}) },
  };
}

/** Normalise une chaîne couleur hex (#abc / #aabbcc) ; renvoie undefined si invalide. */
export function normalizeHex(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : undefined;
}

export { defaultVitrineTheme };
