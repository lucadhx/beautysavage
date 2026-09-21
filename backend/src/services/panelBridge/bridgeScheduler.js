// ORDONNANCEUR DU PONT — Phase 4.
//
// ── LE MANQUE QUE CE MODULE COMBLE ──────────────────────────────────────────
// Jusqu'ici, le projet n'envoyait qu'UN signe de vie, au démarrage. Un Panel
// qui surveille la vivacité voyait donc un heartbeat par redémarrage — et
// classait le projet HORS LIGNE le reste du temps. La supervision construite
// en Phase 3A observait un parc qui, en réalité, ne parlait pas.
//
// Deux boucles, volontairement séparées :
//   · HEARTBEAT — « je suis vivant, voici ma version et ma santé » ;
//   · SYNCHRONISATION — vidage de l'outbox puis rattrapage des écritures.
//
// Elles n'ont pas la même cadence ni le même coût, et surtout : un heartbeat
// qui échoue ne doit pas empêcher une synchronisation de réussir. Les fusionner
// aurait couplé deux pannes indépendantes.
//
// ── DISCIPLINE ──────────────────────────────────────────────────────────────
//   · ne lève JAMAIS — une erreur de pont ne fait pas tomber le backend ;
//   · ne se chevauche jamais avec elle-même (un tic lent ne s'empile pas) ;
//   · `unref()` sur les minuteurs — un processus qui n'a plus rien à faire
//     doit pouvoir sortir, y compris en test ;
//   · silencieux quand le projet n'est pas appairé : ne pas être appairé est
//     un état normal (STANDALONE), pas une anomalie à journaliser en boucle.
// Ce module ne lit AUCUNE configuration : les cadences lui sont données au
// démarrage. C'est la même discipline que le reste du pont — le module de
// transport ignore l'application, y compris son `.env`. Un test
// d'architecture le vérifie.
import { logger } from '../../utils/logger.js';
import { isPaired } from './pairingStore.js';
import { getPanelBridge } from './bridgeRuntime.js';
import { recordSyncIncident, SYNC_INCIDENT } from './syncIncidents.js';

/** Repli si l'appelant ne précise rien — jamais une lecture d'environnement. */
const DEFAULT_HEARTBEAT_MS = 60_000;
const DEFAULT_SYNC_MS = 120_000;

let heartbeatTimer = null;
let syncTimer = null;
let identityProvider = null;
let healthProvider = null;
/**
 * ══ « LE RUNTIME ACCEPTE-T-IL ENCORE DU TRAVAIL ? » — INJECTÉ, JAMAIS IMPORTÉ ══
 *
 * ── LE DÉFAUT QUE CE PRÉDICAT FERME ────────────────────────────────────────
 *
 * Une poussée déclenchée par un enregistrement part sans être attendue. Quand
 * l'arrêt survient dans cette fenêtre, elle atteint une base déjà refermée et
 * journalise `CYCLE_FAILED / Client must be connected` — au niveau ERREUR, sur
 * un arrêt parfaitement normal.
 *
 * C'est exactement le mécanisme décrit par `runtimeLifecycle` : confondre « en
 * panne » et « en train de s'arrêter » apprend à ignorer une catégorie
 * d'incidents, et le jour où l'un d'eux est vrai, personne ne le lit.
 *
 * ── POURQUOI UN PROVIDER, ET PAS UN `import` ───────────────────────────────
 *
 * Le module de pont ne dépend de RIEN du runtime — `bridge-conformity` le
 * vérifie, et la règle vaut plus que la commodité. Le prédicat est donc confié
 * au démarrage, comme l'identité et la santé. Par défaut il répond « oui » :
 * un pont utilisé hors runtime (tests unitaires purs) continue de travailler.
 */
let acceptingWorkProvider = () => true;

function accepteDuTravail() {
  try {
    return acceptingWorkProvider() !== false;
  } catch {
    return true;
  }
}

