// controllers/integratedApiController.js
// Surface de GESTION (DEV) des intégrations chiffrées (coffre IntegratedApi).
// Configurer / Tester / Activer un mode / Supprimer — sérialisation MASQUÉE (aucun secret
// renvoyé). Un secret n'est jamais réaffiché : le front n'envoie que les champs saisis
// (champ vide = valeur conservée), `null` = suppression explicite.

import IntegratedApi from '../models/IntegratedApi.js';
import { serializeIntegratedApi } from '../services/integratedApiSerializer.js';
import { testConnection } from '../services/integratedApiConnectionTest.service.js';
import {
  setIntegratedApiMode,
  isProviderVerified,
  IntegratedApiNotFoundError
} from '../services/integratedApiCredentialService.js';
import {
  encryptCredential,
  lastFour
} from '../utils/credentialVault.js';
import {
  catalogSlugs,
  catalogEntry,
  catalogField,
  validateCredentialFormat
} from '../utils/integratedApiCatalog.js';

// Assure l'existence du document d'une intégration cataloguée (crée un doc vide au besoin).
async function ensureIntegration(slug) {
  const lower = String(slug || '').toLowerCase();
  const entry = catalogEntry(lower);
  if (!entry) return null;
  let api = await IntegratedApi.findOne({ slug: lower });
  if (!api) {
    api = await IntegratedApi.create({
      slug: lower,
      name: entry.name,
      provider: entry.provider,
      accountPurpose: entry.accountPurpose || null,
      runtimeModel: entry.runtimeModel,
      mode: 'test',
      credentials: []
    });
  }
  return api;
}

// Runtime de travail effectif pour une écriture (single → null ; dual → 'test'|'prod').
function resolveWriteRuntime(api, runtime) {
  if (api.runtimeModel === 'dual_environment') {
    return runtime === 'test' || runtime === 'prod' ? runtime : undefined; // undefined = invalide
  }
  return null;
}

