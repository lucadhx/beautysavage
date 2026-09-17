// M7 — Utilitaire couleur (hex de repli hors .tsx pour le color-picker des catégories).
const FALLBACK_HEX = '#3b82f6';
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Valeur sûre pour un <input type="color"> (hex 7 car. obligatoire). */
export function toHexValue(value: string): string {
  return HEX_RE.test(String(value || '').trim()) ? String(value).trim() : FALLBACK_HEX;
}
