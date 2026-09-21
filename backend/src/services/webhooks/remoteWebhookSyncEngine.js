import { IntegratedApi } from '../../models/IntegratedApi.model.js';
import { encryptSecret, lastFourOf } from '../../utils/integratedApiCrypto.js';
import { WEBHOOK_CONFIG_STATUS } from '../../utils/brevoWebhookConstants.js';
import { tryGetCredential } from '../integratedApi.service.js';
import { safeErrorMessage } from '../../utils/eventPayloadSafety.js';
import { logger } from '../../utils/logger.js';
import {
  managedWebhookSpec,
  expectedWebhookUrl,
  buildWebhookUrl,
  managedWebhookDescription,
  isManagedDescription,
} from './managedWebhookRegistry.js';

/**
 * MOTEUR GÉNÉRIQUE de synchronisation d'un webhook géré chez un fournisseur.
 *
 * Chaque provider fournit un ADAPTATEUR distant minimal (list/create/update/
 * remove) ; le moteur applique la MÊME politique que le service Brevo
 * historique — identification sûre, création automatique, mise à jour sur
 * divergence, dédoublonnage limité à ce qui nous appartient avec certitude,
 * persistance d'état et de secret — sans dupliquer cette politique par
 * fournisseur.
 *
 * ── IDENTIFICATION PAR DESCRIPTION, JAMAIS PAR URL ──────────────────────────
 * Stripe et Yousign reçoivent TEST et PROD sur la MÊME route locale
 * (aiguillage cryptographique par signature). L'URL ne distingue donc pas les
 * modes : l'identité distante est portée par la DESCRIPTION canonique
 * (`SB_AUTO_06_MANAGED_<PROVIDER>_<CATEGORY>_<MODE>`), plus l'id persisté.
 *
 * ── SECRETS ─────────────────────────────────────────────────────────────────
 * Stripe (`whsec_…`) et Yousign (`secret_key`) ne renvoient leur secret QU'À
 * LA CRÉATION. Le moteur le persiste immédiatement (chiffré, credentials du
 * mode). Si le webhook distant existe mais que le secret local manque, la
 * seule réparation honnête est RECRÉER (supprimer NOTRE webhook + le recréer)
 * pour obtenir un secret neuf — jamais un état « configuré » sans secret.
 *
 * @param {object} cfg
 * @param {string} cfg.provider   'STRIPE' | 'YOUSIGN' | …
 * @param {string} cfg.category   'payment' | 'signature' | …
 * @param {string} cfg.requiredCredential  credential nécessaire aux appels API ('secretKey'|'apiKey')
 * @param {object} cfg.adapter    { list(mode), create(mode,{url,events,description}), update(mode,id,{url,events,description}), remove(mode,id) }
 *   list → [{ id, url, events, description, enabled }] ; create → { id, secret|null }
 */
