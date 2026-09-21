/**
 * PanelBridge — LA façade unique du projet vers le Panel (LOT 3/4).
 *
 * Philosophie : docs/panelXvitrine/01_PANEL_CONNECTOR.md.
 * Contrat     : docs/panelXvitrine/spec/PanelBridge.openapi.yaml.
 *
 * Responsabilités (et RIEN d'autre) : authentification, appairage,
 * désappairage, heartbeat, synchronisation (push/pull), découverte (ping),
 * outbox, reprise après erreur. Aucun composant métier n'appelle le Panel :
 * tout passe par cette classe, qui elle-même ne parle qu'à un PanelClient
 * injecté (HTTP réel ou stub) — verrouillé par bridge-conformity.test.js.
 *
 * États (01_PANEL_CONNECTOR §2) :
 *
 *   UNCONFIGURED ──pair()──▶ CONNECTED ◀──succès──┐
 *        ▲                       │                │
 *        └──────unpair()─────────┤            heartbeat/sync
 *                                ▼                │
 *                            DEGRADED ────────────┘
 *
 *   UNCONFIGURED = pas d'appairage (jamais appairé, débranché, revendu) :
 *   c'est l'état STANDALONE, normal et de première classe. DEGRADED = appairé
 *   mais Panel injoignable : le métier ne s'en aperçoit pas, l'outbox
 *   accumule, la reprise est automatique au prochain échange réussi.
 *
 * ══ CE QUI SURVIT À UN REDÉMARRAGE, ET CE QUI N'A PAS À Y SURVIVRE ══════════
 *
 * TROIS choses sont DURABLES, chacune par un adaptateur injecté au bootstrap —
 * le cœur du pont ne connaît aucun modèle, et `bridge-conformity` le vérifie :
 *
 *   L'APPAIRAGE          `pairingStore` + adaptateur chiffré. Un redémarrage
 *                        ne casse jamais la relation de confiance.
 *   L'OUTBOX             `mongoOutboxAdapter`. Une écriture métier acquise ne
 *                        se perd pas parce que le Panel était absent.
 *   LA CONSOMMATION      `consumptionStore` + adaptateur. Le curseur de tirage
 *                        et les compteurs de santé survivent : après un arrêt,
 *                        le rattrapage reprend EXACTEMENT où il s'était arrêté.
 *
 * Ce qui reste volontairement EN MÉMOIRE :
 *
 *   `localWriteIds`      l'anti-écho de nos propres écritures. Ce n'est pas la
 *                        protection — le Panel exclut lui-même l'émetteur
 *                        d'origine —, et après un redémarrage plus aucune
 *                        écriture en vol ne peut nous revenir. Borné.
 *   les handlers         ils sont rebranchés à chaque construction du pont.
 *
 * ── LA DETTE QUE CE LOT A FERMÉE ────────────────────────────────────────────
 *
 * Le curseur vivait dans une propriété d'instance. Le projet repartait donc de
 * zéro à chaque démarrage, rejouait tout le journal, et le Panel ne pouvait
 * rien dire de ce qu'il avait réellement consommé.
 */
import { readFileSync } from 'node:fs';
import {
  CONTRACT_VERSION,
  EMITTERS,
  ACK_STATUS,
  SYNC_ENTITY_TYPES,
  APPLIED_ENTITY_TYPES,
  heartbeatSchema,
  bootstrapRequestSchema,
  bootstrapResponseDataSchema,
  syncChangeSchema,
  syncPullEnvelopeSchema,
  syncPullResponseDataSchema,
  syncPushResponseDataSchema,
  identitySchema,
  parseOrThrow,
  assertContractCompatible,
  nowIso,
} from './bridgeContract.js';
import { bridgeError, BRIDGE_ERROR_CODES } from './bridgeErrors.js';
import { recordSyncIncident, SYNC_INCIDENT } from './syncIncidents.js';
import { isPanelClient } from './PanelClient.js';
import {
  setPairing,
  clearPairing,
  isPaired,
  describePairing,
} from './pairingStore.js';
/**
 * L'ÉTAT DE CONSOMMATION — DURABLE depuis ce lot.
 *
 * Le curseur de tirage vivait dans une propriété d'instance : il ne survivait
 * ni à un redémarrage, ni à une release. Le projet repartait donc de zéro à
 * chaque démarrage, et le Panel ne pouvait rien dire de ce qu'il avait
 * réellement consommé.
 *
 * Le magasin suit exactement la discipline de `pairingStore` : lectures
 * synchrones sur un cache, écritures par un adaptateur INJECTÉ au bootstrap.
 * Le cœur du pont continue de ne connaître aucun modèle.
 */
import {
  MAX_APPLY_ATTEMPTS,
  alreadyApplied,
  claimConsumerLease,
  holdsConsumerLease,
  renewConsumerLease,
  resolveDeadLettersFor,
  clearApplyFailure,
  clearConsumption,
  currentCursor,
  deadLetterChange,
  describeConsumption,
  consumptionIsAuthoritative,
  blockingChange,
  clearBlockingChange,
  recordApplied,
  recordApplyFailure,
  recordBlockingChange,
  recordCursor,
  recordPullFailure,
  recordUnreadableChange,
  resetCursor,
} from './consumptionStore.js';
import { logger } from '../../utils/logger.js';

export const BRIDGE_STATES = Object.freeze({
  UNCONFIGURED: 'UNCONFIGURED', // = STANDALONE (aucun appairage)
  CONNECTED: 'CONNECTED',
  DEGRADED: 'DEGRADED',
});

/** Bornes de sécurité des boucles de synchronisation (jamais infinies). */
const MAX_PULL_PAGES_PER_RUN = 10;
const PUSH_BATCH_SIZE = 100;
/**
 * BORNE DE L'ENSEMBLE ANTI-ÉCHO — il n'en avait aucune.
 *
 * `localWriteIds` grandissait à chaque écriture émise, pour toujours. Sur un
 * processus qui tourne des mois, c'est une fuite lente : quelques dizaines
 * d'octets par projection, sans jamais rien libérer.
 *
 * La borne est large parce que la fenêtre à couvrir est courte : le temps
 * qu'une écriture poussée revienne dans une page de tirage. Au-delà, le
 * Panel l'exclut déjà lui-même par `originProjectId` — cet ensemble n'a
 * jamais été la protection, seulement une ceinture.
 */
const LOCAL_WRITE_IDS_MAX = 1_000;

