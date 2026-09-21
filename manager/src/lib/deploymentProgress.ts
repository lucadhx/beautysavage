import type { DeploymentRunSnapshot } from '@/types';

/**
 * ══ LE VERDICT D'UN RUN, ET SA PROGRESSION — une seule autorité ═════════════
 *
 * ── LE DÉFAUT QUE CE MODULE FERME ───────────────────────────────────────────
 *
 * La vue de suivi testait `status === 'success'`. Le moteur n'écrit JAMAIS
 * `success` : son vocabulaire terminal est celui du modèle Mongo —
 * `ok | error | warning | cancelled | interrupted | finalization_failed`.
 *
 * Conséquence : **tout déploiement réussi s'affichait « échoué »**. Le test
 * était prudent dans son intention — n'accepter qu'un succès explicite — et
 * faux dans son vocabulaire. La recette navigateur ne l'a pas vu parce que son
 * faux moteur émettait `success` : le harnais parlait une langue que la
 * production ne parle pas, et validait donc une vue que personne n'aurait pu
 * utiliser.
 *
 * La leçon tient en une ligne : le vocabulaire d'un contrat ne se devine pas,
 * il se lit à la source. Il vit désormais ICI, en un seul endroit, et un test
 * le compare à l'énumération réelle du modèle.
 *
 * ── POURQUOI LE POURCENTAGE VIT AU MÊME ENDROIT ─────────────────────────────
 *
 * Parce qu'il dépend du même verdict. Un run en échec ne doit pas afficher
 * 100 %, et un run réussi ne doit pas afficher 97 % parce qu'une étape
 * facultative a été sautée. Séparer les deux, c'est garantir qu'ils
 * divergeront.
 */

/**
 * LES STATUTS TERMINAUX DE SUCCÈS — et il n'y en a qu'un.
 *
 * `warning` n'en fait PAS partie : un déploiement qui s'achève avec des
 * réserves est monté en ligne, mais l'écran doit le dire.
 */
export const STATUTS_SUCCES = Object.freeze(['ok']);

/** Succès avec réserves : en ligne, mais quelque chose mérite d'être lu. */
export const STATUTS_RESERVE = Object.freeze(['warning']);

/**
 * Le run tourne encore. Aligné sur `STATUTS_ACTIFS` du backend — la source qui
 * décide aussi de `snapshot.active`.
 */
export const STATUTS_ACTIFS = Object.freeze(['running']);

/**
 * Interrompu par la disparition du process qui l'exécutait. Distinct d'un
 * échec : le déploiement n'a pas échoué, il a été *coupé*. Le confondre avec
 * `error` ferait chercher une cause métier là où il n'y en a pas.
 */
export const STATUTS_INTERROMPUS = Object.freeze(['interrupted']);

export type VerdictRun = 'en-cours' | 'succes' | 'reserve' | 'interrompu' | 'echec';

/**
 * Rend le verdict d'un run.
 *
 * On teste l'appartenance au SUCCÈS, jamais à l'échec : la liste des façons
 * d'échouer grandira, celle des façons de réussir non. Un statut inconnu est
 * donc traité comme un non-succès — le sens prudent.
 */
export function verdictDeRun(snapshot: Pick<DeploymentRunSnapshot, 'status' | 'active'> | null): VerdictRun {
  if (!snapshot) return 'en-cours';
  const s = String(snapshot.status ?? '');
  if (snapshot.active || STATUTS_ACTIFS.includes(s)) return 'en-cours';
  if (STATUTS_SUCCES.includes(s)) return 'succes';
  if (STATUTS_RESERVE.includes(s)) return 'reserve';
  if (STATUTS_INTERROMPUS.includes(s)) return 'interrompu';
  return 'echec';
}

export function estTermine(snapshot: Pick<DeploymentRunSnapshot, 'status' | 'active'> | null): boolean {
  return verdictDeRun(snapshot) !== 'en-cours';
}

/** L'état visuel de la roue, dérivé du verdict — jamais calculé deux fois. */
export function etatAnneau(verdict: VerdictRun): 'running' | 'ok' | 'error' {
  if (verdict === 'succes' || verdict === 'reserve') return 'ok';
  if (verdict === 'en-cours') return 'running';
  return 'error';
}

