// LA REPRISE DES ÉVÉNEMENTS ABANDONNÉS — au démarrage, avant tout worker.
//
// docs/STRIPE_SUBSCRIPTION_FLOW.md §« Reprise après incident ».
//
// ── LES DEUX FILETS, ET CE QUE CHACUN COUVRE ────────────────────────────────
//
// 1. LE REJEU DE STRIPE. Un processus tué n'a répondu à personne : Stripe voit
//    un échec et rejoue. Depuis le bail, ce rejeu REPREND l'événement au lieu
//    d'être refusé comme doublon. C'est le filet principal — il est gratuit, il
//    apporte le corps de l'événement, et il couvre le cas nominal du crash.
//
// 2. CE MODULE. Il couvre ce que le rejeu ne couvre pas : les événements pour
//    lesquels nous avions déjà répondu 200 avant de perdre l'effet, et ceux
//    dont le rejeu tarde. Stripe ne rejouera pas les premiers.
//
// ── POURQUOI IL NE REJOUE PAS LUI-MÊME L'ÉVÉNEMENT ──────────────────────────
//
// Il n'en a pas le corps, et il ne peut pas aller le chercher : `WebhookEvent`
// ne conserve que le type et l'identifiant — jamais la charge utile, qui porte
// des données personnelles — et les clés Stripe appartiennent au Panel, pas au
// projet. Fabriquer ici un chemin d'appel vers Stripe reviendrait à donner au
// projet une autorité que toute l'architecture lui refuse.
//
// Il fait donc ce qu'il peut faire honnêtement, et rien de plus :
//
//   · il REMET les événements abandonnés en état reprenable, pour que le
//     prochain rejeu de Stripe les applique au lieu d'être éconduit ;
//   · il déclenche la RÉCONCILIATION, qui relit l'état réel chez le fournisseur
//     et fait converger les contrats — c'est le filet déjà écrit pour cela ;
//   · il ABANDONNE explicitement ceux qui ont épuisé leurs tentatives, plutôt
//     que de les laisser tourner en boucle.
//
// ── CE QU'IL NE FAIT PAS ────────────────────────────────────────────────────
//
// Il ne rejoue aucune logique métier. La réconciliation SIGNALE et fait
// converger l'état ; elle n'est pas une seconde machine d'application. Le
// `WebhookEvent` reste l'unité de travail, et l'événement reste la source.
import { WebhookEvent } from '../../models/WebhookEvent.model.js';
import { logger } from '../../utils/logger.js';
import {
  WEBHOOK_PROCESSING_STATUS as ST,
} from '../../utils/contractConstants.js';
import { abandonedFilter, MAX_PROCESSING_ATTEMPTS } from './webhookLease.js';

/**
 * Borne de balayage. Un démarrage ne doit pas se transformer en rattrapage :
 * au-delà, le journal porte le reste et le prochain passage le reprendra.
 */
const LOT_MAX = 50;

/**
 * BALAYER LES ÉVÉNEMENTS ABANDONNÉS.
 *
 * Ne lève jamais : un rattrapage impossible ne doit pas empêcher un backend de
 * démarrer. Il RAPPORTE, et c'est ce rapport que l'amorçage journalise.
 *
 * @param {object} [options]
 * @param {Function} [options.reconcile]  injectable — la recette n'a pas besoin
 *                                        d'un vrai Panel pour prouver l'état.
 * @returns {Promise<{scanned, rearmed, deadLettered, reconciled, oldestAgeSeconds}>}
 */