export class PanelBridge {
  /**
   * @param {object} opts
   * @param {import('./PanelClient.js')} opts.client PanelClient injecté (HTTP ou stub).
   * @param {object} [opts.log] Logger injectable (défaut : logger applicatif).
   */
  constructor({ client, log = logger, outbox = null, onReconnected = null, networkProvider = null }) {
    // Rappel INJECTÉ : le pont annonce qu'il a retrouvé le Panel, sans savoir
    // ce que le métier veut en faire.
    this.onReconnected = onReconnected;
    /**
     * CE QUE CE PROJET SERT COMME ADRESSES PUBLIQUES — fournisseur INJECTÉ.
     *
     * ══ POURQUOI IL EST INJECTÉ ET NON IMPORTÉ ═══════════════════════════════
     *
     * Le pont ne connaît AUCUN modèle et AUCUN module métier : c'est un
     * invariant du dépôt, vérifié par `bridge-conformity`. Importer ici le
     * lecteur de configuration réseau aurait fait entrer `projectBridge` — donc
     * Mongo — dans le cœur du pont, et la garde l'a refusé, à juste titre.
     *
     * Le patron est celui des autres providers (identité, manifeste,
     * découverte) : le bootstrap branche, le pont appelle sans savoir ce qu'il
     * y a derrière. `null` = ce projet ne déclare pas son réseau, ce qui reste
     * parfaitement conforme.
     */
    this.networkProvider = networkProvider;
    if (!isPanelClient(client)) {
      throw new Error('PanelBridge : le client fourni n’honore pas l’interface PanelClient.');
    }
    this.client = client;
    this.log = log;
    /**
     * OUTBOX DURABLE (injectée). Quand elle est présente, c'est ELLE qui fait
     * foi : la file mémoire ci-dessous ne sert plus qu'au stub et aux tests
     * isolés. Le cœur du pont n'importe aucun modèle — l'adaptateur lui est
     * confié, comme la persistance de l'appairage.
     */
    this.durableOutbox = outbox;

    this.state = isPaired() ? BRIDGE_STATES.CONNECTED : BRIDGE_STATES.UNCONFIGURED;
    /** Écritures locales en attente de livraison au Panel (FIFO). */
    this.outbox = [];
    /** Écritures locales rejetées par le Panel (observabilité, jamais bloquant). */
    this.rejected = [];
    /**
     * writeId ÉMIS PAR CE PROJET — anti-écho au pull (règle 11 §1.1 n°4).
     *
     * ══ POURQUOI CET ENSEMBLE RESTE EN MÉMOIRE, ET BORNÉ ═══════════════════
     *
     * Ce n'est PAS la protection : le Panel exclut lui-même l'émetteur
     * d'origine de la page qu'il sert (`originProjectId: { $ne }` dans
     * `pullForProject`). C'est une ceinture, et une ceinture n'a pas à survivre
     * à un redémarrage — après lequel, précisément, plus aucune écriture en vol
     * ne peut nous revenir.
     *
     * Il est en revanche BORNÉ, ce qu'il n'était pas : un `Set` qui grandit à
     * chaque écriture émise finit par peser sur un processus qui tourne des
     * mois. La borne couvre largement la fenêtre où un écho est possible — le
     * temps qu'une écriture poussée revienne dans une page de tirage.
     */
    this.localWriteIds = new Set();
    /** Handlers d'application par entityType (Phase 3+ : un par lot). */
    this.applyHandlers = new Map();

    this.lastHeartbeatAt = null;
    this.lastSyncAt = null;
    this.lastError = null;
  }

  // ------------------------------------------------------------- découverte

  /** Le Panel est-il vivant ? N'exige pas d'appairage. Ne lève jamais. */
  async ping() {
    try {
      const data = await this.client.ping();
      return { reachable: true, time: data?.time ?? null };
    } catch (err) {
      return { reachable: false, error: err.code || err.message };
    }
  }

  // -------------------------------------------------------------- appairage

  /**
   * Bootstrap : appaire CE projet au Panel (01_PANEL_CONNECTOR §3.1).
   * @param {object} identity    Identité du projet (identitySchema, sans contractVersion imposée).
   * @param {string} pairingCode Code à usage unique obtenu hors-bande.
   * @param {object} [manifest]  Manifeste officiel du projet (contrat ≥ 1.1.0,
   *                             optionnel) — le Panel n'a rien à déduire.
   */
  async pair({ identity, pairingCode, publicBackendUrl = null, manifest = undefined }) {
    if (isPaired()) throw bridgeError(BRIDGE_ERROR_CODES.ALREADY_PAIRED);
    const id = parseOrThrow(identitySchema, identity, 'Identity');
    const request = parseOrThrow(
      bootstrapRequestSchema,
      {
        contractVersion: CONTRACT_VERSION,
        projectKey: id.projectKey,
        projectName: id.projectName,
        environment: id.environment,
        softwareVersion: id.softwareVersion,
        publicBackendUrl,
        pairingCode,
        ...(manifest !== undefined ? { manifest } : {}),
      },
      'BootstrapRequest'
    );

    const raw = await this.client.bootstrap(request);
    const granted = parseOrThrow(bootstrapResponseDataSchema, raw, 'BootstrapResponse');
    assertContractCompatible(granted.panel.contractVersion);

    await setPairing({
      panelUrl: this.client.baseUrl || '',
      /**
       * L'ADRESSE HUMAINE DU PANEL, DECLAREE PAR LUI - lui seul la connait.
       *
       * Champ de PREMIER NIVEAU, et non `panel.frontendUrl` : le schema de la
       * reponse de bootstrap est `passthrough()` a la racine mais `strict()`
       * sur son objet `panel`. Un Panel qui enrichirait `panel` ferait donc
       * ECHOUER le bootstrap de tous les projets deja deployes - l'inverse
       * d'une evolution additive.
       */
      panelFrontendUrl: granted.panelFrontendUrl ?? null,
      projectId: granted.projectId,
      panelName: granted.panel.name,
      bridgeToken: granted.bridgeToken,
    });

    // Contrat >= 1.3.0 — le Panel a joint sa configuration. Le curseur qu'il
    // fournit positionne le projet APRÈS ces écritures : sans lui, le premier
    // rattrapage rejouerait ce qu'on vient de recevoir.
    /**
     * IL EST PERSISTÉ IMMÉDIATEMENT, et non gardé en mémoire.
     *
     * Un appairage suivi d’un redémarrage avant le premier cycle aurait
     * sinon perdu cette position — et le tout premier rattrapage aurait
     * rejoué la configuration que le bootstrap venait de livrer.
     */
    if (typeof granted.syncCursor === 'string') {
      await recordCursor(granted.syncCursor);
    }

    this.state = BRIDGE_STATES.CONNECTED;
    this.lastError = null;
    this.log.info?.(`[panel-bridge] Appairé au Panel « ${granted.panel.name} ».`);

    // La DÉCOUVERTE est retournée telle quelle, pas appliquée ici : ce module
    // ne connaît rien au métier et ne doit pas commencer maintenant. C'est le
    // runtime qui la confie à l'applicateur injecté.
    return {
      ...describePairing(),
      discovery: {
        company: granted.company ?? null,
        integratedApis: granted.integratedApis ?? [],
        syncCursor: granted.syncCursor ?? null,
      },
    };
  }

  /**
   * Débranchement (04_STANDALONE §4.1) : best-effort côté Panel, TOUJOURS
   * effectif côté projet. Idempotent. Purge l'outbox et le curseur — les
   * données synchronisées, elles, restent dans le projet par construction.
   */
  async unpair() {
    if (isPaired()) {
      try {
        await this.client.unpair();
      } catch (err) {
        // Panel mort ou token déjà révoqué : le débranchement local prime.
        this.log.warn?.(`[panel-bridge] unpair best-effort : ${err.code || err.message}`);
      }
    }
    try {
      await clearPairing();
    } catch (err) {
      // La persistance a échoué mais le cache RAM est vidé : le débranchement
      // local prime toujours ; on le dit, on ne bloque pas.
      this.log.warn?.(`[panel-bridge] purge de l'appairage persisté : ${err.message}`);
    }
    this.outbox = [];
    this.rejected = [];
    this.localWriteIds.clear();
    /**
     * L’ÉTAT DE CONSOMMATION REPART AVEC L’APPAIRAGE.
     *
     * Un curseur est une position dans le journal d’UN Panel, pour UN
     * projet. Le conserver après un débranchement ferait démarrer le
     * prochain appairage au milieu d’un journal qui ne le concerne pas —
     * et tout ce qui précède cette position serait sauté, définitivement.
     */
    await clearConsumption().catch((err) => {
      this.log.warn?.(`[panel-bridge] purge de l'état de consommation : ${err.message}`);
    });
    this.state = BRIDGE_STATES.UNCONFIGURED;
    return { unpaired: true };
  }

  // ------------------------------------------------------------ capacités

  /**
   * DEMANDE UNE CAPACITÉ AU PANEL (contrat 1.5.0).
   *
   * ── CE QUE LE PROJET N'A PAS, ET N'AURA PAS ────────────────────────────────
   *
   * Ni clé, ni URL de fournisseur, ni choix du monde. Il nomme une INTENTION
   * MÉTIER — « vérifie que je peux écrire » — et le Panel décide de tout le
   * reste à partir du bridgeToken : quel projet, quel environnement, quel
   * fournisseur, quel jeu d'identifiants, et si le commerce est ouvert.
   *
   * ── POURQUOI CETTE MÉTHODE LÈVE, CONTRAIREMENT AU BATTEMENT ────────────────
   *
   * Un battement raté est sans conséquence : on réessaiera dans trente
   * secondes. Une capacité, elle, est demandée PAR une action métier qui
   * attend une réponse. La ravaler en `{ delivered: false }` obligerait chaque
   * appelant à inventer sa propre lecture du silence — et l'un d'eux finirait
   * par traiter « je ne sais pas » comme « ça n'a pas eu lieu », puis à
   * rejouer.
   *
   * Les codes `CAPABILITY_*` remontent tels quels. `CAPABILITY_TIMEOUT`
   * signifie que l'issue est INDÉTERMINÉE : ne pas rejouer une écriture sans
   * arbitrage.
   *
   * @param {string} code   par exemple `email.sender.verify`
   * @param {object} input  entrée métier, dont `operationId`
   */
  async invokeCapability(code, input = {}) {
    if (!isPaired()) {
      throw bridgeError(
        BRIDGE_ERROR_CODES.NOT_PAIRED,
        'Aucun Panel appairé : aucune capacité ne peut être demandée.',
      );
    }
    return this.client.invokeCapability(code, input);
  }

