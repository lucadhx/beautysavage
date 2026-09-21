import { integrationWebhookProviders, providerByCode } from './integrationWebhookProviders.js';

/**
 * ORCHESTRATEUR générique des webhooks gérés.
 *
 * C'est la SEULE surface que connaissent le bootstrap, le moteur de
 * déploiement et le Manager : aucun d'eux ne cite un fournisseur. On itère le
 * registre des drivers (`IntegrationWebhookProvider`), chaque driver répond de
 * ses propres webhooks (0, 1 ou plusieurs), l'orchestrateur agrège des
 * RAPPORTS — jamais des détails de fournisseur.
 *
 * Isolation des pannes : l'échec d'un provider n'empêche JAMAIS les autres
 * d'être réconciliés — il devient une ligne d'erreur dans le rapport.
 */

/** Réconcilie les webhooks d'UN provider. Ne lève jamais. */
export async function ensureProviderWebhooks(providerCode, mode, { providers } = {}) {
  const provider = providers
    ? providers.find((p) => p.providerCode() === String(providerCode).toUpperCase())
    : providerByCode(providerCode);
  if (!provider) {
    return { provider: String(providerCode).toUpperCase(), supportsWebhooks: false, results: [], error: { code: 'UNKNOWN_PROVIDER' } };
  }
  const code = provider.providerCode();
  if (!provider.supportsWebhooks()) {
    return { provider: code, supportsWebhooks: false, results: [], skipped: true, reason: 'REMOTE_SYNC_UNSUPPORTED' };
  }
  try {
    const results = await provider.ensureWebhooks(mode);
    return { provider: code, supportsWebhooks: true, results: Array.isArray(results) ? results : [] };
  } catch (err) {
    return {
      provider: code,
      supportsWebhooks: true,
      results: [],
      error: { code: err?.code || 'ENSURE_FAILED', message: String(err?.message || '') },
    };
  }
}

/**
 * Réconcilie les webhooks de TOUS les providers du registre, pour un mode.
 *
 * @returns {Promise<{mode, providers: object[], summary: {ensured, skipped, failed}}>}
 */
export async function ensureAllWebhooks(mode, { providers = integrationWebhookProviders() } = {}) {
  const reports = [];
  for (const p of providers) {
    reports.push(await ensureProviderWebhooks(p.providerCode(), mode, { providers }));
  }
  const summary = { ensured: 0, skipped: 0, failed: 0 };
  for (const r of reports) {
    if (r.error) { summary.failed += 1; continue; }
    if (r.skipped) { summary.skipped += 1; continue; }
    for (const item of r.results) {
      if (item.skipped) summary.skipped += 1;
      else if (item.ok) summary.ensured += 1;
      else summary.failed += 1;
    }
  }
  return { mode, providers: reports, summary };
}

/** Descripteurs de TOUS les webhooks gérés (affichage Manager). Ne lève jamais. */
export async function describeAllManagedWebhooks(mode, { providers = integrationWebhookProviders() } = {}) {
  const out = [];
  for (const p of providers) {
    try {
      const list = await p.listManagedWebhooks(mode);
      out.push({
        provider: p.providerCode(),
        supportsWebhooks: p.supportsWebhooks(),
        capabilities: p.capabilities ? p.capabilities() : null,
        webhooks: list,
      });
    } catch (err) {
      out.push({
        provider: p.providerCode(),
        supportsWebhooks: p.supportsWebhooks(),
        capabilities: p.capabilities ? p.capabilities() : null,
        webhooks: [],
        error: { code: err?.code || 'LIST_FAILED', message: String(err?.message || '') },
      });
    }
  }
  return out;
}

/**
 * ══ `logEnsureReport` A ÉTÉ RETIRÉ — ET C'EST LE CŒUR DU LOT ════════════════
 *
 * Il journalisait le rapport brut, ligne par ligne. C'est lui qui écrivait :
 *
 *     Webhook STRIPE/payment (TEST) : réconciliation sautée (PANEL_NOT_PAIRED).
 *
 * Une phrase exacte, et sans lendemain. Elle nommait un geste abandonné sans
 * que personne n'ait à en rendre compte : rien ne le comptait, rien ne le
 * reprenait, et le résumé du démarrage ne le voyait pas.
 *
 * L'AUDIT de démarrage (`services/lifecycle/integratedApiStartup.service.js`)
 * a repris ce rôle, et il fait davantage : il traduit chaque constat en un
 * ÉTAT du vocabulaire commun, exige une preuve pour tout succès, et inscrit un
 * travail de reprise pour tout geste resté dû.
 *
 * Le garder en parallèle aurait produit DEUX journaux pour un même fait. Ils
 * auraient fini par se contredire — et c'est toujours celui qui ne compte pas
 * qu'on croit. Un seul chemin écrit désormais ces lignes, et c'est le même qui
 * les totalise.
 */
