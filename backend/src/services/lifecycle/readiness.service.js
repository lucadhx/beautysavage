/**
 * APTITUDE DE SERVICE — « vivant » et « prêt » sont deux questions distinctes.
 *
 * ══ LE DÉFAUT QUE CE MODULE FERME ═══════════════════════════════════════════
 *
 * `app.listen()` était la dernière ligne du démarrage : il venait après la
 * connexion Mongo, `bootstrap()` — qui réconcilie les webhooks avec un délai
 * pouvant atteindre vingt secondes — et cinq reprises de données. Pendant toute
 * cette fenêtre, RIEN n'écoutait sur le port.
 *
 * Le Manager recevait donc, selon la topologie, un `502` d'nginx ou un
 * `ECONNREFUSED`. Les deux se présentaient de la même façon côté client : une
 * erreur sans corps exploitable, affichée « Serveur injoignable ». C'est ce qui
 * produisait le symptôme observé — un premier déploiement refusé sans que ses
 * prérequis ne se lancent, puis un succès quelques dizaines de secondes plus
 * tard, sans qu'on ait rien changé.
 *
 * ══ CE QUI LE REMPLACE ══════════════════════════════════════════════════════
 *
 * Le port s'ouvre tout de suite, et l'aptitude devient une donnée explicite.
 * Les sondes répondent immédiatement ; les routes métier refusent proprement
 * — `503` avec un code stable — tant que les dépendances ne sont pas prêtes.
 *
 * L'invariant est intact : aucune route métier n'est servie avant que ses
 * dépendances ne soient prêtes. Ce qui change, c'est la QUALITÉ du refus.
 *
 * ══ CE QUE CE MODULE NE FAIT PAS ════════════════════════════════════════════
 *
 * Aucune requête réseau, aucune lecture Mongo. L'état de la base est lu sur la
 * connexion en cours (`readyState`) : une sonde qui interrogerait la base
 * deviendrait indisponible au moment précis où elle doit répondre pour DIRE que
 * la base est indisponible.
 */
import mongoose from 'mongoose';
import { isShuttingDown } from './runtimeLifecycle.js';
import { bootstrapSummary } from './bootstrapReport.service.js';
import { describeStartupReconciliation } from './startupReconciliation.service.js';

export const READINESS = Object.freeze({
  STARTING: 'STARTING',
  READY: 'READY',
  DRAINING: 'DRAINING',
});

let amorce = false;
let readySince = null;
let bootFailure = null;
let bootStep = 'initialisation';

/**
 * La base est-elle utilisable MAINTENANT ?
 *
 * `readyState === 1` seul signifie « connectée ». Les états 0, 2 et 3 sont ceux
 * où une requête partirait en tampon puis expirerait au bout de dix secondes :
 * refuser tout de suite est plus honnête que faire attendre pour refuser quand
 * même.
 */
export function isDatabaseReady() {
  return mongoose.connection.readyState === 1;
}

export function readinessPhase() {
  if (isShuttingDown()) return READINESS.DRAINING;
  return amorce ? READINESS.READY : READINESS.STARTING;
}

/** Prêt à servir une requête MÉTIER : amorçage terminé ET base joignable. */
export function isReady() {
  return readinessPhase() === READINESS.READY && isDatabaseReady();
}

export function markBootStep(step) {
  bootStep = String(step || '').trim() || bootStep;
}

export function markReady() {
  amorce = true;
  readySince = new Date().toISOString();
  bootFailure = null;
  bootStep = 'terminé';
}

export function markBootFailed(err) {
  bootFailure = String(err?.message ?? err ?? 'cause inconnue');
}

/** Remise à zéro — réservée aux recettes qui amorcent plusieurs fois un process. */
export function resetReadiness() {
  amorce = false;
  readySince = null;
  bootFailure = null;
  bootStep = 'initialisation';
}

