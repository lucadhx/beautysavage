// services/integratedApiCredentialService.js
// Fail-loud accessor for third-party credentials stored in the IntegratedApi vault.
//
// Resolution order:
//   1. VAULT FIRST  — read the active credential from the IntegratedApi document.
//   2. ENV FALLBACK — ONLY if ALLOW_ENV_CREDENTIAL_FALLBACK==='true' (migration phase).
//   3. FAIL LOUD    — otherwise throw a typed error. Never a silent fallback, never a
//                     network call with a placeholder.
//
// The vault always takes priority over .env when a credential is present.

import crypto from 'node:crypto';
import IntegratedApi from '../models/IntegratedApi.js';
import { decryptCredential, isUnfilledSentinel } from '../utils/credentialVault.js';

// --- Typed errors ----------------------------------------------------------
export class IntegratedApiNotFoundError extends Error {
  constructor(slug) { super(`[credentialService] integration not found: ${slug}`); this.name = 'IntegratedApiNotFoundError'; this.slug = slug; }
}
export class CredentialNotFoundError extends Error {
  constructor(slug, role, runtime) { super(`[credentialService] no active credential: ${slug}/${role} (runtime=${runtime ?? 'null'})`); this.name = 'CredentialNotFoundError'; this.slug = slug; this.role = role; this.runtime = runtime ?? null; }
}
export class RuntimeMismatchError extends Error {
  constructor(slug, runtimeModel, provided) { super(`[credentialService] runtime mismatch for ${slug}: runtimeModel=${runtimeModel}, provided=${provided}`); this.name = 'RuntimeMismatchError'; this.slug = slug; this.runtimeModel = runtimeModel; this.provided = provided; }
}
export class ConfigMissingError extends Error {
  constructor(slug) { super(`[credentialService] dual_environment integration ${slug} has no resolvable runtime (mode invalid).`); this.name = 'ConfigMissingError'; this.slug = slug; }
}
export class CredentialUnfilledError extends Error {
  constructor(slug, role, runtime) { super(`[credentialService] credential is an unfilled placeholder: ${slug}/${role} (runtime=${runtime ?? 'null'})`); this.name = 'CredentialUnfilledError'; this.slug = slug; this.role = role; this.runtime = runtime ?? null; }
}

// --- .env fallback mapping (migration only) --------------------------------
const ENV_FALLBACK = {
  'stripe-institut': { secret_key: 'STRIPE_SECRET_KEY', publishable_key: 'STRIPE_PUBLISHABLE_KEY', webhook_secret: 'STRIPE_WEBHOOK_SECRET' },
  'stripe-dev': { secret_key: 'STRIPE_DEV_SECRET_KEY', publishable_key: 'STRIPE_DEV_PUBLISHABLE_KEY', webhook_secret: 'STRIPE_DEV_WEBHOOK_SECRET' },
  brevo: { api_key: 'BREVO_API_KEY' }
};

function fallbackEnabled() {
  // S1C — politique UNIFORME (aucune logique d'environnement). Le fallback .env des
  // credentials est un opt-in EXPLICITE : actif si et seulement si
  // ALLOW_ENV_CREDENTIAL_FALLBACK==='true'. La sécurité vient de la clé de coffre,
  // désormais OBLIGATOIRE au boot (le coffre est toujours la source officielle).
  return String(process.env.ALLOW_ENV_CREDENTIAL_FALLBACK || '').trim() === 'true';
}

const _warnedFallback = new Set();
function readEnvFallback(slug, role) {
  if (!fallbackEnabled()) return null;
  const envName = ENV_FALLBACK[slug]?.[role];
  if (!envName) return null;
  const val = String(process.env[envName] || '').trim();
  if (!val) return null;
  const key = `${slug}/${role}`;
  if (!_warnedFallback.has(key)) {
    _warnedFallback.add(key);
    // No secret value is ever logged — only slug/role and the env var name.
    console.warn(`[credentialService] vault miss for ${key} — using temporary .env fallback (${envName}). Seed the vault to remove this.`);
  }
  return val;
}

// --- Runtime resolution ----------------------------------------------------
function resolveEffectiveRuntime(api, runtime) {
  if (api.runtimeModel === 'single') {
    if (runtime != null) throw new RuntimeMismatchError(api.slug, api.runtimeModel, runtime);
    return null;
  }
  // dual_environment
  const eff = runtime || api.mode;
  if (eff !== 'test' && eff !== 'prod') throw new ConfigMissingError(api.slug);
  return eff;
}