/** Étapes considérées comme achevées, du point de vue de la progression. */
const ETAPES_ACHEVEES = new Set(['ok', 'warning', 'skipped']);

export interface Progression {
  /** 0..1 — ce que la roue dessine. */
  valeur: number;
  /** 0..100 entier — ce que l'utilisateur lit. */
  pourcentage: number;
  /** Étapes achevées / total attendu, pour l'affichage secondaire. */
  achevees: number;
  total: number;
}

/**
 * CALCULE LA PROGRESSION À PARTIR DU SEUL INSTANTANÉ PERSISTANT.
 *
 * ── CE QUE CETTE FONCTION N'EST PAS ─────────────────────────────────────────
 *
 * Ce n'est pas une horloge. L'ancienne UX avait ce défaut : une barre qui
 * avançait avec le temps rassurait pendant une panne, puis restait à 90 %
 * pendant dix minutes. Ici, la valeur ne bouge QUE si le backend a écrit une
 * étape — donc jamais pendant une indisponibilité, ce qui est exactement le
 * comportement voulu (§19 : le pourcentage reste au dernier état prouvé).
 *
 * ── POURQUOI LE TOTAL VIENT DU CONTRAT ──────────────────────────────────────
 *
 * Le run ne porte que les étapes ATTEINTES. Diviser par ce nombre donnerait
 * 100 % dès la première étape — une progression qui commence pleine puis
 * redescend. Le dénominateur doit donc venir du contrat d'étapes attendu.
 *
 * @param snapshot  l'instantané persistant (source de vérité)
 * @param idsAttendus  les identifiants d'étapes du contrat, dans l'ordre
 */
export function progressionDeRun(
  snapshot: DeploymentRunSnapshot | null,
  idsAttendus: readonly string[],
): Progression {
  const verdict = verdictDeRun(snapshot);

  const etats = new Map((snapshot?.steps ?? []).map((s) => [s.id, String(s.status ?? 'pending')]));
  const total = idsAttendus.length || etats.size;
  const achevees = idsAttendus.length
    ? idsAttendus.filter((id) => ETAPES_ACHEVEES.has(etats.get(id) ?? 'pending')).length
    : [...etats.values()].filter((s) => ETAPES_ACHEVEES.has(s)).length;

  /**
   * 100 % N'EST ATTEINT QUE PAR UN SUCCÈS RÉEL.
   *
   * Un run peut voir toutes ses étapes marquées `ok` et finir en
   * `finalization_failed` : les fichiers sont partis, la destination n'a jamais
   * atteint son état final. Afficher 100 % là serait le mensonge le plus cher
   * du parcours — celui qui fait fermer l'écran en croyant le site en ligne.
   */
  if (verdict === 'succes' || verdict === 'reserve') {
    return { valeur: 1, pourcentage: 100, achevees: total, total };
  }

  const brut = total > 0 ? achevees / total : 0;
  /* Un run terminé sans succès reste à sa DERNIÈRE progression prouvée. */
  const valeur = Math.max(0, Math.min(1, brut));
  /*
   * `floor`, jamais `round` : arrondir 99,6 % à 100 % afficherait un plein
   * sur un run qui n'a pas fini. Le seul 100 % possible est celui du succès.
   */
  const pourcentage = Math.min(99, Math.floor(valeur * 100));

  return { valeur, pourcentage, achevees, total };
}

/**
 * L'étape à NOMMER sous la roue : celle qui tourne, sinon la dernière atteinte.
 *
 * Un écran qui n'affiche que « en cours » sans dire de quoi laisse l'opérateur
 * sans prise pendant les étapes longues — et l'installation des dépendances est
 * précisément l'une d'elles.
 */
export function etapeCourante(
  snapshot: DeploymentRunSnapshot | null,
): { id: string; label: string } | null {
  const steps = snapshot?.steps ?? [];
  const enCours = steps.find((s) => s.status === 'running');
  const cible = enCours ?? [...steps].reverse().find((s) => s.status !== 'pending');
  if (!cible) return null;
  return { id: cible.id, label: cible.label ?? cible.id };
}

export default { verdictDeRun, progressionDeRun, etapeCourante, etatAnneau, estTermine };
