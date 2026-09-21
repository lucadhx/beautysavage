/**
 * LA REPRISE DES ACTIONS EN ÉCHEC — périodique, et non plus au redémarrage.
 *
 * ══ CE QUI MANQUAIT, ET CE QUE ÇA COÛTAIT ═══════════════════════════════════
 *
 * Toute la mécanique de nouvelle tentative existait déjà : `attempts`,
 * `availableAt`, backoff borné, verrou atomique, distinction retryable /
 * terminal. Il manquait la seule chose qui la rende vivante — quelqu'un pour
 * regarder l'heure.
 *
 * `processPendingEventActions()` n'était appelée qu'au DÉMARRAGE du processus,
 * et par un script d'exploitation. Un fournisseur d'envoi injoignable trois
 * minutes suffisait donc à différer une relance d'impayé jusqu'au prochain
 * déploiement — potentiellement des semaines, pour un message dont l'intérêt
 * est précisément d'arriver avant l'échéance de suspension.
 *
 * ══ CE N'EST PAS UNE SECONDE INFRASTRUCTURE DE TÂCHES ══════════════════════
 *
 * Ce module ne sait ni prendre, ni exécuter, ni réessayer. Il appelle la
 * fonction existante, à intervalle fixe. Toute la logique — réservation
 * atomique, incrément des tentatives, backoff, verrou expiré repris — reste où
 * elle était. Un second moteur aurait divergé du premier au premier correctif.
 *
 * ══ LA CADENCE ═════════════════════════════════════════════════════════════
 *
 * Le premier palier de backoff vaut 30 s. Battre plus vite ne ferait
 * qu'interroger une base pour rien ; battre plus lentement retarderait
 * mécaniquement chaque tentative. On bat donc à la maille du plus petit
 * palier.
 *
 * ══ CE QU'IL NE FAIT JAMAIS ════════════════════════════════════════════════
 *
 * Deux cycles ne se chevauchent pas : un cycle lent ne doit pas se doubler
 * lui-même et faire prendre les mêmes exécutions par deux chemins. Le verrou
 * atomique le supporterait, mais empiler les cycles sur une base lente est
 * exactement la façon dont une lenteur devient une panne.
 *
 * Et il ne travaille pas pendant l'arrêt : `isAcceptingWork()` retombe à faux
 * dès la vidange, et un cycle qui démarrerait alors écrirait sur une base qu'on
 * vient de refermer.
 */
import { logger } from '../../utils/logger.js';
import { isAcceptingWork } from '../lifecycle/runtimeLifecycle.js';
import { processPendingEventActions } from './domainEventDispatcher.service.js';

/** La maille du plus petit palier de backoff (`RETRY_POLICY.SEND_EMAIL`). */
export const DEFAULT_RETRY_TICK_MS = 30_000;

let timer = null;
let enCours = false;
/** Promesse du cycle en vol — c'est elle que la vidange attend. */
let cycleEnVol = null;

const stats = {
  startedAt: null,
  cycles: 0,
  claimed: 0,
  processed: 0,
  lastAt: null,
  lastError: null,
};

/**
 * UN passage. Exporté pour que la recette puisse le déclencher sans minuteur.
 *
 * Ne lève jamais : un cycle raté sera revu au suivant, et faire remonter une
 * exception depuis un `setInterval` tuerait le processus.
 */
export async function runEventActionRetryCycle() {
  if (enCours) return { skipped: 'ALREADY_RUNNING' };
  if (!isAcceptingWork()) return { skipped: 'DRAINING' };

  enCours = true;
  cycleEnVol = (async () => {
    try {
      const { claimed, processed } = await processPendingEventActions();
      stats.cycles += 1;
      stats.claimed += claimed;
      stats.processed += processed;
      stats.lastAt = new Date().toISOString();
      stats.lastError = null;
      if (processed > 0) {
        logger.info(`[events] ${processed} action(s) reprise(s) automatiquement.`);
      }
      return { claimed, processed };
    } catch (err) {
      stats.lastError = err?.message ?? 'erreur inconnue';
      logger.warn(`[events] cycle de reprise interrompu : ${stats.lastError}`);
      return { claimed: 0, processed: 0, error: stats.lastError };
    } finally {
      enCours = false;
    }
  })();

  return cycleEnVol;
}

export function startEventActionScheduler({ intervalMs = DEFAULT_RETRY_TICK_MS, immediate = false } = {}) {
  stopEventActionScheduler();
  stats.startedAt = new Date().toISOString();
  timer = setInterval(() => { void runEventActionRetryCycle(); }, intervalMs);
  timer.unref?.();
  /**
   * Pas de passage immédiat par défaut : l'amorçage vient d'en faire un, juste
   * avant. Le rejouer ici prendrait les mêmes exécutions une seconde fois — le
   * verrou l'empêcherait, mais ce serait du bruit pour rien.
   */
  if (immediate) void runEventActionRetryCycle();
  logger.info(`[events] Reprise automatique des actions toutes les ${Math.round(intervalMs / 1000)} s.`);
  return { intervalMs };
}

export function stopEventActionScheduler() {
  if (!timer) return false;
  clearInterval(timer);
  timer = null;
  return true;
}

/**
 * ARRÊTER LE MINUTEUR NE SUFFIT PAS.
 *
 * Un cycle déjà parti continue et atteint une base que l'arrêt vient de
 * refermer. On arrête, PUIS on attend — sous plafond, pour qu'un cycle bloqué
 * ne retienne pas l'extinction indéfiniment.
 */
export async function drainEventActionScheduler({ timeoutMs = 10_000 } = {}) {
  stopEventActionScheduler();
  if (!cycleEnVol) return { drained: true, waited: false };
  const plafond = new Promise((r) => { setTimeout(() => r('TIMEOUT'), timeoutMs); });
  const issue = await Promise.race([cycleEnVol.catch(() => 'ERROR'), plafond]);
  return { drained: issue !== 'TIMEOUT', waited: true };
}

export function isEventActionSchedulerRunning() {
  return timer !== null;
}

export function describeEventActionScheduler() {
  return { running: timer !== null, ...stats };
}

export default {
  startEventActionScheduler,
  stopEventActionScheduler,
  drainEventActionScheduler,
  runEventActionRetryCycle,
  describeEventActionScheduler,
};
