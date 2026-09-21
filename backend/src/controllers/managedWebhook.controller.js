import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { describeAllManagedWebhooks } from '../services/webhooks/webhookOrchestrator.service.js';
import {
  runProviderWebhookAction,
  getLastRunReports,
} from '../services/webhooks/webhookRunReport.service.js';
import { providerByCode } from '../services/webhooks/integrationWebhookProviders.js';
import { MODE_VALUES } from '../utils/integratedApiCatalog.js';

/**
 * Webhooks GÉRÉS — surface générique du Manager (DEV).
 *
 * Le Manager ne connaît aucun fournisseur : il affiche ce que le registre des
 * drivers décrit (0, 1 ou plusieurs webhooks par provider) et déclenche des
 * actions génériques. Ajouter un provider demain = zéro changement ici.
 * Jamais de secret dans les réponses (les descripteurs n'en portent pas).
 */

function assertMode(mode) {
  const m = String(mode || '').toUpperCase();
  if (!MODE_VALUES.includes(m)) throw ApiError.badRequest(`Mode invalide : ${mode}.`);
  return m;
}

function resolveProvider(code) {
  try {
    return providerByCode(code);
  } catch {
    throw ApiError.notFound(`Provider de webhooks inconnu : ${code}.`);
  }
}

/** GET /api/dev/managed-webhooks/:mode — descripteurs + dernier rapport persisté. */
export const list = asyncHandler(async (req, res) => {
  const mode = assertMode(req.params.mode);
  const [providers, reports] = await Promise.all([
    describeAllManagedWebhooks(mode),
    getLastRunReports(mode),
  ]);
  for (const entry of providers) {
    const r = reports[entry.provider] || {};
    entry.lastRunReport = r.lastRunReport || null;
    entry.lastAttemptAt = r.lastAttemptAt || null;
    entry.lastSuccessAt = r.lastSuccessAt || null;
  }
  return ok(res, { mode, providers });
});

/**
 * Les trois actions (Synchroniser/Réparer/Tester) passent par le MÊME runner
 * instrumenté : rapport complet construit, masqué, PERSISTÉ, puis renvoyé avec
 * le résultat historique (compatibilité de forme conservée).
 */
function actionHandler(action) {
  return asyncHandler(async (req, res) => {
    const mode = assertMode(req.params.mode);
    const provider = resolveProvider(req.params.provider);
    const { actionReport, runReport } = await runProviderWebhookAction(provider.providerCode(), mode, action);
    return ok(res, { ...actionReport, runReport });
  });
}

/** POST /api/dev/managed-webhooks/:provider/:mode/sync — réconciliation. */
export const sync = actionHandler('sync');

/** POST /api/dev/managed-webhooks/:provider/:mode/repair — sync + joignabilité. */
export const repair = actionHandler('repair');

/** POST /api/dev/managed-webhooks/:provider/:mode/test — meilleur diagnostic possible. */
export const test = actionHandler('test');

/** POST /api/dev/managed-webhooks/:provider/:mode/health — joignabilité seule. */
export const health = asyncHandler(async (req, res) => {
  const mode = assertMode(req.params.mode);
  const provider = resolveProvider(req.params.provider);
  if (!provider.supportsWebhooks()) {
    return ok(res, { provider: provider.providerCode(), skipped: true, reason: 'REMOTE_SYNC_UNSUPPORTED', results: [] });
  }
  const results = await provider.getWebhookHealth(mode);
  return ok(res, { provider: provider.providerCode(), results });
});
