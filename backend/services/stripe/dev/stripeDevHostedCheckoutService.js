// services/stripe/dev/stripeDevHostedCheckoutService.js
// Sprint U3 — Création de Sessions Stripe Checkout HÉBERGÉES sur le compte PLATEFORME (Stripe Dev),
// pour la commission et les frais de lancement (mode payment) et l'abonnement (mode setup). Le
// client Dev provient du shim (mockable). Aucune logique métier : pures créations de session.

import { getStripeDevClient } from '../../../utils/stripeDevClient.js';
import { resolvePublicUrl } from '../../system/domainResolver.js';

// S1C — les retours du Checkout plateforme (pages /gestion.html servies à la racine du
// domaine public) viennent de SystemConfiguration via le DomainResolver (localhost au
// premier boot). Plus aucune dépendance au tunnel de dev.
function devUrl(pathAndQuery) {
  return resolvePublicUrl(pathAndQuery);
}

async function devClientOrThrow() {
  const stripe = await getStripeDevClient();
  if (!stripe) {
    const e = new Error('Client Stripe Developer non configuré.');
    e.status = 500;
    throw e;
  }
  return stripe;
}

// mode payment : encaisse un montant (commission, frais de lancement). Le PaymentIntent hérite de
// `paymentIntentMetadata` → la finalisation passe par le webhook Dev payment_intent.succeeded EXISTANT.
export async function createDevPaymentCheckoutSession({
  amountCents,
  currency = 'eur',
  productName = 'Beauty Savage',
  sessionMetadata = {},
  paymentIntentMetadata = {},
  successPath = '/gestion.html',
  cancelPath = '/gestion.html'
}) {
  const stripe = await devClientOrThrow();
  return stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      { price_data: { currency, unit_amount: amountCents, product_data: { name: productName } }, quantity: 1 }
    ],
    payment_intent_data: { metadata: paymentIntentMetadata },
    metadata: sessionMetadata,
    success_url: devUrl(successPath),
    cancel_url: devUrl(cancelPath)
  });
}

// mode setup : collecte un moyen de paiement (abonnement). Le SetupIntent → webhook Dev
// setup_intent.succeeded EXISTANT crée la Subscription.
export async function createDevSetupCheckoutSession({
  customerId,
  sessionMetadata = {},
  successPath = '/gestion.html',
  cancelPath = '/gestion.html'
}) {
  const stripe = await devClientOrThrow();
  return stripe.checkout.sessions.create({
    mode: 'setup',
    customer: customerId,
    payment_method_types: ['card'],
    metadata: sessionMetadata,
    success_url: devUrl(successPath),
    cancel_url: devUrl(cancelPath)
  });
}
