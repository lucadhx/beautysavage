// services/stripe/dev/stripeDevContractSyncService.js
// Sprint F3A — Extraction PUREMENT STRUCTURELLE de la synchronisation des statuts Stripe Dev
// du contrat (frais de lancement + abonnement) hors de contractController. Aucune modification
// de comportement : `syncStripeStatuses` déplacée verbatim. Le client Dev provient du shim
// (mockable). Mute + sauvegarde le document Contract fourni. Importée par le contrôleur ET
// le job de sync (`automatisme/contractPaymentSyncJob`).

import ContractCheckoutIntent from '../../../models/ContractCheckoutIntent.js';
import { getStripeDevClient } from '../../../utils/stripeDevClient.js';

export async function syncStripeStatuses(contract) {
  const stripeDevClient = await getStripeDevClient();
  if (!stripeDevClient) return;

  // Vérifier PaymentIntent launch
  if (!contract.launchFee?.paid && Number(contract.launchFee?.amount || 0) > 0) {
    const intent = await ContractCheckoutIntent.findOne({
      contractId: contract._id,
      type: 'launch'
    });
    if (intent?.stripePaymentIntentId) {
      try {
        const pi = await stripeDevClient.paymentIntents.retrieve(intent.stripePaymentIntentId);
        if (pi.status === 'succeeded') {
          contract.launchFee.paid = true;
          intent.processed = true;
          await intent.save();
        }
      } catch (_) {}
    }
  }

  // Vérifier SetupIntent + Subscription monthly
  if (!contract.monthlyFee?.active && Number(contract.monthlyFee?.amount || 0) > 0) {
    if (contract.monthlyFee?.stripeSubscriptionId) {
      try {
        const sub = await stripeDevClient.subscriptions.retrieve(contract.monthlyFee.stripeSubscriptionId);
        if (sub.status === 'active') {
          contract.monthlyFee.active = true;
          await ContractCheckoutIntent.findOneAndUpdate(
            { contractId: contract._id, type: 'monthly', processed: false },
            { processed: true }
          );
        }
      } catch (_) {}
    }
  }

  // Pas d'auto-activation ici: activation manuelle via POST /api/contract/activate
  await contract.save();
}
