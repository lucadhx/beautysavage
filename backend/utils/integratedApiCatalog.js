// utils/integratedApiCatalog.js
// Source de vérité unique des intégrations gérables : fournisseur, champs (role/type),
// obligatoire ou non, préfixes attendus par mode, phrase d'activation PROD.
// Aligné sur seeders/seedIntegratedApisFromEnv.js (mêmes slugs / roles / runtimeModel).
// Aucun secret ici.

export const INTEGRATED_API_CATALOG = {
  'stripe-institut': {
    name: 'Stripe Institut',
    provider: 'stripe',
    accountPurpose: 'customer_payments',
    runtimeModel: 'dual_environment',
    confirmVerb: 'ACTIVER STRIPE INSTITUT PROD',
    fields: [
      { role: 'secret_key', type: 'secret_key', required: true, secret: true, prefixByMode: { test: 'sk_test_', prod: 'sk_live_' } },
      { role: 'publishable_key', type: 'publishable_key', required: false, secret: true, prefixByMode: { test: 'pk_test_', prod: 'pk_live_' } },
      { role: 'webhook_secret', type: 'webhook_secret', required: true, secret: true, prefix: 'whsec_' }
    ]
  },
  'stripe-dev': {
    name: 'Stripe Developer',
    provider: 'stripe',
    accountPurpose: 'platform_billing',
    runtimeModel: 'dual_environment',
    confirmVerb: 'ACTIVER STRIPE DEV PROD',
    fields: [
      { role: 'secret_key', type: 'secret_key', required: true, secret: true, prefixByMode: { test: 'sk_test_', prod: 'sk_live_' } },
      { role: 'publishable_key', type: 'publishable_key', required: false, secret: true, prefixByMode: { test: 'pk_test_', prod: 'pk_live_' } },
      { role: 'webhook_secret', type: 'webhook_secret', required: true, secret: true, prefix: 'whsec_' }
    ]
  },
  brevo: {
    name: 'Brevo',
    provider: 'brevo',
    accountPurpose: 'messaging',
    runtimeModel: 'single',
    confirmVerb: 'ACTIVER BREVO PROD',
    fields: [
      { role: 'api_key', type: 'api_key', required: true, secret: true, prefix: 'xkeysib-' },
      { role: 'webhook_secret', type: 'webhook_secret', required: false, secret: true }
    ]
  }
};

/** Liste des slugs gérables. */
export function catalogSlugs() {
  return Object.keys(INTEGRATED_API_CATALOG);
}

/** Entrée catalogue d'un slug (ou null). */
export function catalogEntry(slug) {
  return INTEGRATED_API_CATALOG[String(slug || '').toLowerCase()] || null;
}

/** Définition d'un champ (role) pour un slug (ou null). */
export function catalogField(slug, role) {
  const entry = catalogEntry(slug);
  if (!entry) return null;
  return entry.fields.find(f => f.role === String(role || '').toLowerCase()) || null;
}

/** Runtimes attendus d'un slug : ['test','prod'] (dual) ou [null] (single). */
export function catalogRuntimes(slug) {
  const entry = catalogEntry(slug);
  if (!entry) return [null];
  return entry.runtimeModel === 'dual_environment' ? ['test', 'prod'] : [null];
}

/**
 * Valide/normalise une valeur de credential (préfixe par mode). Fail-loud.
 * @param {string} slug
 * @param {string} role
 * @param {string} value valeur en clair saisie
 * @param {'test'|'prod'|null} runtime
 * @returns {string} valeur nettoyée (trim)
 * @throws {Error} avec `.code` métier si vide ou préfixe invalide.
 */
export function validateCredentialFormat(slug, role, value, runtime) {
  const clean = String(value ?? '').trim();
  if (!clean) {
    const e = new Error('Valeur vide.');
    e.code = 'EMPTY_CREDENTIAL';
    throw e;
  }
  const field = catalogField(slug, role);
  if (!field) return clean; // champ hors catalogue → pas de contrainte de format

  let expected = null;
  if (field.prefixByMode && (runtime === 'test' || runtime === 'prod')) {
    expected = field.prefixByMode[runtime];
  } else if (field.prefix) {
    expected = field.prefix;
  }
  if (expected && !clean.startsWith(expected)) {
    const e = new Error(`Préfixe attendu "${expected}" pour ${slug}/${role}${runtime ? ` (${runtime})` : ''}.`);
    e.code = 'INVALID_CREDENTIAL_PREFIX';
    throw e;
  }
  return clean;
}

export default INTEGRATED_API_CATALOG;