  /**
   * Le secret de VÉRIFICATION de ce projet (L6.3A).
   *
   * Il ne permet aucun appel sortant : il sert uniquement à constater qu'un
   * webhook reçu vient bien du fournisseur. La valeur n'est ni journalisée ni
   * conservée ici — elle traverse et va directement au coffre chiffré.
   */
  async fetchWebhookVerificationSecret(provider) {
    if (!isPaired()) {
      throw bridgeError(
        BRIDGE_ERROR_CODES.NOT_PAIRED,
        'Aucun Panel appairé : aucun secret de vérification ne peut être demandé.',
      );
    }
    return this.client.fetchWebhookVerificationSecret(provider);
  }

  /* ------------------------------------------------- modèles d'e-mail --- */
  /*
   * LA PROJECTION AUTORITATIVE DU PANEL (1.11.0) — quatre lectures, un test.
   *
   * ══ POURQUOI LE PONT NE MET RIEN EN CACHE ICI ═════════════════════════════
   *
   * Parce qu'un cache de CONTENU recréerait exactement ce que ce lot supprime :
   * une seconde copie du modèle, vivant dans le projet, capable de diverger et
   * de mentir à un écran. La seule chose que le projet conserve est le CONTRAT
   * DE VARIABLES (clés, types, obligation), parce qu'il en a besoin hors
   * connexion pour valider ce qu'il produit — et il le range ailleurs, dans
   * `emailTemplateContract.service.js`, précisément pour que la distinction
   * reste lisible.
   */

  async listEmailTemplates() {
    this.#requirePairing('aucune projection de modèles ne peut être lue');
    return this.client.listEmailTemplates();
  }

  async getEmailTemplate(templateCode) {
    this.#requirePairing('aucun modèle ne peut être lu');
    return this.client.getEmailTemplate(templateCode);
  }

  async previewEmailTemplate(templateCode) {
    this.#requirePairing('aucun aperçu de modèle ne peut être demandé');
    return this.client.previewEmailTemplate(templateCode);
  }

  async emailTemplateReadiness(templateCode) {
    this.#requirePairing('aucun diagnostic de modèle ne peut être demandé');
    return this.client.emailTemplateReadiness(templateCode);
  }

  async sendEmailTemplateTest(templateCode, recipientEmail) {
    this.#requirePairing('aucun envoi de test ne peut être demandé');
    return this.client.sendEmailTemplateTest(templateCode, recipientEmail);
  }