/**
 * LES CYCLES EN VOL — pour que l'arrêt puisse les ATTENDRE.
 *
 * ── POURQUOI REFUSER DU TRAVAIL NE SUFFIT PAS ──────────────────────────────
 *
 * Le prédicat ci-dessus empêche un cycle de COMMENCER pendant l'arrêt. Il ne
 * peut rien pour celui qui a commencé une milliseconde plus tôt : sa requête
 * part, la base se referme sous lui, et il journalise `CYCLE_FAILED` au niveau
 * erreur sur un arrêt parfaitement normal — le défaut exact que la garde
 * précédente ferme, à une milliseconde près.
 *
 * On garde donc une trace des cycles en vol, et `drainBridgeScheduler()` les
 * attend. C'est la seule façon de rendre la fenêtre vide plutôt qu'étroite.
 */
const enVol = new Set();

function suivre(promesse) {
  enVol.add(promesse);
  void promesse.finally(() => enVol.delete(promesse));
  return promesse;
}
let intervals = { heartbeatMs: DEFAULT_HEARTBEAT_MS, syncMs: DEFAULT_SYNC_MS };
let running = { heartbeat: false, sync: false, push: false };
/**
 * UNE POUSSÉE DEMANDÉE PENDANT QU'UNE AUTRE TOURNE N'EST PAS PERDUE.
 *
 * Voir `runPushCycle` : ce drapeau est la différence entre « on saute ce tic »
 * et « on perd cette modification ».
 */
let pushDemandeeEnCours = false;
let stats = {
  startedAt: null,
  heartbeats: { attempts: 0, delivered: 0, lastAt: null, lastError: null },
  sync: { attempts: 0, applied: 0, pushed: 0, lastAt: null, lastError: null },
};

/**
 * Un tic qui ne se chevauche pas.
 *
 * Si un cycle dure plus longtemps que l'intervalle (Panel lent, réseau
 * dégradé), le tic suivant est SAUTÉ plutôt que mis en attente. Empiler des
 * cycles sur un Panel déjà lent ne ferait qu'aggraver la situation.
 */
function guarded(name, fn) {
  return suivre(garde(name, fn));
}

async function garde(name, fn) {
  /**
   * UN ARRÊT N'EST PAS UNE PANNE. On sort AVANT toute lecture de base : le
   * cycle n'a pas échoué, il n'avait plus lieu d'être.
   */
  if (!accepteDuTravail()) return { skipped: true, reason: 'DRAINING' };
  if (running[name]) {
    // Un saut est une information : c'est lui qui explique un retard de
    // convergence, et il ne doit pas disparaître.
    recordSyncIncident(SYNC_INCIDENT.CYCLE_SKIPPED, { step: name, reason: 'ALREADY_RUNNING' });
    return { skipped: true, reason: 'ALREADY_RUNNING' };
  }
  running[name] = true;
  try {
    return await fn();
  } catch (err) {
    // Par contrat, les cycles ne lèvent pas. Que l'un le fasse est une
    // anomalie franche : on la nomme, on ne l'absorbe pas en `warn`.
    recordSyncIncident(
      SYNC_INCIDENT.CYCLE_FAILED,
      { step: name, reason: err.code || err.message },
      'error',
    );
    return { skipped: true, reason: err.message };
  } finally {
    running[name] = false;
  }
}

/** Un cycle de heartbeat. Exporté : le Manager peut le déclencher à la main. */
export async function runHeartbeatCycle() {
  return guarded('heartbeat', async () => {
    if (!isPaired()) return { skipped: true, reason: 'NOT_PAIRED' };
    const instance = getPanelBridge();
    if (!instance || typeof identityProvider !== 'function') {
      return { skipped: true, reason: 'NOT_CONFIGURED' };
    }

    const identity = await identityProvider();
    const health = typeof healthProvider === 'function'
      ? await healthProvider()
      : { status: 'OK', details: null };

    stats.heartbeats.attempts += 1;
    const result = await instance.heartbeat({
      softwareVersion: identity.softwareVersion,
      environment: identity.environment,
      healthStatus: health.status ?? 'OK',
      details: health.details ?? null,
    });

    if (result.delivered) {
      stats.heartbeats.delivered += 1;
      stats.heartbeats.lastAt = new Date().toISOString();
      stats.heartbeats.lastError = null;
    } else {
      stats.heartbeats.lastError = result.reason ?? 'inconnu';
    }
    return result;
  });
}

