/**
 * RUNTIME du PanelBridge (Phase 2A, objectif 3) — l'instance UNIQUE que
 * l'application utilise pour parler à un Panel RÉEL.
 *
 * En Phase 1, le pont n'existait qu'en tests (client stub). Ici, le projet est
 * prêt pour un vrai Panel : le client par DÉFAUT est le client HTTP réel
 * (HttpPanelClient), construit sur l'URL du Panel mémorisée par l'appairage
 * persisté. Le stub ne sert plus qu'aux tests, via `clientFactory` injectable.
 *
 * DÉCOUPLAGE : ce module ne connaît RIEN du métier ni du ProjectBridge. Les
 * informations du projet (identité, manifeste) arrivent par des PROVIDERS
 * injectés au bootstrap (`configureBridgeRuntime`) — même patron que la
 * persistance de l'appairage. Verrouillé par bridge-conformity.test.js.
 *
 * Cycle de vie :
 *   bootstrap ─▶ configureBridgeRuntime(...) ─▶ startupBridgeHello()
 *   Manager   ─▶ pairWithPanel(...) / unpairFromPanel() / getPanelBridge()
 */
import { PanelBridge } from './PanelBridge.js';
import { HttpPanelClient } from './PanelClient.js';
import { isPaired, describePairing, currentBridgeToken } from './pairingStore.js';
import { logger } from '../../utils/logger.js';

/** @type {PanelBridge|null} Instance applicative unique (par URL de Panel). */
let bridge = null;

/** Providers injectés (bootstrap). Null tant que non configurés. */
let identityProvider = null;
let manifestProvider = null;
/**
 * Applicateur de la découverte reçue au bootstrap (contrat >= 1.3.0).
 * Injecté comme les autres providers : le runtime du pont ne doit pas
 * apprendre ce qu'est une « entreprise » ni une « API intégrée ».
 */
let discoveryApplier = null;
/**
 * CE QUE CE PROJET SERT COMME ADRESSES PUBLIQUES (contrat 1.9.0).
 *
 * Injecté comme les autres providers : le runtime du pont n'a pas à savoir ce
 * qu'est une « configuration système », ni où elle est rangée. Il transporte
 * une fonction, et la garde de découplage reste satisfaite.
 */
let networkProvider = null;
/** Fabrique de client — HTTP réel par défaut ; stub injectable en test. */
let clientFactory = (panelUrl) =>
  new HttpPanelClient({ baseUrl: panelUrl, tokenProvider: () => currentBridgeToken() });

/**
 * Branche les providers du runtime (appelé UNE fois au bootstrap).
 * @param {object} opts
 * @param {Function} opts.identityProvider async () => Identity du projet.
 * @param {Function} [opts.manifestProvider] async () => ProjectManifest.
 * @param {Function} [opts.clientFactory] (panelUrl) => PanelClient — tests uniquement.
 */
let outboxAdapter = null;

/**
 * OUTBOX DURABLE du projet. Injectée au bootstrap : le cœur du pont ne connaît
 * ni Mongo ni les modèles, exactement comme pour l'appairage.
 */
let initialProjectionProvider = null;

/**
 * AMORÇAGE APRÈS APPAIRAGE — construit les projections métier initiales.
 * Injecté : le runtime du pont ne sait pas ce qu'est une « présentation ».
 */
export function configureInitialProjections(provider) {
  initialProjectionProvider = provider;
}

/**
 * Rappel exécuté quand le pont retrouve le Panel après une coupure.
 * Le métier y rejoue sa photographie complète.
 */
let reconnectHook = null;
export function configureReconnectHook(fn) {
  reconnectHook = typeof fn === 'function' ? fn : null;
}

export function configureOutboxAdapter(adapter) {
  outboxAdapter = adapter;
}

