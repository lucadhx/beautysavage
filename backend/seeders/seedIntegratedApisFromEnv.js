// seeders/seedIntegratedApisFromEnv.js
// Idempotent pre-seed of the IntegratedApi vault from the existing .env secrets.
//
// Seeds three integrations (mono-tenant): stripe-institut, stripe-dev, brevo.
// Reads the current .env values, encrypts them, and stores them. Runtime for
// dual_environment providers is derived from the key PREFIX:
//   sk_test_ / pk_test_ -> test     sk_live_ / pk_live_ -> prod
// webhook_secret (whsec_, no env indicator) is attached to the SAME runtime as
// the account's secret_key (documented coupling).
//
// IMPORTANT: never logs a secret value. Idempotent: re-running does not duplicate
// credentials; a role already present (active, for that runtime) is left untouched.

import IntegratedApi from '../models/IntegratedApi.js';
import { encryptCredential, lastFour, validateCredentialVaultKey } from '../utils/credentialVault.js';

function detectRuntimeFromValue(value) {
  const v = String(value || '');
  if (/^sk_test_|^pk_test_/.test(v)) return 'test';
  if (/^sk_live_|^pk_live_/.test(v)) return 'prod';
  return null; // unknown — caller decides
}

const DEFINITIONS = [
  {
    slug: 'stripe-institut',
    name: 'Stripe Institut',
    provider: 'stripe',
    accountPurpose: 'customer_payments',
    runtimeModel: 'dual_environment',
    roles: [
      { role: 'secret_key', type: 'secret_key', env: 'STRIPE_SECRET_KEY', drivesMode: true },
      { role: 'publishable_key', type: 'publishable_key', env: 'STRIPE_PUBLISHABLE_KEY' },
      { role: 'webhook_secret', type: 'webhook_secret', env: 'STRIPE_WEBHOOK_SECRET', followsSecretRuntime: true }
    ]
  },
  {
    slug: 'stripe-dev',
    name: 'Stripe Developer',
    provider: 'stripe',
    accountPurpose: 'platform_billing',
    runtimeModel: 'dual_environment',
    roles: [
      { role: 'secret_key', type: 'secret_key', env: 'STRIPE_DEV_SECRET_KEY', drivesMode: true },
      { role: 'publishable_key', type: 'publishable_key', env: 'STRIPE_DEV_PUBLISHABLE_KEY' },
      { role: 'webhook_secret', type: 'webhook_secret', env: 'STRIPE_DEV_WEBHOOK_SECRET', followsSecretRuntime: true }
    ]
  },
  {
    slug: 'brevo',
    name: 'Brevo',
    provider: 'brevo',
    accountPurpose: 'messaging',
    runtimeModel: 'single',
    roles: [
      { role: 'api_key', type: 'api_key', env: 'BREVO_API_KEY' },
      // Sprint pré-React A3 — secret partagé du webhook Brevo. Optionnel hors prod
      // (rôle seedé seulement si BREVO_WEBHOOK_SECRET est défini), OBLIGATOIRE en
      // production (le contrôleur refuse en 503 si absent). Jamais loggé.
      { role: 'webhook_secret', type: 'webhook_secret', env: 'BREVO_WEBHOOK_SECRET' }
    ]
  }
];

/**
 * Seed/refresh the IntegratedApi vault from env. Safe to call at every boot.
 * @param {{dryRun?: boolean}} [opts] dryRun=true : compute what WOULD be seeded,
 *   without writing anything (used by the migration CLI). Never logs a secret.
 * @returns {Promise<{seeded: string[], skipped: string[], details: object[], dryRun: boolean}>}
 */
export async function seedIntegratedApisFromEnv(opts = {}) {
  const dryRun = opts.dryRun === true;
  // S1C — politique uniforme : sans clé de coffre valide, on REFUSE (throw), quel que soit
  // l'environnement (le boot a déjà appelé validateCredentialVaultKey en amont).
  validateCredentialVaultKey();

  const result = { seeded: [], skipped: [], details: [] };

  for (const def of DEFINITIONS) {
    // Determine the account runtime from the secret_key prefix (dual only).
    let accountRuntime = null;
    if (def.runtimeModel === 'dual_environment') {
      const secretRole = def.roles.find(r => r.drivesMode);
      accountRuntime = detectRuntimeFromValue(process.env[secretRole.env]) || 'test'; // default test if unknown
    }

    let api = await IntegratedApi.findOne({ slug: def.slug });
    const created = !api;
    if (!api) {
      api = new IntegratedApi({
        slug: def.slug,
        name: def.name,
        provider: def.provider,
        accountPurpose: def.accountPurpose || null,
        runtimeModel: def.runtimeModel,
        mode: def.runtimeModel === 'dual_environment' ? accountRuntime : 'test',
        credentials: []
      });
    }

    // Backfill idempotent : pose accountPurpose sur les documents existants sans valeur.
    let purposeBackfilled = false;
    if (def.accountPurpose && api.accountPurpose !== def.accountPurpose) {
      api.accountPurpose = def.accountPurpose;
      purposeBackfilled = true;
    }

    let added = 0;
    for (const r of def.roles) {
      const rawValue = String(process.env[r.env] || '').trim();
      if (!rawValue) continue; // no value to seed (e.g. missing prod key)

      let runtime = null;
      if (def.runtimeModel === 'dual_environment') {
        runtime = r.followsSecretRuntime ? accountRuntime : (detectRuntimeFromValue(rawValue) || accountRuntime);
      }

      // Idempotence: an ACTIVE credential already present for (role, runtime) → skip.
      const exists = (api.credentials || []).some(
        c => c.isActive === true && String(c.role).toLowerCase() === r.role && (c.runtime ?? null) === (runtime ?? null)
      );
      if (exists) continue;

      if (!dryRun) {
        api.credentials.push({
          role: r.role,
          type: r.type,
          runtime,
          encryptedValue: encryptCredential(rawValue),
          lastFourChars: lastFour(rawValue),
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
      added += 1;
    }

    if (created || added > 0 || purposeBackfilled) {
      if (!dryRun) await api.save();
      result.seeded.push(def.slug);
      result.details.push({ slug: def.slug, created, credentialsAdded: added, mode: api.mode, accountPurpose: api.accountPurpose, purposeBackfilled });
    } else {
      result.skipped.push(def.slug);
      result.details.push({ slug: def.slug, created: false, credentialsAdded: 0, mode: api.mode, accountPurpose: api.accountPurpose });
    }
  }

  console.log(`[seedIntegratedApis]${dryRun ? ' (dry-run)' : ''} seeded=[${result.seeded.join(', ')}] skipped=[${result.skipped.join(', ')}]`);
  return { ...result, dryRun };
}

export default seedIntegratedApisFromEnv;
