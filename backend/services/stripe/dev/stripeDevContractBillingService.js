// services/stripe/dev/stripeDevContractBillingService.js
// Sprint F3A — Extraction PUREMENT STRUCTURELLE de la facturation contrat Stripe Dev
// (frais de lancement, abonnement mensuel, vérifications, annulation) hors de
// contractController. Aucune modification de comportement : logique déplacée verbatim, les
// `res.status().json()` deviennent des résultats `{ status, json }` (mappés par
// contractResponseMapper). Le client Dev provient du shim (mockable). La garde « client
// optionnel » (→ 500 « Client Stripe Developer non configuré. », SANS champ `code`) est
// préservée à l'identique.

import Contract from '../../../models/Contract.js';
import ContractCheckoutIntent from '../../../models/ContractCheckoutIntent.js';
import { getStripeDevClient } from '../../../utils/stripeDevClient.js';
import { invalidateContractCache } from '../../../middlewares/contractGuard.js';
import { contractAmountTtcCents } from '../../contract/contractStateService.js';
// Sprint U3 — UnifiedCheckout plateforme + Checkout hébergé (flag).
import { isPlatformCheckoutHostedEnabled } from '../../checkout/unified/unifiedCheckoutConfig.js';
import { createPlatformUnifiedCheckoutRecord } from '../../checkout/unified/unifiedCheckoutFactory.js';
import { updateCheckout } from '../../checkout/unified/unifiedCheckoutRepository.js';
import { createDevPaymentCheckoutSession, createDevSetupCheckoutSession } from './stripeDevHostedCheckoutService.js';

// Reproduit exactement respondError du contrôleur (statut + payload { ok, code, error } + log).
function errorResult(error, context) {
  console.error(`[ContractController:${context}]`, error);
  const status = error?.status || 500;
  return {
    status,
    json: {
      ok: false,
      code: error?.code || 'CONTRACT_ERROR',
      error: error?.message || 'Erreur interne.'
    }
  };
}

