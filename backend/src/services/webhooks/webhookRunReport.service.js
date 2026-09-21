import { IntegratedApi } from '../../models/IntegratedApi.model.js';
import { tryGetCredential } from '../integratedApi.service.js';
import { safeErrorMessage } from '../../utils/eventPayloadSafety.js';
import { logger } from '../../utils/logger.js';
import { providerByCode } from './integrationWebhookProviders.js';
import { ensureProviderWebhooks } from './webhookOrchestrator.service.js';

/**
 * RAPPORT D'EXÉCUTION des actions webhook (Synchroniser / Réparer / Tester).
 *
 * Chaque action, quel que soit le bouton utilisé, produit un rapport COMPLET :
 * contexte (URLs, capacités, credentials), étapes, résultat, exception, stack
 * interne, diagnostic et correction suggérée. Le rapport est PERSISTÉ par
 * provider et par mode (`modes[mode].webhook.lastRunReport`) puis affiché et
 * copiable depuis le Manager — fini le badge rouge inexpliqué.
 *
 * ── SECRETS ────────────────────────────────────────────────────────────────
 * Jamais de secret, token ou clé API dans un rapport : tout texte libre passe
 * par `maskSensitiveText` (motifs connus + tokens longs) AVANT persistance.
 */

export const RUN_ACTIONS = Object.freeze({
  sync: 'Synchroniser',
  repair: 'Réparer',
  test: 'Tester',
});

/* -------------------------------------------------------------------------- */
/*  Masquage des secrets                                                      */
/* -------------------------------------------------------------------------- */

const SECRET_PATTERNS = [
  /whsec_[A-Za-z0-9]+/g, // secret webhook Stripe
  /[sr]k_(?:test|live)_[A-Za-z0-9]+/g, // clés Stripe (secrète/restreinte)
  /pk_(?:test|live)_[A-Za-z0-9]{20,}/g, // clé publique Stripe (par prudence)
  /xkeysib-[A-Za-z0-9-]+/g, // clé API Brevo
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, // en-têtes Authorization
  /\b[A-Za-z0-9_-]{40,}\b/g, // tout token long opaque
];

/** Masque secrets/tokens/clés dans un texte libre. Idempotent, sans faux « undefined ». */
export function maskSensitiveText(text) {
  let out = String(text ?? '');
  for (const re of SECRET_PATTERNS) out = out.replace(re, '***');
  return out;
}

/** Masque récursivement toutes les chaînes d'une structure (profondeur bornée). */
export function maskDeep(value, depth = 0) {
  if (depth > 6) return undefined;
  if (typeof value === 'string') return maskSensitiveText(value);
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v instanceof Date) { out[k] = v; continue; }
      out[k] = maskDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/*  Diagnostic : code d'erreur → explication + correction suggérée            */
/* -------------------------------------------------------------------------- */