export function createRemoteWebhookManager({ provider, category, requiredCredential, adapter }) {
  const spec = managedWebhookSpec(provider, category);

  /* ── outillage persistance ─────────────────────────────────────────────── */

  async function loadDoc() {
    const doc = await IntegratedApi.findOne({ provider });
    if (!doc) {
      const err = new Error(`${provider} absent du registre IntegratedApi.`);
      err.code = 'PROVIDER_NOT_REGISTERED';
      throw err;
    }
    return doc;
  }

  function persistState(doc, mode, patch) {
    const w = doc.modes[mode].webhook || {};
    doc.modes[mode].webhook = { ...(w.toObject ? w.toObject() : w), ...patch };
    doc.markModified(`modes.${mode}.webhook`);
  }

  function persistSecret(doc, mode, secret) {
    doc.modes[mode].credentials.set(spec.secretReference, {
      encryptedValue: encryptSecret(secret),
      lastFour: lastFourOf(secret),
      updatedAt: new Date(),
    });
    doc.markModified(`modes.${mode}.credentials`);
  }

  async function failState(mode, code, message) {
    try {
      const doc = await loadDoc();
      const hadId = Boolean(doc.modes[mode].webhook?.webhookId);
      persistState(doc, mode, {
        status: hadId ? WEBHOOK_CONFIG_STATUS.OUT_OF_SYNC : WEBHOOK_CONFIG_STATUS.ERROR,
        lastErrorSafe: { code, message: safeErrorMessage(message) },
      });
      await doc.save();
    } catch { /* l'état d'erreur est best-effort */ }
  }

  /* ── identification & divergence ───────────────────────────────────────── */

  function ownedBy(remoteList, mode) {
    return remoteList.filter((w) => isManagedDescription(w.description, provider, category, mode));
  }

  function identify(remoteList, mode, localId) {
    if (localId) {
      const byId = remoteList.find((w) => String(w.id) === String(localId));
      if (byId) return byId;
    }
    const owned = ownedBy(remoteList, mode);
    return owned.length >= 1 ? owned[0] : null;
  }

  function computeDivergence(remote, { url, events, description }) {
    const diffs = [];
    if (remote.url !== url) diffs.push('url');
    const remoteSet = new Set(remote.events || []);
    if (!remoteSet.has('*') && events.some((e) => !remoteSet.has(e))) diffs.push('events');
    if (description && remote.description !== description) diffs.push('description');
    if (remote.enabled === false) diffs.push('disabled');
    return diffs;
  }

  /* ── sérialisation par mode (pas de course) ────────────────────────────── */

  const chains = new Map();
  function serialize(mode, fn) {
    const prev = chains.get(mode) || Promise.resolve();
    const next = prev.then(fn, fn);
    chains.set(mode, next.catch(() => {}));
    return next;
  }

  /* ── SYNCHRONISER (créer si absent, corriger si divergent) ─────────────── */

  async function _sync(mode) {
    const doc = await loadDoc();
    const description = managedWebhookDescription(provider, category, mode);
    const expectation = await expectedWebhookUrl(provider, category, mode);
    if (!expectation.webhookReady) {
      const err = new Error('URL publique HTTPS requise (ngrok en dev, domaine déployé en PROD).');
      err.code = 'URL_NOT_PUBLIC';
      await failState(mode, err.code, err.message);
      throw err;
    }
    const url = expectation.url;
    const events = [...spec.expectedEvents];
    const localId = doc.modes[mode].webhook?.webhookId || null;

    let created = false;
    let updated = false;
    let deletedDuplicates = 0;
    let webhookId = localId;
    let secretCaptured = false;

    try {
      let remote = await adapter.list(mode);

      // Dédoublonnage SÛR : uniquement des webhooks portant NOTRE description.
      const owned = ownedBy(remote, mode);
      if (owned.length > 1) {
        const keep =
          owned.find((w) => String(w.id) === String(localId)) ||
          owned.find((w) => w.description === description) ||
          owned[0];
        for (const w of owned) {
          if (String(w.id) === String(keep.id)) continue;
          await adapter.remove(mode, w.id);
          deletedDuplicates += 1;
          logger.info(`[webhooks] doublon géré supprimé (${provider}/${category} ${mode}, id ${w.id}).`);
        }
        remote = remote.filter((w) => String(w.id) === String(keep.id) || !owned.includes(w) || w === keep);
      }

      let managed = identify(remote, mode, localId);

      // Secret local absent alors que le distant existe : le fournisseur ne
      // relivre JAMAIS un secret — on recrée NOTRE webhook pour en obtenir un.
      const secret = await tryGetCredential(provider, spec.secretReference, { mode });
      if (managed && !secret) {
        await adapter.remove(mode, managed.id);
        logger.info(`[webhooks] ${provider}/${category} ${mode} : secret local absent — webhook recréé pour en obtenir un neuf.`);
        managed = null;
      }

      if (managed) {
        webhookId = String(managed.id);
        const diffs = computeDivergence(managed, { url, events, description });
        if (diffs.length) {
          await adapter.update(mode, managed.id, { url, events, description });
          updated = true;
        }
      } else {
        const res = await adapter.create(mode, { url, events, description });
        webhookId = res?.id ? String(res.id) : null;
        created = true;
        if (res?.secret) {
          persistSecret(doc, mode, res.secret);
          secretCaptured = true;
        }
      }
    } catch (err) {
      const code = err?.code || 'REMOTE_SYNC_FAILED';
      await failState(mode, code, err?.message || 'Synchronisation échouée.');
      err.code = code;
      throw err;
    }

    persistState(doc, mode, {
      webhookId,
      webhookUrl: url,
      subscribedEvents: events,
      authenticationType: spec.authentication,
      status: WEBHOOK_CONFIG_STATUS.CONFIGURED,
      active: true,
      lastSyncedAt: new Date(),
      lastErrorSafe: { code: '', message: '' },
    });
    await doc.save();

    return {
      status: WEBHOOK_CONFIG_STATUS.CONFIGURED,
      webhookId, url, events,
      created, updated, deletedDuplicates, secretCaptured,
    };
  }

  const syncWebhook = (mode) => serialize(mode, () => _sync(mode));

  /* ── ENSURE (réconciliation non intrusive — jamais d'exception) ────────── */

  async function ensureWebhook(mode) {
    let doc;
    try { doc = await IntegratedApi.findOne({ provider }).lean(); }
    catch { return { skipped: true, reason: 'REGISTRY_UNAVAILABLE' }; }
    if (!doc || !doc.enabled) return { skipped: true, reason: 'PROVIDER_DISABLED' };
    const creds = doc.modes?.[mode]?.credentials;
    const hasKey = Boolean(creds instanceof Map ? creds.get(requiredCredential) : creds?.[requiredCredential]);
    if (!hasKey) return { skipped: true, reason: 'API_KEY_MISSING' };

    const expectation = await expectedWebhookUrl(provider, category, mode);
    if (!expectation.webhookReady) return { skipped: true, reason: 'URL_NOT_PUBLIC' };

    try {
      const r = await syncWebhook(mode);
      return { skipped: false, ok: true, created: r.created, updated: r.updated, deletedDuplicates: r.deletedDuplicates, secretCaptured: r.secretCaptured };
    } catch (err) {
      return { skipped: false, ok: false, error: { code: err?.code || 'REMOTE_SYNC_FAILED', message: safeErrorMessage(err?.message || '') } };
    }
  }

  /* ── JOIGNABILITÉ (sonde de NOTRE route publique, health suffix) ───────── */

  async function probeHealth(mode) {
    const doc = await loadDoc();
    const expectation = await expectedWebhookUrl(provider, category, mode);
    const base = expectation.url ||
      (expectation.publicBackendUrl
        ? buildWebhookUrl({ provider, category, mode, publicBackendUrl: expectation.publicBackendUrl })
        : '');
    if (!base || !expectation.webhookReady) {
      persistState(doc, mode, { healthStatus: 'UNREACHABLE', healthCheckedAt: new Date(), healthyUntil: null });
      await doc.save();
      return { healthy: false, code: 'URL_NOT_PUBLIC' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(`${base.replace(/\/+$/, '')}/health`, { signal: controller.signal });
      if (!res.ok) throw new Error(`réponse ${res.status}`);
      persistState(doc, mode, { healthStatus: 'HEALTHY', healthCheckedAt: new Date(), healthyUntil: new Date(Date.now() + 10 * 60 * 1000) });
      await doc.save();
      return { healthy: true };
    } catch {
      persistState(doc, mode, { healthStatus: 'UNREACHABLE', healthCheckedAt: new Date(), healthyUntil: null });
      await doc.save();
      return { healthy: false, code: 'WEBHOOK_URL_UNREACHABLE' };
    } finally {
      clearTimeout(timer);
    }
  }

  /* ── RÉPARER = ensure + constat de joignabilité ────────────────────────── */

  async function repairWebhook(mode) {
    const ensured = await ensureWebhook(mode);
    const health = ensured.skipped ? null : await probeHealth(mode).catch(() => ({ healthy: false }));
    return { ...ensured, health };
  }

  /* ── TESTER = meilleur diagnostic possible, AUCUN effet distant ────────── */

  async function testWebhook(mode) {
    const doc = await IntegratedApi.findOne({ provider }).lean();
    const localId = doc?.modes?.[mode]?.webhook?.webhookId || null;
    const secretConfigured = Boolean(await tryGetCredential(provider, spec.secretReference, { mode }));
    const description = managedWebhookDescription(provider, category, mode);
    const expectation = await expectedWebhookUrl(provider, category, mode);

    let remoteOk = false;
    let differences = [];
    let remoteError = null;
    try {
      const remote = await adapter.list(mode);
      const managed = identify(remote, mode, localId);
      if (managed && expectation.url) {
        differences = computeDivergence(managed, { url: expectation.url, events: [...spec.expectedEvents], description });
        remoteOk = differences.length === 0;
      }
    } catch (err) {
      remoteError = { code: err?.code || 'REMOTE_LIST_FAILED', message: safeErrorMessage(err?.message || '') };
    }

    const reachability = expectation.webhookReady ? await probeHealth(mode).catch(() => ({ healthy: false })) : { healthy: false, code: 'URL_NOT_PUBLIC' };

    return {
      ok: remoteOk && secretConfigured && reachability.healthy,
      remoteOk,
      differences,
      remoteError,
      secretConfigured,
      reachable: reachability.healthy,
      reachabilityCode: reachability.code || null,
    };
  }

  /* ── ÉTAT (affichage) ──────────────────────────────────────────────────── */

  async function getState(mode) {
    const doc = await loadDoc();
    const w = doc.modes[mode].webhook || {};
    const plain = w.toObject ? w.toObject() : w;
    const expectation = await expectedWebhookUrl(provider, category, mode);
    return {
      provider, category, mode,
      status: plain.status || WEBHOOK_CONFIG_STATUS.NOT_CONFIGURED,
      webhookId: plain.webhookId || null,
      webhookUrl: plain.webhookUrl || expectation.url,
      expectedUrl: expectation.url,
      urlReady: expectation.webhookReady,
      publicBackendUrl: expectation.publicBackendUrl,
      publicUrlSource: expectation.source,
      subscribedEvents: plain.subscribedEvents || [],
      authenticationType: plain.authenticationType || spec.authentication,
      active: Boolean(plain.active),
      secretConfigured: Boolean(doc.modes[mode].credentials.get(spec.secretReference)),
      lastSyncedAt: plain.lastSyncedAt || null,
      lastReceivedAt: plain.lastReceivedAt || null,
      lastReceivedType: plain.lastReceivedType || null,
      healthStatus: plain.healthStatus || 'UNKNOWN',
      lastErrorSafe: { code: plain.lastErrorSafe?.code || '', message: plain.lastErrorSafe?.message || '' },
    };
  }

  return { syncWebhook, ensureWebhook, repairWebhook, testWebhook, probeHealth, getState };
}

/**
 * LA PERSISTANCE SEULE — sans aucune capacité d'appel distant (L6.3A).
 *
 * Un gestionnaire dont la convergence vit ailleurs (côté Panel) a quand même
 * besoin de lire et d'écrire l'état local, de connaître l'URL attendue et de
 * sonder sa propre route. Ces trois gestes n'appellent AUCUN fournisseur : les
 * extraire permet de les réutiliser tels quels, plutôt que d'en écrire une
 * seconde version destinée à diverger de celle-ci.
 *
 * On passe volontairement un adaptateur qui refuse tout : si un futur appelant
 * tentait de s'en servir pour joindre le fournisseur, il obtiendrait une erreur
 * franche au lieu d'un appel silencieux.
 */
export function createWebhookPersistence({ provider, category }) {
  const moteur = createRemoteWebhookManager({
    provider,
    category,
    requiredCredential: null,
    adapter: {
      list: () => { throw Object.assign(new Error('Aucun accès distant depuis le projet.'), { code: 'REMOTE_ACCESS_REMOVED' }); },
      create: () => { throw Object.assign(new Error('Aucun accès distant depuis le projet.'), { code: 'REMOTE_ACCESS_REMOVED' }); },
      update: () => { throw Object.assign(new Error('Aucun accès distant depuis le projet.'), { code: 'REMOTE_ACCESS_REMOVED' }); },
      remove: () => { throw Object.assign(new Error('Aucun accès distant depuis le projet.'), { code: 'REMOTE_ACCESS_REMOVED' }); },
    },
  });

  return {
    loadState: (mode) => moteur.getState(mode),
    probeHealth: (mode) => moteur.probeHealth(mode),
    expectedUrl: (mode) => expectedWebhookUrl(provider, category, mode),
    async saveState(mode, patch) {
      const doc = await IntegratedApi.findOne({ provider });
      if (!doc) return;
      const w = doc.modes[mode].webhook || {};
      doc.modes[mode].webhook = { ...(w.toObject ? w.toObject() : w), ...patch };
      doc.markModified(`modes.${mode}.webhook`);
      await doc.save();
    },
  };
}
