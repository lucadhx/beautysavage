import { logger } from '../utils/logger.js';
import { reconcileInstituteCheckouts } from './commerce.service.js';
import { notifyFinishedCommissionMonths, reconcileCommissionPayments } from './commissionPayment.service.js';
import { processReviewRequests } from './reviewRequest.service.js';
import { reconcileSlotGroups } from './trainingSlotGroup.service.js';

/**
 * RATTRAPAGE DES PAIEMENTS CLIENTS — toutes les 3 minutes, les ventes encore
 * « en paiement » sont confrontées à Stripe (voir `reconcileInstituteCheckouts`),
 * puis les commissions payées à la plateforme (`reconcileCommissionPayments`).
 * Un passage à la fois : un cycle lent ne se superpose jamais au suivant.
 */
const INTERVAL_MS = 3 * 60_000;
/** Créneaux partagés : vérifiés chaque minute (requêtes légères, groupes ouverts seulement). */
const SLOT_GROUP_INTERVAL_MS = 60_000;
let timer = null;
let slotTimer = null;
let running = null;
let slotRunning = null;

function slotCycle() {
  if (slotRunning) return slotRunning;
  slotRunning = reconcileSlotGroups()
    .catch((err) => logger.warn(`[créneau partagé] vérification interrompue : ${err.message}`))
    .finally(() => { slotRunning = null; });
  return slotRunning;
}

async function cycle() {
  if (running) return running;
  running = (async () => {
    try {
      await reconcileInstituteCheckouts();
    } catch (err) {
      logger.warn(`[checkout] rattrapage interrompu : ${err.message}`);
    }
    try {
      // Les commissions « en paiement » et les factures pas encore lues.
      await reconcileCommissionPayments();
      // Les mois terminés, pas encore annoncés : un e-mail « Payer » chacun.
      await notifyFinishedCommissionMonths();
    } catch (err) {
      logger.warn(`[commission] rattrapage interrompu : ${err.message}`);
    }
    try {
      // Demandes d'avis : prestations terminées détectées, envois et relances dus.
      await processReviewRequests();
    } catch (err) {
      logger.warn(`[avis] passage interrompu : ${err.message}`);
    } finally {
      running = null;
    }
  })();
  return running;
}

export function startCommerceReconcileScheduler({ intervalMs = INTERVAL_MS } = {}) {
  stopCommerceReconcileScheduler();
  timer = setInterval(() => { void cycle(); }, intervalMs);
  timer.unref?.();
  slotTimer = setInterval(() => { void slotCycle(); }, SLOT_GROUP_INTERVAL_MS);
  slotTimer.unref?.();
  // Premier passage peu après le démarrage : rattrape ce qu'un arrêt aurait laissé.
  setTimeout(() => { void cycle(); }, 30_000).unref?.();
  logger.info(`[checkout] Rattrapage des paiements clients toutes les ${Math.round(intervalMs / 1000)} s.`);
  return { intervalMs };
}

export function stopCommerceReconcileScheduler() {
  if (timer) clearInterval(timer);
  if (slotTimer) clearInterval(slotTimer);
  timer = null;
  slotTimer = null;
}

export async function drainCommerceReconcileScheduler() {
  stopCommerceReconcileScheduler();
  const inFlight = [running, slotRunning].filter(Boolean);
  if (inFlight.length) await Promise.race([Promise.all(inFlight), new Promise((r) => setTimeout(r, 10_000))]);
}