const DIAGNOSTICS = {
  URL_NOT_PUBLIC: {
    diagnostic: "Le backend n'expose pas d'URL publique HTTPS : le fournisseur ne peut appeler aucun webhook.",
    fix: 'En TEST : démarrez ngrok (le backend détecte le tunnel). En PROD : déployez le site ou renseignez Configuration système › Réseau (URL backend publique).',
  },
  BACKEND_URL_NOT_CONFIGURED: {
    diagnostic: "L'URL publique du backend n'est pas configurée pour ce mode.",
    fix: 'Renseignez Configuration système › Réseau (URL backend), puis relancez la synchronisation.',
  },
  API_KEY_MISSING: {
    diagnostic: "La clé API du fournisseur est absente pour ce mode : aucun appel distant n'est possible.",
    fix: 'Les identifiants fournisseur sont détenus par la plateforme L.Y Solution : vérifiez l’appairage du projet, puis synchronisez.',
  },
  PROVIDER_DISABLED: {
    diagnostic: 'Le fournisseur est désactivé dans le registre des intégrations.',
    fix: "Activez le fournisseur pour ce projet, puis relancez l'action.",
  },
  REGISTRY_UNAVAILABLE: {
    diagnostic: "Le registre des intégrations est momentanément inaccessible (base de données).",
    fix: "Vérifiez la connexion MongoDB du backend puis relancez l'action.",
  },
  PROVIDER_NOT_REGISTERED: {
    diagnostic: "Le fournisseur n'existe pas dans le registre des intégrations (base non initialisée ?).",
    fix: 'Redémarrez le backend (le bootstrap recrée les entrées manquantes) puis relancez.',
  },
  REMOTE_UNREACHABLE: {
    diagnostic: "L'API du fournisseur est injoignable (réseau, DNS, délai dépassé).",
    fix: "Vérifiez la connectivité sortante du backend et le statut du fournisseur, puis relancez l'action.",
  },
  WEBHOOK_URL_UNREACHABLE: {
    diagnostic: "Le webhook existe mais NOTRE URL publique ne répond pas (tunnel fermé, backend arrêté, DNS).",
    fix: 'En TEST : relancez ngrok puis Réparer. En PROD : vérifiez que le domaine pointe vers le backend et que /api/webhooks/... répond.',
  },
  REMOTE_SYNC_UNSUPPORTED: {
    diagnostic: "Ce fournisseur ne permet pas la gestion distante de ses webhooks via API.",
    fix: "Configurez le webhook dans le dashboard du fournisseur avec l'URL calculée affichée.",
  },
  API_UNAUTHORIZED: {
    diagnostic: 'Le fournisseur refuse la clé API (invalide, expirée ou du mauvais mode TEST/PROD).',
    fix: 'La clé de ce mode est détenue par la plateforme L.Y Solution : corrigez-la côté Panel, puis synchronisez.',
  },
  REMOTE_ERROR: {
    diagnostic: "L'API du fournisseur a rejeté l'opération (voir « Réponse API » : limite de plan, quota de webhooks, payload refusé…).",
    fix: 'Lisez le message distant ci-dessus ; supprimez les webhooks obsolètes chez le fournisseur ou adaptez le plan, puis relancez Synchroniser.',
  },
  SECRET_MISSING: {
    diagnostic: 'Le webhook distant existe mais le secret local est absent : les événements entrants seraient invérifiables.',
    fix: 'Lancez Synchroniser : le webhook sera recréé automatiquement pour obtenir un secret neuf (comportement canonique).',
  },
  OUT_OF_SYNC: {
    diagnostic: "Le webhook distant diverge de l'attendu (URL, événements, description ou désactivé).",
    fix: 'Lancez Synchroniser pour réaligner automatiquement le webhook distant.',
  },
  DEFAULT_FAILED: {
    diagnostic: "L'action a échoué pour une cause non cataloguée — voir Exception et Stack interne.",
    fix: "Copiez ce rapport et transmettez-le au support technique / à l'assistant.",
  },
};

/** Diagnostic pour un code d'erreur, avec repli par suffixe (générique multi-providers). */
export function diagnoseErrorCode(code) {
  if (!code) return null;
  const c = String(code).toUpperCase();
  if (DIAGNOSTICS[c]) return DIAGNOSTICS[c];
  if (c.endsWith('_API_UNAUTHORIZED')) return DIAGNOSTICS.API_UNAUTHORIZED;
  if (c.endsWith('_REMOTE_ERROR')) return DIAGNOSTICS.REMOTE_ERROR;
  if (c.endsWith('_API_KEY_MISSING')) return DIAGNOSTICS.API_KEY_MISSING;
  return DIAGNOSTICS.DEFAULT_FAILED;
}

/* -------------------------------------------------------------------------- */
/*  Construction du rapport                                                   */
/* -------------------------------------------------------------------------- */

function firstErrorOf(actionReport) {
  if (actionReport?.error?.code || actionReport?.error?.message) return actionReport.error;
  for (const r of actionReport?.results || []) {
    if (r?.error?.code || r?.error?.message) return r.error;
    if (r?.remoteError?.code || r?.remoteError?.message) return r.remoteError;
  }
  return null;
}

function statusOf(actionReport, thrown) {
  if (thrown) return 'FAILED';
  if (actionReport?.error) return 'FAILED';
  if (actionReport?.skipped) return 'SKIPPED';
  const results = actionReport?.results || [];
  if (!results.length) return 'FAILED';
  if (results.every((r) => r.skipped)) return 'SKIPPED';
  if (results.every((r) => r.ok === true || r.skipped)) return 'SUCCESS';
  return 'FAILED';
}

