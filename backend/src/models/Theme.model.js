import mongoose from 'mongoose';
import { FONT_IDS, DEFAULT_TYPOGRAPHY } from '../utils/fontCatalog.js';

/**
 * Vitrine theme, editable by the ADMIN.
 *
 * Palette RÉDUITE : seulement 4 couleurs de base. Toutes les autres nuances
 * (secondaire, atténué, bordures, contrastes) sont DÉRIVÉES côté vitrine via
 * `color-mix` en CSS — aucune couleur codée en dur dans les composants.
 *
 * Défaut : thème sombre noir / bleu / blanc (adapté à un logo blanc & bleu
 * sur fond noir).
 */
const themeSchema = new mongoose.Schema(
  {
    /**
     * LA PALETTE PAR DÉFAUT DE L.Y SOLUTION — noir, gris profond, blanc.
     *
     * ══ POURQUOI L'ACCENT N'EST PAS UNE COULEUR ═══════════════════════════
     *
     * Le moteur d'origine partait sur un bleu, et c'était juste pour un
     * commerce : une marque a besoin d'être reconnue de loin. Ici, la marque
     * EST la retenue. Le plan de site le dit en toutes lettres — « noir et
     * gris profond, typographie forte, lignes fines, beaucoup d'espace ».
     *
     * `primary` est donc un blanc cassé : un bouton s'affiche en aplat clair
     * sur le noir, et son libellé se peint en sombre — CALCULÉ, jamais
     * supposé blanc (voir `lib/theme.ts`). `accent` est un gris froid : il
     * sert les filets et les détails d'interface, pas à crier.
     *
     * Les quatre restent pilotables depuis le Manager. Ce sont des défauts,
     * pas une identité gravée : un projet neuf doit simplement naître juste.
     */
    colors: {
      background: { type: String, default: '#ffffff' },
      foreground: { type: String, default: '#111111' },
      primary: { type: String, default: '#111111' },
      accent: { type: String, default: '#c7a98a' },
      menuBackground: { type: String, default: '#050505' },
      menuForeground: { type: String, default: '#ffffff' },
    },
    /**
     * DES ANGLES PRESQUE DROITS — 0,85 rem arrondissait tout, et un site qui
     * revendique la précision ne peut pas être fait de galets.
     */
    radius: { type: String, default: '0.25rem' },
    /**
     * Typographie de la vitrine — IDS du catalogue canonique UNIQUEMENT
     * (utils/fontCatalog.js, allowlist par enum : jamais une famille CSS libre
     * injectée dans le DOM). Défauts = rendu historique (Poppins/Inter) : les
     * thèmes antérieurs sans ce bloc ne changent pas d'apparence.
     */
    typography: {
      headingFont: { type: String, enum: FONT_IDS, default: 'manrope' },
      bodyFont: { type: String, enum: FONT_IDS, default: DEFAULT_TYPOGRAPHY.bodyFont },
    },
  },
  { timestamps: true }
);

export const Theme = mongoose.model('Theme', themeSchema);
export default Theme;
