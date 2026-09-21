import type { ActivationStep, ContractStatus } from '@/types';

/**
 * Parcours d'activation vu comme une SUITE D'ÉCRANS — module PUR (aucun React,
 * aucun DOM), donc testable directement sous Node.
 *
 * L'étape courante reste dérivée par le backend (`contract.step`,
 * `deriveActivationStep`) : ce module ne décide de RIEN sur le fond. Il ne fait
 * que traduire cette étape en position dans le parcours, et détecter qu'on
 * vient d'en franchir une — de quoi jouer la bonne animation.
 */

/** Ordre des écrans. `DONE` n'en est pas un : le site est actif, on sort du parcours. */
export const JOURNEY_ORDER: ActivationStep[] = ['SIGNATURE', 'LAUNCH_FEE', 'SUBSCRIPTION', 'ACTIVATION'];

/** Parcours RÉEL d'un contrat : sans signature requise, l'étape n'existe pas. */
export function journeyOrderFor(contract?: { signatureApplicable?: boolean } | null): ActivationStep[] {
  return contract?.signatureApplicable === false
    ? JOURNEY_ORDER.filter((s) => s !== 'SIGNATURE')
    : JOURNEY_ORDER;
}

/** Position (1-based) de l'étape dans le parcours, 0 si hors parcours. */
export function stepPosition(step: ActivationStep, contract?: { signatureApplicable?: boolean } | null): number {
  return journeyOrderFor(contract).indexOf(step) + 1;
}

/**
 * Vient-on de franchir une étape ?
 *
 * Renvoie l'étape qui vient d'être TERMINÉE, ou `null`. Trois refus explicites :
 *
 * - `prev === null` : premier rendu. Arriver sur la page ne franchit rien —
 *   sinon toute ouverture de « Mon contrat » fêterait une étape déjà passée.
 * - recul (`SUBSCRIPTION` -> `SIGNATURE`) : un webhook tardif ou une signature
 *   invalidée peut faire reculer l'étape. On ne fête pas une régression.
 * - étape inconnue : on ne fête que ce qu'on sait nommer.
 */
export function completedStep(prev: ActivationStep | null, next: ActivationStep): ActivationStep | null {
  if (prev === null || prev === next) return null;

  const from = JOURNEY_ORDER.indexOf(prev);
  if (from === -1) return null;

  // `DONE` est hors parcours mais marque bien la fin : on fête l'étape quittée.
  const to = next === 'DONE' ? JOURNEY_ORDER.length : JOURNEY_ORDER.indexOf(next);
  if (to === -1) return null;

  return to > from ? prev : null;
}

/** Le parcours est-il terminé (site actif) ? */
export function isJourneyDone(step: ActivationStep): boolean {
  return step === 'DONE';
}

/**
 * Statuts dont plus RIEN ne bougera tout seul.
 *
 * `CANCEL_AT_PERIOD_END` en fait partie : le site reste actif jusqu'à
 * l'échéance, mais c'est un travail d'horloge côté serveur — rien n'arrivera
 * dans les secondes qui suivent. `FAILED` aussi : il attend une action humaine
 * (relance par le DEV), pas une notification.
 *
 * Attention au piège : `deriveActivationStep` ne renvoie `DONE` que si le
 * statut vaut exactement `ACTIVE`. Un contrat résilié rend donc `ACTIVATION`,
 * et se fier à la seule étape ferait sonder indéfiniment.
 */
const SETTLED_STATUS: ContractStatus[] = ['ACTIVE', 'CANCEL_AT_PERIOD_END', 'ENDED', 'CANCELLED', 'FAILED'];

/**
 * Faut-il continuer à interroger le serveur ?
 *
 * On ne sonde QUE si une notification externe (webhook paiement/signature) peut
 * encore faire avancer le contrat. Un écran qui sonde sans rien attendre est un
 * coût invisible : personne ne le voit, et il ne s'arrête jamais.
 */
export function shouldPoll(status: ContractStatus | null | undefined, step: ActivationStep | null | undefined): boolean {
  if (!status) return false;
  if (SETTLED_STATUS.includes(status)) return false;
  return step !== 'DONE';
}
