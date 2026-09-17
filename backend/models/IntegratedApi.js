// models/IntegratedApi.js
// Minimal, MONO-TENANT credential vault registry.
// One document per third-party provider integration (e.g. "stripe-institut",
// "stripe-dev", "brevo"). Secret values live ONLY in `credentials[].encryptedValue`
// (AES-256-GCM via utils/credentialVault.js) — never in clear, never exposed.
//
// Deliberately OUT OF SCOPE (Phase 1): multi-tenant (no scope/garageId),
// auto-refresh / OAuth, usage ledger, admin UI.

import mongoose from 'mongoose';

const CREDENTIAL_TYPES = ['secret_key', 'publishable_key', 'webhook_secret', 'api_key'];
const RUNTIME_MODELS = ['single', 'dual_environment'];
const MODES = ['test', 'prod'];
// Pré-React — clarifie la vocation de chaque intégration (notamment les DEUX comptes
// Stripe) sans créer de modèle enfant :
//   customer_payments → encaissement des clients (Stripe Institut)
//   platform_billing  → l'institut paie la plateforme : commissions, frais de lancement,
//                        abonnement mensuel (Stripe Developer)
//   messaging         → emails transactionnels (Brevo)
const ACCOUNT_PURPOSES = ['customer_payments', 'platform_billing', 'messaging'];

const TEST_STATUSES = ['success', 'failed'];

const credentialSchema = new mongoose.Schema(
  {
    role: { type: String, required: true, trim: true, lowercase: true, minlength: 2, maxlength: 40 },
    type: { type: String, required: true, enum: CREDENTIAL_TYPES },
    runtime: { type: String, enum: ['test', 'prod', null], default: null },
    encryptedValue: { type: String, required: true }, // "iv.authTag.ciphertext" — NEVER serialized to clients
    lastFourChars: { type: String, default: '', maxlength: 4 },
    isActive: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

// Résultat du dernier test de connexion, par runtime (test|prod pour dual_environment,
// null pour single). `verified` est valide UNIQUEMENT pour l'empreinte courante :
// `verifiedFingerprint` = sha256 des credentials actifs de ce runtime au moment du test.
// Toute modification d'un credential change l'empreinte → `verified` devient périmé
// (recalculé côté service, cf. isProviderVerified). Aucun secret n'y est stocké.
const verificationSchema = new mongoose.Schema(
  {
    runtime: { type: String, enum: ['test', 'prod', null], default: null },
    verified: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
    verifiedFingerprint: { type: String, default: '' },
    lastTestedAt: { type: Date, default: null },
    lastTestStatus: { type: String, enum: [...TEST_STATUSES, null], default: null },
    lastTestMessage: { type: String, default: '' },
    lastTestDetails: { type: mongoose.Schema.Types.Mixed, default: null } // diagnostic non sensible
  },
  { _id: false }
);

const integratedApiSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
      match: /^[a-z0-9-]+$/
    },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    provider: { type: String, required: true, trim: true, lowercase: true, maxlength: 60 },
    // Vocation du compte/intégration (cf. ACCOUNT_PURPOSES). Nullable pour compat ascendante.
    accountPurpose: { type: String, enum: [...ACCOUNT_PURPOSES, null], default: null },
    runtimeModel: { type: String, enum: RUNTIME_MODELS, default: 'single' },
    mode: { type: String, enum: MODES, default: 'test' },
    modeUpdatedAt: { type: Date, default: null },
    credentials: { type: [credentialSchema], default: [] },
    // État de vérification par runtime (au plus une entrée par runtime). Additif :
    // les documents existants n'en ont pas → traités comme non vérifiés.
    verifications: { type: [verificationSchema], default: [] }
  },
  { timestamps: true }
);

// ---------------------------------------------------------------------------
// Helpers de vérification (aucun secret manipulé ici)
// ---------------------------------------------------------------------------
function normalizeRuntimeKey(runtime) {
  return runtime === 'test' || runtime === 'prod' ? runtime : null;
}

/** Retourne l'entrée de vérification pour un runtime (ou null). */
integratedApiSchema.methods.getVerification = function getVerification(runtime) {
  const key = normalizeRuntimeKey(runtime);
  return (this.verifications || []).find(v => (v.runtime ?? null) === key) || null;
};

/** Upsert de l'entrée de vérification d'un runtime avec un patch partiel. */
integratedApiSchema.methods.setVerification = function setVerification(runtime, patch = {}) {
  const key = normalizeRuntimeKey(runtime);
  let entry = (this.verifications || []).find(v => (v.runtime ?? null) === key);
  if (!entry) {
    entry = { runtime: key, verified: false, verifiedFingerprint: '' };
    this.verifications.push(entry);
    entry = this.verifications[this.verifications.length - 1];
  }
  Object.assign(entry, patch);
  return entry;
};

/** Réinitialise l'état vérifié d'un runtime (après changement de credential). */
integratedApiSchema.methods.resetVerification = function resetVerification(runtime) {
  return this.setVerification(runtime, {
    verified: false,
    verifiedAt: null,
    verifiedFingerprint: ''
  });
};

// ---------------------------------------------------------------------------
// Invariants (enforced before every save)
// ---------------------------------------------------------------------------
integratedApiSchema.pre('validate', function enforceInvariants(next) {
  const creds = Array.isArray(this.credentials) ? this.credentials : [];

  // 1. runtimeModel <-> credential.runtime coherence
  if (this.runtimeModel === 'single') {
    for (const c of creds) {
      if (c.runtime != null) {
        return next(
          new Error(`IntegratedApi "${this.slug}": runtimeModel=single requires credential.runtime=null (role=${c.role}).`)
        );
      }
    }
  } else if (this.runtimeModel === 'dual_environment') {
    for (const c of creds) {
      if (c.runtime !== 'test' && c.runtime !== 'prod') {
        return next(
          new Error(`IntegratedApi "${this.slug}": runtimeModel=dual_environment requires credential.runtime in {test,prod} (role=${c.role}).`)
        );
      }
    }
  }

  // 2. At most one ACTIVE credential per (role, runtime)
  const seen = new Set();
  for (const c of creds) {
    if (!c.isActive) continue;
    const key = `${String(c.role).toLowerCase()}::${c.runtime ?? 'null'}`;
    if (seen.has(key)) {
      return next(
        new Error(`IntegratedApi "${this.slug}": more than one active credential for (role=${c.role}, runtime=${c.runtime ?? 'null'}).`)
      );
    }
    seen.add(key);
  }

  return next();
});

const IntegratedApi = mongoose.models.IntegratedApi || mongoose.model('IntegratedApi', integratedApiSchema);

export default IntegratedApi;
export { CREDENTIAL_TYPES, RUNTIME_MODELS, MODES, ACCOUNT_PURPOSES, TEST_STATUSES };