/**
 * POUSSÉE IMMÉDIATE — celle qui suit un enregistrement dans le Manager.
 *
 * ══ LE DÉFAUT QUE CETTE FONCTION CORRIGE ════════════════════════════════════
 *
 * L'enregistrement d'une fiche déclenchait `runSyncCycle()`. Ce cycle est
 * GARDÉ : si un cycle périodique tournait déjà — et il tourne à chaque
 * intervalle, pendant tout le temps d'un aller-retour réseau — la poussée
 * immédiate était SAUTÉE. Silencieusement.
 *
 * La modification n'était pas perdue : elle attendait dans l'outbox durable.
 * Mais elle attendait le PROCHAIN tic périodique. Avec l'intervalle par
 * défaut, cela voulait dire jusqu'à deux minutes pendant lesquelles
 * l'utilisateur enregistre, va voir le Panel, et y lit l'ancien nom. C'est
 * exactement le symptôme « la synchronisation n'est pas live ».
 *
 * ══ POURQUOI UNE GARDE À PART, ET UN DRAPEAU ════════════════════════════════
 *
 * Deux poussées simultanées réclameraient le même lot dans l'outbox : la garde
 * reste nécessaire. Mais sauter une demande ne l'est pas. Quand une poussée
 * arrive pendant qu'une autre s'exécute, on note la demande ; la poussée en
 * cours, en se terminant, RECOMMENCE une fois. La file est donc toujours
 * revisitée APRÈS la dernière mise en file, quel que soit l'entrelacement.
 *
 * ══ POUSSER SEULEMENT — le rattrapage reste au cycle périodique ════════════
 *
 * Un enregistrement local n'a aucune raison de déclencher une lecture
 * descendante. Les séparer garde chaque panne dans son couloir : un Panel qui
 * répond mal au `pull` ne doit pas retarder la livraison de ce qu'on vient
 * d'écrire.
 */
export function runPushCycle() {
  return suivre(executerPoussee());
}

async function executerPoussee() {
  /**
   * Même règle que les cycles gardés : une poussée qui arrive pendant l'arrêt
   * est SANS OBJET, pas en échec. Ce qu'elle n'a pas livré reste dans l'outbox
   * durable et repartira au prochain démarrage — c'est précisément la garantie
   * que la file existe pour donner.
   */
  if (!accepteDuTravail()) return { delivered: 0, skipped: true, reason: 'DRAINING' };
  if (running.push) {
    pushDemandeeEnCours = true;
    return { skipped: true, reason: 'ALREADY_RUNNING', queuedAgain: true };
  }
  running.push = true;
  try {
    /**
     * LE COMPTE EST CUMULÉ SUR TOUTES LES PASSES.
     *
     * L'appelant a demandé UNE poussée ; combien de fois la file a dû être
     * revisitée est une affaire interne. Rendre le résultat de la dernière
     * passe ferait dire « 0 livrée » à un cycle qui vient d'en livrer deux —
     * et l'amorçage après appairage, qui lit ce compte pour dire « appairé ET
     * synchronisé », s'en trouverait faussé.
     */
    let livrees = 0;
    let dernier = { delivered: 0, pending: 0 };
    // Au plus une reprise par demande arrivée en vol : la boucle se ferme
    // parce que le drapeau est remis à zéro AVANT chaque passe.
    for (;;) {
      pushDemandeeEnCours = false;
      if (!isPaired()) return { delivered: livrees, skipped: true, reason: 'NOT_PAIRED' };
      const instance = getPanelBridge();
      if (!instance) return { delivered: livrees, skipped: true, reason: 'NOT_CONFIGURED' };

      dernier = await instance.flushOutbox();
      livrees += dernier?.delivered ?? 0;
      stats.sync.pushed += dernier?.delivered ?? 0;
      stats.sync.lastAt = new Date().toISOString();
      if (dernier?.reason) {
        stats.sync.lastError = dernier.reason;
        recordSyncIncident(SYNC_INCIDENT.OUTBOX_PUSH_FAILED, {
          step: 'push', reason: dernier.reason, pending: dernier.pending,
        });
      } else {
        stats.sync.lastError = null;
      }

      if (!pushDemandeeEnCours) {
        return { ...dernier, delivered: livrees };
      }
    }
  } catch (err) {
    recordSyncIncident(
      SYNC_INCIDENT.CYCLE_FAILED,
      { step: 'push', reason: err.code || err.message },
      'error',
    );
    return { skipped: true, reason: err.message };
  } finally {
    running.push = false;
  }
}

