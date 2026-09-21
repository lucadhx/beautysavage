// LE PROVISIONNEMENT PASSE PAR LE PANEL (L6.3A).
//
// ══ CE QUI CHANGE ═══════════════════════════════════════════════════════════
//
// Jusqu'ici, ce projet enregistrait lui-même son endpoint chez Stripe :
// `POST /v1/webhook_endpoints`, avec SA clé secrète, au démarrage et à chaque
// changement de tunnel. C'était le dernier geste qui rendait cette clé
// indispensable — et donc le dernier verrou empêchant de la retirer.
//
// Désormais il DEMANDE : « garantis que mon endpoint existe et correspond à
// mon adresse publique actuelle ». Le Panel compare, crée ou corrige avec sa
// propre clé, et range le secret de signature. Le projet vient ensuite le
// chercher par un canal qui ne transporte que cela.
//
// ══ CE QUI NE CHANGE PAS ════════════════════════════════════════════════════
//
// L'endpoint pointe toujours vers CE projet, et c'est toujours lui qui vérifie
// les signatures et traite les événements. Rien du parcours métier ne bouge :
// seule la main qui enregistre l'adresse a changé.
//
// ══ AUCUN REPLI ═════════════════════════════════════════════════════════════
//
// Si le Panel est absent ou refuse, le provisionnement ÉCHOUE. Il n'existe pas
// de `catch { stripeLocal() }` — ce serait rouvrir la clé locale exactement le
// jour où le Panel est indisponible, c'est-à-dire le jour où personne ne
// regarde. Un endpoint déjà enregistré continue naturellement de recevoir : ne
// pas pouvoir le RÉ-enregistrer n'interrompt rien tant que l'adresse tient.
import {
  invokeCapability,
  capabilitiesAvailable,
  fetchWebhookVerificationSecret,
} from '../panelBridge/capabilityClient.js';
import { IntegratedApi } from '../../models/IntegratedApi.model.js';
import { encryptSecret, lastFourOf } from '../../utils/integratedApiCrypto.js';
import { logger } from '../../utils/logger.js';

/** Le verbe demandé au Panel. Le projet nomme une intention, jamais un appel. */
export const ENSURE_CAPABILITY = 'webhook.endpoint.ensure';

export class PanelProvisioningError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PanelProvisioningError';
    this.code = code;
  }
}

/**
 * Garantit l'endpoint Stripe de ce projet, et rapatrie son secret si besoin.
 *
 * @param {object} args
 * @param {'TEST'|'PROD'} args.mode
 * @param {string} args.publicBackendUrl  l'adresse publique courante du projet
 * @returns {Promise<{endpointId: string|null, url: string, events: string[],
 *   created: boolean, updated: boolean, secretRefreshed: boolean}>}
 */
export async function ensureStripeWebhookViaPanel({ mode, publicBackendUrl }) {
  if (!capabilitiesAvailable()) {
    /**
     * NON APPAIRÉ N'EST PAS UNE PANNE, mais ce n'est pas non plus un succès.
     * Le dire distinctement évite qu'un projet autonome journalise une erreur
     * à chaque démarrage — et évite surtout de faire croire que l'endpoint est
     * garanti alors que personne ne l'a vérifié.
     */
    throw new PanelProvisioningError(
      'PANEL_NOT_PAIRED',
      'Projet non appairé : le provisionnement du webhook appartient au Panel.',
    );
  }

  const enveloppe = await invokeCapability(ENSURE_CAPABILITY, { publicBackendUrl });
  /**
   * L'enveloppe porte l'issue, la capacité et le monde ; `result` porte le
   * constat. On ne garde que le second — le reste appartient au diagnostic de
   * la passerelle, et le faire entrer ici y ferait entrer le vocabulaire du
   * pont.
   */
  const resultat = enveloppe?.result ?? null;
  if (!resultat?.endpointId) {
    throw new PanelProvisioningError(
      'ENDPOINT_NOT_ENSURED',
      'Le Panel n’a pas rendu d’endpoint exploitable.',
    );
  }

  /**
   * LE SECRET NE VIENT PAS AVEC LA RÉPONSE, et c'est voulu : le résultat d'une
   * capacité traverse la garde du Panel qui refuse tout identifiant
   * fournisseur. On apprend seulement QU'IL Y EN A un à relire.
   */
  let secretRefreshed = false;
  if (resultat?.secretRenewed || (resultat?.secretAvailable && !(await hasLocalSecret(mode)))) {
    secretRefreshed = await refreshVerificationSecret({ mode });
  }

  logger.info(
    `[webhooks] endpoint Stripe ${mode} garanti par le Panel `
    + `(${resultat?.created ? 'créé' : resultat?.updated ? 'corrigé' : 'déjà conforme'}`
    + `${secretRefreshed ? ', secret rapatrié' : ''}).`,
  );

  return {
    endpointId: resultat?.endpointId ?? null,
    url: resultat?.url ?? '',
    events: resultat?.events ?? [],
    created: Boolean(resultat?.created),
    updated: Boolean(resultat?.updated),
    secretRefreshed,
  };
}