export async function createLaunchIntent({ adminId } = {}) {
  const stripeDevClient = await getStripeDevClient();
  try {
    if (!stripeDevClient) {
      return { status: 500, json: { ok: false, error: 'Client Stripe Developer non configuré.' } };
    }

    const contract = await Contract.findOne({ status: 'pending' });
    if (!contract) {
      return { status: 404, json: { ok: false, error: 'Aucun contrat en attente.' } };
    }

    if (contract.launchFee?.paid) {
      return { status: 409, json: { ok: false, error: 'Frais de lancement déjà réglés.' } };
    }

    const amountCents = contractAmountTtcCents(
      contract.launchFee?.amount,
      contract.launchFee?.taxRate
    );
    if (amountCents <= 0) {
      return { status: 400, json: { ok: false, error: 'Montant des frais de lancement invalide.' } };
    }

    // Sprint U3 — Checkout HÉBERGÉ plateforme (flag). Un ContractCheckoutIntent est créé avec le
    // PaymentIntent de la Session → le webhook Dev payment_intent.succeeded EXISTANT finalise
    // (launchFee.paid). Aucune logique métier dupliquée.
    if (isPlatformCheckoutHostedEnabled()) {
      await ContractCheckoutIntent.deleteMany({ contractId: contract._id, type: 'launch' });
      const { checkout } = await createPlatformUnifiedCheckoutRecord({
        kind: 'launch_fee',
        amountToPay: amountCents / 100,
        userId: adminId,
        source: 'platform_launch_fee',
        inputSnapshot: { contractId: String(contract._id) }
      });
      const session = await createDevPaymentCheckoutSession({
        amountCents,
        productName: 'Frais de lancement Beauty Savage',
        paymentIntentMetadata: { contractId: String(contract._id), type: 'launch_fee' },
        sessionMetadata: { unifiedCheckoutId: checkout.checkoutId, contractId: String(contract._id), kind: 'launch_fee' }
      });
      await ContractCheckoutIntent.create({
        stripePaymentIntentId: session.payment_intent,
        contractId: contract._id,
        adminId,
        type: 'launch',
        processed: false
      });
      await updateCheckout(checkout.checkoutId, {
        'payment.stripeCheckoutSessionId': session.id,
        'payment.stripePaymentIntentId': session.payment_intent || null
      }).catch(() => {});
      return { status: 200, json: { ok: true, mode: 'hosted', url: session.url, checkoutId: checkout.checkoutId, amountCents } };
    }

    // Idempotence — check existing unprocessed intent and verify its Stripe status
    const existingLaunch = await ContractCheckoutIntent.findOne({
      contractId: contract._id,
      type: 'launch',
      processed: false,
      stripePaymentIntentId: { $ne: null }
    }).lean();
    if (existingLaunch?.stripePaymentIntentId) {
      const pi = await stripeDevClient.paymentIntents.retrieve(existingLaunch.stripePaymentIntentId);
      switch (pi.status) {
        case 'succeeded':
          await ContractCheckoutIntent.findByIdAndUpdate(existingLaunch._id, { processed: true });
          return { status: 200, json: { ok: true, alreadyProcessed: true } };
        case 'canceled':
        case 'requires_payment_method':
          await ContractCheckoutIntent.findByIdAndDelete(existingLaunch._id);
          break; // fall through to create a new PaymentIntent
        case 'requires_confirmation':
        case 'requires_action':
        case 'processing':
          return { status: 200, json: { ok: true, clientSecret: pi.client_secret, paymentIntentId: pi.id, amountCents } };
        default:
          await ContractCheckoutIntent.findByIdAndDelete(existingLaunch._id);
          break;
      }
    }

    // Nettoyer TOUS les anciens intents launch — processed ou non
    await ContractCheckoutIntent.deleteMany({
      contractId: contract._id,
      type: 'launch'
    });

    const paymentIntent = await stripeDevClient.paymentIntents.create({
      amount: amountCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      metadata: {
        contractId: String(contract._id),
        type: 'launch_fee'
      }
    });

    await ContractCheckoutIntent.create({
      stripePaymentIntentId: paymentIntent.id,
      contractId: contract._id,
      adminId,
      type: 'launch',
      processed: false
    });

    return {
      status: 200,
      json: {
        ok: true,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amountCents
      }
    };
  } catch (error) {
    return errorResult(error, 'CreateLaunchIntent');
  }
}

