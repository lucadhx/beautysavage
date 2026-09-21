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

export async function getStripeInstituteIntegration() {
  const integration = await InstituteIntegration.findOne({ provider: 'STRIPE_INSTITUTE' });
  if (!integration) throw ApiError.badRequest('Stripe Institut non configure');
  const secretKey = clearSecret(integration.secretKey);
  if (!secretKey || !secretKey.startsWith('sk_')) {
    throw ApiError.badRequest('Cle secrete Stripe Institut invalide ou absente');
  }
  return { integration, secretKey, webhookSecret: clearSecret(integration.webhookSecret) };
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

export async function createInstituteCheckoutSession({ sale, customer, lineItems, successUrl, cancelUrl }) {
  const { integration, secretKey } = await getStripeInstituteIntegration();
  if (!integration.verified) {
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
      mode: integration.mode,
    },
    payment_intent_data: {
      metadata: {
        saleId: String(sale._id),
        saleNumber: sale.saleNumber,
      },
    },
    line_items: lineItems,
  };
  return stripeRequest(secretKey, 'POST', '/checkout/sessions', body, `checkout:${sale.idempotencyKey}`);
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

export async function provisionInstituteStripeWebhook() {
  const { integration, secretKey } = await getStripeInstituteIntegration();
  const url = `${config.publicUrl}/api/webhooks/stripe-institute`;
  const body = {
    url,
    enabled_events: [
      'checkout.session.completed',
      'checkout.session.async_payment_failed',
      'payment_intent.payment_failed',
      'charge.refunded',
    ],
    metadata: { project: 'beautysavage', provider: 'STRIPE_INSTITUTE', mode: integration.mode },
  };
  const endpoint = await stripeRequest(secretKey, 'POST', '/webhook_endpoints', body, `webhook:${url}:${integration.mode}`);
  integration.webhookEndpointId = endpoint.id || '';
  integration.webhookUrl = url;
  integration.webhookLastProvisionedAt = new Date();
  integration.webhookLastError = '';
  if (endpoint.secret) {
    integration.webhookSecret = {
      encryptedValue: encryptSecret(endpoint.secret),
      lastFour: lastFourOf(endpoint.secret),
      verifiedAt: new Date(),
    };
  }
  await integration.save();
  return integration;
}

export async function verifyInstituteStripeWebhook(rawBody, signature) {
  const doc = await InstituteIntegration.findOne({ provider: 'STRIPE_INSTITUTE' });
  const secret = doc?.webhookSecret?.encryptedValue ? decryptSecret(doc.webhookSecret.encryptedValue) : '';
  return Boolean(secret && verifyWebhookSignature(rawBody, signature, secret));
}
