import { config } from '../config/env.js';
import { InstituteIntegration } from '../models/InstituteIntegration.model.js';
import { ApiError } from '../utils/ApiError.js';
import { decryptSecret, encryptSecret, lastFourOf } from '../utils/integratedApiCrypto.js';
import { verifyWebhookSignature } from './stripe/stripe.service.js';

const STRIPE_API = 'https://api.stripe.com/v1';

function formBody(value, prefix = '') {
  const params = new URLSearchParams();
  function append(obj, keyPrefix) {
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => append(item, `${keyPrefix}[${index}]`));
      return;
    }
    if (obj && typeof obj === 'object') {
      for (const [key, child] of Object.entries(obj)) append(child, keyPrefix ? `${keyPrefix}[${key}]` : key);
      return;
    }
    if (obj !== undefined && obj !== null) params.append(keyPrefix, String(obj));
  }
  append(value, prefix);
  return params;
}

function clearSecret(ref) {
  if (!ref?.encryptedValue) return '';
  return decryptSecret(ref.encryptedValue);
}

/**
 * L'ENVIRONNEMENT DU SERVEUR CHOISIT LES CLÉS — `ENV=PROD` lit les clés PROD
 * (live) de l'institut, `ENV=TEST` les clés de test. Plus de bascule « mode »
 * réglée à la main, qui pouvait encaisser en réel depuis la recette (ou
 * l'inverse).
 */
export function activeInstituteMode() {
  return config.env === 'PROD' ? 'PROD' : 'TEST';
}

const KEY_PATTERNS = {
  TEST: { secretKey: /^(sk|rk)_test_/, publicKey: /^pk_test_/ },
  PROD: { secretKey: /^(sk|rk)_live_/, publicKey: /^pk_live_/ },
};

/** Une clé de test en PROD (ou live en TEST) est refusée, avec la raison. */
export function assertInstituteKeyMatchesMode(kind, value, mode = activeInstituteMode()) {
  const pattern = KEY_PATTERNS[mode]?.[kind];
  if (!pattern || !value) return;
  if (!pattern.test(String(value))) {
    const expected = mode === 'PROD' ? (kind === 'publicKey' ? 'pk_live_…' : 'sk_live_… (ou rk_live_…)') : (kind === 'publicKey' ? 'pk_test_…' : 'sk_test_… (ou rk_test_…)');
    throw ApiError.badRequest(`Ce site tourne en ${mode} : la ${kind === 'publicKey' ? 'clé publique' : 'clé secrète'} doit commencer par ${expected}.`);
  }
}

/** Le jeu de clés de l'environnement courant. */
export function instituteSlot(doc, mode = activeInstituteMode()) {
  return doc?.modes?.[mode] || null;
}

export async function getStripeInstituteIntegration() {
  const integration = await InstituteIntegration.findOne({ provider: 'STRIPE_INSTITUTE' });
  const mode = activeInstituteMode();
  const slot = instituteSlot(integration, mode);
  if (!integration || !slot?.secretKey?.encryptedValue) {
    throw ApiError.badRequest(`Stripe Institut non configuré pour l'environnement ${mode}`);
  }
  const secretKey = clearSecret(slot.secretKey);
  assertInstituteKeyMatchesMode('secretKey', secretKey, mode);
  return { integration, slot, mode, secretKey, webhookSecret: clearSecret(slot.webhookSecret) };
}

/** Prêt à encaisser : clés de l'environnement courant enregistrées et vérifiées. */
export async function instituteStripeReady() {
  const integration = await InstituteIntegration.findOne({ provider: 'STRIPE_INSTITUTE' }).lean();
  return Boolean(instituteSlot(integration)?.verified);
}

async function stripeRequest(secretKey, method, path, body, idempotencyKey = '') {
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers,
    body: body ? formBody(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw ApiError.badRequest(json.error?.message || 'Appel Stripe Institut refuse', { stripe: json.error || json });
  }
  return json;
}

