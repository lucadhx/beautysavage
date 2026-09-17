// Modèle de thème React — deux scopes (vitrine / panel). Source unique des tokens visuels.
// Règle : les composants lisent les CSS variables ; ces types décrivent les valeurs injectées.

export type ThemeScope = 'vitrine' | 'panel';

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceElevated: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryHover: string;
  secondary: string;
  accent: string;
  border: string;
  success: string;
  warning: string;
  danger: string;
}

export interface ThemeSpacing {
  x1: string;
  x2: string;
  x3: string;
  x4: string;
}

export interface ThemeTokens {
  colors: ThemeColors;
  radius: string;
  shadow: string;
  font: string;
  spacing: ThemeSpacing;
}

/** Surcharge partielle (ex. issue du backend) fusionnée sur un thème par défaut. */
export interface PartialThemeTokens {
  colors?: Partial<ThemeColors>;
  radius?: string;
  shadow?: string;
  font?: string;
  spacing?: Partial<ThemeSpacing>;
}

/** Configuration de thème persistable (futur Theme Studio Dev — cf. rapport 161). */
export interface ThemeConfig {
  scope: ThemeScope;
  tokens: ThemeTokens;
}
