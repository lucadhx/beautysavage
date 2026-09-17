import { runRefundRecovery } from '../services/refundRecoveryService.js';

const JOB_INTERVAL_MS = 60 * 60 * 1000;

let recoveryIntervalId = null;
let recoveryRunning = false;

async function runRecoveryCycle(trigger = 'interval') {
  if (recoveryRunning) return;
  recoveryRunning = true;
  try {
    // LOT2 — runRefundRecovery loggue lui-même UN résumé exploitable (inspected/recovered/
    // deferred/finalFailed/configurationBlocked) au lieu de N stacks. On lui passe le déclencheur.
    await runRefundRecovery({ limit: 100, trigger });
  } finally {
    recoveryRunning = false;
  }
}

export function startRefundRecoveryScheduler(trigger = 'startup') {
  if (recoveryIntervalId) {
    void runRecoveryCycle(trigger);
    return;
  }
  console.log('[RefundRecovery] Job demarre (intervalle: 1h).');
  recoveryIntervalId = setInterval(() => {
    void runRecoveryCycle('interval').catch(error => {
      console.error('[RefundRecovery] interval run failed', error);
    });
  }, JOB_INTERVAL_MS);
  void runRecoveryCycle(trigger).catch(error => {
    console.error('[RefundRecovery] startup run failed', error);
  });
}