/**
 * Un cycle de synchronisation : POUSSER puis TIRER, dans cet ordre.
 *
 * L'ordre compte. Pousser d'abord garantit qu'une écriture locale n'est pas
 * écrasée par une version du Panel plus ancienne qu'elle : le Panel connaît
 * alors notre modification avant de nous répondre.
 */
export async function runSyncCycle() {
  return guarded('sync', async () => {
    if (!isPaired()) return { skipped: true, reason: 'NOT_PAIRED' };
    const instance = getPanelBridge();
    if (!instance) return { skipped: true, reason: 'NOT_CONFIGURED' };

    stats.sync.attempts += 1;
    /**
     * La poussée passe par `runPushCycle` — et non par un second appel direct
     * à `flushOutbox`. Deux vidanges concurrentes réclameraient le même lot ;
     * une seule porte d'entrée les sérialise, et une demande arrivée en vol
     * n'est pas perdue.
     */
    const pushed = await runPushCycle();
    const pulled = await instance.pullUpdates();

    stats.sync.applied += pulled?.applied ?? 0;
    stats.sync.lastAt = new Date().toISOString();
    if (pulled?.reason) {
      stats.sync.lastError = pulled.reason;
      recordSyncIncident(SYNC_INCIDENT.PULL_FAILED, { step: 'pull', reason: pulled.reason });
    }

    if ((pulled?.applied ?? 0) > 0) {
      logger.info(`[panel-bridge] ${pulled.applied} écriture(s) du Panel appliquée(s).`);
    }
    return { pushed, pulled };
  });
}

/**
 * Démarre les deux boucles.
 *
 * Le premier heartbeat part TOUT DE SUITE : attendre l'intervalle complet
 * laisserait le Panel considérer le projet hors ligne pendant plusieurs
 * minutes après chaque redémarrage — exactement au moment où l'on veut
 * savoir qu'il est reparti.
 */
export function startBridgeScheduler({
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS,
  syncIntervalMs = DEFAULT_SYNC_MS,
  immediate = true,
} = {}) {
  stopBridgeScheduler();
  stats.startedAt = new Date().toISOString();
  intervals = { heartbeatMs: heartbeatIntervalMs, syncMs: syncIntervalMs };

  heartbeatTimer = setInterval(() => void runHeartbeatCycle(), heartbeatIntervalMs);
  syncTimer = setInterval(() => void runSyncCycle(), syncIntervalMs);
  heartbeatTimer.unref?.();
  syncTimer.unref?.();

  if (immediate) {
    void runHeartbeatCycle();
    void runSyncCycle();
  }

  logger.info(
    `[panel-bridge] Ordonnanceur démarré — heartbeat toutes les ${Math.round(heartbeatIntervalMs / 1000)} s, synchronisation toutes les ${Math.round(syncIntervalMs / 1000)} s.`
  );
  return { heartbeatIntervalMs, syncIntervalMs };
}

export function stopBridgeScheduler() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (syncTimer) clearInterval(syncTimer);
  heartbeatTimer = null;
  syncTimer = null;
}

/**
 * ARRÊT COMPLET — on cesse de programmer, PUIS on attend ce qui vole encore.
 *
 * ── CE QUE `stopBridgeScheduler()` SEUL NE PEUT PAS FAIRE ──────────────────
 *
 * Il éteint les minuteurs. Il n'attend rien : un cycle déjà parti continue,
 * atteint une base que l'arrêt vient de refermer, et écrit une FAUSSE panne.
 * C'est ce qui reste visible en fin de recette sous la forme
 * `CYCLE_FAILED / Client must be connected` — un incident qui n'en est pas un.
 *
 * ── LE PLAFOND EST UN FILET, PAS LE CHEMIN NORMAL ─────────────────────────
 *
 * Un Panel qui ne répond plus ne doit pas retenir un arrêt : au-delà du délai,
 * on rend la main. Ce qui n'a pas été livré reste dans l'outbox DURABLE et
 * repartira au prochain démarrage — la file existe exactement pour cela.
 */
