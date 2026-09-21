/**
 * Durée d'une prestation — module PUR (aucun React, aucun DOM), testable sous
 * Node.
 *
 * L'unité de stockage est la MINUTE (entier). Une durée est FACULTATIVE :
 * `null` / `undefined` / `0` signifient « non renseignée » et ne doivent jamais
 * s'afficher. Toute la logique de ce module tient à cette règle — d'où
 * `formatDuration` qui rend `''` plutôt que « 0 min ».
 *
 * `formatDuration` est dupliqué à l'identique dans `vitrine/src/lib/utils.ts`,
 * comme `formatPrice` : les deux applications ne partagent pas de paquet.
 */

/** Une durée est-elle renseignée ? Seul point de vérité pour l'affichage. */
export function hasDuration(minutes?: number | null): boolean {
  return typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0;
}

/**
 * Rend une durée lisible : « 45 min », « 1h », « 2h30 ».
 *
 * Les minutes sont complétées à deux chiffres derrière les heures (« 1h05 ») :
 * « 1h5 » se lirait comme cinquante minutes.
 * Rend `''` si la durée n'est pas renseignée — l'appelant n'affiche rien.
 */
export function formatDuration(minutes?: number | null): string {
  if (!hasDuration(minutes)) return '';
  const total = Math.round(minutes as number);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

/** Découpe une durée en heures / minutes pour l'édition. */
export function splitDuration(minutes?: number | null): { hours: number | null; mins: number | null } {
  if (!hasDuration(minutes)) return { hours: null, mins: null };
  const total = Math.round(minutes as number);
  return { hours: Math.floor(total / 60), mins: total % 60 };
}

/**
 * Recompose une durée depuis les deux champs d'édition.
 *
 * Les deux champs vides -> `null` (« non renseignée »), et non `0` : c'est ce
 * qui permet d'effacer une durée. `0h 0min` rend donc aussi `null` — une
 * prestation de zéro minute n'a pas de sens, et l'utilisateur qui remet tout à
 * zéro veut manifestement retirer la durée.
 */
export function joinDuration(hours: number | null, mins: number | null): number | null {
  const total = (hours ?? 0) * 60 + (mins ?? 0);
  return total > 0 ? total : null;
}

/**
 * Lit un champ numérique de saisie.
 *
 * Champ vide -> `null` (distinct de `0`, qu'on doit pouvoir taper pour écrire
 * « 2h00 »). Les valeurs négatives ou aberrantes sont ramenées dans les bornes
 * plutôt que rejetées : on ne bloque pas la frappe, on la corrige.
 */
export function parseDurationPart(raw: string, max: number): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(max, n));
}

/** Borne haute des minutes (au-delà, ce sont des heures). */
export const MAX_MINUTES_PART = 59;
/** Borne haute des heures — une prestation d'atelier ne dépasse pas la journée. */
export const MAX_HOURS_PART = 23;
