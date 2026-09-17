// Formatage centralisé prix & médias (cf. rapport 158). Le serveur fait foi sur les montants ;
// on ne fait que formater pour l'affichage (Intl fr-FR).

const PRICE_FMT = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/** Formate un montant € (Number) en chaîne fr-FR. Renvoie '' si absent/NaN. */
export function formatPrice(amount?: number | null): string {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '';
  return PRICE_FMT.format(Number(amount));
}

/** Formate une durée en minutes (ex. 90 → "1 h 30"). Renvoie '' si absent. */
export function formatDuration(minutes?: number | null): string {
  if (!minutes || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} h ${String(m).padStart(2, '0')}`;
  if (h) return `${h} h`;
  return `${m} min`;
}

/**
 * Résout un chemin média backend en URL utilisable.
 * - URL absolue (http/https) → renvoyée telle quelle.
 * - chemin relatif `/uploads/...` → renvoyé tel quel (servi par le proxy same-origin).
 * - vide/absent → null (laisser le placeholder).
 */
export function resolveMediaUrl(path?: string | null): string | null {
  if (!path || typeof path !== 'string') return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
