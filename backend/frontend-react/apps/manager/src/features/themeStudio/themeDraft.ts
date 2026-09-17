// M5 — Modèle de brouillon Theme Studio + helpers (hors .tsx pour ne pas y mettre de hex).
import {
  defaultVitrineTheme,
  defaultPanelTheme,
  mergeTheme,
  themeToCssVars,
  mapBackendThemeToTokens,
} from '@bs/ui';
import type { ThemeScope, ThemeStudioTheme, ThemeDraftInput } from '@bs/api-client';

// Repli pour <input type="color"> (qui n'accepte qu'un hex 7 caractères).
const FALLBACK_HEX = '#000000';
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export interface ThemeDraft {
  name: string;
  colors: { primary: string; secondary: string; background: string; surface: string; text: string };
  derivedTokens: { surfaceHeader: string; accent: string; accentStrong: string };
  typography: { fontFamily: string };
  radius: string;
  shadow: string;
  spacing: { x1: string; x2: string; x3: string; x4: string };
  logoUrl: string;
  slogan: string;
}

export function defaultDraft(scope: ThemeScope): ThemeDraft {
  const t = scope === 'panel' ? defaultPanelTheme : defaultVitrineTheme;
  return {
    name: '',
    colors: {
      primary: t.colors.primary,
      secondary: t.colors.secondary,
      background: t.colors.background,
      surface: t.colors.surface,
      text: t.colors.text,
    },
    derivedTokens: { surfaceHeader: '', accent: t.colors.accent, accentStrong: '' },
    typography: { fontFamily: t.font },
    radius: t.radius,
    shadow: t.shadow,
    spacing: { ...t.spacing },
    logoUrl: '',
    slogan: '',
  };
}

export function themeToDraft(theme: ThemeStudioTheme | null, scope: ThemeScope): ThemeDraft {
  const base = defaultDraft(scope);
  if (!theme) return base;
  return {
    name: theme.name || '',
    colors: {
      primary: theme.colors.primary || base.colors.primary,
      secondary: theme.colors.secondary || base.colors.secondary,
      background: theme.colors.background || base.colors.background,
      surface: theme.colors.surface || base.colors.surface,
      text: theme.colors.text || base.colors.text,
    },
    derivedTokens: {
      surfaceHeader: theme.derivedTokens?.surfaceHeader || '',
      accent: theme.derivedTokens?.accent || base.derivedTokens.accent,
      accentStrong: theme.derivedTokens?.accentStrong || '',
    },
    typography: { fontFamily: theme.typography?.fontFamily || base.typography.fontFamily },
    radius: theme.radius || base.radius,
    shadow: theme.shadow || base.shadow,
    spacing: {
      x1: theme.spacing?.x1 || base.spacing.x1,
      x2: theme.spacing?.x2 || base.spacing.x2,
      x3: theme.spacing?.x3 || base.spacing.x3,
      x4: theme.spacing?.x4 || base.spacing.x4,
    },
    logoUrl: theme.logoUrl || '',
    slogan: theme.slogan || '',
  };
}

// Forme attendue par mapBackendThemeToTokens (@bs/ui) pour la preview / le live.
export function draftToBackendInput(draft: ThemeDraft) {
  const derived: Record<string, string> = {};
  if (draft.derivedTokens.surfaceHeader) derived.surfaceHeader = draft.derivedTokens.surfaceHeader;
  if (draft.derivedTokens.accent) derived.accent = draft.derivedTokens.accent;
  if (draft.derivedTokens.accentStrong) derived.accentStrong = draft.derivedTokens.accentStrong;
  return {
    colors: { ...draft.colors },
    derivedTokens: derived,
    typography: { fontFamily: draft.typography.fontFamily },
    radius: draft.radius,
    shadow: draft.shadow,
    spacing: { ...draft.spacing },
  };
}

// Corps pour createTheme/updateTheme (api-client). logo/slogan : vitrine uniquement.
export function draftToSaveInput(draft: ThemeDraft, scope: ThemeScope): ThemeDraftInput {
  const input: ThemeDraftInput = {
    name: draft.name.trim(),
    scope,
    colors: { ...draft.colors },
    derivedTokens: { ...draft.derivedTokens },
    typography: { fontFamily: draft.typography.fontFamily },
    radius: draft.radius,
    shadow: draft.shadow,
    spacing: { ...draft.spacing },
  };
  if (scope === 'vitrine') {
    input.logoUrl = draft.logoUrl;
    input.slogan = draft.slogan;
  }
  return input;
}

// CSS variables --bs-* pour la preview locale (sans toucher au document global).
export function computePreviewVars(draft: ThemeDraft, scope: ThemeScope): Record<string, string> {
  const base = scope === 'panel' ? defaultPanelTheme : defaultVitrineTheme;
  const tokens = mergeTheme(base, mapBackendThemeToTokens(draftToBackendInput(draft)));
  return themeToCssVars(tokens);
}

/** Valeur sûre pour un <input type="color"> (hex 7 car. obligatoire). */
export function toHexValue(value: string): string {
  return HEX_RE.test(value.trim()) ? value.trim() : FALLBACK_HEX;
}
