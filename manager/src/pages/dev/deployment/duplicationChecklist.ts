import type { DuplicationPhaseContract, DuplicationPhaseEvent, DuplicationPhaseStatus } from '@/types';
import type { StepState } from './ui';

/**
 * LA CHECKLIST DE DUPLICATION — DÉRIVÉE, jamais écrite à la main.
 *
 * ══ CE QUE CE MODULE REMPLACE ═══════════════════════════════════════════════
 *
 * Une constante `DUPLICATION_PHASES` vivait dans `friendly.ts`, côté Manager :
 * elle portait l'ordre, les libellés, l'existence des phases — et les trois
 * sous-projets Node écrits en dur (`dependencies.backend`, `.manager`,
 * `.vitrine`) alors que le moteur les DÉCOUVRE. Le jour où un projet n'a pas de
 * vitrine, l'écran affichait une ligne éternellement en attente sur une
 * duplication parfaitement réussie.
 *
 * Il n'y a plus de liste ici. Il y a une PROJECTION du registre backend
 * (`GET /deployment/duplication/phases`) et une fonction qui la croise avec les
 * événements réellement reçus.
 *
 * ══ LA RÈGLE QUI REND LA DÉRIVE IMPOSSIBLE ══════════════════════════════════
 *
 * Une ligne n'existe que si le CONTRAT la déclare. Un état n'existe que si un
 * ÉVÉNEMENT l'a dit. L'écran ne peut donc afficher ni une étape que le moteur
 * ignore, ni un « terminé » que personne n'a annoncé.
 */

/** Une ligne de la checklist : une phase, éventuellement pour une cible. */
export type ChecklistRow = {
  key: string;
  label: string;
  icon: string;
  state: StepState;
  /** Renseigné pour une instance d'une famille dynamique (`backend`, `manager`…). */
  target?: string;
  reason?: string;
};

/**
 * La clé d'une instance. MÊME convention que le backend (`phaseKey`) : un
 * séparateur `:`, parce qu'une cible est un chemin où le point est légitime.
 */
export const rowKey = (phase: string, target?: string | null) => (target ? `${phase}:${target}` : phase);

/**
 * L'ÉTAT D'UNE PHASE SE LIT DIRECTEMENT DU FIL.
 *
 * Il a existé ici une traduction — `failed` → `error` — parce que le moteur
 * employait deux mots pour un même état. Le vocabulaire est désormais fermé
 * côté moteur : il n'y a plus rien à traduire, et c'est le genre de fonction
 * dont la disparition prouve qu'un contrat a été réellement unifié.
 */
const toStepState = (status: DuplicationPhaseStatus): StepState => status;

/**
 * Construit la checklist affichable.
 *
 * @param contract  la projection du registre canonique (backend).
 * @param events    les événements reçus, dans l'ordre d'arrivée.
 */
export function buildChecklist(
  contract: DuplicationPhaseContract[],
  events: DuplicationPhaseEvent[],
): ChecklistRow[] {
  const ordonne = [...contract].sort((a, b) => a.order - b.order);

  /** Dernier état connu par clé d'instance, et cibles vues par famille. */
  const etats = new Map<string, { status: DuplicationPhaseStatus; reason?: string }>();
  const ciblesParPhase = new Map<string, string[]>();
  for (const evenement of events) {
    const cle = rowKey(evenement.phase, evenement.target);
    etats.set(cle, { status: evenement.status, reason: evenement.reason });
    if (evenement.target) {
      const vues = ciblesParPhase.get(evenement.phase) ?? [];
      if (!vues.includes(evenement.target)) vues.push(evenement.target);
      ciblesParPhase.set(evenement.phase, vues);
    }
  }

  const lignes: ChecklistRow[] = [];
  for (const definition of ordonne) {
    if (definition.id === 'done') continue; // le succès s'affiche par l'écran, pas par une ligne

    if (!definition.dynamic) {
      lignes.push({
        key: definition.id,
        label: definition.label,
        icon: definition.icon,
        state: toStepState(etats.get(definition.id)?.status ?? 'pending'),
        reason: etats.get(definition.id)?.reason,
      });
      continue;
    }

    /**
     * UNE FAMILLE DYNAMIQUE N'A PAS D'INSTANCE TANT QUE RIEN N'EST DÉCOUVERT.
     *
     * On affiche alors UNE ligne d'attente portant le libellé de la famille :
     * l'exploitant voit qu'une étape reste à venir, sans qu'on lui promette un
     * nombre de sous-projets que personne ne connaît encore. Dès le premier
     * événement, elle est remplacée par les instances réelles.
     */
    const cibles = ciblesParPhase.get(definition.id) ?? [];
    if (cibles.length === 0) {
      const global = etats.get(definition.id);
      lignes.push({
        key: definition.id,
        label: definition.label,
        icon: definition.icon,
        state: toStepState(global?.status ?? 'pending'),
        reason: global?.reason,
      });
      continue;
    }
    for (const cible of cibles) {
      const etat = etats.get(rowKey(definition.id, cible));
      lignes.push({
        key: rowKey(definition.id, cible),
        label: `${definition.label} — ${cible}`,
        icon: definition.icon,
        target: cible,
        state: toStepState(etat?.status ?? 'pending'),
        reason: etat?.reason,
      });
    }
  }
  return lignes;
}

export default buildChecklist;
