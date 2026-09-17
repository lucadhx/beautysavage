// services/integratedApiConnectionTest.service.js
// Test de connexion LECTURE SEULE d'une intégration, par runtime explicite (test|prod
// pour dual_environment, null pour single). Ne crée aucune ressource distante, ne renvoie
// jamais de secret. Un succès estampille `verified` + empreinte (markProviderVerified) ;
// un échec pose `verified=false` + le dernier message (markProviderUnverified).
//
// Endpoints : Stripe GET /v1/account (Bearer) · Brevo GET /v3/account (header api-key).

import IntegratedApi from '../models/IntegratedApi.js';
import {
  resolveTargetRuntime,
  readSpecificCredential,
  markProviderVerified,
  markProviderUnverified,
  IntegratedApiNotFoundError
} from './integratedApiCredentialService.js';

const STRIPE_BASE = 'https://api.stripe.com';
const BREVO_BASE = 'https://api.brevo.com/v3';
const TIMEOUT_MS = 10000;

async function fetchTimed(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const responseTimeMs = Date.now() - startedAt;
    let json = null;
    try { json = await res.json(); } catch (_e) { json = null; }
    return { res, json, responseTimeMs };
  } finally {
    clearTimeout(timer);
  }
}

function stripeKeyMode(secret) {
  if (/^sk_live_/.test(secret)) return 'live';
  if (/^sk_test_/.test(secret)) return 'test';
  return 'inconnu';
}

async function testStripe(effectiveRuntime, secretKey) {
  try {
    const { res, json, responseTimeMs } = await fetchTimed(`${STRIPE_BASE}/v1/account`, {
      headers: { Authorization: `Bearer ${secretKey}` }
    });
    if (res.ok) {
      return {
        status: 'success',
        message: 'Clé Stripe valide.',
        details: {
          account: json?.id || null,
          country: json?.country || null,
          defaultCurrency: json?.default_currency || null,
          chargesEnabled: Boolean(json?.charges_enabled),
          keyMode: stripeKeyMode(secretKey),
          httpStatus: res.status,
          responseTimeMs
        }
      };
    }
    if (res.status === 401) {
      return { status: 'failed', message: 'Clé Stripe invalide (401).', details: { httpStatus: 401, responseTimeMs } };
    }
    return {
      status: 'failed',
      message: `Réponse Stripe inattendue (${res.status}).`,
      details: { httpStatus: res.status, responseTimeMs }
    };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    return { status: 'failed', message: aborted ? 'Délai dépassé (Stripe).' : 'Erreur réseau (Stripe).', details: null };
  }
}

async function testBrevo(effectiveRuntime, apiKey) {
  try {
    const { res, json, responseTimeMs } = await fetchTimed(`${BREVO_BASE}/account`, {
      headers: { 'api-key': apiKey, accept: 'application/json' }
    });
    if (res.ok) {
      return {
        status: 'success',
        message: 'Clé Brevo valide.',
        details: {
          account: json?.companyName || null,
          accountEmail: json?.email || null,
          plan: Array.isArray(json?.plan) ? (json.plan[0]?.type || null) : (json?.plan?.type || null),
          httpStatus: res.status,
          responseTimeMs
        }
      };
    }
    if (res.status === 401) {
      return {
        status: 'failed',
        message: 'Clé Brevo invalide OU IP du serveur non autorisée (401).',
        details: { httpStatus: 401, responseTimeMs }
      };
    }
    return {
      status: 'failed',
      message: `Réponse Brevo inattendue (${res.status}).`,
      details: { httpStatus: res.status, responseTimeMs }
    };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    return { status: 'failed', message: aborted ? 'Délai dépassé (Brevo).' : 'Erreur réseau (Brevo).', details: null };
  }
}

/**
 * Teste la connexion d'une intégration pour un runtime donné et persiste le résultat.
 * @param {string} slug
 * @param {'test'|'prod'|null} [runtime]
 * @returns {Promise<{status:'success'|'failed', message:string, details:object|null, slug:string, runtime:string|null, testedAt:string}>}
 */
export async function testConnection(slug, runtime = null) {
  const api = await IntegratedApi.findOne({ slug: String(slug).toLowerCase() });
  if (!api) throw new IntegratedApiNotFoundError(slug);
  const eff = resolveTargetRuntime(api, runtime); // fail-loud on runtime mismatch

  const secretRole = api.provider === 'brevo' ? 'api_key' : 'secret_key';
  let secret = null;
  try {
    secret = await readSpecificCredential(slug, secretRole, eff);
  } catch (_err) {
    secret = null;
  }

  let result;
  if (!secret) {
    result = { status: 'failed', message: `Aucun credential ${secretRole} configuré pour ce mode.`, details: null };
  } else if (api.provider === 'stripe') {
    result = await testStripe(eff, secret);
  } else if (api.provider === 'brevo') {
    result = await testBrevo(eff, secret);
  } else {
    result = { status: 'failed', message: `Test non supporté pour le fournisseur "${api.provider}".`, details: null };
  }

  if (result.status === 'success') {
    await markProviderVerified(slug, eff, { message: result.message, details: result.details });
  } else {
    await markProviderUnverified(slug, eff, { message: result.message, details: result.details });
  }

  return { ...result, slug: api.slug, runtime: eff, testedAt: new Date().toISOString() };
}

export default testConnection;