/**
 * L'état DÉTAILLÉ. Aucun secret, aucune adresse d'infrastructure : une aptitude
 * se lit sans rien apprendre de la machine qui la sert.
 */
export function describeReadiness() {
  const ready = isReady();
  /**
   * ── POURQUOI LE RÉSUMÉ D'AMORÇAGE FIGURE ICI ──────────────────────────────
   *
   * « Prêt » est binaire ; « prêt mais dégradé » ne l'est pas. Un projet dont
   * le webhook Stripe attend sa troisième reprise SERT parfaitement son métier
   * — il doit donc répondre 200 — mais quelqu'un doit pouvoir l'apprendre sans
   * relire la console du démarrage, laquelle a pu défiler depuis longtemps.
   *
   * Aucun secret n'y transite : le rapport ne contient que des noms de
   * contrôles, des codes stables et des phrases destinées à l'humain.
   */
  const bootstrap = bootstrapSummary();
  const retries = describeStartupReconciliation();
  return {
    ready,
    phase: readinessPhase(),
    readySince,
    bootStep: ready ? null : bootStep,
    bootFailure,
    checks: {
      backend: true,
      database: isDatabaseReady(),
    },
    bootstrap: {
      core: bootstrap.core,
      panel: bootstrap.panel,
      integratedApi: bootstrap.integratedApi,
      recovery: bootstrap.recovery,
      background: bootstrap.background,
      /**
       * LES DEUX FAMILLES D'INVARIANTS SONT DISTINGUÉES.
       *
       * « Structurel » répond à « l'état est-il réparé ? » ; « service » répond
       * à « les workers tournent-ils vraiment ? ». Les additionner priverait
       * l'exploitant de la seule information qui oriente son diagnostic :
       * faut-il regarder la base, ou les minuteurs ?
       */
      structuralInvariants: bootstrap.structuralInvariants,
      serviceInvariants: bootstrap.serviceInvariants,
      invariants: bootstrap.invariants,
      blockingErrors: bootstrap.blockingErrors,
      degraded: bootstrap.degradedDetails,
      pendingRetries: retries.filter((r) => !r.gated).length,
      deferred: retries.filter((r) => r.gated).length,
      retries,
    },
  };
}

/**
 * LE CODE MÉTIER qui explique un refus — stable, jamais une phrase à relire.
 *
 * ── L'ORDRE DES CAUSES EST UNE DÉCISION, PAS UNE COMMODITÉ ─────────────────
 *
 * La PHASE l'emporte sur l'état de la base. Pendant l'amorçage, la base n'est
 * pas encore connectée : c'est l'état ATTENDU, pas un incident. Nommer « base
 * injoignable » à ce moment enverrait l'exploitant vérifier une base qui va
 * très bien, alors que la seule chose à faire est d'attendre.
 *
 * Une base absente n'est une CAUSE qu'une fois le service amorcé : là, elle
 * décrit une vraie panne, et c'est elle qu'il faut nommer.
 */
export function unavailabilityReason() {
  if (isReady()) return null;
  const phase = readinessPhase();
  if (phase === READINESS.DRAINING) {
    return {
      code: 'SERVICE_STOPPING',
      message: 'Le service s’arrête. Votre session reste valide — réessayez dans quelques instants.',
    };
  }
  if (phase === READINESS.STARTING) {
    return {
      code: 'SERVICE_STARTING',
      message: 'Le service démarre et n’est pas encore prêt à traiter cette demande. '
        + 'Votre session reste valide — réessayez dans quelques instants.',
    };
  }
  return {
    code: 'DATABASE_UNAVAILABLE',
    message: 'Base de données momentanément injoignable. Votre session reste valide — '
      + 'réessayez dans quelques instants.',
  };
}

export default {
  READINESS,
  describeReadiness,
  isDatabaseReady,
  isReady,
  markBootFailed,
  markBootStep,
  markReady,
  readinessPhase,
  resetReadiness,
  unavailabilityReason,
};
