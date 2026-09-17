import { mapBackendThemeToTokens, type PartialThemeTokens } from '@bs/ui';
import type { PublicVitrineTheme } from '@bs/api-client';

// Adapte le thème vitrine backend vers une surcharge partielle de tokens (délègue au mapper @bs/ui).
export function mapVitrineThemeToTokens(theme?: PublicVitrineTheme | null): PartialThemeTokens {
  return mapBackendThemeToTokens(theme);
}
