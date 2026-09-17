// services/stripe/stripeConfigService.js
// Sprint F2 — Extraction PUREMENT STRUCTURELLE de la configuration Stripe (compte institut)
// hors de stripeController. Aucune modification de comportement.
//
// Source unique du client Stripe et des credentials (coffre IntegratedApi, fallback .env via
// le vault pendant la migration). `getStripeClient` propage l'erreur si la secret_key manque
// (comportement de l'ancien `getStripe`) ; les lectures publishable_key / webhook_secret
// renvoient '' en cas d'échec (comportement de `getConfig` / `handleWebhook`).

import Stripe from 'stripe';
import { getCredential } from '../integratedApiCredentialService.js';

export async function getStripeClient() {
  // Credential sourced from the IntegratedApi vault (env fallback during migration).
  const secretKey = await getCredential('stripe-institut', { role: 'secret_key' });
  return new Stripe(secretKey);
}

export async function getStripePublishableKey() {
  try {
    return await getCredential('stripe-institut', { role: 'publishable_key' });
  } catch (_err) {
    return '';
  }
}

export async function getStripeWebhookSecret() {
  try {
    return await getCredential('stripe-institut', { role: 'webhook_secret' });
  } catch (_err) {
    return '';
  }
}
