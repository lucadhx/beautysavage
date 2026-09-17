// services/stripe/dev/stripeDevWebhookHandlers.js
// Sprint F2B — Extraction PUREMENT STRUCTURELLE des handlers d'événements du webhook Stripe
// Dev (plateforme) hors de devWebhookController. Aucune modification de comportement :
// fonctions déplacées verbatim.
//
// Le client Dev provient du shim `utils/stripeDevClient` (mockable). `finalizeCommissionPaymentById`
// reste la source serveur de finalisation des commissions (importée du contrôleur commission).

import Contract from '../../../models/Contract.js';
import ContractCheckoutIntent from '../../../models/ContractCheckoutIntent.js';
import { getStripeDevClient } from '../../../utils/stripeDevClient.js';
import { invalidateContractCache } from '../../../middlewares/contractGuard.js';
import { finalizeCommissionPaymentById } from '../../../controllers/commissionPaymentController.js';
// Sprint U3 — réconciliation UnifiedCheckout (plateforme) sur checkout.session.completed.
import { updateCheckout } from '../../checkout/unified/unifiedCheckoutRepository.js';

export async function handlePaymentIntentSucceeded(paymentIntent) {
  const piId = paymentIntent.id;

  // Pré-React — finalisation des commissions via webhook (source serveur de vérité).
  // Reconnaître un PaymentIntent de commission via metadata.commissionPaymentId.
  const commissionPaymentId = paymentIntent?.metadata?.commissionPaymentId;
  if (commissionPaymentId) {
    const result = await finalizeCommissionPaymentById(commissionPaymentId);
    // Idempotent : un replay ou un mois déjà 'paid' ne re-finalise pas.
    if (!result.ok) {
      console.warn(`[DevWebhook] commission PI ${piId}: CommissionPayment introuvable (${commissionPaymentId}).`);
    } else if (result.idempotent) {
      console.log(`[DevWebhook] commission PI ${piId}: déjà finalisé (idempotent).`);
    } else {
      console.log(`[DevWebhook] commission PI ${piId}: CommissionPayment ${commissionPaymentId} marqué payé.`);
    }
    return;
  }

  const intent = await ContractCheckoutIntent.findOne({
    stripePaymentIntentId: piId,
    type: 'launch',
    processed: false
  });

  if (!intent) {
    console.log(`[DevWebhook] payment_intent.succeeded: intent introuvable ou déjà traité (${piId})`);
    return;
  }

  const contract = await Contract.findById(intent.contractId);
  if (!contract) {
    console.warn(`[DevWebhook] Contrat introuvable pour intent ${piId}`);
    return;
  }

  contract.launchFee.paid = true;

  await contract.save();
  intent.processed = true;
  await intent.save();
}

export async function handleSetupIntentSucceeded(setupIntent) {
  const stripeDevClient = await getStripeDevClient();
  const siId = setupIntent.id;
  const customerId = setupIntent.customer;
  const paymentMethodId = setupIntent.payment_method;

  const intent = await ContractCheckoutIntent.findOne({
    stripeSetupIntentId: siId,
    type: 'monthly',
    processed: false
  });

  if (!intent) {
    console.log(`[DevWebhook] setup_intent.succeeded: intent introuvable ou déjà traité (${siId})`);
    return;
  }

  const contract = await Contract.findById(intent.contractId);
  if (!contract) {
    console.warn(`[DevWebhook] Contrat introuvable pour setup intent ${siId}`);
    return;
  }

  if (!stripeDevClient) {
    console.error('[DevWebhook] stripeDevClient non disponible.');
    return;
  }

  // Build subscription with immediate first invoice
  const amountCents = Math.round(
    Number(contract.monthlyFee?.amount || 0) *
    (1 + Number(contract.monthlyFee?.taxRate || 0)) *
    100
  );

  try {
    // Attach payment method to customer
    await stripeDevClient.paymentMethods.attach(paymentMethodId, {
      customer: customerId
    });
    await stripeDevClient.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId }
    });

    // Étape 1 — Créer un Price inline (price_data.product_data non supporté dans subscriptions.create)
    const price = await stripeDevClient.prices.create({
      currency: 'eur',
      unit_amount: Math.round(
        contract.monthlyFee.amount * (1 + contract.monthlyFee.taxRate) * 100
      ),
      recurring: { interval: 'month' },
      product_data: {
        name: 'Maintenance Beauty Savage'
      }
    });

    // Étape 2 — Créer la Subscription avec le Price créé
    const subscription = await stripeDevClient.subscriptions.create({
      customer: customerId,
      items: [{ price: price.id }],
      default_payment_method: paymentMethodId,
      expand: ['latest_invoice.payment_intent'],
      metadata: { contractId: String(contract._id) }
    });

    contract.monthlyFee.stripeSubscriptionId = subscription.id;
    contract.monthlyFee.stripeCustomerId = customerId;

    const latestInvoice = subscription.latest_invoice;
    if (latestInvoice?.payment_intent) {
      contract.monthlyFee.pendingPaymentIntentId = latestInvoice.payment_intent.id;
      contract.monthlyFee.pendingClientSecret = latestInvoice.payment_intent.client_secret;
    }

    if (subscription.current_period_end) {
      contract.monthlyFee.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
    }

    await contract.save();
    intent.processed = true;
    await intent.save();

    console.log(`[DevWebhook] Abonnement ${subscription.id} créé pour contrat ${contract._id}.`);
  } catch (error) {
    console.error('[DevWebhook] Erreur création abonnement', error);
  }
}