/** Diagnostic dérivé de l'ÉTAT quand aucun code d'erreur explicite n'existe (Tester). */
function deriveDiagnostic({ status, actionReport, descriptor, skippedReason }) {
  if (status === 'SUCCESS') {
    return {
      diagnostic: 'Aucune anomalie détectée : webhook conforme, secret présent, URL joignable.',
      fix: 'Aucune action requise.',
    };
  }
  if (status === 'SKIPPED') {
    return diagnoseErrorCode(skippedReason) || DIAGNOSTICS.DEFAULT_FAILED;
  }
  const err = firstErrorOf(actionReport);
  if (err?.code) return diagnoseErrorCode(err.code);
  // Échec sans code : lire les constats du test.
  const r = (actionReport?.results || []).find((x) => x.ok === false) || {};
  if (r.secretConfigured === false) return DIAGNOSTICS.SECRET_MISSING;
  if (r.reachable === false) return diagnoseErrorCode(r.reachabilityCode) || DIAGNOSTICS.WEBHOOK_URL_UNREACHABLE;
  if (r.remoteOk === false || (Array.isArray(r.differences) && r.differences.length)) return DIAGNOSTICS.OUT_OF_SYNC;
  if (descriptor && !descriptor.remoteWebhookId) {
    return {
      diagnostic: "Aucun webhook n'existe encore chez le fournisseur pour ce mode.",
      fix: 'Lancez Synchroniser : le webhook sera créé automatiquement.',
    };
  }
  return DIAGNOSTICS.DEFAULT_FAILED;
}

function capabilitiesLine(capabilities) {
  if (!capabilities) return 'inconnues';
  return Object.entries(capabilities)
    .map(([k, v]) => (v === true ? k : v ? `${k}=${v}` : `${k}=non`))
    .join(', ');
}

function fmtDate(d) {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString();
}

function resultLine(r) {
  if (r.skipped) return `ignoré (${r.reason || 'raison inconnue'})`;
  if (r.ok === false) {
    const code = r.error?.code || r.remoteError?.code || 'ÉCHEC';
    const msg = r.error?.message || r.remoteError?.message || '';
    return `échec (${code})${msg ? ` — ${msg}` : ''}`;
  }
  const bits = [];
  if (r.created) bits.push('webhook créé');
  if (r.updated) bits.push('mis à jour');
  if (typeof r.deletedDuplicates === 'number' && r.deletedDuplicates > 0) bits.push(`${r.deletedDuplicates} doublon(s) supprimé(s)`);
  if (r.secretCaptured) bits.push('secret capturé et enregistré (chiffré)');
  if (typeof r.remoteOk === 'boolean') bits.push(r.remoteOk ? 'conforme au distant' : `non conforme (${(r.differences || []).join(', ') || 'divergence'})`);
  if (typeof r.secretConfigured === 'boolean') bits.push(r.secretConfigured ? 'secret présent' : 'secret ABSENT');
  if (typeof r.reachable === 'boolean') bits.push(r.reachable ? 'URL joignable' : `URL injoignable${r.reachabilityCode ? ` (${r.reachabilityCode})` : ''}`);
  if (r.health && typeof r.health.healthy === 'boolean') bits.push(r.health.healthy ? 'joignabilité confirmée' : 'joignabilité NON confirmée');
  return bits.length ? bits.join(', ') : 'déjà conforme';
}