export function configureBridgeRuntime(opts = {}) {
  if (opts.identityProvider) identityProvider = opts.identityProvider;
  if (opts.manifestProvider) manifestProvider = opts.manifestProvider;
  if (opts.clientFactory) clientFactory = opts.clientFactory;
  if (opts.discoveryApplier) discoveryApplier = opts.discoveryApplier;
  if (opts.networkProvider) networkProvider = opts.networkProvider;
  if (opts.applyHandlers) {
    applyHandlers = opts.applyHandlers;
    /**
     * ══ UNE INSTANCE DÉJÀ CONSTRUITE EST REBRANCHÉE — ET C'EST LE CŒUR ══════
     *
     * ── LA PANNE, TELLE QU'ELLE S'EST PRODUITE ───────────────────────────────
     *
     * `getPanelBridge()` construit l'instance PARESSEUSEMENT, et la mémorise.
     * Or plusieurs consommateurs l'appellent AVANT que le bootstrap n'ait
     * atteint `configureBridgeRuntime` — le rafraîchissement du contrat de
     * variables e-mail (`templateProjectionClient`) est le premier de tous, et
     * c'est la première ligne du journal de démarrage.
     *
     * L'instance mémorisée naissait donc avec une table d'applicateurs VIDE, et
     * `configureBridgeRuntime` ne faisait ensuite que remplir la variable de
     * module : l'instance vivante, elle, ne la relisait jamais.
     *
     * ── CE QUE ÇA CASSAIT, ET POURQUOI ÇA NE SE VOYAIT PAS ───────────────────
     *
     * Le chemin de LIVRAISON IMMÉDIATE (`changeAppliers`, injecté ailleurs)
     * continuait de fonctionner : l'appairage, l'identité développeur, le
     * secret de webhook arrivaient normalement. Seul le RATTRAPAGE au tirage
     * était mort — et il l'était en silence, jusqu'à la première écriture d'un
     * type « déclaré mais non branché ». Elle RETIENT le curseur, sans jamais
     * s'épuiser (`tentative 0/5` indéfiniment, par construction), et tout ce
     * qui la suit dans le journal cesse d'arriver.
     *
     * Sur ce projet, c'est un `EMAIL_DELIVERY_EVENT` qui a bloqué — et derrière
     * lui les DOCUMENTS LÉGAUX, qui ne sont jamais arrivés sur le site.
     *
     * ── POURQUOI LE CORRECTIF EST ICI, ET PAS DANS `getPanelBridge` ──────────
     *
     * Parce que le défaut n'est pas « l'instance est construite trop tôt » —
     * elle a le droit de l'être, et le reste du pont fonctionne sans ses
     * applicateurs. Le défaut est que la configuration n'atteignait pas ce qui
     * existait déjà. Les deux sens sont désormais couverts : une instance
     * construite APRÈS est câblée par `wireHandlers` à sa naissance, une
     * instance construite AVANT est recâblée ici.
     *
     * ⚠️ DÉFAUT DE FABRIQUE — à remonter dans le moteur, pas seulement ici.
     */
    if (bridge) wireHandlers(bridge);
  }
}

/**
 * Handlers de synchronisation, par type d'entité. Injectés au bootstrap et
 * rebranchés sur CHAQUE instance du pont — y compris celle reconstruite
 * paresseusement après un redémarrage. Sans ce rebranchement, un projet
 * redémarré tirerait des écritures qu'il ne saurait plus appliquer.
 */
let applyHandlers = {};

function wireHandlers(instance) {
  for (const [entityType, handler] of Object.entries(applyHandlers)) {
    try {
      instance.registerApplyHandler(entityType, handler);
    } catch (err) {
      logger.warn(`[panel-bridge] handler « ${entityType} » non branché : ${err.message}`);
    }
  }
  return instance;
}

function assertConfigured() {
  if (typeof identityProvider !== 'function') {
    throw new Error(
      'bridgeRuntime non configuré : configureBridgeRuntime({ identityProvider }) doit être appelé au bootstrap.'
    );
  }
}

/**
 * L'instance applicative du pont. Null si le projet n'est pas appairé (état
 * STANDALONE — normal). Construite paresseusement sur l'URL persistée.
 */
export function getPanelBridge() {
  if (bridge) return bridge;
  if (!isPaired()) return null;
  const { panelUrl } = describePairing();
  if (!panelUrl) return null;
  bridge = wireHandlers(new PanelBridge({ client: clientFactory(panelUrl), outbox: outboxAdapter, onReconnected: () => reconnectHook?.(), networkProvider: () => networkProvider?.() }));
  return bridge;
}

/**
 * Appaire CE projet à un Panel réel (page « Connexion Panel », duplication…).
 * Le manifeste est joint au bootstrap si le provider est branché (best-effort :
 * un manifeste indisponible n'empêche pas l'appairage — le Panel pourra le
 * relire via GET /manifest).
 */
