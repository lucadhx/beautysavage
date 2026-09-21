import {
  CONTRACT_STATUS as S,
  ACTIVATION_STEP,
  PAYMENT_STATUS,
  SUBSCRIPTION_ENTITLED_STATUSES,
  SIGNATURE_STATUS,
  SIGNATURE_STATE,
} from '../utils/contractConstants.js';
import { signatureOf } from './signature/signatureRecord.js';

/**
 * Machine à états du contrat.
 *
 * Transitions AUTORISÉES uniquement. Toute mutation de statut passe par
 * `assertTransition` : on ne « pose » jamais un statut arbitraire.
 *
 * L'étape d'activation courante n'est JAMAIS lue depuis un simple index stocké :
 * elle est DÉRIVÉE des états réels (signature confirmée ? frais payés ?
 * abonnement actif ?) — cf. deriveActivationStep. Un webhook manquant ou un
 * rafraîchissement ne peut donc pas désynchroniser le parcours.
 */

export const ALLOWED_TRANSITIONS = Object.freeze({
  // DRAFT -> INACTIVE : validation d'un contrat SANS signature requise (le
  // parcours saute l'étape signature et va directement au paiement).
  [S.DRAFT]: [S.PENDING_DEV_SIGNATURE, S.INACTIVE, S.CANCELLED],
  [S.PENDING_DEV_SIGNATURE]: [S.INACTIVE, S.CANCELLED, S.FAILED],
  [S.INACTIVE]: [S.ACTIVATION_IN_PROGRESS, S.CANCELLED, S.FAILED],
  [S.ACTIVATION_IN_PROGRESS]: [S.ACTIVE, S.INACTIVE, S.CANCELLED, S.FAILED],
  [S.ACTIVE]: [S.CANCEL_AT_PERIOD_END, S.ENDED],
  [S.CANCEL_AT_PERIOD_END]: [S.ENDED, S.ACTIVE], // ACTIVE = reprise (réactivation avant échéance)
  [S.ENDED]: [], // terminal
  [S.CANCELLED]: [], // terminal
  // Récupération : INACTIVE, ou relance de signature (PENDING_DEV_SIGNATURE).
  [S.FAILED]: [S.INACTIVE, S.PENDING_DEV_SIGNATURE],
});

