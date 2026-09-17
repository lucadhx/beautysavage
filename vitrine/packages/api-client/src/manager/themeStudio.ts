// M5 — Client API Theme Studio (dev-only). 2 thèmes : vitrine + panel.
// Mapping produit↔backend : uiScope 'panel' ↔ backend scope 'manager' ; 'vitrine' ↔ 'vitrine'.
// CRUD via /api/gestion/themes (dev-only) ; actif via /api/theme/:scope (public). Aucun secret.
import { apiGet, apiPost, apiFetch } from '../apiFetch';

export type ThemeScope = 'vitrine' | 'panel';
export type BackendThemeScope = 'vitrine' | 'manager';

export interface ThemeColors {
  primary: string;
  secondary: string;
  background: string;
  surface: string;
  text: string;
}
export interface ThemeDerivedTokens {
  surfaceHeader?: string;
  accent?: string;
  accentStrong?: string;
}
export interface ThemeTypography {
  fontFamily?: string;
}
export interface ThemeSpacing {
  x1?: string;
  x2?: string;
  x3?: string;
  x4?: string;
}
export type ThemeRadius = string;
export type ThemeShadow = string;

export interface ThemeStudioTheme {
  id: string;
  name: string;
  scope: ThemeScope; // déjà mappé en vocabulaire produit
  colors: ThemeColors;
  derivedTokens: ThemeDerivedTokens;
  typography?: ThemeTypography;
  radius?: ThemeRadius;
  shadow?: ThemeShadow;
  spacing?: ThemeSpacing;
  logoUrl: string;
  slogan: string;
  isActive: boolean;
  createdAt: string | null;
}

export interface ThemeDraftInput {
  name?: string;
  scope?: ThemeScope;
  colors?: Partial<ThemeColors>;
  derivedTokens?: ThemeDerivedTokens;
  typography?: ThemeTypography;
  radius?: ThemeRadius;
  shadow?: ThemeShadow;
  spacing?: ThemeSpacing;
  logoUrl?: string;
  slogan?: string;
}

export function toBackendScope(scope: ThemeScope): BackendThemeScope {
  return scope === 'panel' ? 'manager' : 'vitrine';
}
export function toUiScope(scope: string | undefined): ThemeScope {
  return scope === 'manager' ? 'panel' : 'vitrine';
}

interface RawTheme {
  id?: string;
  _id?: string;
  name?: string;
  scope?: string;
  colors?: Partial<ThemeColors>;
  derivedTokens?: ThemeDerivedTokens;
  typography?: ThemeTypography;
  radius?: string;
  shadow?: string;
  spacing?: ThemeSpacing;
  logoUrl?: string;
  slogan?: string;
  isActive?: boolean;
  createdAt?: string | null;
}

function mapTheme(raw: RawTheme): ThemeStudioTheme {
  return {
    id: String(raw.id ?? raw._id ?? ''),
    name: raw.name ?? '',
    scope: toUiScope(raw.scope),
    colors: {
      primary: raw.colors?.primary ?? '',
      secondary: raw.colors?.secondary ?? '',
      background: raw.colors?.background ?? '',
      surface: raw.colors?.surface ?? '',
      text: raw.colors?.text ?? '',
    },
    derivedTokens: raw.derivedTokens ?? {},
    typography: raw.typography,
    radius: raw.radius,
    shadow: raw.shadow,
    spacing: raw.spacing,
    logoUrl: raw.logoUrl ?? '',
    slogan: raw.slogan ?? '',
    isActive: Boolean(raw.isActive),
    createdAt: raw.createdAt ?? null,
  };
}

function draftToBody(input: ThemeDraftInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.scope !== undefined) body.scope = toBackendScope(input.scope);
  if (input.colors !== undefined) body.colors = input.colors;
  if (input.derivedTokens !== undefined) body.derivedTokens = input.derivedTokens;
  if (input.typography !== undefined) body.typography = input.typography;
  if (input.radius !== undefined) body.radius = input.radius;
  if (input.shadow !== undefined) body.shadow = input.shadow;
  if (input.spacing !== undefined) body.spacing = input.spacing;
  if (input.logoUrl !== undefined) body.logoUrl = input.logoUrl;
  if (input.slogan !== undefined) body.slogan = input.slogan;
  return body;
}

const CRUD_BASE = '/api/gestion/themes';

export async function listThemes(scope?: ThemeScope): Promise<ThemeStudioTheme[]> {
  const params = scope ? { scope: toBackendScope(scope) } : undefined;
  const res = await apiGet<{ ok: boolean; themes: RawTheme[] }>(CRUD_BASE, params);
  return (res.themes ?? []).map(mapTheme);
}

export async function getActiveTheme(scope: ThemeScope): Promise<ThemeStudioTheme | null> {
  const res = await apiGet<{ ok: boolean; scope?: string; theme?: RawTheme | null }>(
    `/api/theme/${encodeURIComponent(toBackendScope(scope))}`,
  );
  return res.theme ? mapTheme(res.theme) : null;
}

export async function createTheme(input: ThemeDraftInput): Promise<ThemeStudioTheme> {
  const res = await apiPost<{ ok: boolean; theme: RawTheme }>(CRUD_BASE, draftToBody(input));
  return mapTheme(res.theme);
}

export async function updateTheme(id: string, input: ThemeDraftInput): Promise<ThemeStudioTheme> {
  const res = await apiFetch<{ ok: boolean; theme: RawTheme }>(`${CRUD_BASE}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: draftToBody(input),
  });
  return mapTheme(res.theme);
}

export async function activateTheme(id: string): Promise<ThemeStudioTheme> {
  const res = await apiPost<{ ok: boolean; theme: RawTheme }>(`${CRUD_BASE}/${encodeURIComponent(id)}/activate`);
  return mapTheme(res.theme);
}