/** Rendu TEXTE du rapport — directement collable pour analyse externe. */
export function renderRunReportText(report) {
  const L = [];
  L.push('=== RAPPORT WEBHOOK ===');
  L.push(`Provider : ${report.provider}`);
  L.push(`Mode : ${report.mode}`);
  L.push(`Action : ${RUN_ACTIONS[report.action] || report.action}`);
  L.push(`Résultat : ${report.status}`);
  L.push(`Date : ${fmtDate(report.finishedAt)}`);
  L.push(`Durée : ${report.durationMs} ms`);
  L.push('');
  L.push(`Backend URL : ${report.backendUrl || '—'}`);
  L.push(`Webhook URL : ${report.webhookUrl || '—'}`);
  L.push(`URL publique prête : ${report.webhookReady ? 'oui' : 'NON'}${report.urlSource ? ` (source : ${report.urlSource})` : ''}`);
  L.push('');
  L.push(`Capabilities : ${capabilitiesLine(report.capabilities)}`);
  L.push(`Credentials : ${report.credential === 'OK' ? 'OK' : report.credential === 'MISSING' ? 'ABSENTES' : 'inconnues'}`);
  L.push(`Secret webhook : ${report.secretConfigured ? 'configuré (chiffré)' : 'ABSENT'}`);
  L.push('');
  L.push(`État distant : ${report.remote?.status || 'INCONNU'}`);
  L.push(`Webhook distant : ${report.remote?.webhookId ? `id ${report.remote.webhookId}` : 'aucun'}`);
  L.push(`Dernière synchro réussie : ${fmtDate(report.remote?.lastSyncAt)}`);
  L.push(`Dernier événement reçu : ${report.remote?.lastReceivedAt ? `${report.remote.lastReceivedType || 'reçu'} · ${fmtDate(report.remote.lastReceivedAt)}` : 'aucun'}`);
  L.push('');
  L.push('Résultats :');
  const results = report.results || [];
  if (!results.length) L.push('  (aucun)');
  for (const r of results) L.push(`  - [${r.category || '—'}] ${resultLine(r)}`);
  L.push('');
  L.push(`Réponse API : ${report.remoteResponse || (report.status === 'SUCCESS' ? 'OK' : '—')}`);
  L.push(`Exception : ${report.error?.message || 'aucune'}`);
  if (report.error?.stack) {
    L.push('Stack interne :');
    L.push(report.error.stack);
  }
  L.push('');
  L.push('Diagnostic :');
  L.push(report.diagnostic || '—');
  L.push('');
  L.push('Correction suggérée :');
  L.push(report.suggestedFix || '—');
  L.push('=== FIN DU RAPPORT ===');
  return L.join('\n');
}

/**
 * Construit le rapport STRUCTURÉ d'une exécution (fonction pure, testée).
 * Toutes les chaînes libres sont masquées ; le texte collable est inclus.
 */
export function buildRunReport({
  provider,
  mode,
  action,
  startedAt,
  finishedAt,
  actionReport,
  thrown,
  descriptor,
  capabilities,
  credential,
}) {
  const status = statusOf(actionReport, thrown);
  const err = thrown
    ? { code: thrown.code || 'UNEXPECTED_ERROR', message: thrown.message || 'Erreur inattendue.', stack: thrown.stack || '' }
    : firstErrorOf(actionReport);
  const { diagnostic, fix } = deriveDiagnostic({
    status,
    actionReport,
    descriptor,
    skippedReason: actionReport?.reason || (actionReport?.results || []).find((r) => r.skipped)?.reason,
  });

  const report = {
    version: 1,
    provider,
    mode,
    action,
    status,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),
    backendUrl: descriptor?.publicBackendUrl || '',
    webhookUrl: descriptor?.expectedUrl || '',
    urlSource: descriptor?.publicUrlSource || '',
    webhookReady: Boolean(descriptor?.webhookReady),
    capabilities: capabilities || null,
    credential: credential || 'UNKNOWN',
    secretConfigured: Boolean(descriptor?.secretConfigured),
    remote: descriptor
      ? {
          status: descriptor.remoteStatus || 'NOT_CONFIGURED',
          webhookId: descriptor.remoteWebhookId || null,
          lastSyncAt: descriptor.lastSyncAt || null,
          lastReceivedAt: descriptor.lastReceivedEventAt || null,
          lastReceivedType: descriptor.lastReceivedEventType || null,
          lastError: descriptor.lastSyncError || null,
        }
      : null,
    results: maskDeep(actionReport?.results || []),
    remoteResponse: err?.message ? maskSensitiveText(safeErrorMessage(err.message)) : '',
    error: err
      ? {
          code: err.code || '',
          message: maskSensitiveText(safeErrorMessage(err.message || '')),
          stack: err.stack ? maskSensitiveText(String(err.stack).slice(0, 2000)) : '',
        }
      : null,
    diagnostic,
    suggestedFix: fix,
  };
  report.text = renderRunReportText(report);
  return report;
}

/* -------------------------------------------------------------------------- */
/*  Exécution instrumentée + persistance                                      */
/* -------------------------------------------------------------------------- */

