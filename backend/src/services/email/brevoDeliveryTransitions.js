/**
 * Machine d'état DÉTERMINISTE : événement Brevo normalisé → livraison.
 *
 * Fonction PURE, sans base de données : elle prend l'état courant et un événement
 * normalisé, et renvoie ce qu'il faut écrire. C'est ce qui la rend testable
 * exhaustivement (ordre, doublons, régressions) sans Mongo.
 *
 * ═══ DEUX INVARIANTS ═════════════════════════════════════════════════════════
 *
 *  1. Un événement REÇU DANS LE DÉSORDRE ne fait jamais régresser la livraison.
 *     `DELIVERED` puis un `SENT` retardé RESTE `DELIVERED`. On ordonne les statuts
 *     par PRÉCÉDENCE ; un événement n'écrase que s'il est strictement plus avancé.
 *
 *  2. Les statuts NÉGATIFS TERMINAUX (hard bounce, blocked, invalid, error) ne
 *     sont pas écrasés par un événement moins informatif arrivé tard.
 *
 * Les ouvertures/clics sont de l'ENGAGEMENT : historisés à part, ils ne changent
 * JAMAIS le statut. Ni preuve de lecture, ni preuve de remise — un traitement
 * automatique suffit à les déclencher (voir le commentaire de la branche).
 */
import { DELIVERY_STATUS } from '../../utils/emailTemplateConstants.js';
import {
  NORMALIZED_EVENT,
  isEngagementEvent,
  isOpenEvent,
  isClickEvent,
} from '../../utils/brevoTransactionalEventRegistry.js';

/**
 * Précédence des statuts de livraison. Un événement n'écrase le statut courant que
 * si le statut cible a une précédence STRICTEMENT supérieure.
 *
 * Ordre : progression normale (PENDING→…→DELIVERED), puis signaux post-livraison
 * (unsubscribe < spam), puis échecs permanents (les plus « forts »). Ainsi
 * `DELIVERED`→`SPAM` passe, mais `HARD_BOUNCED`→`DELIVERED` (tardif) ne passe pas.
 */
export const STATUS_PRECEDENCE = Object.freeze({
  [DELIVERY_STATUS.PENDING]: 0,
  [DELIVERY_STATUS.SENDING]: 1,
  [DELIVERY_STATUS.FAILED]: 1, // échec d'envoi : sans messageId, jamais rapproché
  // Refus interne AVANT tout appel : aucun messageId n'existe, donc aucun webhook
  // ne peut le rapprocher. Précédence faible pour que la reprise, elle, écrase
  // librement cet état dès que la précondition est de nouveau réunie.
  [DELIVERY_STATUS.PRECONDITION_FAILED]: 1,
  [DELIVERY_STATUS.SENT]: 2,
  [DELIVERY_STATUS.DEFERRED]: 3,
  [DELIVERY_STATUS.SOFT_BOUNCED]: 4,
  [DELIVERY_STATUS.DELIVERED]: 5,
  [DELIVERY_STATUS.UNSUBSCRIBED]: 6,
  [DELIVERY_STATUS.SPAM]: 7,
  // Échecs permanents — les plus forts : rien de « moins grave » ne les écrase.
  [DELIVERY_STATUS.BOUNCED]: 8, // legacy umbrella
  [DELIVERY_STATUS.BLOCKED]: 8,
  [DELIVERY_STATUS.INVALID]: 8,
  [DELIVERY_STATUS.HARD_BOUNCED]: 8,
  [DELIVERY_STATUS.ERROR]: 8,
});

/** Événement normalisé → statut de livraison cible (null = pas de changement). */
const EVENT_TO_STATUS = Object.freeze({
  [NORMALIZED_EVENT.ACCEPTED]: DELIVERY_STATUS.SENT,
  [NORMALIZED_EVENT.SENT]: DELIVERY_STATUS.SENT,
  [NORMALIZED_EVENT.DELIVERED]: DELIVERY_STATUS.DELIVERED,
  [NORMALIZED_EVENT.DEFERRED]: DELIVERY_STATUS.DEFERRED,
  [NORMALIZED_EVENT.SOFT_BOUNCE]: DELIVERY_STATUS.SOFT_BOUNCED,
  [NORMALIZED_EVENT.HARD_BOUNCE]: DELIVERY_STATUS.HARD_BOUNCED,
  [NORMALIZED_EVENT.BLOCKED]: DELIVERY_STATUS.BLOCKED,
  [NORMALIZED_EVENT.SPAM]: DELIVERY_STATUS.SPAM,
  [NORMALIZED_EVENT.INVALID]: DELIVERY_STATUS.INVALID,
  [NORMALIZED_EVENT.ERROR]: DELIVERY_STATUS.ERROR,
  [NORMALIZED_EVENT.UNSUBSCRIBED]: DELIVERY_STATUS.UNSUBSCRIBED,
});

/** Statuts incompatibles avec une réception : un `delivered` tardif n'y pose pas `deliveredAt`. */
const NEVER_DELIVERED_STATUSES = Object.freeze([
  DELIVERY_STATUS.HARD_BOUNCED,
  DELIVERY_STATUS.BLOCKED,
  DELIVERY_STATUS.INVALID,
  DELIVERY_STATUS.ERROR,
]);

/** État d'engagement neutre. */
export function emptyEngagement() {
  return {
    firstOpenedAt: null,
    lastOpenedAt: null,
    openCount: 0,
    firstClickedAt: null,
    lastClickedAt: null,
    clickCount: 0,
  };
}