export async function handleInvoicePaymentSucceeded(invoice) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  const contract = await Contract.findOne({
    'monthlyFee.stripeSubscriptionId': subscriptionId
  });

  if (!contract) {
    console.log(`[DevWebhook] invoice.payment_succeeded: contrat introuvable pour sub ${subscriptionId}`);
    return;
  }

  if (contract.status === 'cancelled') {
    console.log(`[DevWebhook] invoice.payment_succeeded: contrat ${contract._id} annulé, invoice ignorée.`);
    return;
  }

  contract.monthlyFee.active = true;
  contract.monthlyFee.stripeSubscriptionId = subscriptionId;
  contract.monthlyFee.pendingPaymentIntentId = null;
  contract.monthlyFee.pendingClientSecret = null;

  if (invoice.period_end) {
    contract.monthlyFee.currentPeriodEnd = new Date(invoice.period_end * 1000);
  }

  await contract.save();
}

export async function handleInvoicePaymentFailed(invoice) {
  const subscriptionId = invoice.subscription;
  console.warn(`[DevWebhook] invoice.payment_failed pour abonnement ${subscriptionId || 'inconnu'}`);
}

export async function handleSubscriptionUpdated(subscription) {
  const contract = await Contract.findOne({
    'monthlyFee.stripeSubscriptionId': subscription.id
  });

  if (!contract) return;

  if (subscription.current_period_end) {
    contract.monthlyFee.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
    await contract.save();
    console.log(`[DevWebhook] currentPeriodEnd mis à jour pour contrat ${contract._id}.`);
  }
}

export async function handleSubscriptionDeleted(subscription) {
  const contract = await Contract.findOne({
    'monthlyFee.stripeSubscriptionId': subscription.id
  });

  if (!contract) return;

  contract.status = 'cancelled';
  contract.cancelledAt = new Date();
  contract.monthlyFee.active = false;
  await contract.save();

  invalidateContractCache();
  console.log(`[DevWebhook] Contrat ${contract._id} annulé via customer.subscription.deleted.`);
}

// Sprint U3 — Réconciliation UnifiedCheckout (plateforme) sur checkout.session.completed. La
// finalisation métier reste assurée par les handlers EXISTANTS (payment_intent.succeeded pour
// commission/launch ; setup_intent.succeeded pour l'abonnement). Ici : bookkeeping best-effort.
export async function handleDevCheckoutSessionCompleted(session) {
  const unifiedCheckoutId = String(session?.metadata?.unifiedCheckoutId || session?.metadata?.checkoutId || '').trim();
  if (!unifiedCheckoutId) return;
  const pi = typeof session?.payment_intent === 'string' ? session.payment_intent : session?.payment_intent?.id || null;
  await updateCheckout(unifiedCheckoutId, {
    status: 'finalized',
    'payment.status': 'succeeded',
    'payment.stripePaymentIntentId': pi || null,
    'finalization.finalizedAt': new Date()
  }).catch(() => {});
}
