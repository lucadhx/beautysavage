import Contract from '../models/Contract.js';
// Sprint F3A — syncStripeStatuses déplacée vers le service de sync Stripe Dev contrat.
import { syncStripeStatuses } from '../services/stripe/dev/stripeDevContractSyncService.js';

let syncInterval = null;

export function startContractPaymentSyncJob() {
  if (syncInterval) return;

  syncInterval = setInterval(async () => {
    try {
      const pendingContracts = await Contract.find({ status: 'pending' });
      if (pendingContracts.length === 0) {
        stopContractPaymentSyncJob();
        return;
      }
      for (const contract of pendingContracts) {
        await syncStripeStatuses(contract);
      }
    } catch (err) {
      console.error('[ContractSyncJob] Erreur:', err.message);
    }
  }, 5 * 60 * 1000);

  console.log('[ContractSyncJob] Démarré — vérification toutes les 5 minutes.');
}

export function stopContractPaymentSyncJob() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('[ContractSyncJob] Arrêté — aucun contrat pending.');
  }
}