export async function drainBridgeScheduler({ graceMs = 5_000 } = {}) {
  stopBridgeScheduler();
  const attendus = enVol.size;
  /**
   * ══ ON REND LE BAIL — BEST-EFFORT, ET LA SÛRETÉ N'EN DÉPEND PAS ═════════
   *
   * Un `kill -9` ne rend rien : c'est l'EXPIRATION qui débloque, et elle seule.
   * Rendre proprement évite simplement à un redémarrage d'attendre tout un TTL
   * avant de reprendre. Un mécanisme dont la sûreté reposerait sur un arrêt
   * propre n'aurait de sûreté que le nom.
   *
   * APRÈS `stopBridgeScheduler()` : plus aucun tic ne partira, donc plus
   * personne ne le reprendra derrière nous.
   */
  const { releaseConsumerLease } = await import('./consumptionStore.js');
  const rendu = await releaseConsumerLease().catch(() => ({ released: false }));
  if (rendu.released) {
    logger.info('[panel-bridge] bail de consommation rendu à l’arrêt.');
  }
  if (attendus === 0) return { awaited: 0, timedOut: false, leaseReleased: rendu.released === true };
  const delai = new Promise((resoudre) => {
    const t = setTimeout(() => resoudre('forced'), graceMs);
    t.unref?.();
  });
  const issue = await Promise.race([
    Promise.allSettled([...enVol]).then(() => 'drained'),
    delai,
  ]);
  return { awaited: attendus, timedOut: issue === 'forced', leaseReleased: rendu.released === true };
}

/**
 * ══ POURQUOI L'INSCRIPTION À L'EXTINCTION N'EST PAS ICI ═════════════════════
 *
 * Chacun des tics de cet ordonnanceur lit la base : le laisser tourner pendant
 * qu'elle se ferme produirait une FAUSSE panne — un cycle de synchronisation en
 * échec sur un arrêt parfaitement normal.
 *
 * Il doit donc s'arrêter au drainage. Mais le module de pont ne dépend de RIEN
 * du métier ni du runtime : c'est une règle vérifiée par `bridge-conformity`,
 * et elle vaut plus que la commodité d'écrire l'inscription près du code
 * qu'elle ferme. Importer `runtimeLifecycle` d'ici ouvrirait la table fermée
 * des dépendances du pont — pour un gain de lisibilité.
 *
 * `config/bootstrap.js` DÉMARRE cet ordonnanceur ; c'est donc lui qui inscrit
 * son arrêt. Démarrage et arrêt au même endroit : la symétrie est ce qui
 * empêche l'un d'être oublié quand l'autre change.
 */

/** Branche les fournisseurs d'identité et de santé (bootstrap). */
export function configureBridgeScheduler(opts = {}) {
  if (opts.identityProvider) identityProvider = opts.identityProvider;
  if (opts.healthProvider) healthProvider = opts.healthProvider;
  if (opts.acceptingWorkProvider) acceptingWorkProvider = opts.acceptingWorkProvider;
}

/** État de l'ordonnanceur — pour l'écran « Connexion Panel » du Manager. */
export function describeScheduler() {
  return {
    running: heartbeatTimer !== null,
    startedAt: stats.startedAt,
    heartbeatIntervalS: Math.round(intervals.heartbeatMs / 1000),
    syncIntervalS: Math.round(intervals.syncMs / 1000),
    heartbeats: { ...stats.heartbeats },
    sync: { ...stats.sync },
  };
}

/** Réinitialisation — tests uniquement. */
export function resetSchedulerForTests() {
  stopBridgeScheduler();
  enVol.clear();
  identityProvider = null;
  healthProvider = null;
  acceptingWorkProvider = () => true;
  intervals = { heartbeatMs: DEFAULT_HEARTBEAT_MS, syncMs: DEFAULT_SYNC_MS };
  running = { heartbeat: false, sync: false, push: false };
  pushDemandeeEnCours = false;
  stats = {
    startedAt: null,
    heartbeats: { attempts: 0, delivered: 0, lastAt: null, lastError: null },
    sync: { attempts: 0, applied: 0, pushed: 0, lastAt: null, lastError: null },
  };
}

export default {
  startBridgeScheduler, stopBridgeScheduler, drainBridgeScheduler, configureBridgeScheduler,
  runHeartbeatCycle, runSyncCycle, runPushCycle, describeScheduler, resetSchedulerForTests,
};
