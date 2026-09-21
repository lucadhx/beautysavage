/**
 * Miroir MANAGER du catalogue canonique de polices
 * (`backend/src/utils/fontCatalog.js` — l'autorité de validation reste le
 * backend, enum Mongoose). Module PUR, testé.
 */

export interface CatalogFont {
  id: string;
  label: string;
  cssFamily: string;
  category: 'sans' | 'display' | 'serif' | 'system';
  previewText: string;
  googleFamily?: string;
  weights: number[];
}

export const FONT_CATALOG: CatalogFont[] = [
  { id: 'inter', label: 'Inter', cssFamily: "'Inter', system-ui, sans-serif", category: 'sans', previewText: 'Une présence digitale qui n’appartient qu’à vous', googleFamily: 'Inter', weights: [300, 400, 500, 600, 700] },
  { id: 'poppins', label: 'Poppins', cssFamily: "'Poppins', 'Inter', system-ui, sans-serif", category: 'sans', previewText: 'Titre principal de la vitrine', googleFamily: 'Poppins', weights: [400, 600, 700, 800] },
  { id: 'montserrat', label: 'Montserrat', cssFamily: "'Montserrat', system-ui, sans-serif", category: 'sans', previewText: 'Titre principal de la vitrine', googleFamily: 'Montserrat', weights: [400, 600, 700, 800] },
  { id: 'roboto', label: 'Roboto', cssFamily: "'Roboto', system-ui, sans-serif", category: 'sans', previewText: 'Une présence digitale qui n’appartient qu’à vous', googleFamily: 'Roboto', weights: [400, 500, 700] },
  { id: 'open-sans', label: 'Open Sans', cssFamily: "'Open Sans', system-ui, sans-serif", category: 'sans', previewText: 'Une présence digitale qui n’appartient qu’à vous', googleFamily: 'Open Sans', weights: [400, 600, 700] },
  { id: 'lato', label: 'Lato', cssFamily: "'Lato', system-ui, sans-serif", category: 'sans', previewText: 'Une présence digitale qui n’appartient qu’à vous', googleFamily: 'Lato', weights: [400, 700] },
  { id: 'manrope', label: 'Manrope', cssFamily: "'Manrope', system-ui, sans-serif", category: 'sans', previewText: 'Une présence digitale qui n’appartient qu’à vous', googleFamily: 'Manrope', weights: [200, 300, 400, 500, 600, 700, 800] },
  { id: 'raleway', label: 'Raleway', cssFamily: "'Raleway', system-ui, sans-serif", category: 'sans', previewText: 'Titre principal de la vitrine', googleFamily: 'Raleway', weights: [400, 600, 700, 800] },
  { id: 'oswald', label: 'Oswald', cssFamily: "'Oswald', system-ui, sans-serif", category: 'display', previewText: 'TITRE PRINCIPAL DE LA VITRINE', googleFamily: 'Oswald', weights: [400, 500, 600, 700] },
  { id: 'bebas-neue', label: 'Bebas Neue', cssFamily: "'Bebas Neue', 'Oswald', system-ui, sans-serif", category: 'display', previewText: 'TITRE PRINCIPAL DE LA VITRINE', googleFamily: 'Bebas Neue', weights: [400] },
  { id: 'playfair-display', label: 'Playfair Display', cssFamily: "'Playfair Display', Georgia, serif", category: 'serif', previewText: 'Titre principal de la vitrine', googleFamily: 'Playfair Display', weights: [400, 600, 700, 800] },
  { id: 'racing-sans-one', label: 'Racing Sans One', cssFamily: "'Racing Sans One', 'Oswald', system-ui, sans-serif", category: 'display', previewText: 'TITRE PRINCIPAL DE LA VITRINE', googleFamily: 'Racing Sans One', weights: [400] },
  { id: 'orbitron', label: 'Orbitron', cssFamily: "'Orbitron', system-ui, sans-serif", category: 'display', previewText: 'TITRE PRINCIPAL DE LA VITRINE', googleFamily: 'Orbitron', weights: [400, 500, 700, 900] },
  { id: 'chakra-petch', label: 'Chakra Petch', cssFamily: "'Chakra Petch', system-ui, sans-serif", category: 'display', previewText: 'Titre principal de la vitrine', googleFamily: 'Chakra Petch', weights: [400, 500, 600, 700] },
  { id: 'rajdhani', label: 'Rajdhani', cssFamily: "'Rajdhani', system-ui, sans-serif", category: 'display', previewText: 'Titre principal de la vitrine', googleFamily: 'Rajdhani', weights: [400, 500, 600, 700] },
  { id: 'teko', label: 'Teko', cssFamily: "'Teko', 'Oswald', system-ui, sans-serif", category: 'display', previewText: 'TITRE PRINCIPAL DE LA VITRINE', googleFamily: 'Teko', weights: [400, 500, 600, 700] },
  { id: 'saira-condensed', label: 'Saira Condensed', cssFamily: "'Saira Condensed', system-ui, sans-serif", category: 'sans', previewText: 'Une présence digitale qui n’appartient qu’à vous', googleFamily: 'Saira Condensed', weights: [400, 500, 600, 700] },
  { id: 'system', label: 'Police système', cssFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", category: 'system', previewText: 'Une présence digitale qui n’appartient qu’à vous', weights: [400, 600, 700] },
];

export const DEFAULT_TYPOGRAPHY = { headingFont: 'poppins', bodyFont: 'inter' } as const;

export function fontById(id: string | undefined | null): CatalogFont | null {
  return FONT_CATALOG.find((f) => f.id === id) ?? null;
}

/** URL Google Fonts (css2) pour un ensemble d'IDS du catalogue — jamais arbitraire. */
export function googleFontsHref(ids: Array<string | undefined | null>): string | null {
  const fonts = [...new Set(ids.map((id) => fontById(id)).filter((f): f is CatalogFont => Boolean(f?.googleFamily)))];
  if (!fonts.length) return null;
  const parts = fonts.map((f) => `family=${encodeURIComponent(f.googleFamily as string)}:wght@${f.weights.join(';')}`);
  return `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap`;
}

/** Charge (une fois) les polices du catalogue dans le DOCUMENT MANAGER — pour
 *  que le sélecteur affiche chaque police avec sa propre police. */
export function ensureCatalogFontsLoaded(doc: Document = document) {
  const href = googleFontsHref(FONT_CATALOG.map((f) => f.id));
  if (!href) return;
  let link = doc.querySelector<HTMLLinkElement>('link[data-font-catalog]');
  if (!link) {
    link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.setAttribute('data-font-catalog', 'true');
    doc.head.appendChild(link);
  }
  if (link.href !== href) link.href = href;
}