export async function listIntegrationsHandler(_req, res) {
  try {
    const out = [];
    for (const slug of catalogSlugs()) {
      const api = await ensureIntegration(slug);
      if (api) out.push(serializeIntegratedApi(api));
    }
    return res.json({ ok: true, integrations: out });
  } catch (error) {
    console.error('[integratedApi] list échouée', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function getIntegrationHandler(req, res) {
  try {
    if (!catalogEntry(req.params.slug)) {
      return res.status(404).json({ ok: false, error: 'Intégration inconnue.', code: 'UNKNOWN_INTEGRATION' });
    }
    const api = await ensureIntegration(req.params.slug);
    return res.json({ ok: true, integration: serializeIntegratedApi(api) });
  } catch (error) {
    console.error('[integratedApi] detail échouée', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function updateCredentialsHandler(req, res) {
  try {
    const entry = catalogEntry(req.params.slug);
    if (!entry) return res.status(404).json({ ok: false, error: 'Intégration inconnue.', code: 'UNKNOWN_INTEGRATION' });

    const api = await ensureIntegration(req.params.slug);
    const { runtime = null, credentials = {} } = req.body || {};
    const eff = resolveWriteRuntime(api, runtime);
    if (eff === undefined) {
      return res.status(400).json({ ok: false, error: 'Mode invalide (test|prod requis).', code: 'INVALID_RUNTIME' });
    }
    if (!credentials || typeof credentials !== 'object') {
      return res.status(400).json({ ok: false, error: 'credentials manquant.', code: 'CREDENTIALS_REQUIRED' });
    }

    let changed = false;
    for (const [role, rawValue] of Object.entries(credentials)) {
      const field = catalogField(api.slug, role);
      if (!field) {
        return res.status(400).json({ ok: false, error: `Champ inconnu: ${role}.`, code: 'UNKNOWN_FIELD' });
      }
      if (rawValue === null) {
        // Suppression explicite du credential (role, runtime).
        const before = api.credentials.length;
        api.credentials = api.credentials.filter(
          c => !(String(c.role).toLowerCase() === role && (c.runtime ?? null) === (eff ?? null))
        );
        if (api.credentials.length !== before) changed = true;
        continue;
      }
      // Valeur fournie → validation format + chiffrement + remplacement.
      let clean;
      try {
        clean = validateCredentialFormat(api.slug, role, rawValue, eff);
      } catch (e) {
        return res.status(400).json({ ok: false, error: e.message, code: e.code || 'INVALID_CREDENTIAL' });
      }
      api.credentials = api.credentials.filter(
        c => !(String(c.role).toLowerCase() === role && (c.runtime ?? null) === (eff ?? null))
      );
      api.credentials.push({
        role,
        type: field.type,
        runtime: eff ?? null,
        encryptedValue: encryptCredential(clean),
        lastFourChars: lastFour(clean),
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      changed = true;
    }

    if (changed) {
      api.resetVerification(eff); // toute modif invalide le "verified" de ce runtime
      await api.save();
    }
    return res.json({ ok: true, integration: serializeIntegratedApi(api) });
  } catch (error) {
    if (error instanceof IntegratedApiNotFoundError) {
      return res.status(404).json({ ok: false, error: 'Intégration inconnue.', code: 'UNKNOWN_INTEGRATION' });
    }
    console.error('[integratedApi] update échouée', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function deleteRuntimeHandler(req, res) {
  try {
    const entry = catalogEntry(req.params.slug);
    if (!entry) return res.status(404).json({ ok: false, error: 'Intégration inconnue.', code: 'UNKNOWN_INTEGRATION' });
    const api = await ensureIntegration(req.params.slug);
    const runtime = req.query.runtime ?? req.body?.runtime ?? null;
    const eff = resolveWriteRuntime(api, runtime);
    if (eff === undefined) {
      return res.status(400).json({ ok: false, error: 'Mode invalide (test|prod requis).', code: 'INVALID_RUNTIME' });
    }
    api.credentials = api.credentials.filter(c => (c.runtime ?? null) !== (eff ?? null));
    api.resetVerification(eff);
    await api.save();
    return res.json({ ok: true, integration: serializeIntegratedApi(api) });
  } catch (error) {
    console.error('[integratedApi] delete échouée', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function testIntegrationHandler(req, res) {
  try {
    const entry = catalogEntry(req.params.slug);
    if (!entry) return res.status(404).json({ ok: false, error: 'Intégration inconnue.', code: 'UNKNOWN_INTEGRATION' });
    const api = await ensureIntegration(req.params.slug);
    const runtime = req.body?.runtime ?? null;
    const eff = resolveWriteRuntime(api, runtime);
    if (eff === undefined) {
      return res.status(400).json({ ok: false, error: 'Mode invalide (test|prod requis).', code: 'INVALID_RUNTIME' });
    }
    const result = await testConnection(api.slug, eff);
    const fresh = await IntegratedApi.findOne({ slug: api.slug });
    return res.json({ ok: true, result, integration: serializeIntegratedApi(fresh) });
  } catch (error) {
    console.error('[integratedApi] test échoué', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function setModeHandler(req, res) {
  try {
    const entry = catalogEntry(req.params.slug);
    if (!entry) return res.status(404).json({ ok: false, error: 'Intégration inconnue.', code: 'UNKNOWN_INTEGRATION' });
    const api = await ensureIntegration(req.params.slug);
    if (api.runtimeModel !== 'dual_environment') {
      return res.status(400).json({ ok: false, error: 'Ce fournisseur n\'a pas de mode test/prod.', code: 'MODE_NOT_APPLICABLE' });
    }
    const target = req.body?.mode;
    if (target !== 'test' && target !== 'prod') {
      return res.status(400).json({ ok: false, error: 'mode invalide (test|prod).', code: 'INVALID_MODE' });
    }
    if (target === 'prod') {
      const verified = await isProviderVerified(api.slug, 'prod');
      if (!verified) {
        return res.status(400).json({ ok: false, error: 'Le mode PROD doit être configuré et testé avant activation.', code: 'MODE_NOT_VERIFIED' });
      }
      const confirmation = String(req.body?.confirmation || '').trim();
      if (confirmation !== entry.confirmVerb) {
        return res.status(400).json({ ok: false, error: `Confirmation requise : saisir exactement "${entry.confirmVerb}".`, code: 'CONFIRMATION_REQUIRED' });
      }
    }
    await setIntegratedApiMode(api.slug, target);
    const fresh = await IntegratedApi.findOne({ slug: api.slug });
    return res.json({ ok: true, integration: serializeIntegratedApi(fresh) });
  } catch (error) {
    console.error('[integratedApi] set-mode échoué', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}
