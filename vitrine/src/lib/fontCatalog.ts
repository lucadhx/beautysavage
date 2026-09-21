/**
 * Miroir VITRINE du catalogue canonique de polices
 * (`backend/src/utils/fontCatalog.js` — l'autorité de validation reste le
 * backend : le thème ne transporte que des IDS de ce catalogue, jamais une
 * famille CSS libre).
 */

export interface CatalogFont {
  id: string;
  label: string;
  cssFamily: string;
  /** Nom de famille Google Fonts (absent pour les polices système). */
  googleFamily?: string;
  weights: number[];
}

export const FONT_CATALOG: CatalogFont[] = [
  { id: 'inter', label: 'Inter', cssFamily: "'Inter', system-ui, sans-serif", googleFamily: 'Inter', weights: [300, 400, 500, 600, 700] },
  { id: 'poppins', label: 'Poppins', cssFamily: "'Poppins', 'Inter', system-ui, sans-serif", googleFamily: 'Poppins', weights: [400, 600, 700, 800] },
  { id: 'montserrat', label: 'Montserrat', cssFamily: "'Montserrat', system-ui, sans-serif", googleFamily: 'Montserrat', weights: [400, 600, 700, 800] },
  { id: 'roboto', label: 'Roboto', cssFamily: "'Roboto', system-ui, sans-serif", googleFamily: 'Roboto', weights: [400, 500, 700] },
  { id: 'open-sans', label: 'Open Sans', cssFamily: "'Open Sans', system-ui, sans-serif", googleFamily: 'Open Sans', weights: [400, 600, 700] },
  { id: 'lato', label: 'Lato', cssFamily: "'Lato', system-ui, sans-serif", googleFamily: 'Lato', weights: [400, 700] },
  { id: 'manrope', label: 'Manrope', cssFamily: "'Manrope', system-ui, sans-serif", googleFamily: 'Manrope', weights: [200, 300, 400, 500, 600, 700, 800] },
  { id: 'raleway', label: 'Raleway', cssFamily: "'Raleway', system-ui, sans-serif", googleFamily: 'Raleway', weights: [400, 600, 700, 800] },
  { id: 'oswald', label: 'Oswald', cssFamily: "'Oswald', system-ui, sans-serif", googleFamily: 'Oswald', weights: [400, 500, 600, 700] },
  { id: 'bebas-neue', label: 'Bebas Neue', cssFamily: "'Bebas Neue', 'Oswald', system-ui, sans-serif", googleFamily: 'Bebas Neue', weights: [400] },
  { id: 'playfair-display', label: 'Playfair Display', cssFamily: "'Playfair Display', Georgia, serif", googleFamily: 'Playfair Display', weights: [400, 600, 700, 800] },
  { id: 'racing-sans-one', label: 'Racing Sans One', cssFamily: "'Racing Sans One', 'Oswald', system-ui, sans-serif", googleFamily: 'Racing Sans One', weights: [400] },
  { id: 'orbitron', label: 'Orbitron', cssFamily: "'Orbitron', system-ui, sans-serif", googleFamily: 'Orbitron', weights: [400, 500, 700, 900] },
  { id: 'chakra-petch', label: 'Chakra Petch', cssFamily: "'Chakra Petch', system-ui, sans-serif", googleFamily: 'Chakra Petch', weights: [400, 500, 600, 700] },
  { id: 'rajdhani', label: 'Rajdhani', cssFamily: "'Rajdhani', system-ui, sans-serif", googleFamily: 'Rajdhani', weights: [400, 500, 600, 700] },
  { id: 'teko', label: 'Teko', cssFamily: "'Teko', 'Oswald', system-ui, sans-serif", googleFamily: 'Teko', weights: [400, 500, 600, 700] },
  { id: 'saira-condensed', label: 'Saira Condensed', cssFamily: "'Saira Condensed', system-ui, sans-serif", googleFamily: 'Saira Condensed', weights: [400, 500, 600, 700] },
  { id: 'system', label: 'Police système', cssFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", weights: [400, 600, 700] },
];

export const DEFAULT_TYPOGRAPHY = { headingFont: 'poppins', bodyFont: 'inter' } as const;

export function fontById(id: string | undefined | null): CatalogFont | null {
  return FONT_CATALOG.find((f) => f.id === id) ?? null;
}

/**
 * URL Google Fonts (css2) pour un ensemble d'IDS — uniquement des entrées du
 * catalogue : aucune URL arbitraire ne peut être construite.
 */
export function googleFontsHref(ids: Array<string | undefined | null>): string | null {
  const families = [...new Set(ids.map((id) => fontById(id)).filter((f): f is CatalogFont => Boolean(f?.googleFamily)))];
  if (!families.length) return null;
  const parts = families.map(
    (f) => `family=${encodeURIComponent(f.googleFamily as string)}:wght@${f.weights.join(';')}`
  );
  return `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap`;
}
