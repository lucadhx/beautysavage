import { getCredential, getProviderBaseUrl } from '../integratedApi.service.js';

/**
 * ADAPTATEURS DISTANTS des webhooks gérés — Stripe & Yousign.
 *
 * Interface minimale consommée par `remoteWebhookSyncEngine` :
 *   list(mode)                 → [{ id, url, events, description, enabled }]
 *   create(mode, {url,events,description}) → { id, secret|null }
 *   update(mode, id, {url,events,description})
 *   remove(mode, id)
 *
 * Volontairement en `fetch` nu (pas de SDK) : mêmes patrons de test que Brevo
 * (mock de `globalThis.fetch`), zéro dépendance au client HTTP interne du SDK.
 * Jamais de secret loggé ; les erreurs remontent en messages sûrs.
 */

const FETCH_TIMEOUT_MS = 10_000;

async function timedFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    const e = new Error(err?.name === 'AbortError' ? 'Fournisseur injoignable (délai dépassé).' : 'Fournisseur injoignable (erreur réseau).');
    e.code = 'REMOTE_UNREACHABLE';
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function parseJson(res) {
  const text = await res.text().catch(() => '');
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

function remoteError(provider, res, json) {
  const msg = json?.error?.message || json?.message || json?.detail || `Erreur ${provider} (${res.status}).`;
  const e = new Error(String(msg).slice(0, 300));
  e.code = res.status === 401 || res.status === 403 ? `${provider}_API_UNAUTHORIZED` : `${provider}_REMOTE_ERROR`;
  return e;
}

/* -------------------------------------------------------------------------- */
/*  STRIPE — SUPPRIMÉ EN L6.3A                                                */
/* -------------------------------------------------------------------------- */
//
// Ce fichier pilotait `/v1/webhook_endpoints` avec la clé secrète du PROJET :
// lister, créer, mettre à jour, supprimer. C'était le dernier geste qui rendait
// cette clé indispensable — et donc le dernier verrou empêchant de la retirer.
//
// Le Panel provisionne désormais l'endpoint de ce projet avec SA clé, puis lui
// livre le seul secret de VÉRIFICATION. Voir `panelWebhookProvisioning.js`.
//
// Le code a été SUPPRIMÉ plutôt que désactivé : un adaptateur qui existe finit
// par être rebranché, et celui-ci n'aurait eu besoin que d'une ligne dans la
// table des drivers pour recommencer à parler à Stripe. Une garde statique
// (`stripe-local-surface.test.js`) vérifie qu'il ne revient pas.

/*
 * ADAPTATEUR YOUSIGN RETIRE (R10.5C).
 *
 * Il appelait /v3/webhooks avec la cle d'appel LOCALE pour creer, lister et
 * supprimer l endpoint. Le Panel fait cela desormais, avec la sienne.
 *
 * Le supprimer est ce qui fait tomber les deux dernieres lectures de cle
 * Yousign de ce projet a zero.
 */