export function canTransition(from, to) {
  if (from === to) return true; // idempotent (no-op)
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

export class ContractTransitionError extends Error {
  constructor(from, to) {
    super(`Transition de contrat interdite : ${from} -> ${to}`);
    this.name = 'ContractTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) throw new ContractTransitionError(from, to);
  return to;
}

// --- Dérivations d'état -----------------------------------------------------

/**
 * Une signature est-elle requise DANS ce projet pour ce contrat ?
 * Les contrats antérieurs (champ absent) restent REQUIRED — comportement
 * historique inchangé.
 */
export function signatureRequired(contract) {
  return contract?.signatureRequirement !== 'NOT_REQUIRED';
}

/** La signature des deux parties est-elle confirmée (via webhook Yousign) ? */
export function isFullySigned(contract) {
  return (
    signatureOf(contract).status === SIGNATURE_STATUS.DONE ||
    (Boolean(signatureOf(contract).devSignedAt) && Boolean(signatureOf(contract).clientSignedAt))
  );
}

/**
 * L'exigence de signature est-elle SATISFAITE ? C'est CE prédicat que le
 * paiement et l'activation consultent : non requise -> satisfaite d'office
 * (jamais un échec, jamais une étape) ; requise -> preuve cryptographique.
 */
export function signatureSatisfied(contract) {
  return !signatureRequired(contract) || isFullySigned(contract);
}

export function isDevSigned(contract) {
  return Boolean(signatureOf(contract).devSignedAt);
}

export function isAdminSigned(contract) {
  return Boolean(signatureOf(contract).clientSignedAt);
}

/**
 * État de signature DÉRIVÉ (vue métier lisible). Ne modifie
 * rien. NONE si aucune demande ; DECLINED/EXPIRED/CANCELED prioritaires ;
 * FULLY_SIGNED si terminé ; DEV_SIGNED si seul le DEV a signé ; sinon REQUESTED.
 */
export function deriveSignatureState(contract) {
  /**
   * LE BLOC EST LU PAR `signatureOf`, JAMAIS DIRECTEMENT.
   *
   * Un contrat signé avant la bascule porte sa signature dans `yousign`, un
   * contrat récent dans `signature`. Lire l'un des deux en dur ferait afficher
   * « aucune signature » sur la moitié du parc, sans erreur ni journal.
   */
  const y = signatureOf(contract);
  if (!y.requestId) return SIGNATURE_STATE.NONE;
  if (y.status === SIGNATURE_STATUS.DECLINED) return SIGNATURE_STATE.DECLINED;
  if (y.status === SIGNATURE_STATUS.EXPIRED) return SIGNATURE_STATE.EXPIRED;
  if (y.status === SIGNATURE_STATUS.CANCELED) return SIGNATURE_STATE.CANCELED;
  if (isFullySigned(contract)) return SIGNATURE_STATE.FULLY_SIGNED;
  if (y.devSignedAt && !y.clientSignedAt) return SIGNATURE_STATE.DEV_SIGNED;
  return SIGNATURE_STATE.REQUESTED;
}

/** Les frais de lancement sont-ils requis ? */
export function launchFeeRequired(contract) {
  return Boolean(contract?.pricing?.launchFee?.enabled);
}

/** Les frais de lancement sont-ils réglés (ou non requis) ? */
export function launchFeeSatisfied(contract) {
  if (!launchFeeRequired(contract)) return true;
  return contract?.stripe?.launchFee?.status === PAYMENT_STATUS.PAID;
}

/** L'abonnement est-il requis ? */
export function subscriptionRequired(contract) {
  return Boolean(contract?.pricing?.subscription?.enabled);
}

/** L'abonnement confère-t-il l'accès (actif/essai/résilié-en-fin-de-période) ou non requis ? */
export function subscriptionSatisfied(contract) {
  if (!subscriptionRequired(contract)) return true;
  return SUBSCRIPTION_ENTITLED_STATUSES.includes(contract?.stripe?.subscription?.status);
}

/**
 * Étape d'activation courante DÉRIVÉE des états réels. Renvoie la première étape
 * obligatoire non satisfaite ; DONE si tout est prêt (l'ADMIN peut activer).
 * L'ordre : signature (ADMIN) -> frais -> abonnement -> activation.
 */
export function deriveActivationStep(contract) {
  if (!signatureSatisfied(contract)) return ACTIVATION_STEP.SIGNATURE;
  if (!launchFeeSatisfied(contract)) return ACTIVATION_STEP.LAUNCH_FEE;
  if (!subscriptionSatisfied(contract)) return ACTIVATION_STEP.SUBSCRIPTION;
  if (contract?.status === S.ACTIVE) return ACTIVATION_STEP.DONE;
  return ACTIVATION_STEP.ACTIVATION; // tout satisfait, reste le clic « Activer mon site »
}

/**
 * Toutes les conditions d'activation finale sont-elles réunies ? (revérifié
 * côté backend avant de basculer en ACTIVE — jamais sur la seule foi du front.)
 */
export function canActivate(contract) {
  return (
    signatureSatisfied(contract) &&
    launchFeeSatisfied(contract) &&
    subscriptionSatisfied(contract) &&
    [S.INACTIVE, S.ACTIVATION_IN_PROGRESS].includes(contract?.status)
  );
}

export default {
  ALLOWED_TRANSITIONS,
  signatureRequired,
  signatureSatisfied,
  canTransition,
  assertTransition,
  ContractTransitionError,
  deriveActivationStep,
  canActivate,
  isFullySigned,
  isDevSigned,
  isAdminSigned,
  launchFeeRequired,
  launchFeeSatisfied,
  subscriptionRequired,
  subscriptionSatisfied,
};