function findActiveCredential(api, role, effectiveRuntime) {
  const roleKey = String(role).toLowerCase();
  return (api.credentials || []).find(
    c => c.isActive === true && String(c.role).toLowerCase() === roleKey && (c.runtime ?? null) === (effectiveRuntime ?? null)
  ) || null;
}

// --- Public API ------------------------------------------------------------

/**
 * Get a single credential value (fail-loud).
 * @param {string} slug
 * @param {{role?: string, runtime?: 'test'|'prod'|null}} [opts]
 * @returns {Promise<string>} decrypted credential value
 */
export async function getCredential(slug, { role = 'default', runtime = null } = {}) {
  if (!slug || typeof slug !== 'string') throw new Error('[credentialService] slug is required.');

  const api = await IntegratedApi.findOne({ slug: String(slug).toLowerCase() });

  if (api) {
    const effectiveRuntime = resolveEffectiveRuntime(api, runtime); // may throw (fail-loud)
    const cred = findActiveCredential(api, role, effectiveRuntime);
    if (cred) {
      const clear = decryptCredential(cred.encryptedValue); // throws on tamper/missing key
      if (isUnfilledSentinel(clear)) throw new CredentialUnfilledError(slug, role, effectiveRuntime);
      return clear; // VAULT WINS
    }
  }

  // Vault miss — temporary .env fallback (migration) if explicitly enabled.
  const fromEnv = readEnvFallback(String(slug).toLowerCase(), role);
  if (fromEnv) return fromEnv;

  // Fail loud.
  if (!api) throw new IntegratedApiNotFoundError(slug);
  throw new CredentialNotFoundError(slug, role, runtime);
}

/**
 * Get all active credentials for an integration as { role: value }.
 * @param {string} slug
 * @param {{runtime?: 'test'|'prod'|null}} [opts]
 * @returns {Promise<Record<string,string>>}
 */
export async function getCredentials(slug, { runtime = null } = {}) {
  if (!slug || typeof slug !== 'string') throw new Error('[credentialService] slug is required.');
  const lower = String(slug).toLowerCase();
  const api = await IntegratedApi.findOne({ slug: lower });

  if (api) {
    const effectiveRuntime = resolveEffectiveRuntime(api, runtime);
    const out = {};
    for (const c of api.credentials || []) {
      if (c.isActive !== true) continue;
      if ((c.runtime ?? null) !== (effectiveRuntime ?? null)) continue;
      const clear = decryptCredential(c.encryptedValue);
      if (!isUnfilledSentinel(clear)) out[String(c.role).toLowerCase()] = clear;
    }
    if (Object.keys(out).length > 0) return out;
  }

  // Fallback (migration): assemble from env map.
  if (fallbackEnabled() && ENV_FALLBACK[lower]) {
    const out = {};
    for (const [role, envName] of Object.entries(ENV_FALLBACK[lower])) {
      const val = String(process.env[envName] || '').trim();
      if (val) out[role] = val;
    }
    if (Object.keys(out).length > 0) return out;
  }

  if (!api) throw new IntegratedApiNotFoundError(slug);
  throw new CredentialNotFoundError(slug, '*', runtime);
}

/**
 * Set the active mode (test|prod) of a dual_environment integration.
 * @param {string} slug
 * @param {'test'|'prod'} mode
 * @returns {Promise<{slug:string, mode:string, runtimeModel:string}>}
 */
export async function setIntegratedApiMode(slug, mode) {
  if (mode !== 'test' && mode !== 'prod') throw new Error(`[credentialService] invalid mode: ${mode}`);
  const api = await IntegratedApi.findOne({ slug: String(slug).toLowerCase() });
  if (!api) throw new IntegratedApiNotFoundError(slug);
  api.mode = mode;
  api.modeUpdatedAt = new Date();
  await api.save();
  return { slug: api.slug, mode: api.mode, runtimeModel: api.runtimeModel };
}

// ---------------------------------------------------------------------------
// Résolution de runtime & lecture ciblée (surface de gestion / test de connexion)
// ---------------------------------------------------------------------------