/** Ce projet sait-il déjà vérifier une signature pour ce mode ? */
async function hasLocalSecret(mode) {
  const doc = await IntegratedApi.findOne({ provider: 'STRIPE' }).lean();
  const creds = doc?.modes?.[mode]?.credentials;
  const entry = creds instanceof Map ? creds.get('webhookSecret') : creds?.webhookSecret;
  return Boolean(entry?.encryptedValue);
}

/**
 * Va chercher le secret de VÉRIFICATION et le range, chiffré.
 *
 * La valeur ne transite par aucun journal, aucune erreur, aucune réponse HTTP
 * de ce projet. Elle va du client de pont au coffre, et nulle part ailleurs.
 */
export async function refreshVerificationSecret({ mode }) {
  let charge;
  try {
    charge = await fetchWebhookVerificationSecret('STRIPE');
  } catch (err) {
    /**
     * Un secret absent côté Panel n'est pas une panne : c'est l'état normal
     * d'un projet dont l'endpoint n'a pas encore été créé. On le distingue
     * d'un vrai échec pour ne pas faire échouer un démarrage sur un ordre
     * d'exécution.
     */
    if (err?.code === 'PANEL_WEBHOOK_VERIFICATION_SECRET_MISSING') return false;
    throw err;
  }

  const secret = charge?.webhookSecret;
  if (typeof secret !== 'string' || !secret.startsWith('whsec_')) {
    /**
     * On refuse de ranger ce qui n'a pas la forme attendue. Le Panel valide
     * déjà à l'émission ; le revérifier ici coûte une ligne et ferme le seul
     * cas où un intermédiaire aurait pu substituer autre chose.
     */
    throw new PanelProvisioningError(
      'VERIFICATION_SECRET_MALFORMED',
      'Le secret livré n’a pas la forme d’un secret de signature.',
    );
  }

  const doc = await IntegratedApi.findOne({ provider: 'STRIPE' });
  if (!doc) {
    throw new PanelProvisioningError('PROVIDER_NOT_REGISTERED', 'STRIPE absent du registre local.');
  }
  doc.modes[mode].credentials.set('webhookSecret', {
    encryptedValue: encryptSecret(secret),
    lastFour: lastFourOf(secret),
    updatedAt: new Date(),
  });
  doc.markModified(`modes.${mode}.credentials`);
  await doc.save();
  // Le journal dit QU'IL Y A eu un secret, jamais lequel.
  logger.info(`[webhooks] secret de vérification Stripe ${mode} rapatrié depuis le Panel.`);
  return true;
}

export default { ensureStripeWebhookViaPanel, refreshVerificationSecret, ENSURE_CAPABILITY };

/* -------------------------------------------------------------------------- */
/*  LE DRIVER — même interface qu'avant, autre main au bout                    */
/* -------------------------------------------------------------------------- */

/**
 * Un gestionnaire de webhook Stripe qui DEMANDE au lieu d'APPELER.
 *
 * Il expose exactement la même surface que le moteur générique
 * (`createRemoteWebhookManager`) : l'orchestrateur, le bootstrap, la veille
 * ngrok et l'écran de diagnostic continuent de l'appeler sans savoir que la
 * main au bout a changé. C'est ce qui rend la bascule invisible au reste du
 * projet.
 *
 * Ce qu'il ne fait plus : lister, créer, modifier ou supprimer un endpoint chez
 * Stripe. Toute la convergence — reconnaissance, dérive, dédoublonnage,
 * plafond, secret rendu à la création — vit désormais côté Panel, en un seul
 * exemplaire. La dupliquer ici aurait produit deux vérités sur la même
 * question.
 */
