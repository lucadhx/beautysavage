/**
 * Machine à états de l'enregistrement — module PUR (aucun React, aucun DOM),
 * donc testable directement sous Node.
 *
 * La règle que tout le reste sert : l'utilisateur ne doit JAMAIS se demander si
 * son travail est enregistré. Autrement dit « ✓ Enregistré » ne doit pas
 * pouvoir s'afficher sur un formulaire modifié — c'est le seul mensonge que ce
 * composant peut commettre, et la raison d'être de ce module.
 */

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved';

/** Phase interne : ce que le CODE fait, par opposition à ce que l'écran dit. */
export type SavePhase = 'resting' | 'saving' | 'saved';

/** Durée d'affichage de la validation avant retour au repos. */
export const SAVED_DECAY_MS = 2200;

/** Représentation comparable d'une valeur. `null` = pas encore chargée. */
export function snapshot(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

/**
 * Égalité par défaut : comparaison structurelle par sérialisation.
 *
 * Sensible à l'ORDRE des clés et des tableaux. C'est volontaire — un faux
 * « modifié » est bénin (on propose d'enregistrer), un faux « propre » perd du
 * travail. Les appelants dont l'ordre n'est pas signifiant fournissent leur
 * propre comparateur (voir `zonesEqual` pour les zones de signature).
 */
export const defaultEquals = (a: unknown, b: unknown): boolean => snapshot(a) === snapshot(b);

/**
 * Y a-t-il du travail en attente ?
 *
 * Tant que la référence n'est pas posée (ressource en cours de chargement),
 * rien n'est modifié : on ne réclame pas l'enregistrement d'un écran vide.
 */
export function isDirty<T>(
  baseline: T | null,
  current: T | null,
  equals: (a: T, b: T) => boolean = defaultEquals
): boolean {
  if (baseline == null || current == null) return false;
  return !equals(baseline, current);
}

/**
 * Traduit (phase interne + travail en attente) en état affiché.
 *
 * `dirty` PRIME sur `saved` : éditer pendant la fenêtre de validation doit
 * redemander l'enregistrement immédiatement, sans attendre sa disparition.
 * `saving` prime sur tout : une requête en vol interdit d'en lancer une autre.
 */
export function deriveSaveState(phase: SavePhase, dirty: boolean): SaveState {
  if (phase === 'saving') return 'saving';
  if (dirty) return 'dirty';
  if (phase === 'saved') return 'saved';
  return 'idle';
}
