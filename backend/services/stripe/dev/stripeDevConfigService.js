// services/stripe/dev/stripeDevConfigService.js
// Sprint F2B — Extraction PUREMENT STRUCTURELLE de la configuration Stripe **Dev / plateforme**
// (compte distinct de l'Institut : l'institut paie la plateforme — commissions, frais de
// lancement, abonnement). Aucune modification de comportement.
//
// Source unique du client Stripe Dev et de ses credentials (coffre IntegratedApi slug
// "stripe-dev", accountPurpose: platform_billing ; fallback .env pendant la migration). Le
// compte Dev est OPTIONNEL : `getStripeDevClient` renvoie `null` si aucun secret n'est
// disponible (tolérance historique). `utils/stripeDevClient.js` est conservé comme shim
// re-exportant `getStripeDevClient` (accesseur mockable par les tests).

import Stripe from 'stripe';
import IntegratedApi from '../../../models/IntegratedApi.js';
import { getCredential } from '../../integratedApiCredentialService.js';

let cachedClient = null;
let cachedKey = null;

export async function getStripeDevClient() {
  let key = null;
  try {
    key = await getCredential('stripe-dev', { role: 'secret_key' });
  } catch (_err) {
    key = null; // no dev secret configured → optional client unavailable
  }

  if (!key) {
    cachedClient = null;
    cachedKey = null;
    return null;
  }

  if (cachedClient && cachedKey === key) return cachedClient;
  cachedClient = new Stripe(key, { apiVersion: '2024-06-20' });
  cachedKey = key;
  return cachedClient;
}

export async function getStripeDevPublishableKey() {
  try {
    return await getCredential('stripe-dev', { role: 'publishable_key' });
  } catch (_err) {
    return '';
  }
}

export async function getStripeDevWebhookSecret() {
  try {
    return await getCredential('stripe-dev', { role: 'webhook_secret' });
  } catch (_err) {
    return '';
  }
}

// Garde de cohérence (lecture seule) : le compte Dev doit porter accountPurpose
// 'platform_billing'. Renvoie l'accountPurpose résolu (ou null en legacy non backfillé). Ne
// bloque AUCUN flux (le seed backfille accountPurpose) — sert à la validation/observabilité.
export async function getStripeDevAccountPurpose() {
  const api = await IntegratedApi.findOne({ slug: 'stripe-dev' }).select({ accountPurpose: 1 }).lean();
  return api?.accountPurpose || null;
}

export default getStripeDevClient;