  #requirePairing(what) {
    if (!isPaired()) {
      throw bridgeError(BRIDGE_ERROR_CODES.NOT_PAIRED, `Aucun Panel appairé : ${what}.`);
    }
  }

  /**
   * L'IDENTITÉ FÉDÉRÉE EST-ELLE ENCORE VALABLE ? (L12.B)
   *
   * Le pont ne décide rien : il transporte la question et rend la réponse du
   * Panel. Le projet n'apprend jamais POURQUOI un accès est refusé — sa
   * réaction est la même dans tous les cas : fermer la session.
   */
  async introspectFederatedPrincipal(input = {}) {
    if (!isPaired()) {
      throw bridgeError(
        BRIDGE_ERROR_CODES.NOT_PAIRED,
        'Aucun Panel appairé : aucune identité fédérée ne peut être vérifiée.',
      );
    }
    return this.client.introspectFederatedPrincipal(input);
  }

  /**
   * LE PANEL SAIT-IL LIRE UN CHAMP APPARU EN 1.<mineure> ?
   *
   * ══ POURQUOI CETTE QUESTION SE POSE, ALORS QUE TOUT EST « ADDITIF » ═══════
   *
   * Parce que les schémas d'entrée des deux côtés sont `.strict()` : un champ
   * inconnu fait refuser le message ENTIER, pas seulement le champ. Et la
   * garde de compatibilité ne vérifie que la MAJEURE — un projet en 1.10 passe
   * donc la garde d'un Panel en 1.9, puis se fait refuser son battement.
   * Résultat : un projet parfaitement sain rendu muet, et une fiche qui
   * bascule hors ligne alors que rien n'est tombé.
   *
   * On lit la version que le Panel a ANNONCÉE sur ses réponses, jamais celle
   * qu'on parle soi-même : la question n'est pas « suis-je à jour ? » mais
   * « mon interlocuteur acceptera-t-il ce champ ? ».
   *
   * Fail closed : tant qu'aucune réponse n'a été reçue, on ne déclare rien.
   * Un battement muet est sans conséquence — le suivant portera la donnée —
   * alors qu'un battement refusé fait basculer la fiche hors ligne.
   *
   * ── POURQUOI LE SEUIL EST UN PARAMÈTRE ──────────────────────────────────
   *
   * Deux champs sont désormais conditionnés à deux versions différentes : le
   * réseau (1.9.0) et la consommation (1.10.0). Recopier le prédicat aurait
   * produit deux fonctions jumelles dont l'une aurait fini par ne plus suivre.
   */
  /**
   * PUBLIC depuis 1.11.0 — et pour une raison qui a failli coûter cher.
   *
   * Ce prédicat était privé, donc réservé au battement. La déclaration d'usage
   * a ensuite gagné un champ (`contractFingerprints`), et rien ne l'empêchait
   * de partir vers un Panel qui ne sait pas le lire : les schémas d'entrée sont
   * `.strict()` des deux côtés, la garde de version ne vérifie que la MAJEURE,
   * et le message ENTIER aurait été refusé — pas seulement le champ.
   *
   * La conséquence n'aurait pas été visible tout de suite : la déclaration
   * cesse simplement d'être acceptée, les instances du projet cessent de
   * converger, et personne ne le remarque avant qu'un modèle manque à l'envoi.
   *
   * Une garde privée protège un appelant ; celle-ci doit en protéger plusieurs.
   */
  panelSpeaks(mineureMinimale) {
    return this.#panelSpeaks(mineureMinimale);
  }

  #panelSpeaks(mineureMinimale) {
    const annoncee = this.client?.panelContractVersion;
    if (typeof annoncee !== 'string') return false;
    const [majeure, mineure] = annoncee.trim().split('.').map(Number);
    if (!Number.isInteger(majeure) || !Number.isInteger(mineure)) return false;
    return majeure > 1 || (majeure === 1 && mineure >= mineureMinimale);
  }

  // -------------------------------------------------------------- heartbeat

  /**
   * Signal de vie. Ne LÈVE jamais (best-effort, jamais bloquant) : un échec
   * fait passer en DEGRADED, un succès ramène en CONNECTED.
   */
  async heartbeat({
    softwareVersion, environment, healthStatus = 'OK', details = null,
    // Contrat >= 1.2.0 : observabilité passive, entièrement optionnelle.
    // Injectables pour rester testables sans dépendre du process réel.
    runtime = defaultRuntimeSnapshot(),
    engines = defaultEngineVersions(),
  } = {}) {
    if (!isPaired()) return { delivered: false, reason: BRIDGE_ERROR_CODES.NOT_PAIRED };
    /**
     * L'ÉTAT DE LA FILE VOYAGE AVEC LE BATTEMENT — et c'est ce qui rend un
     * blocage VISIBLE de l'autre côté.
     *
     * « Connecté » et « à jour » sont deux faits distincts, et le premier
     * n'implique en rien le second : une instance dont toutes les écritures
     * sont refusées bat parfaitement. Sans ce bloc, le Panel n'avait aucun
     * moyen de le savoir — la fiche restait verte devant une donnée figée
     * depuis des semaines.
     *
     * Best-effort ASSUMÉ : un battement ne doit jamais échouer parce qu'une
     * lecture d'observabilité a échoué.
     */
    let outbox = null;
    try {
      outbox = (await this.durableOutbox?.health?.()) ?? null;
    } catch { outbox = null; }

    /**
     * ══ LE RÉSEAU COURANT, DÉCLARÉ AU BATTEMENT (contrat 1.9.0) ═════════════
     *
     * ── POURQUOI L'ÉMISSION EST CONDITIONNÉE ──────────────────────────────
     *
     * Les schémas des deux côtés du pont sont `.strict()`, et la compatibilité
     * n'est vérifiée que sur la MAJEURE. Un projet en 1.9 qui enverrait ce
     * champ à un Panel en 1.8 passerait donc la garde de version, puis verrait
     * son battement REFUSÉ EN BLOC pour un champ inconnu : un projet
     * parfaitement sain rendu muet par une extension censée être additive, et
     * une fiche qui bascule hors ligne alors que rien n'est tombé.
     *
     * On ne le publie donc qu'à un Panel qui a ANNONCÉ savoir le lire. Tant
     * qu'il ne l'a pas fait — première requête, Panel antérieur — le battement
     * part exactement comme en 1.8, et la fiche continue de converger par la
     * projection de présentation.
     *
     * ── ET SI LA LECTURE ÉCHOUE ───────────────────────────────────────────
     *
     * On ne déclare rien. Un battement ne doit jamais échouer parce qu'une
     * lecture d'observabilité a échoué — même règle que la file ci-dessus.
     */
    let reseau;
    try {
      if (this.#panelSpeaks(9) && typeof this.networkProvider === 'function') {
        reseau = await this.networkProvider();
      }
    } catch { reseau = undefined; }
    const runtimeDeclare = reseau ? { ...(runtime ?? {}), network: reseau } : runtime;

    const heartbeat = parseOrThrow(
      heartbeatSchema,
      {
        sentAt: nowIso(),
        softwareVersion,
        environment,
        health: { status: healthStatus, ...(details ? { details } : {}) },
        bridgeStats: {
          outboxSize: outbox?.pending ?? this.outbox.length,
          lastSyncAt: this.lastSyncAt,
          ...(outbox
            ? {
              rejectedCount: outbox.rejected,
              ...(outbox.oldestRejection ? { oldestRejection: outbox.oldestRejection } : {}),
            }
            : {}),
          /**
           * ══ CE QUE CE PROJET CONSOMME (contrat >= 1.10.0) ═════════════════
           *
           * ── LE DÉFAUT QUE CE BLOC FERME ─────────────────────────────────
           *
           * Tout ce qui précède décrit la file SORTANTE. Le tirage de ce projet
           * est resté mort 91 cycles — `applied: 0`, `lastError: null`, état
           * DEGRADED — avec une file sortante parfaitement vide et un battement
           * régulier. Le Panel voyait une fiche verte, et il avait raison de la
           * voir verte : aucun champ ne décrivait la descente.
           *
           * ── ÉMISSION CONDITIONNÉE, POUR LA MÊME RAISON QUE LE RÉSEAU ────
           *
           * Les schémas d'entrée du Panel sont `.strict()`, et la compatibilité
           * n'est vérifiée que sur la MAJEURE. Un projet en 1.10 qui enverrait
           * ce champ à un Panel en 1.9 passerait la garde de version, puis
           * verrait son battement REFUSÉ EN BLOC pour un champ inconnu : un
           * projet parfaitement sain rendu muet, et une fiche qui bascule hors
           * ligne alors que rien n'est tombé.
           *
           * On ne le publie donc qu'à un Panel qui a ANNONCÉ savoir le lire.
           *
           * ── ET SEULEMENT SI CE RUNTIME CONSOMME RÉELLEMENT ──────────────
           *
           * Un runtime qui a PERDU le bail de consommation porte un curseur
           * hydraté au démarrage puis figé : il n'a plus le droit de tirer, donc
           * plus rien ne le fait avancer. Le publier faisait décrire au Panel un
           * retard qui n'existe pas — et, en alternance avec les battements du
           * titulaire, une dégradation qui s'ouvrait et se refermait à chaque
           * minute. Mesuré : un courriel de rétablissement par minute pendant
           * une demi-heure.
           *
           * Son silence est lu `UNKNOWN` par le Panel : ni ouverture d'alerte,
           * ni fermeture. Voir `consumptionIsAuthoritative`.
           */
          ...(this.#panelSpeaks(10) && consumptionIsAuthoritative()
            ? { consumption: describeConsumption(this.state) }
            : {}),
        },
        ...(runtimeDeclare ? { runtime: runtimeDeclare } : {}),
        ...(engines ? { engines } : {}),
      },
      'Heartbeat'
    );
    try {
      await this.client.heartbeat(heartbeat);
      this.#recovered();
      this.lastHeartbeatAt = nowIso();
      return { delivered: true };
    } catch (err) {
      this.#degraded(err);
      return { delivered: false, reason: err.code || err.message };
    }
  }

  // ---------------------------------------------------------------- outbox

  /**
   * Enfile une écriture LOCALE à destination du Panel. Fonctionne dans TOUS
   * les états (Standalone : accumule ; la livraison viendra, ou pas — le
   * métier ne s'en préoccupe jamais).
   */
  queueLocalChange(input) {
    const change = parseOrThrow(syncChangeSchema, input, 'SyncChange');
    if (change.emitter !== EMITTERS.PROJECT) {
      throw bridgeError(
        BRIDGE_ERROR_CODES.INVALID_PAYLOAD,
        'queueLocalChange ne transporte que des écritures émises par le PROJET.'
      );
    }
    this.#rememberLocalWrite(change.writeId); // anti-écho au futur pull
    if (this.durableOutbox) {
      // Mise en file DURABLE : elle survit au redémarrage. Volontairement non
      // attendue ici — l'appelant vient de réussir une écriture métier et ne
      // doit pas dépendre de la disponibilité de la file.
      void this.durableOutbox.enqueue(change);
    } else {
      this.outbox.push(change);
    }
    return change;
  }

  /**
   * Vide l'outbox vers le Panel (reprise après erreur incluse) :
   *   - accusés APPLIED / DUPLICATE / IGNORED -> écriture sortie de la file ;
   *   - REJECTED -> sortie de la file + consignée dans `rejected` (une
   *     écriture invalide ne doit JAMAIS boucher la file) ;
   *   - panne de transport -> file INTACTE, état DEGRADED, on réessaiera.
   * Ne lève jamais.
   */
  async flushOutbox() {
    if (this.durableOutbox) return this.#flushDurable();
    if (!isPaired()) return { delivered: 0, pending: this.outbox.length, reason: BRIDGE_ERROR_CODES.NOT_PAIRED };
    let delivered = 0;
    while (this.outbox.length > 0) {
      const batch = this.outbox.slice(0, PUSH_BATCH_SIZE);
      let data;
      try {
        data = parseOrThrow(
          syncPushResponseDataSchema,
          await this.client.pushChanges({ changes: batch }),
          'SyncPushResponse'
        );
      } catch (err) {
        this.#degraded(err);
        return { delivered, pending: this.outbox.length, reason: err.code || err.message };
      }
      const ackByWriteId = new Map(data.results.map((r) => [r.writeId, r]));
      for (const change of batch) {
        const ack = ackByWriteId.get(change.writeId);
        if (!ack) continue; // pas d'accusé -> reste en file, sera relivré (idempotent)
        this.outbox = this.outbox.filter((c) => c.writeId !== change.writeId);
        if (ack.status === ACK_STATUS.REJECTED) {
          this.rejected.push({ change, ack });
          this.log.warn?.(
            `[panel-bridge] Écriture rejetée par le Panel (${change.entityType}/${change.writeId}) : ${ack.code || 'sans code'}.`
          );
        } else {
          delivered += 1;
        }
      }
      this.#recovered();
      this.lastSyncAt = nowIso();
    }
    return { delivered, pending: this.outbox.length };
  }

  /**
   * Vidange de la file DURABLE.
   *
   * Les écritures sont RÉCLAMÉES (marquées en vol) avant l'envoi : un second
   * processus ne peut pas livrer le même lot. Un accusé les acquitte ; un refus
   * les sort de la file avec son motif — une écriture invalide ne doit jamais
   * la boucher ; une panne de transport les rend à la file avec un délai
   * croissant, sans les perdre.
   */
  async #flushDurable() {
    if (!isPaired()) {
      return { delivered: 0, pending: await this.durableOutbox.pending(), reason: BRIDGE_ERROR_CODES.NOT_PAIRED };
    }
    await this.durableOutbox.releaseOrphans();
    /**
     * LA RÉPARATION PASSE PAR ICI, ET PAR AUCUN AUTRE CHEMIN.
     *
     * Une écriture refusée reste en file, reprogrammée selon la cadence de sa
     * classe. C'est en la réaffirmant qu'elle finit par passer le jour où le
     * destinataire sait l'accepter — sans qu'un utilisateur ait à réenregistrer
     * quoi que ce soit, et sans qu'aucun écran ne propose de « resynchroniser ».
     */
    await this.durableOutbox.reviveRejected?.();

    let delivered = 0;
    for (;;) {
      const entries = await this.durableOutbox.claim(PUSH_BATCH_SIZE);
      if (entries.length === 0) break;
      const changes = entries.map((e) => this.durableOutbox.toChange(e));
      for (const c of changes) this.#rememberLocalWrite(c.writeId);

      let data;
      try {
        data = parseOrThrow(
          syncPushResponseDataSchema,
          await this.client.pushChanges({ changes }),
          'SyncPushResponse'
        );
      } catch (err) {
        // Transport : la file est RENDUE intacte, avec backoff.
        await this.durableOutbox.defer(entries.map((e) => e.writeId), err.code || err.message);
        this.#degraded(err);
        return { delivered, pending: await this.durableOutbox.pending(), reason: err.code || err.message };
      }

      const ackByWriteId = new Map(data.results.map((r) => [r.writeId, r]));
      for (const entry of entries) {
        const ack = ackByWriteId.get(entry.writeId);
        if (!ack) continue; // sans accusé : reste en vol, libérée puis relivrée
        const issue = await this.durableOutbox.acknowledge(entry.writeId, ack.status, ack.code);
        if (ack.status === ACK_STATUS.REJECTED) {
          this.rejected.push({ change: this.durableOutbox.toChange(entry), ack });
          /**
           * UN REFUS EST GRAVE, ET IL EST DÉSORMAIS SUIVI.
           *
           * L'écriture ne sort plus de la file : elle y reste, classée et
           * datée, et sera réaffirmée à la cadence de sa classe. L'incident
           * dit maintenant CE QU'IL VA SE PASSER — sans quoi le lecteur du
           * journal ne pouvait pas distinguer « perdu » de « repris plus
           * tard ».
           */
          recordSyncIncident(SYNC_INCIDENT.OUTBOX_WRITE_REJECTED, {
            step: 'push',
            entityType: entry.entityType,
            entityId: entry.entityId,
            writeId: entry.writeId,
            // `entry.attempts` est lu AVANT l'incrément de la réclamation : il
            // rapportait donc toujours un coup de retard (« attempt=0 » sur une
            // première tentative). On publie le compte de REFUS, qui est ce
            // qu'on veut savoir, et il est juste.
            attempt: (entry.attempts ?? 0) + 1,
            failureClass: issue?.failureClass ?? null,
            retryInS: issue?.nextAttemptInSeconds ?? null,
            reason: ack.code || 'sans code',
          }, 'error');
        } else {
          delivered += 1;
        }
      }
      this.#recovered();
      this.lastSyncAt = nowIso();
    }
    return { delivered, pending: await this.durableOutbox.pending() };
  }

  // ------------------------------------------------------------------ pull

  /**
   * Enregistre le handler d'application d'un type d'entité (un par lot de
   * synchronisation, Phase 3+). Signature : async ({ change }) => void.
   */
  registerApplyHandler(entityType, handler) {
    if (!SYNC_ENTITY_TYPES.includes(entityType)) {
      throw bridgeError(
        BRIDGE_ERROR_CODES.ENTITY_TYPE_UNSUPPORTED,
        `Type d'entité inconnu du contrat : ${entityType}.`
      );
    }
    if (typeof handler !== 'function') {
      throw new Error('registerApplyHandler : handler doit être une fonction.');
    }
    this.applyHandlers.set(entityType, handler);
  }

  /**
   * Rattrapage : tire les écritures faites côté Panel et les applique
   * localement. Règles appliquées AVANT tout handler : anti-écho (jamais
   * ré-appliquer une écriture émise par CE projet), idempotence (writeId déjà
   * appliqué = non-événement), types sans handler = ignorés (comptés, jamais
   * une erreur — le lot correspondant n'est pas encore livré). Ne lève jamais.
   */
  async pullUpdates({ limit = 100 } = {}) {
    if (!isPaired()) return { applied: 0, skipped: 0, reason: BRIDGE_ERROR_CODES.NOT_PAIRED };

    /**
     * ══ ON NE CONSOMME QUE SI L'ON A LE DROIT ════════════════════════════════
     *
     * « Un projet est une instance » était vrai de la configuration, jamais du
     * code. Deux runtimes du même projet sur la même base tiraient la même
     * page, appliquaient tous les deux, et écrasaient mutuellement leur curseur.
     *
     * Le bail est réclamé au démarrage ; on le REPREND ici quand il a été perdu
     * — c'est le chemin normal après l'expiration du bail d'un runtime mort, et
     * c'est le seul endroit où la reprise peut se décider sans minuteur dédié.
     *
     * Un refus n'est pas une panne : c'est un autre runtime qui travaille.
     */
    if (!holdsConsumerLease()) {
      /**
       * AUCUN ARGUMENT : le magasin porte déjà le projet et la génération, posés
       * à l'hydratation. Les lui repasser depuis ici exigerait que le cœur du
       * pont connaisse `config` — ce que `bridge-conformity` interdit, à juste
       * titre : le pont ne doit rien savoir de la configuration du projet.
       */
      const bail = await claimConsumerLease()
        .catch(() => ({ granted: false, reason: 'CLAIM_FAILED' }));
      if (!bail.granted) {
        return { applied: 0, skipped: 0, reason: 'LEASE_HELD_ELSEWHERE', leaseOwner: bail.owner ?? null };
      }
      this.log?.info?.(`[panel-bridge] bail de consommation repris (${bail.reason ?? 'accordé'}).`);
    }
    let applied = 0;
    let skipped = 0;
    for (let page = 0; page < MAX_PULL_PAGES_PER_RUN; page += 1) {
      let data;
      /**
       * UNE ÉCRITURE PLUS RÉCENTE QUE CE CONTRAT A ÉTÉ RENCONTRÉE.
       *
       * Déclaré à la portée de la PAGE, et non du bloc de lecture : la
       * décision de retenir le curseur se prend plus bas, après application
       * des écritures qui PRÉCÈDENT celle-ci.
       */
      let bloquantIncompatible = false;
      try {
        /**
         * ── UNE ÉCRITURE ILLISIBLE NE DOIT PAS ARRÊTER LE RATTRAPAGE ────────
         *
         * ══ CE QUE LA VALIDATION EN BLOC A COÛTÉ ══════════════════════════
         *
         * La page entière passait par `parseOrThrow`. Une seule écriture non
         * conforme — trois `EMAIL_DELIVERY_EVENT` dont l'`entityId` portait un
         * préfixe au lieu d'être un UUID nu — faisait échouer la validation,
         * `pullUpdates` sortait AVANT d'avoir touché au curseur, et le cycle
         * suivant redemandait exactement la même page.
         *
         * Le tirage était donc mort depuis la deuxième écriture du journal :
         * 91 cycles consécutifs, `applied: 0`, `lastError: null`. Tout ce qui
         * arrivait encore du Panel passait par la livraison immédiate — un
         * accélérateur, pas une garantie. Le seul mécanisme DURABLE de
         * propagation Panel → projet était hors service, en silence.
         *
         * On valide donc l'ENVELOPPE en bloc (curseur, pagination : sans elle
         * on ne sait pas quoi faire), puis CHAQUE écriture séparément. Une
         * écriture illisible est écartée NOMMÉMENT, avec son incident, et le
         * curseur avance : la perte est bornée à elle seule, et elle se voit.
         *
         * Écarter en silence serait pire que le blocage. C'est pourquoi
         * `CHANGE_UNREADABLE` existe et porte le type, l'identifiant et le
         * motif.
         */
        const brut = await this.client.pullChanges({ cursor: currentCursor(), limit });
        const enveloppe = parseOrThrow(syncPullEnvelopeSchema, brut, 'SyncPullResponse');

        const lisibles = [];
        for (const candidat of enveloppe.changes) {
          const verdict = syncChangeSchema.safeParse(candidat);
          if (verdict.success) { lisibles.push(verdict.data); continue; }

          /**
           * ══ « ILLISIBLE » ET « PLUS RÉCENT QUE MOI » NE SONT PAS LA MÊME
           *    CHOSE ═══════════════════════════════════════════════════════
           *
           * ── LE PIÈGE, ET IL EST SUBTIL ────────────────────────────────────
           *
           * `syncChangeSchema` valide `entityType` contre une ÉNUMÉRATION —
           * celle du contrat LOCAL. Un type que le Panel vient d'inventer n'y
           * figure donc pas, et la validation échoue exactement comme pour une
           * charge utile corrompue.
           *
           * Les deux finissaient en lettre morte, curseur avancé. Pour une
           * charge corrompue c'est la bonne réponse : aucune version ne la
           * lira jamais. Pour un TYPE INCONNU c'est l'incident
           * `LEGAL_DOCUMENT` reproduit à l'identique — l'écriture est
           * parfaitement valide, simplement plus récente que ce binaire, et la
           * garer la perd définitivement.
           *
           * ── LE DISCRIMINANT ──────────────────────────────────────────────
           *
           * Si le SEUL grief porte sur `entityType`, l'écriture est LISIBLE :
           * c'est moi qui suis en retard. On retient alors le curseur, comme
           * pour un applicateur manquant, et la mise à niveau la rattrapera.
           *
           * Toute autre erreur — un `writeId` qui n'est pas un UUID, un
           * tombstone avec charge utile — reste une écriture illisible :
           * aucune version future ne la sauvera.
           */
          const griefs = verdict.error?.issues ?? [];
          const seulLeType = griefs.length > 0
            && griefs.every((i) => i.path?.[0] === 'entityType');

          if (seulLeType) {
            this.lastError = {
              at: nowIso(),
              code: 'INCOMPATIBLE',
              message: `${candidat?.entityType} inconnu du contrat ${CONTRACT_VERSION} — mise à niveau requise`,
            };
            recordSyncIncident(SYNC_INCIDENT.CHANGE_INCOMPATIBLE, {
              step: 'pull',
              entityType: candidat?.entityType ?? 'inconnu',
              entityId: candidat?.entityId ?? 'inconnu',
              writeId: candidat?.writeId ?? 'inconnu',
              reason: 'INCOMPATIBLE',
              contractVersion: CONTRACT_VERSION,
            }, 'error');
            await recordBlockingChange({
              entityType: candidat?.entityType,
              entityId: candidat?.entityId,
              writeId: candidat?.writeId,
              reason: 'INCOMPATIBLE',
              contractVersion: CONTRACT_VERSION,
            }).catch(() => null);
            skipped += 1;
            /**
             * ON ARRÊTE LA PAGE ICI, sans écrire le curseur.
             *
             * Les écritures déjà retenues dans `lisibles` seront appliquées —
             * elles PRÉCÈDENT celle-ci dans le journal, et l'ordre est
             * préservé —, mais le curseur ne les dépassera pas : la garde de
             * retenue plus bas s'en charge, et l'idempotence évite la double
             * application au cycle suivant.
             */
            bloquantIncompatible = true;
            break;
          }

          skipped += 1;
          /**
           * LE COMPTEUR MONTE AVEC L'INCIDENT — et il monte SÉPARÉMENT.
           *
           * Une écriture illisible ne deviendra jamais lisible : aucune
           * tentative ne changera son sort. La confondre avec un échec de
           * transport — qui, lui, se rattrape tout seul — ferait taire
           * exactement la plus grave des deux pannes.
           *
           * ── ELLE EST GARÉE, PLUS SEULEMENT COMPTÉE ────────────────────────
           *
           * Le compteur disait COMBIEN on en avait perdu, jamais LESQUELLES.
           * La lettre morte garde le type, l'identifiant et le motif : une
           * enquête peut alors commencer, au lieu de constater un nombre.
           */
          await recordUnreadableChange();
          await deadLetterChange({
            writeId: candidat?.writeId,
            entityType: candidat?.entityType,
            entityId: candidat?.entityId,
            reason: `illisible : ${verdict.error?.issues?.[0]?.message ?? 'non conforme au contrat'}`,
          });
          recordSyncIncident(SYNC_INCIDENT.CHANGE_UNREADABLE, {
            step: 'pull',
            entityType: candidat?.entityType ?? 'inconnu',
            entityId: candidat?.entityId ?? 'inconnu',
            writeId: candidat?.writeId ?? 'inconnu',
            reason: verdict.error?.issues?.[0]?.message ?? 'écriture non conforme au contrat',
          }, 'error');
        }
        data = { ...enveloppe, changes: lisibles };
      } catch (err) {
        /**
         * ── LE CURSEUR REFUSÉ PAR LE PANEL — le seul cas qui exige une remise
         *    à zéro ────────────────────────────────────────────────────────
         *
         * ══ CE QUE CE BLOC EMPÊCHE ═══════════════════════════════════════
         *
         * Le Panel refuse un curseur qu'il ne sait pas décoder
         * (`BRIDGE_INVALID_PAYLOAD`). Sans traitement, ce refus est DÉFINITIF :
         * le curseur invalide est persisté, chaque cycle le renvoie, chaque
         * cycle est refusé. Le tirage serait mort pour toujours — la panne
         * exacte que tout ce lot répare, aggravée par la persistance qui la
         * ferait survivre aux redémarrages.
         *
         * ══ POURQUOI REPARTIR DE ZÉRO EST SÛR ════════════════════════════
         *
         * Le rejeu du journal ne corrompt rien : les applicateurs sont
         * idempotents par construction (dernier-écrit-gagne sur la version,
         * écriture par identité). Il coûte. Face à un tirage mort, ce coût est
         * le bon prix — et il ne se paie qu'une fois.
         *
         * ══ ET IL SE DIT ═════════════════════════════════════════════════
         *
         * Une remise à zéro silencieuse ferait réapparaître des applications
         * anciennes sans que personne ne sache pourquoi. L'incident la nomme.
         */
        if (err?.code === BRIDGE_ERROR_CODES.INVALID_PAYLOAD) {
          await resetCursor('CURSOR_REFUSED_BY_PANEL');
          recordSyncIncident(SYNC_INCIDENT.PULL_FAILED, {
            step: 'pull',
            reason: 'curseur refusé par le Panel — remise à zéro du rattrapage',
          }, 'error');
        }
        await recordPullFailure();
        this.#degraded(err);
        return { applied, skipped, reason: err.code || err.message };
      }

      let bloquante = null;
      for (const change of data.changes) {
        if (this.localWriteIds.has(change.writeId)) {
          skipped += 1; // anti-écho : notre propre écriture nous revient
          continue;
        }
        /**
         * IDEMPOTENCE — sur une FENÊTRE, plus sur un ensemble sans fin.
         *
         * Le curseur DURABLE fait l’essentiel du travail : une écriture
         * au-delà de lui ne sera jamais reservie. Le seul rejeu possible
         * est intra-page — une écriture poussée en livraison immédiate qui
         * revient dans la page suivante avant que le curseur ne l’ait
         * dépassée. Une fenêtre bornée couvre exactement ce cas.
         */
        if (alreadyApplied(change.writeId)) {
          skipped += 1;
          continue;
        }
        /**
         * ══ « JE NE SAIS PAS APPLIQUER CECI » — TROIS RÉPONSES, PAS UNE ═════
         *
         * ── L'INCIDENT QUI A RENDU CETTE DISTINCTION NÉCESSAIRE ────────────
         *
         * Il n'y avait qu'une réponse : `skipped++ ; continue`, et le curseur
         * passait. Le Panel est monté en 1.14.0 et a publié `LEGAL_DOCUMENT`
         * vers des projets encore en 1.13.0. Ils ne connaissaient pas le type,
         * l'ont donc « sauté », et leur curseur a dépassé les écritures. Après
         * redéploiement, les documents étaient réputés CONSOMMÉS : ils
         * n'existaient nulle part, et il a fallu un `/resync` manuel pour les
         * republier.
         *
         * Le curseur avait menti. C'est le seul mensonge que ce pont ne peut
         * pas se permettre : le Panel le LIT pour savoir ce que le projet a
         * consommé.
         *
         * ── LA RÈGLE, EN UNE PHRASE ───────────────────────────────────────
         *
         *   Un curseur ne dit pas « j'ai vu ». Il dit « ceci est traité selon
         *   le contrat ».
         *
         * ── LES TROIS CAS, ET CE QUI LES SÉPARE ───────────────────────────
         *
         *   IGNORED_BY_CONTRACT   le type est DÉCLARÉ à mon contrat, et mon
         *                         contrat dit que je ne l'applique pas
         *                         (`SYNC_ENTITY_TYPES` sans
         *                         `APPLIED_ENTITY_TYPES`). Mon ignorance est
         *                         donc EXPLICITEMENT autorisée : le curseur
         *                         avance, et c'est légitime. C'est le cas de
         *                         `INVOICE`, `PAYMENT`, `MEETING`…
         *
         *   INCOMPATIBLE          le type est INCONNU de mon contrat — le
         *                         Panel est plus récent que moi. Rien ne
         *                         m'autorise à l'ignorer, et une version
         *                         future de moi saura le traiter. Le curseur
         *                         est RETENU : l'écriture reste dans le
         *                         journal, et la mise à niveau la rattrapera
         *                         d'elle-même, sans republication manuelle.
         *
         *   WIRING_MISSING        le type est déclaré APPLIQUÉ par mon
         *                         contrat, mais aucun applicateur n'est
         *                         branché. C'est un défaut de câblage de CE
         *                         binaire, pas une incompatibilité. Même
         *                         traitement : on retient, parce qu'un
         *                         correctif le rendra applicable.
         *
         * ── ET LE BLOCAGE DE TÊTE DE FILE ? ───────────────────────────────
         *
         * Retenir bloque ce qui suit. C'est assumé, et c'est BORNÉ : la seule
         * cause est « ce runtime est en retard sur le Panel », et la seule
         * issue est de le mettre à niveau — ce que le diagnostic dit
         * explicitement, et que le Panel voit (`consumption.blocked`) au lieu
         * d'afficher « synchronisé ». Un blocage visible et réparable vaut
         * mieux qu'une perte invisible et définitive.
         *
         * Le cas VRAIMENT sans issue — une charge utile corrompue qu'aucune
         * version ne lira — est traité ailleurs et ne bloque pas : il est garé
         * en lettre morte après `MAX_APPLY_ATTEMPTS`.
         */
        const handler = this.applyHandlers.get(change.entityType);
        if (!handler) {
          const declare = SYNC_ENTITY_TYPES.includes(change.entityType);
          const devraitAppliquer = APPLIED_ENTITY_TYPES.includes(change.entityType);

          if (declare && !devraitAppliquer) {
            // IGNORED_BY_CONTRACT — ignorance autorisée : le curseur avance.
            skipped += 1;
            continue;
          }

          const motif = declare ? 'WIRING_MISSING' : 'INCOMPATIBLE';
          this.lastError = {
            at: nowIso(),
            code: motif,
            message: declare
              ? `aucun applicateur branché pour ${change.entityType} (défaut de câblage)`
              : `${change.entityType} inconnu du contrat ${CONTRACT_VERSION} — mise à niveau requise`,
          };
          recordSyncIncident(SYNC_INCIDENT.CHANGE_INCOMPATIBLE, {
            step: 'apply',
            entityType: change.entityType,
            entityId: change.entityId,
            writeId: change.writeId,
            reason: motif,
            contractVersion: CONTRACT_VERSION,
          }, 'error');
          skipped += 1;
          bloquante = { change, attempts: 0, incompatible: motif };
          break; // le curseur reste où il est : rien n'est perdu
        }
        try {
          await handler({ change });
          await recordApplied(change.writeId);
          await clearApplyFailure(change.writeId);
          /**
           * CE QUI ÉTAIT GARÉ SUR CETTE ENTITÉ EST DÉBLOQUÉ.
           *
           * Le rejeu republie le même fait sous un NOUVEAU `writeId` : la lettre
           * morte ne peut donc se reconnaître qu'à l'identité MÉTIER. Peu
           * importe le chemin — rejeu délibéré ou publication ordinaire — le
           * blocage n'existe plus, et le dire est le rôle de cette ligne.
           */
          await resolveDeadLettersFor({
            entityType: change.entityType,
            entityId: change.entityId,
            byWriteId: change.writeId,
          }).catch(() => null);
          applied += 1;
        } catch (err) {
          /**
           * ══ LE CURSEUR NE DÉPASSE PLUS UNE ÉCRITURE NON APPLIQUÉE ═════════
           *
           * ── CE QUI ÉTAIT ÉCRIT ICI, ET POURQUOI C'ÉTAIT LE DERNIER TROU ──
           *
           * L'échec était consigné, puis la boucle continuait et le curseur
           * avançait quand même. Le commentaire d'origine le disait sans
           * détour : « cette écriture ne sera PAS relivrée par le Panel ».
           *
           * Le Panel, lui, LIT ce curseur au battement et en déduit ce que le
           * projet a consommé. Un curseur qui saute une écriture non appliquée
           * n'est donc pas seulement une perte : c'est un ACCUSÉ MENSONGER.
           * Le Panel voyait un retard nul, sa fiche restait verte, et le fait
           * n'existait nulle part.
           *
           * On ARRÊTE la page. Le curseur reste où il est, la page entière
           * sera retirée au cycle suivant, et les écritures déjà appliquées
           * de cette page sont écartées par `alreadyApplied` — la fenêtre
           * d'idempotence existe précisément pour ce cas.
           *
           * ── ET L'ÉCRITURE QU'AUCUNE TENTATIVE NE PASSERA ? ───────────────
           *
           * Elle bloquerait le flux à vie, et tout ce qui la suit avec elle.
           * Après `MAX_APPLY_ATTEMPTS`, elle est GARÉE en lettre morte et le
           * curseur passe. Renoncer en le disant n'est pas perdre en silence.
           */
          this.lastError = { at: nowIso(), code: err.code || 'APPLY_FAILED', message: err.message };
          const echec = await recordApplyFailure(change.writeId);
          recordSyncIncident(SYNC_INCIDENT.APPLY_FAILED, {
            step: 'apply',
            entityType: change.entityType,
            entityId: change.entityId,
            writeId: change.writeId,
            reason: err.code || err.message,
            attempts: echec.attempts,
          }, 'error');
          skipped += 1;

          if (echec.exhausted) {
            await deadLetterChange({
              writeId: change.writeId,
              entityType: change.entityType,
              entityId: change.entityId,
              reason: err.code || err.message,
              attempts: echec.attempts,
            });
            logger.error(
              `[bridge] écriture ${change.entityType}/${change.entityId} GARÉE après `
              + `${echec.attempts} tentatives : ${err.code || err.message}. Le curseur reprend sa course.`,
            );
            continue; // garée : elle ne bloque plus la file
          }

          bloquante = { change, attempts: echec.attempts };
          break; // le curseur reste où il est : la page sera retirée
        }
      }

      /**
       * LE CURSEUR EST ÉCRIT AVANT D’ÊTRE OUBLIÉ — MAIS SEULEMENT S'IL EST VRAI.
       *
       * Il l’était en mémoire, et le prochain redémarrage le perdait. Il est
       * persisté à chaque page ; il ne l'est PAS quand une écriture de cette
       * page n'a pas pu être appliquée. Un curseur avancé est un accusé, et un
       * accusé faux est pire qu'un retard.
       */
      /**
       * LE BLOCAGE EST DÉCLARÉ, PUIS LEVÉ — dans cet ordre, à chaque page.
       *
       * Il n'est pas seulement journalisé : il est PERSISTÉ et REMONTÉ au
       * battement. C'est ce qui permet au Panel de dire « mise à niveau
       * requise » au lieu d'afficher un projet vert dont le curseur ne bouge
       * plus depuis trois jours.
       */
      if (bloquante) {
        await recordBlockingChange({
          entityType: bloquante.change.entityType,
          entityId: bloquante.change.entityId,
          writeId: bloquante.change.writeId,
          reason: bloquante.incompatible ?? 'APPLY_FAILED',
          contractVersion: CONTRACT_VERSION,
        }).catch(() => null);
      } else if (!bloquantIncompatible && blockingChange()) {
        // La page est passée EN ENTIER : ce qui bloquait ne bloque plus.
        await clearBlockingChange().catch(() => null);
      }

      /**
       * LE CURSEUR NE PASSE PAS UNE ÉCRITURE PLUS RÉCENTE QUE CE CONTRAT.
       *
       * Les écritures qui la PRÉCÈDENT dans la page ont été appliquées — leur
       * ordre est respecté — mais le curseur reste en deçà. Au cycle suivant,
       * elles reviendront et seront écartées par l'idempotence, puis on
       * butera de nouveau ici. Jusqu'à la mise à niveau, qui débloque tout.
       */
      if (bloquantIncompatible) {
        const b = blockingChange();
        logger.warn(
          `[bridge] curseur RETENU : ${b?.entityType} est inconnu du contrat `
          + `${CONTRACT_VERSION} — mise à niveau de ce projet requise. `
          + 'Aucune écriture n’est perdue.',
        );
        return { applied, skipped, cursor: currentCursor(), held: true, incompatible: true };
      }

      if (bloquante) {
        logger.warn(
          `[bridge] curseur RETENU sur ${bloquante.change.entityType}/${bloquante.change.entityId} `
          + `(tentative ${bloquante.attempts}/${MAX_APPLY_ATTEMPTS}) — la page sera retirée au prochain cycle.`,
        );
        return { applied, skipped, cursor: currentCursor(), held: true };
      }

      const ecrit = await recordCursor(data.cursor);
      if (ecrit.written === false) {
        /**
         * LE BAIL A ÉTÉ PERDU PENDANT LA PAGE — on s'arrête NET.
         *
         * C'est le cas où ce runtime a ralenti, son bail a expiré, et un autre
         * a repris. Continuer écraserait le travail du successeur et
         * acquitterait des écritures que personne n'a appliquées. Le refus
         * vient de la base, au bon instant — pas d'une vérification locale que
         * le temps aurait périmée.
         */
        this.log?.warn?.(
          '[panel-bridge] bail de consommation perdu pendant le tirage — arrêt immédiat, '
          + 'le curseur reste celui du titulaire courant.',
        );
        return { applied, skipped, cursor: currentCursor(), leaseLost: true };
      }
      this.#recovered();
      this.lastSyncAt = nowIso();
      if (!data.hasMore) break;

      /**
       * ON RENOUVELLE ENTRE LES PAGES, PAS À CHAQUE ÉCRITURE.
       *
       * Une page est l'unité de travail : c'est là que le temps passe, et c'est
       * là qu'un bail court risque d'expirer. Renouveler par écriture
       * multiplierait les allers-retours pour la même garantie.
       */
      const renouvele = await renewConsumerLease().catch(() => ({ renewed: false }));
      if (renouvele.renewed === false) {
        this.log?.warn?.('[panel-bridge] bail non renouvelé — arrêt du tirage.');
        return { applied, skipped, cursor: currentCursor(), leaseLost: true };
      }
    }
    return { applied, skipped, cursor: currentCursor() };
  }

  // ------------------------------------------------------------------ état

  /** Instantané NON sensible (page « Connexion Panel », supervision, tests). */
  getStatus() {
    return {
      state: this.state,
      contractVersion: CONTRACT_VERSION,
      pairing: describePairing(),
      outboxSize: this.outbox.length,
      rejectedCount: this.rejected.length,
      pullCursor: currentCursor(),
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
    };
  }

  /**
   * Retient une écriture ÉMISE, sans laisser l'ensemble croître sans fin.
   *
   * `Set` conserve l'ordre d'insertion : la plus ancienne clé est donc la
   * première rendue par l'itérateur, et c'est elle qu'on retire. Aucune
   * structure de plus n'est nécessaire.
   */
  #rememberLocalWrite(writeId) {
    if (!writeId) return;
    this.localWriteIds.add(writeId);
    while (this.localWriteIds.size > LOCAL_WRITE_IDS_MAX) {
      const plusAncienne = this.localWriteIds.values().next().value;
      this.localWriteIds.delete(plusAncienne);
    }
  }

  #degraded(err) {
    if (isPaired()) this.state = BRIDGE_STATES.DEGRADED;
    this.lastError = { at: nowIso(), code: err.code || 'UNKNOWN', message: err.message };
  }

  /**
   * Le lien revient.
   *
   * On en profite pour REDEMANDER une photographie complète : pendant la
   * coupure, le Panel a pu manquer des changements que rien ne rejouera
   * autrement — un document déposé, une signature reçue. Le rappel est
   * injecté, jamais importé : le cœur du pont ne connaît aucun métier.
   */
  #recovered() {
    const etaitCoupe = this.state !== BRIDGE_STATES.CONNECTED;
    if (isPaired()) this.state = BRIDGE_STATES.CONNECTED;
    if (etaitCoupe && typeof this.onReconnected === 'function') {
      // Une réconciliation ratée ne casse pas un cycle — mais elle se voit :
      // c'est elle qui rejoue ce que le Panel a manqué pendant la coupure.
      const signaler = (err) => recordSyncIncident(SYNC_INCIDENT.PROJECTION_BUILD_FAILED, {
        step: 'reconnect', reason: err?.code || err?.message,
      }, 'error');
      try {
        void Promise.resolve(this.onReconnected()).catch(signaler);
      } catch (err) { signaler(err); }
    }
  }
}