function precedenceOf(status) {
  return STATUS_PRECEDENCE[status] ?? 0;
}

/**
 * Applique un événement normalisé à l'état d'une livraison.
 *
 * @param {object} p
 * @param {string} p.currentStatus         statut actuel de la livraison
 * @param {object} [p.engagement]          état d'engagement actuel (sinon neutre)
 * @param {string} p.normalizedEvent       type normalisé (NORMALIZED_EVENT)
 * @param {Date|null} [p.occurredAt]       date fournisseur de l'événement
 * @returns {{
 *   statusBefore: string, statusAfter: string, statusChanged: boolean,
 *   setDeliveredAt: boolean,
 *   engagement: object, engagementChanged: boolean,
 *   kind: 'STATUS'|'ENGAGEMENT'|'NOOP'
 * }}
 */
export function applyBrevoEventToDelivery({
  currentStatus,
  engagement,
  normalizedEvent,
  occurredAt = null,
}) {
  const eng = { ...emptyEngagement(), ...(engagement || {}) };
  const base = {
    statusBefore: currentStatus,
    statusAfter: currentStatus,
    statusChanged: false,
    setDeliveredAt: false,
    engagement: eng,
    engagementChanged: false,
    kind: 'NOOP',
  };

  /**
   * ══ ENGAGEMENT : COMPTÉ, JAMAIS PREUVE DE REMISE ═══════════════════════════
   *
   * Une ouverture ou un clic sont enregistrés comme métadonnées d'engagement.
   * Ils ne changent JAMAIS le statut de livraison.
   *
   * ─── POURQUOI (et pourquoi on a cru le contraire) ──────────────────────────
   *
   * Cette transition a existé quelques heures, sur le raisonnement suivant :
   * « on ne charge pas le pixel de suivi d'un message qui n'a pas été remis,
   * donc une ouverture prouve la remise ». Le raisonnement est FAUX, et il a
   * été invalidé par une vérification directe de boîte de réception.
   *
   * Cas réel : un message a produit `request → unique_opened → deferred`. Le
   * suivi l'a affiché « Livré ». Il était absent de la boîte de réception, des
   * indésirables et de la recherche globale du destinataire. Il n'était donc
   * jamais arrivé.
   *
   * Explication : de nombreux traitements automatiques chargent les ressources
   * de suivi sans que le message n'apparaisse jamais devant un humain — proxy
   * d'images, scanner antispam, antivirus, préchargement, inspection de
   * sécurité côté fournisseur. Une ouverture prouve qu'une ressource a été
   * chargée, pas qu'un message a été remis.
   *
   * ─── LA RÈGLE ──────────────────────────────────────────────────────────────
   *
   * Seul `delivered` — ou un autre événement fournisseur explicitement
   * documenté comme constatant une remise — peut écrire DELIVERED. Un signal
   * d'engagement ne fait progresser aucun statut, dans aucun sens.
   *
   * ⚠️ Ne pas réintroduire de promotion par engagement, même « en secours »,
   * même « seulement si aucun delivered n'arrive ». C'est exactement la forme
   * qu'avait la version fautive. Afficher « Livré » pour un message absent de
   * la boîte du destinataire est le pire défaut possible de ce module : il
   * ferme la question au lieu de la poser.
   */
  if (isEngagementEvent(normalizedEvent)) {
    const at = occurredAt || null;
    if (isOpenEvent(normalizedEvent)) {
      eng.openCount += 1;
      if (!eng.firstOpenedAt) eng.firstOpenedAt = at;
      // lastOpenedAt : on garde la date la plus récente connue.
      if (at && (!eng.lastOpenedAt || at > eng.lastOpenedAt)) eng.lastOpenedAt = at;
      else if (!eng.lastOpenedAt) eng.lastOpenedAt = at;
    } else if (isClickEvent(normalizedEvent)) {
      eng.clickCount += 1;
      if (!eng.firstClickedAt) eng.firstClickedAt = at;
      if (at && (!eng.lastClickedAt || at > eng.lastClickedAt)) eng.lastClickedAt = at;
      else if (!eng.lastClickedAt) eng.lastClickedAt = at;
    }
    return { ...base, engagement: eng, engagementChanged: true, kind: 'ENGAGEMENT' };
  }

  // ── Statut ─────────────────────────────────────────────────────────────────
  const target = EVENT_TO_STATUS[normalizedEvent] || null;
  if (!target) return base; // événement non porteur de statut (inconnu / ignoré)

  const applies = precedenceOf(target) > precedenceOf(currentStatus);
  if (!applies) {
    // Cas particulier : un `delivered` retardé alors qu'on est déjà en post-livraison
    // (SPAM/UNSUBSCRIBED, précédence > DELIVERED) doit tout de même dater la réception.
    const isDelivered = normalizedEvent === NORMALIZED_EVENT.DELIVERED;
    const canBackfillDeliveredAt =
      isDelivered && !NEVER_DELIVERED_STATUSES.includes(currentStatus);
    return { ...base, setDeliveredAt: canBackfillDeliveredAt };
  }

  const setDeliveredAt = target === DELIVERY_STATUS.DELIVERED;
  return {
    ...base,
    statusAfter: target,
    statusChanged: true,
    setDeliveredAt,
    kind: 'STATUS',
  };
}