/** Persiste le rapport sur le document IntegratedApi du provider (best-effort). */
export async function persistRunReport(provider, mode, report) {
  try {
    const doc = await IntegratedApi.findOne({ provider });
    if (!doc) return false;
    const w = doc.modes[mode].webhook || {};
    const plain = w.toObject ? w.toObject() : w;
    doc.modes[mode].webhook = {
      ...plain,
      lastRunReport: report,
      lastAttemptAt: report.finishedAt,
      ...(report.status === 'SUCCESS' ? { lastSuccessAt: report.finishedAt } : {}),
    };
    doc.markModified(`modes.${mode}.webhook`);
    await doc.save();
    return true;
  } catch (err) {
    logger.warn(`Rapport webhook ${provider} (${mode}) non persisté : ${err?.message}`);
    return false;
  }
}

/** Derniers rapports persistés, par provider, pour un mode (affichage Manager). */
export async function getLastRunReports(mode) {
  const out = {};
  try {
    const docs = await IntegratedApi.find({}).lean();
    for (const doc of docs) {
      const w = doc.modes?.[mode]?.webhook;
      if (!w) continue;
      out[doc.provider] = {
        lastRunReport: w.lastRunReport || null,
        lastAttemptAt: w.lastAttemptAt || null,
        lastSuccessAt: w.lastSuccessAt || null,
      };
    }
  } catch (err) {
    logger.warn(`Lecture des rapports webhook impossible : ${err?.message}`);
  }
  return out;
}

/**
 * Exécute UNE action webhook (sync/repair/test) avec instrumentation complète :
 * timing, snapshot d'état, rapport structuré + texte, persistance.
 * Ne lève jamais pour la partie rapport ; relève l'absence de provider.
 *
 * @returns {Promise<{actionReport: object, runReport: object}>}
 */
export async function runProviderWebhookAction(providerCode, mode, action, { providers } = {}) {
  const provider = providers
    ? providers.find((p) => p.providerCode() === String(providerCode).toUpperCase())
    : providerByCode(providerCode);
  if (!provider) throw new Error(`Provider de webhooks inconnu : ${providerCode}.`);
  const code = provider.providerCode();

  const startedAt = new Date();
  let actionReport = null;
  let thrown = null;
  try {
    if (action === 'sync') {
      actionReport = await ensureProviderWebhooks(code, mode, providers ? { providers } : {});
    } else if (action === 'repair') {
      if (!provider.supportsWebhooks()) {
        actionReport = { provider: code, skipped: true, reason: 'REMOTE_SYNC_UNSUPPORTED', results: [] };
      } else {
        actionReport = { provider: code, results: await provider.repairWebhooks(mode) };
      }
    } else if (action === 'test') {
      if (!provider.supportsWebhooks() || !provider.testWebhooks) {
        actionReport = { provider: code, skipped: true, reason: 'REMOTE_SYNC_UNSUPPORTED', results: [] };
      } else {
        actionReport = { provider: code, results: await provider.testWebhooks(mode) };
      }
    } else {
      throw new Error(`Action webhook inconnue : ${action}.`);
    }
  } catch (err) {
    thrown = err;
    actionReport = actionReport || { provider: code, results: [] };
  }
  const finishedAt = new Date();

  // Snapshot d'état APRÈS action (URLs, statut distant, secret) — best-effort.
  let descriptor = null;
  try {
    const list = await provider.listManagedWebhooks(mode);
    descriptor = Array.isArray(list) && list.length ? list[0] : null;
  } catch { /* le rapport reste utile sans snapshot */ }

  // Credentials du provider pour ce mode (présence seule, jamais la valeur).
  let credential = 'UNKNOWN';
  try {
    const name = provider.requiredCredentialName ? provider.requiredCredentialName() : null;
    if (name) credential = (await tryGetCredential(code, name, { mode })) ? 'OK' : 'MISSING';
  } catch { /* UNKNOWN */ }

  const runReport = buildRunReport({
    provider: code,
    mode,
    action,
    startedAt,
    finishedAt,
    actionReport,
    thrown,
    descriptor,
    capabilities: provider.capabilities ? provider.capabilities() : null,
    credential,
  });

  await persistRunReport(code, mode, runReport);
  return { actionReport, runReport };
}