/**
 * Runtime EFFECTIF d'un document pour un runtime demandé (peut throw, fail-loud).
 * single → null ; dual_environment → runtime || api.mode (∈ {test,prod}).
 * @param {import('mongoose').Document} api
 * @param {'test'|'prod'|null} [runtime]
 * @returns {'test'|'prod'|null}
 */
export function resolveTargetRuntime(api, runtime = null) {
  return resolveEffectiveRuntime(api, runtime);
}

/**
 * Lit un credential précis (slug, role, runtime effectif) SANS résolution de mode.
 * Utilisé par le test de connexion qui cible un jeu (test|prod) explicite.
 * @returns {Promise<string|null>} valeur en clair, ou null si absent/placeholder.
 */
export async function readSpecificCredential(slug, role, effectiveRuntime) {
  const api = await IntegratedApi.findOne({ slug: String(slug).toLowerCase() });
  if (!api) throw new IntegratedApiNotFoundError(slug);
  const cred = findActiveCredential(api, role, effectiveRuntime ?? null);
  if (!cred) return null;
  const clear = decryptCredential(cred.encryptedValue);
  if (isUnfilledSentinel(clear)) return null;
  return clear;
}

// ---------------------------------------------------------------------------
// Empreinte & état "verified" (par runtime)
// ---------------------------------------------------------------------------

/**
 * Empreinte sha256 des credentials ACTIFS d'un runtime (sur `encryptedValue`, jamais le
 * clair). Change dès qu'un credential est ajouté / remplacé / supprimé → invalide `verified`.
 * @returns {string} hex, '' si aucun credential actif pour ce runtime.
 */
export function computeRuntimeFingerprint(api, effectiveRuntime) {
  const key = effectiveRuntime ?? null;
  const parts = (api.credentials || [])
    .filter(c => c.isActive === true && (c.runtime ?? null) === key)
    .map(c => `${String(c.role).toLowerCase()}:${c.encryptedValue}`)
    .sort();
  if (parts.length === 0) return '';
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * `verified` valide POUR L'EMPREINTE COURANTE. Un changement de clé invalide le verified.
 * @returns {Promise<boolean>}
 */
export async function isProviderVerified(slug, runtime = null) {
  const api = await IntegratedApi.findOne({ slug: String(slug).toLowerCase() });
  if (!api) return false;
  const eff = resolveEffectiveRuntime(api, runtime);
  const v = api.getVerification(eff);
  if (!v?.verified) return false;
  if (!v.verifiedFingerprint) return true; // rétro-compat (jamais posé)
  const current = computeRuntimeFingerprint(api, eff);
  return Boolean(current) && current === v.verifiedFingerprint;
}

/** Marque un runtime comme vérifié (seul writer de verified=true, avec empreinte). */
export async function markProviderVerified(slug, runtime, { message = '', details = null } = {}) {
  const api = await IntegratedApi.findOne({ slug: String(slug).toLowerCase() });
  if (!api) throw new IntegratedApiNotFoundError(slug);
  const eff = resolveEffectiveRuntime(api, runtime);
  api.setVerification(eff, {
    verified: true,
    verifiedAt: new Date(),
    verifiedFingerprint: computeRuntimeFingerprint(api, eff),
    lastTestedAt: new Date(),
    lastTestStatus: 'success',
    lastTestMessage: String(message || ''),
    lastTestDetails: details ?? null
  });
  await api.save();
  return api.getVerification(eff);
}

/** Marque un runtime comme NON vérifié (échec de test) sans effacer les credentials. */
export async function markProviderUnverified(slug, runtime, { message = '', details = null } = {}) {
  const api = await IntegratedApi.findOne({ slug: String(slug).toLowerCase() });
  if (!api) throw new IntegratedApiNotFoundError(slug);
  const eff = resolveEffectiveRuntime(api, runtime);
  api.setVerification(eff, {
    verified: false,
    verifiedAt: null,
    verifiedFingerprint: '',
    lastTestedAt: new Date(),
    lastTestStatus: 'failed',
    lastTestMessage: String(message || ''),
    lastTestDetails: details ?? null
  });
  await api.save();
  return api.getVerification(eff);
}

// Exposed for tests / docs (no secret values).
export const __ENV_FALLBACK_MAP = ENV_FALLBACK;
