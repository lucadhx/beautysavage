/**
 * CATALOGUE canonique des polices de la vitrine — allowlist code-first.
 *
 * Le thème ne stocke JAMAIS une valeur CSS libre : uniquement l'`id` d'une
 * entrée de ce catalogue (enum Mongoose). Les fronts en portent un miroir
 * d'affichage (`manager/src/lib/fontCatalog.ts`, `vitrine/src/lib/fontCatalog.ts`) ;
 * ce fichier reste l'AUTORITÉ de validation.
 *
 * Les DÉFAUTS reproduisent exactement le rendu historique de la vitrine
 * (corps Inter, titres Poppins) : un thème existant sans `typography` ne
 * change pas d'apparence.
 */

export const FONT_CATALOG = Object.freeze([
  { id: 'inter', label: 'Inter', cssFamily: "'Inter', system-ui, sans-serif", category: 'sans', previewText: 'Une présence digitale qui n’appartient qu’à vous', availableWeights: [300, 400, 500, 600, 700], source: 'google' },
  { id: 'poppins', label: 'Poppins', cssFamily: "'Poppins', 'Inter', system-ui, sans-serif", category: 'sans', previewText: 'Titre principal de la vitrine', availableWeights: [400, 600, 700, 800], source: 'google' },
  { id: 'montserrat', label: 'Montserrat', cssFamily: "'Montserrat', system-ui, sans-serif", category: 'sans', previewText: 'Titre principal de la vitrine', availableWeights: [400, 600, 700, 800], source: 'google' },
  { id: 'roboto', label: 'Roboto', cssFamily: "'Roboto', system-ui, sans-serif", category: 'sans', previewText: 'Une présence digitale qui n’appartient qu’à vous', availableWeights: [400, 500, 700], source: 'google' },
  { id: 'open-sans', label: 'Open Sans', cssFamily: "'Open Sans', system-ui, sans-serif", category: 'sans', previewText: 'Une présence digitale qui n’appartient qu’à vous', availableWeights: [400, 600, 700], source: 'google' },
  { id: 'lato', label: 'Lato', cssFamily: "'Lato', system-ui, sans-serif", category: 'sans', previewText: 'Une présence digitale qui n’appartient qu’à vous', availableWeights: [400, 700], source: 'google' },
  { id: 'manrope', label: 'Manrope', cssFamily: "'Manrope', system-ui, sans-serif", category: 'sans', previewText: 'Une présence digitale qui n’appartient qu’à vous', availableWeights: [200, 300, 400, 500, 600, 700, 800], source: 'google' },
  { id: 'raleway', label: 'Raleway', cssFamily: "'Raleway', system-ui, sans-serif", category: 'sans', previewText: 'Titre principal de la vitrine', availableWeights: [400, 600, 700, 800], source: 'google' },
  { id: 'oswald', label: 'Oswald', cssFamily: "'Oswald', system-ui, sans-serif", category: 'display', previewText: 'TITRE PRINCIPAL DE LA VITRINE', availableWeights: [400, 500, 600, 700], source: 'google' },
  { id: 'bebas-neue', label: 'Bebas Neue', cssFamily: "'Bebas Neue', 'Oswald', system-ui, sans-serif", category: 'display', previewText: 'TITRE PRINCIPAL DE LA VITRINE', availableWeights: [400], source: 'google' },
  { id: 'playfair-display', label: 'Playfair Display', cssFamily: "'Playfair Display', Georgia, serif", category: 'serif', previewText: 'Titre principal de la vitrine', availableWeights: [400, 600, 700, 800], source: 'google' },
  { id: 'racing-sans-one', label: 'Racing Sans One', cssFamily: "'Racing Sans One', 'Oswald', system-ui, sans-serif", category: 'display', previewText: 'TITRE PRINCIPAL DE LA VITRINE', availableWeights: [400], source: 'google' },
  { id: 'orbitron', label: 'Orbitron', cssFamily: "'Orbitron', system-ui, sans-serif", category: 'display', previewText: 'TITRE PRINCIPAL DE LA VITRINE', availableWeights: [400, 500, 700, 900], source: 'google' },
  { id: 'chakra-petch', label: 'Chakra Petch', cssFamily: "'Chakra Petch', system-ui, sans-serif", category: 'display', previewText: 'Titre principal de la vitrine', availableWeights: [400, 500, 600, 700], source: 'google' },
  { id: 'rajdhani', label: 'Rajdhani', cssFamily: "'Rajdhani', system-ui, sans-serif", category: 'display', previewText: 'Titre principal de la vitrine', availableWeights: [400, 500, 600, 700], source: 'google' },
  { id: 'teko', label: 'Teko', cssFamily: "'Teko', 'Oswald', system-ui, sans-serif", category: 'display', previewText: 'TITRE PRINCIPAL DE LA VITRINE', availableWeights: [400, 500, 600, 700], source: 'google' },
  { id: 'saira-condensed', label: 'Saira Condensed', cssFamily: "'Saira Condensed', system-ui, sans-serif", category: 'sans', previewText: 'Une présence digitale qui n’appartient qu’à vous', availableWeights: [400, 500, 600, 700], source: 'google' },
  { id: 'system', label: 'Police système', cssFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", category: 'system', previewText: 'Une présence digitale qui n’appartient qu’à vous', availableWeights: [400, 600, 700], source: 'system' },
]);

export const FONT_IDS = Object.freeze(FONT_CATALOG.map((f) => f.id));

/** Défauts = rendu historique exact de la vitrine. */
export const DEFAULT_TYPOGRAPHY = Object.freeze({ headingFont: 'poppins', bodyFont: 'inter' });

export function fontById(id) {
  return FONT_CATALOG.find((f) => f.id === id) || null;
}

export default { FONT_CATALOG, FONT_IDS, DEFAULT_TYPOGRAPHY, fontById };
