// automatisme/giftCardRecreditRecoveryJob.js
// Pré-React C1 — Job périodique de reprise des recrédits carte cadeau bloqués
// (giftCardRefundStatus='rollback_needed'). Best-effort, idempotent (cf.
// giftCardRecreditRecoveryService). N'effectue AUCUN double-crédit.

import { runGiftCardRecreditRecovery } from '../services/giftCardRecreditRecoveryService.js';

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 min

let intervalHandle = null;

export async function executeGiftCardRecreditRecoveryJob({ limit = 100 } = {}) {
  const summary = await runGiftCardRecreditRecovery({ limit });
  if (summary.inspected > 0) {
    console.log(
      `[GiftCardRecreditRecovery] inspected=${summary.inspected} recovered=${summary.recovered} ` +
        `skipped=${summary.skipped} failed=${summary.failed}`
    );
  }
  return summary;
}

export function startGiftCardRecreditRecoveryScheduler({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  if (intervalHandle) return intervalHandle;
  // Premier passage différé (laisse le boot se terminer), puis périodique.
  intervalHandle = setInterval(() => {
    executeGiftCardRecreditRecoveryJob().catch(err =>
      console.error('[GiftCardRecreditRecovery] job error:', err?.message || err)
    );
  }, intervalMs);
  if (typeof intervalHandle.unref === 'function') intervalHandle.unref();
  console.log(`[GiftCardRecreditRecovery] scheduler démarré (intervalle ${Math.round(intervalMs / 60000)} min).`);
  return intervalHandle;
}

export function stopGiftCardRecreditRecoveryScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export default executeGiftCardRecreditRecoveryJob;