/** Une remise à usage unique (part payée par carte cadeau) : la session détaille les articles, puis la déduit. */
export async function createInstituteCoupon({ amountOffCents, name, idempotencyKey }) {
  const { secretKey } = await getStripeInstituteIntegration();
  return stripeRequest(secretKey, 'POST', '/coupons', {
    amount_off: amountOffCents,
    currency: 'eur',
    duration: 'once',
    max_redemptions: 1,
    name: String(name || 'Carte cadeau').slice(0, 40),
  }, idempotencyKey);
}

export async function createInstituteCheckoutSession({ sale, customer, lineItems, successUrl, cancelUrl, expiresInMinutes = null, discounts = null, invoice = true }) {
  const { slot, mode, secretKey } = await getStripeInstituteIntegration();
  if (!slot.verified) {
    throw ApiError.badRequest('Stripe Institut doit etre verifie avant un encaissement client reel');
  }
  const body = {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: String(sale._id),
    customer_email: customer.email,
    metadata: {
      saleId: String(sale._id),
      saleNumber: sale.saleNumber,
      project: 'beautysavage',
      mode,
    },
    payment_intent_data: {
      metadata: {
        saleId: String(sale._id),
        saleNumber: sale.saleNumber,
      },
    },
    line_items: lineItems,
    ...(discounts?.length ? { discounts } : {}),
    /**
     * LA FACTURE STRIPE DE LA CLIENTE — émise après paiement, une ligne par
     * article et par option, la carte cadeau en remise. Aucune commission n'y
     * figure : elle concerne l'institut et la plateforme, pas la cliente.
     */
    ...(invoice ? {
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description: `Commande ${sale.saleNumber}`,
          metadata: { saleId: String(sale._id), saleNumber: sale.saleNumber },
        },
      },
    } : {}),
    // Une session qui retient le solde d'une carte cadeau ne le garde pas une journée (30 min : minimum Stripe).
    ...(expiresInMinutes ? { expires_at: Math.floor(Date.now() / 1000) + Math.max(30, expiresInMinutes) * 60 } : {}),
  };
  return stripeRequest(secretKey, 'POST', '/checkout/sessions', body, `checkout:${sale.idempotencyKey}`);
}

/**
 * Ferme une session encore ouverte : elle ne pourra plus être payée. Une
 * session déjà close (payée ou expirée) est simplement relue.
 */
export async function expireInstituteCheckoutSession(sessionId) {
  const { secretKey } = await getStripeInstituteIntegration();
  try {
    return await stripeRequest(secretKey, 'POST', `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, {});
  } catch {
    return stripeRequest(secretKey, 'GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`, null);
  }
}

export async function retrieveInstituteInvoice(invoiceId) {
  const { secretKey } = await getStripeInstituteIntegration();
  return stripeRequest(secretKey, 'GET', `/invoices/${encodeURIComponent(invoiceId)}`, null);
}

/**
 * Le paiement tel que Stripe l'a encaissé : montant, COMMISSION Stripe, net
 * versé, moyen de paiement, reçu. Lecture seule.
 */