export default PanelBridge;

/**
 * Instantané d'exécution publié avec le heartbeat (contrat >= 1.2.0).
 * Lecture SEULE, sans dépendance : uniquement ce que le process sait de
 * lui-même. Aucune de ces valeurs n'est requise par le contrat.
 */
export function defaultRuntimeSnapshot() {
  try {
    const memory = process.memoryUsage();
    return {
      uptimeSeconds: Math.floor(process.uptime()),
      load: {
        memoryUsedMb: Math.round((memory.rss / 1024 / 1024) * 10) / 10,
      },
    };
  } catch {
    return undefined;
  }
}

/**
 * Versions des moteurs standards embarqués, lues dans leurs manifestes.
 * Un projet sans moteur (ou dont le manifeste est illisible) ne publie rien :
 * le champ reste absent, ce qui est conforme.
 */
export function defaultEngineVersions() {
  const engines = {};
  for (const [key, dir] of [['deployment', 'deployment-engine'], ['duplication', 'duplication-engine']]) {
    try {
      const url = new URL(`../../${dir}/engine.manifest.json`, import.meta.url);
      const manifest = JSON.parse(readFileSync(url, 'utf8'));
      if (/^\d+\.\d+\.\d+$/.test(manifest.version)) engines[key] = manifest.version;
    } catch {
      // Moteur absent ou manifeste illisible : rien à publier.
    }
  }
  return Object.keys(engines).length > 0 ? engines : undefined;
}
