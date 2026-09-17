// services/integratedApiSerializer.js
// Sérialisation MASQUÉE d'un document IntegratedApi pour le frontend DEV.
// GARANTIES : ne renvoie JAMAIS `encryptedValue` ni une valeur en clair. Chaque credential
// configuré est réduit à `configured:true` + `maskedValue` (••••••••••••XXXX). Le `verified`
// est RECALCULÉ à partir de l'empreinte courante (un changement de clé le rend faux).

import { computeRuntimeFingerprint } from './integratedApiCredentialService.js';
import { catalogEntry } from '../utils/integratedApiCatalog.js';

const MASK = '••••••••••••';

function maskedValue(cred) {
  if (!cred) return null;
  const tail = String(cred.lastFourChars || '');
  return `${MASK}${tail}`;
}

function serializeRuntime(api, entry, runtime) {
  const key = runtime ?? null;
  const activeCreds = (api.credentials || []).filter(c => c.isActive === true && (c.runtime ?? null) === key);
  const byRole = new Map(activeCreds.map(c => [String(c.role).toLowerCase(), c]));

  const fields = entry?.fields || [];
  const credentials = fields.map(f => {
    const cred = byRole.get(f.role) || null;
    return {
      role: f.role,
      type: f.type,
      required: Boolean(f.required),
      configured: Boolean(cred),
      maskedValue: cred ? maskedValue(cred) : null,
      isActive: Boolean(cred?.isActive),
      updatedAt: cred?.updatedAt || null,
      expectedPrefix: (f.prefixByMode && (key === 'test' || key === 'prod') ? f.prefixByMode[key] : f.prefix) || null
    };
  });

  const requiredRoles = fields.filter(f => f.required).map(f => f.role);
  const configured = requiredRoles.length > 0 && requiredRoles.every(r => byRole.has(r));

  const v = api.getVerification(key);
  const currentFingerprint = computeRuntimeFingerprint(api, key);
  const verified = Boolean(
    v?.verified && (!v.verifiedFingerprint || v.verifiedFingerprint === currentFingerprint) && currentFingerprint
  );

  return {
    runtime: key,
    isActiveMode: api.runtimeModel === 'dual_environment' ? api.mode === key : true,
    configured,
    verified,
    credentials,
    lastTest: v
      ? {
          status: v.lastTestStatus || null,
          message: v.lastTestMessage || '',
          testedAt: v.lastTestedAt || null,
          details: v.lastTestDetails ?? null,
          verifiedAt: v.verifiedAt || null,
          stale: Boolean(v.verified && v.verifiedFingerprint && v.verifiedFingerprint !== currentFingerprint)
        }
      : null
  };
}

/** Vue masquée complète d'une intégration (jamais de secret). */
export function serializeIntegratedApi(api) {
  const entry = catalogEntry(api.slug);
  const runtimes = api.runtimeModel === 'dual_environment' ? ['test', 'prod'] : [null];
  return {
    slug: api.slug,
    name: api.name,
    provider: api.provider,
    accountPurpose: api.accountPurpose || null,
    runtimeModel: api.runtimeModel,
    mode: api.mode, // mode actif (dual_environment)
    modeUpdatedAt: api.modeUpdatedAt || null,
    confirmVerb: entry?.confirmVerb || null,
    runtimes: runtimes.map(rt => serializeRuntime(api, entry, rt))
  };
}

export default serializeIntegratedApi;