export async function recoverAbandonedWebhookEvents({
  now = Date.now(), limit = LOT_MAX, reconcile = null,
} = {}) {
  const abandonnes = await WebhookEvent.find(abandonedFilter(now))
    .sort({ receivedAt: 1 })
    .limit(limit)
    .lean();

  if (abandonnes.length === 0) {
    return { scanned: 0, rearmed: 0, deadLettered: 0, reconciled: false, oldestAgeSeconds: null };
  }

  let rearmed = 0;
  let deadLettered = 0;

  for (const e of abandonnes) {
    const tentatives = e.processingAttempts ?? 0;
    /**
     * LE PLAFOND SE JUGE ICI AUSSI, ET PAS SEULEMENT À L'ÉCHEC.
     *
     * Un événement peut avoir été réclamé cinq fois sans jamais conclure —
     * cinq crashs successifs n'écrivent aucun `FAILED`. Sans ce contrôle, il
     * resterait éternellement reprenable, et chaque démarrage le reprendrait.
     */
    const abandonner = tentatives >= MAX_PROCESSING_ATTEMPTS
      || e.lastError?.retryable === false;

    // eslint-disable-next-line no-await-in-loop
    await WebhookEvent.updateOne(
      { _id: e._id },
      abandonner
        ? {
          $set: {
            processingStatus: ST.DEAD_LETTER,
            processedAt: new Date(now),
            leaseOwner: null,
            leaseExpiresAt: null,
            errorMessage: `abandonné au démarrage après ${tentatives} tentative(s)`,
            lastError: {
              code: e.lastError?.code ?? 'WEBHOOK_ATTEMPTS_EXHAUSTED',
              retryable: false,
              at: new Date(now),
            },
          },
        }
        : {
          /**
           * REMISE EN FILE — pas une application. On retire le bail mort et on
           * repose l'événement en `PENDING` : le prochain rejeu de Stripe le
           * réclamera normalement. Le compteur de tentatives est CONSERVÉ,
           * sans quoi un événement toxique n'atteindrait jamais son plafond.
           */
          $set: {
            processingStatus: ST.PENDING,
            leaseOwner: null,
            leaseExpiresAt: null,
            processedAt: null,
          },
        },
    );
    if (abandonner) deadLettered += 1;
    else rearmed += 1;

    logger.warn(
      `[webhook] ${e.externalEventId} (${e.eventType || 'type inconnu'}) `
      + `${abandonner ? 'ABANDONNÉ' : 'remis en file'} — ${tentatives} tentative(s), `
      + `état ${e.processingStatus}.`,
    );
  }

  /**
   * ── LA RÉCONCILIATION, UNE FOIS, POUR TOUT LE LOT ───────────────────────
   *
   * Elle relit l'état réel chez le fournisseur et fait converger les contrats.
   * C'est ce qui rattrape un `subscription.deleted` dont le corps est perdu :
   * l'abonnement est bien annulé chez Stripe, elle le voit, le contrat suit.
   *
   * UNE SEULE FOIS : elle balaie déjà tous les contrats. L'appeler par
   * événement multiplierait les allers-retours vers le Panel pour reposer la
   * même question.
   *
   * Best-effort : un Panel injoignable au démarrage ne doit pas empêcher le
   * projet de servir. Les événements restent en file, et Stripe rejouera.
   */
  let reconciled = false;
  if (typeof reconcile === 'function' && rearmed > 0) {
    reconciled = await reconcile()
      .then(() => true)
      .catch((err) => {
        logger.warn(`[webhook] réconciliation de reprise impossible : ${err?.message ?? 'erreur inconnue'}`);
        return false;
      });
  }

  const ages = abandonnes
    .map((e) => (e.receivedAt ? Math.round((now - new Date(e.receivedAt).getTime()) / 1000) : null))
    .filter((n) => Number.isFinite(n));
  const oldestAgeSeconds = ages.length ? Math.max(...ages) : null;

  logger.warn(
    `[webhook] reprise au démarrage : ${abandonnes.length} événement(s) abandonné(s) — `
    + `${rearmed} remis en file, ${deadLettered} abandonné(s) définitivement`
    + `${oldestAgeSeconds === null ? '' : `, le plus ancien remonte à ${oldestAgeSeconds} s`}.`,
  );

  return {
    scanned: abandonnes.length, rearmed, deadLettered, reconciled, oldestAgeSeconds,
  };
}

export default { recoverAbandonedWebhookEvents };
