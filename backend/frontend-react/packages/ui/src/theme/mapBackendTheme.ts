// Mappe un thème backend (couleurs simples + tokens dérivés) vers une surcharge partielle de tokens.
// Entrée STRUCTURELLE (pas de dépendance à @bs/api-client) → réutilisable vitrine ET manager.
import type { PartialThemeTokens } from './themeTypes';
import { normalizeHex } from './themeCssVariables';

export interface BackendThemeInput {
  colors?: {
    primary?: string;
    secondary?: string;
    background?: string;
    surface?: string;
    text?: string;
  };
  derivedTokens?: {
    surfaceHeader?: string;
    accent?: string;
    accentStrong?: string;
  };
  // M5 — tokens visuels optionnels additifs (Theme Studio). Ignorés s'ils sont absents.
  typography?: { fontFamily?: string };
  radius?: string;
  shadow?: string;
  spacing?: { x1?: string; x2?: string; x3?: string; x4?: string };
}

/** Couleurs hex normalisées ; primaryHover/accent dérivés en color-mix si absents.
 *  M5 : mappe aussi font/radius/shadow/spacing si fournis (additif). */
export function mapBackendThemeToTokens(input?: BackendThemeInput | null): PartialThemeTokens {
  if (!input) return {};
  const c = input.colors ?? {};
  const d = input.derivedTokens ?? {};
  const colors: NonNullable<PartialThemeTokens['colors']> = {};

  const primary = normalizeHex(c.primary);
  const secondary = normalizeHex(c.secondary);
  if (primary) {
    colors.primary = primary;
    colors.primaryHover = `color-mix(in oklab, ${primary} 82%, black 18%)`;
  }
  if (secondary) colors.secondary = secondary;
  const bg = normalizeHex(c.background);
  if (bg) colors.background = bg;
  const surface = normalizeHex(c.surface);
  if (surface) {
    colors.surface = surface;
    colors.surfaceElevated = surface;
  }
  const text = normalizeHex(c.text);
  if (text) colors.text = text;

  const accent = normalizeHex(d.accent);
  if (accent) colors.accent = accent;
  else if (primary && secondary) colors.accent = `color-mix(in oklab, ${primary} 70%, ${secondary} 30%)`;

  const out: PartialThemeTokens = {};
  if (Object.keys(colors).length) out.colors = colors;

  const font = input.typography?.fontFamily?.trim();
  if (font) out.font = font;
  if (typeof input.radius === 'string' && input.radius.trim()) out.radius = input.radius.trim();
  if (typeof input.shadow === 'string' && input.shadow.trim()) out.shadow = input.shadow.trim();
  if (input.spacing && typeof input.spacing === 'object') {
    const sp: NonNullable<PartialThemeTokens['spacing']> = {};
    for (const k of ['x1', 'x2', 'x3', 'x4'] as const) {
      const v = input.spacing[k];
      if (typeof v === 'string' && v.trim()) sp[k] = v.trim();
    }
    if (Object.keys(sp).length) out.spacing = sp;
  }

  return out;
}