export async function createMonthlySetup({ adminId } = {}) {
  const stripeDevClient = await getStripeDevClient();
  try {
    if (!stripeDevClient) {
      return { status: 500, json: { ok: false, error: 'Client Stripe Developer non configuré.' } };
    }

    const contract = await Contract.findOne({ status: 'pending' });
    if (!contract) {
      return { status: 404, json: { ok: false, error: 'Aucun contrat en attente.' } };
    }

    // If launch fee exists, it must be paid first
    if ((contract.launchFee?.amount || 0) > 0 && !contract.launchFee?.paid) {
      return {
        status: 409,
        json: {
          ok: false,
          error: 'Les frais de lancement doivent être réglés avant la souscription mensuelle.'
        }
      };
    }

    if (contract.monthlyFee?.active) {
      return { status: 409, json: { ok: false, error: 'Mensualité déjà active.' } };
    }

    // Create or reuse Stripe customer
    let customerId = contract.monthlyFee?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripeDevClient.customers.create({
        metadata: { contractId: String(contract._id) }
      });
      customerId = customer.id;
      contract.monthlyFee.stripeCustomerId = customerId;
      await contract.save();
    }

    // Sprint U3 — Abonnement via Stripe Checkout HÉBERGÉ mode='setup' (flag). Collecte le moyen de
    // paiement ; le SetupIntent de la Session → webhook Dev setup_intent.succeeded EXISTANT crée la
    // Subscription (handleSetupIntentSucceeded). Aucune refonte de l'abonnement.
    if (isPlatformCheckoutHostedEnabled()) {
      await ContractCheckoutIntent.deleteMany({ contractId: contract._id, type: 'monthly' });
      const { checkout } = await createPlatformUnifiedCheckoutRecord({
        kind: 'subscription',
        amountToPay: 0,
        userId: adminId,
        source: 'platform_subscription',
        status: 'payment_pending',
        inputSnapshot: { contractId: String(contract._id) }
      });
      const session = await createDevSetupCheckoutSession({
        customerId,
        sessionMetadata: { unifiedCheckoutId: checkout.checkoutId, contractId: String(contract._id), kind: 'subscription' }
      });
      await ContractCheckoutIntent.create({
        stripeSetupIntentId: session.setup_intent,
        contractId: contract._id,
        adminId,
        type: 'monthly',
        processed: false
      });
      await updateCheckout(checkout.checkoutId, {
        'payment.stripeCheckoutSessionId': session.id
      }).catch(() => {});
      return { status: 200, json: { ok: true, mode: 'hosted', url: session.url, checkoutId: checkout.checkoutId, customerId } };
    }

    // Idempotence — check existing unprocessed intent and verify its Stripe status
    const existingMonthly = await ContractCheckoutIntent.findOne({
      contractId: contract._id,
      type: 'monthly',
      processed: false,
      stripeSetupIntentId: { $ne: null }
    }).lean();
    if (existingMonthly?.stripeSetupIntentId) {
      const si = await stripeDevClient.setupIntents.retrieve(existingMonthly.stripeSetupIntentId);
      switch (si.status) {
        case 'succeeded':
          await ContractCheckoutIntent.findByIdAndUpdate(existingMonthly._id, { processed: true });
          return { status: 200, json: { ok: true, alreadyProcessed: true } };
        case 'canceled':
          await ContractCheckoutIntent.findByIdAndDelete(existingMonthly._id);
          break; // fall through to create a new SetupIntent
        case 'requires_confirmation':
        case 'requires_action':
          return { status: 200, json: { ok: true, clientSecret: si.client_secret, setupIntentId: si.id, customerId } };
        default:
          await ContractCheckoutIntent.findByIdAndDelete(existingMonthly._id);
          break;
      }
    }

    // Nettoyer TOUS les anciens intents monthly — processed ou non
    await ContractCheckoutIntent.deleteMany({
      contractId: contract._id,
      type: 'monthly'
    });

    const setupIntent = await stripeDevClient.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      metadata: {
        contractId: String(contract._id),
        type: 'monthly_setup'
      }
    });

    await ContractCheckoutIntent.create({
      stripeSetupIntentId: setupIntent.id,
      contractId: contract._id,
      adminId,
      type: 'monthly',
      processed: false
    });

    // Store pending client secret
    contract.monthlyFee.pendingClientSecret = setupIntent.client_secret;
    contract.updatedBy = adminId;
    await contract.save();

    return {
      status: 200,
      json: {
        ok: true,
        clientSecret: setupIntent.client_secret,
        setupIntentId: setupIntent.id,
        customerId
      }
    };
  } catch (error) {
    return errorResult(error, 'CreateMonthlySetup');
  }
}

export async function verifyLaunchPayment({ adminId } = {}) {
  const stripeDevClient = await getStripeDevClient();
  try {
    if (!stripeDevClient) {
      return { status: 500, json: { ok: false, error: 'Client Stripe Developer non configuré.' } };
    }

    const contract = await Contract.findOne({ status: 'pending' });
    if (!contract) {
      return { status: 404, json: { ok: false, error: 'Aucun contrat en attente.' } };
    }

    const intent = await ContractCheckoutIntent.findOne({
      contractId: contract._id,
      type: 'launch',
      stripePaymentIntentId: { $ne: null }
    })
      .sort({ createdAt: -1 });

    if (!intent?.stripePaymentIntentId) {
      return { status: 404, json: { ok: false, error: 'Aucun intent launch trouvé.' } };
    }

    const pi = await stripeDevClient.paymentIntents.retrieve(intent.stripePaymentIntentId);
    if (pi.status === 'succeeded') {
      contract.launchFee.paid = true;
      contract.updatedBy = adminId || contract.updatedBy;
      await contract.save();
      if (!intent.processed) {
        intent.processed = true;
        await intent.save();
      }
      return { status: 200, json: { ok: true } };
    }

    return { status: 200, json: { ok: false, status: pi.status } };
  } catch (error) {
    return errorResult(error, 'VerifyLaunchPayment');
  }
}