export async function retrieveInstitutePaymentDetails(paymentIntentId) {
  const { secretKey, mode } = await getStripeInstituteIntegration();
  const pi = await stripeRequest(secretKey, 'GET', `/payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge.balance_transaction`, null);
  const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  const bt = charge?.balance_transaction && typeof charge.balance_transaction === 'object' ? charge.balance_transaction : null;
  const card = charge?.payment_method_details?.card || null;
  const method = charge?.payment_method_details?.type || pi.payment_method_types?.[0] || '';
  return {
    paymentIntentId: pi.id,
    status: pi.status,
    mode,
    amountCents: Number(pi.amount_received ?? pi.amount ?? 0),
    currency: String(pi.currency || 'eur').toUpperCase(),
    feeCents: bt ? Number(bt.fee || 0) : null,
    netCents: bt ? Number(bt.net || 0) : null,
    feeDetails: (bt?.fee_details || []).map((f) => ({ amountCents: Number(f.amount || 0), description: f.description || f.type || '' })),
    availableOn: bt?.available_on ? new Date(bt.available_on * 1000).toISOString() : null,
    refundedCents: Number(charge?.amount_refunded || 0),
    method,
    card: card ? { brand: card.brand || '', last4: card.last4 || '', expMonth: card.exp_month || null, expYear: card.exp_year || null, country: card.country || '', wallet: card.wallet?.type || '' } : null,
    receiptUrl: charge?.receipt_url || '',
    paidAt: charge?.created ? new Date(charge.created * 1000).toISOString() : null,
    dashboardUrl: `https://dashboard.stripe.com/${mode === 'PROD' ? '' : 'test/'}payments/${pi.id}`,
  };
}

export async function retrieveInstituteCheckoutSession(sessionId) {
  const { secretKey } = await getStripeInstituteIntegration();
  return stripeRequest(secretKey, 'GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`, null);
}

export async function refundInstitutePayment({ paymentIntentId, amountCents, reason, saleId }) {
  const { secretKey } = await getStripeInstituteIntegration();
  return stripeRequest(secretKey, 'POST', '/refunds', {
    payment_intent: paymentIntentId,
    amount: amountCents,
    reason: 'requested_by_customer',
    metadata: { saleId: String(saleId), reason: String(reason || '').slice(0, 450) },
  }, `refund:${saleId}:${amountCents}`);
}

/**
 * Les événements écoutés — tout ce qui fait passer une vente de « en cours »
 * à « payée », « échouée », « expirée » ou « remboursée ». Les paiements
 * différés (virement, prélèvement…) arrivent en `async_payment_succeeded` :
 * sans lui, ils restaient « échoués » chez nous alors que l'argent arrivait.
 */
export const INSTITUTE_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payment_intent.payment_failed',
  'charge.refunded',
];

export async function provisionInstituteStripeWebhook() {
  const { integration, slot, mode, secretKey } = await getStripeInstituteIntegration();
  const url = `${config.publicUrl}/api/webhooks/stripe-institute`;
  // L'ancienne adresse est retirée : sinon elle continue d'être appelée, avec
  // un secret qui n'est plus le nôtre, et Stripe réessaie pendant des jours.
  if (slot.webhookEndpointId) {
    await stripeRequest(secretKey, 'DELETE', `/webhook_endpoints/${encodeURIComponent(slot.webhookEndpointId)}`, null).catch(() => null);
  }
  const body = {
    url,
    enabled_events: INSTITUTE_WEBHOOK_EVENTS,
    metadata: { project: 'beautysavage', provider: 'STRIPE_INSTITUTE', mode },
  };
  const endpoint = await stripeRequest(secretKey, 'POST', '/webhook_endpoints', body, `webhook:${url}:${mode}:${Date.now()}`);
  slot.webhookEndpointId = endpoint.id || '';
  slot.webhookUrl = url;
  slot.webhookLastProvisionedAt = new Date();
  slot.webhookLastError = '';
  if (endpoint.secret) {
    slot.webhookSecret = {
      encryptedValue: encryptSecret(endpoint.secret),
      lastFour: lastFourOf(endpoint.secret),
      verifiedAt: new Date(),
    };
  }
  integration.markModified(`modes.${mode}`);
  await integration.save();
  return integration;
}

export async function verifyInstituteStripeWebhook(rawBody, signature) {
  const doc = await InstituteIntegration.findOne({ provider: 'STRIPE_INSTITUTE' });
  const slot = instituteSlot(doc);
  const secret = slot?.webhookSecret?.encryptedValue ? decryptSecret(slot.webhookSecret.encryptedValue) : '';
  return Boolean(secret && verifyWebhookSignature(rawBody, signature, secret));
}