export async function pairWithPanel({ panelUrl, pairingCode, publicBackendUrl = null }) {
  assertConfigured();
  const candidate = wireHandlers(new PanelBridge({ client: clientFactory(panelUrl), outbox: outboxAdapter, onReconnected: () => reconnectHook?.(), networkProvider: () => networkProvider?.() }));
  const identity = await identityProvider();
  let manifest;
  try {
    manifest = manifestProvider ? await manifestProvider() : undefined;
  } catch (err) {
    logger.warn(`[panel-bridge] manifeste indisponible au bootstrap : ${err.message}`);
    manifest = undefined;
  }
  const pairing = await candidate.pair({ identity, pairingCode, publicBackendUrl, manifest });
  bridge = candidate;

  // DÉCOUVERTE (contrat >= 1.3.0). Best-effort ASSUMÉ : l'appairage a réussi,
  // il ne doit pas être annulé parce qu'une configuration n'a pas pu
  // s'appliquer. Ce qui échoue ici sera rattrapé au prochain cycle de
  // synchronisation — c'est précisément à cela que sert le rattrapage.
  if (typeof discoveryApplier === 'function' && pairing.discovery) {
    try {
      await discoveryApplier(pairing.discovery);
    } catch (err) {
      logger.warn(`[panel-bridge] découverte non appliquée : ${err.message}`);
    }
  }
  // AMORÇAGE MÉTIER : identité et contrat partent DÈS l'appairage, sans
  // attendre une future modification du Manager. Best-effort assumé — si le
  // premier envoi échoue, les écritures restent en file durable et seront
  // reprises. L'appairage, lui, est acquis : on ne l'annule pas pour cela.
  let synchronized = false;
  if (typeof initialProjectionProvider === 'function') {
    try {
      const outcome = await initialProjectionProvider();
      synchronized = outcome?.delivered === true;
    } catch (err) {
      logger.warn(`[panel-bridge] amorçage métier différé : ${err.message}`);
    }
  }

  // Le statut DIT ce qui s'est réellement passé : « appairé et synchronisé »
  // n'est pas « appairé, synchronisation en attente ».
  return { ...pairing, synchronized };
}

/** Débranche le projet (best-effort côté Panel, toujours effectif localement). */
export async function unpairFromPanel() {
  const instance = getPanelBridge();
  if (!instance) return { unpaired: true };
  const result = await instance.unpair();
  bridge = null;
  return result;
}

/**
 * Signe de vie au DÉMARRAGE : heartbeat + vidage d'outbox, timeouté, jamais
 * bloquant, jamais levant — même discipline que la réconciliation des
 * webhooks au bootstrap. No-op propre si non appairé ou non configuré.
 */
export async function startupBridgeHello({ timeoutMs = 10_000 } = {}) {
  if (!isPaired()) return { skipped: true, reason: 'NOT_PAIRED' };
  if (typeof identityProvider !== 'function') return { skipped: true, reason: 'NOT_CONFIGURED' };
  const instance = getPanelBridge();
  if (!instance) return { skipped: true, reason: 'NO_BRIDGE' };

  const withTimeout = (p) =>
    Promise.race([p, new Promise((r) => setTimeout(() => r(null), timeoutMs).unref?.())]);
  try {
    const identity = await identityProvider();
    const heartbeat = await withTimeout(
      instance.heartbeat({
        softwareVersion: identity.softwareVersion,
        environment: identity.environment,
      })
    );
    const flush = await withTimeout(instance.flushOutbox());
    if (heartbeat?.delivered) {
      logger.info(`[panel-bridge] Signe de vie envoyé au Panel « ${describePairing().panelName || describePairing().panelUrl} ».`);
    } else {
      logger.warn(`[panel-bridge] Panel injoignable au démarrage (${heartbeat?.reason || 'délai dépassé'}) — mode DEGRADED, reprise automatique.`);
    }
    return { skipped: false, heartbeat, flush };
  } catch (err) {
    // Par contrat heartbeat/flushOutbox ne lèvent pas ; ceinture et bretelles.
    logger.warn(`[panel-bridge] Signe de vie impossible : ${err.message}`);
    return { skipped: false, error: err.message };
  }
}

/** Réinitialise le runtime (tests uniquement). */
export function resetBridgeRuntimeForTests() {
  bridge = null;
  identityProvider = null;
  manifestProvider = null;
  clientFactory = (panelUrl) =>
    new HttpPanelClient({ baseUrl: panelUrl, tokenProvider: () => currentBridgeToken() });
}