export function createPanelBackedStripeWebhookManager({ spec, persistence }) {
  const { loadState, saveState, expectedUrl, probeHealth } = persistence;

  async function syncWebhook(mode) {
    const attendu = await expectedUrl(mode);
    if (!attendu.webhookReady) {
      const err = new Error('URL publique HTTPS requise (ngrok en dev, domaine déployé en PROD).');
      err.code = 'URL_NOT_PUBLIC';
      throw err;
    }
    const r = await ensureStripeWebhookViaPanel({
      mode, publicBackendUrl: attendu.publicBackendUrl,
    });
    await saveState(mode, {
      webhookId: r.endpointId,
      webhookUrl: r.url || attendu.url,
      subscribedEvents: r.events,
      authenticationType: spec.authentication,
      status: 'CONFIGURED',
      active: true,
      lastSyncedAt: new Date(),
      lastErrorSafe: { code: '', message: '' },
    });
    return {
      status: 'CONFIGURED',
      webhookId: r.endpointId,
      url: r.url || attendu.url,
      events: r.events,
      created: r.created,
      updated: r.updated,
      deletedDuplicates: 0,
      secretCaptured: r.secretRefreshed,
    };
  }

  /**
   * ENSURE — non intrusif, ne lève jamais : son appelant est le démarrage.
   *
   * AUCUN REPLI. Un Panel injoignable produit un état d'erreur lisible, jamais
   * une tentative locale. C'est le point du lot : la panne devient explicite au
   * lieu de rouvrir silencieusement la clé du projet.
   */
  async function ensureWebhook(mode) {
    /**
     * UN PROJET NON APPAIRÉ N'EST PAS EN PANNE.
     *
     * C'est un état de première classe : le projet sert son métier, il n'a
     * simplement personne à qui demander le provisionnement. Le compter comme
     * un échec ferait rougir chaque démarrage autonome — et un rapport toujours
     * rouge finit par n'être plus lu.
     *
     * Il remplace exactement l'ancien `API_KEY_MISSING` : hier on sautait faute
     * de clé locale, aujourd'hui faute de Panel. Le geste sauté est le même.
     */
    /**
     * UN FOURNISSEUR DÉSACTIVÉ NE SE PROVISIONNE PAS — et cette garde manquait.
     *
     * Le moteur générique refuse depuis toujours (`PROVIDER_DISABLED`) ; ce
     * gestionnaire-ci, écrit plus tard pour le chemin Panel, ne l'avait jamais
     * reprise. Couper Stripe depuis le Manager n'empêchait donc pas le
     * démarrage suivant de redemander au Panel de garantir son endpoint : la
     * désactivation ne désactivait rien de ce qui est distant.
     *
     * Le motif est le MÊME que celui du moteur générique, à dessein : l'audit
     * de démarrage classe par motif, et deux vocabulaires pour un seul fait
     * l'obligeraient à connaître le fournisseur qui l'a produit.
     */
    let doc = null;
    try {
      doc = await IntegratedApi.findOne({ provider: 'STRIPE' }).lean();
    } catch {
      return { skipped: true, reason: 'REGISTRY_UNAVAILABLE' };
    }
    if (!doc) return { skipped: true, reason: 'REGISTRY_UNAVAILABLE' };
    if (!doc.enabled) return { skipped: true, reason: 'PROVIDER_DISABLED' };

    if (!capabilitiesAvailable()) return { skipped: true, reason: 'PANEL_NOT_PAIRED' };
    const attendu = await expectedUrl(mode);
    if (!attendu.webhookReady) return { skipped: true, reason: 'URL_NOT_PUBLIC' };
    try {
      const r = await syncWebhook(mode);
      return {
        skipped: false, ok: true,
        created: r.created, updated: r.updated,
        deletedDuplicates: 0, secretCaptured: r.secretCaptured,
      };
    } catch (err) {
      const code = err?.code || 'PANEL_PROVISIONING_FAILED';
      await saveState(mode, {
        status: 'OUT_OF_SYNC',
        lastErrorSafe: { code, message: String(err?.message || '').slice(0, 300) },
      }).catch(() => {});
      return { skipped: false, ok: false, error: { code, message: String(err?.message || '').slice(0, 300) } };
    }
  }

  async function repairWebhook(mode) {
    const ensured = await ensureWebhook(mode);
    const health = ensured.skipped ? null : await probeHealth(mode).catch(() => ({ healthy: false }));
    return { ...ensured, health };
  }

  /**
   * TESTER — le meilleur diagnostic possible SANS aucun effet distant.
   *
   * Il ne va plus interroger Stripe : le projet n'a plus de quoi le faire, et
   * c'est le but. Il dit ce qu'il sait vraiment — l'adresse attendue, la
   * présence d'un secret de vérification, la joignabilité de sa propre route.
   */
  async function testWebhook(mode) {
    const etat = await loadState(mode);
    const attendu = await expectedUrl(mode);
    const joignable = attendu.webhookReady
      ? await probeHealth(mode).catch(() => ({ healthy: false }))
      : { healthy: false, code: 'URL_NOT_PUBLIC' };
    const conforme = Boolean(etat.webhookId) && etat.webhookUrl === attendu.url;
    return {
      ok: conforme && etat.secretConfigured && joignable.healthy,
      remoteOk: conforme,
      differences: conforme ? [] : ['url'],
      remoteError: null,
      secretConfigured: Boolean(etat.secretConfigured),
      reachable: joignable.healthy,
      reachabilityCode: joignable.code || null,
    };
  }

  return { syncWebhook, ensureWebhook, repairWebhook, testWebhook, probeHealth, getState: loadState };
}