export async function verifyMonthlySetup({ adminId } = {}) {
  const stripeDevClient = await getStripeDevClient();
  try {
    if (!stripeDevClient) {
      return { status: 500, json: { ok: false, error: 'Client Stripe Developer non configuré.' } };
    }

    const contract = await Contract.findOne({ status: 'pending' });
    if (!contract) {
      return { status: 404, json: { ok: false, error: 'Aucun contrat en attente.' } };
    }

    const intent = await ContractCheckoutIntent.findOne({
      contractId: contract._id,
      type: 'monthly',
      stripeSetupIntentId: { $ne: null }
    })
      .sort({ createdAt: -1 });

    if (!intent?.stripeSetupIntentId) {
      return { status: 404, json: { ok: false, error: 'Aucun intent monthly trouvé.' } };
    }

    const si = await stripeDevClient.setupIntents.retrieve(intent.stripeSetupIntentId);
    if (si.status === 'succeeded') {
      contract.monthlyFee.active = true;
      contract.updatedBy = adminId || contract.updatedBy;
      await contract.save();
      if (!intent.processed) {
        intent.processed = true;
        await intent.save();
      }
      return { status: 200, json: { ok: true } };
    }

    return { status: 200, json: { ok: false, status: si.status } };
  } catch (error) {
    return errorResult(error, 'VerifyMonthlySetup');
  }
}

export async function cancelContract({ adminId } = {}) {
  const stripeDevClient = await getStripeDevClient();
  try {
    const contract = await Contract.findOne({ status: 'active' });

    if (!contract) {
      return { status: 404, json: { ok: false, error: 'Aucun contrat actif.' } };
    }

    if (contract.monthlyFee?.stripeSubscriptionId) {
      const updatedSub = await stripeDevClient.subscriptions.update(
        contract.monthlyFee.stripeSubscriptionId,
        { cancel_at_period_end: true }
      );
      // Persiste current_period_end si pas encore en base (webhook peut ne pas avoir encore tourné)
      if (!contract.monthlyFee.currentPeriodEnd && updatedSub.current_period_end) {
        contract.monthlyFee.currentPeriodEnd = new Date(updatedSub.current_period_end * 1000);
      }

      contract.monthlyFee.cancelAtPeriodEnd = true;
      contract.updatedBy = adminId;
      await contract.save();

      return {
        status: 200,
        json: {
          ok: true,
          cancelAtPeriodEnd: true,
          immediate: false,
          currentPeriodEnd: contract.monthlyFee.currentPeriodEnd ?? null
        }
      };
    }

    // Pas d'abonnement Stripe — résiliation immédiate
    contract.status = 'cancelled';
    contract.cancelledAt = new Date();
    contract.cancelledBy = adminId;
    contract.updatedBy = adminId;
    await contract.save();
    invalidateContractCache();

    return { status: 200, json: { ok: true, cancelAtPeriodEnd: false, immediate: true } };
  } catch (error) {
    return errorResult(error, 'CancelContract');
  }
}

export async function cancelImmediate({ adminId } = {}) {
  const stripeDevClient = await getStripeDevClient();
  try {
    if (process.env.NODE_ENV === 'production') {
      return { status: 403, json: { ok: false, error: 'Non disponible en production.' } };
    }

    const contract = await Contract.findOne({ status: { $in: ['pending', 'active'] } });
    if (!contract) return { status: 404, json: { ok: false, error: 'Aucun contrat actif.' } };

    // Annuler l'abonnement Stripe si existant
    if (contract.monthlyFee?.stripeSubscriptionId) {
      try {
        await stripeDevClient.subscriptions.cancel(contract.monthlyFee.stripeSubscriptionId);
      } catch (err) {
        console.warn('[DevCancel] Erreur annulation subscription Stripe:', err.message);
      }
    }

    contract.status = 'cancelled';
    contract.cancelledAt = new Date();
    contract.cancelledBy = adminId;
    contract.monthlyFee.active = false;
    await contract.save();

    invalidateContractCache();

    await ContractCheckoutIntent.deleteMany({ contractId: contract._id });

    return { status: 200, json: { ok: true } };
  } catch (error) {
    return errorResult(error, 'CancelImmediate');
  }
}
