/**
 * ProjectBridge — logique de la surface exposée AU Panel (LOT 3/4).
 *
 * Philosophie : docs/panelXvitrine/02_PROJECT_CONNECTOR.md.
 * Contrat     : docs/panelXvitrine/spec/ProjectBridge.openapi.yaml.
 *
 * Le Panel ne connaît JAMAIS Mongo, les modèles ni les routes internes : il ne
 * voit que ce module (via routes/projectBridge.routes.js). Catalogue FERMÉ —
 * pas de requête libre, pas d'écriture sur les données locales (catégorie 1).
 *
 * ÉTAT D'AVANCEMENT (Phase 2A — prêt pour un Panel réel) :
 *   - identité/santé : réelles (config + manifeste de build) ;
 *   - manifeste (contrat ≥ 1.1.0) : servi par GET /manifest, assemblé depuis
 *     le registre DÉCLARATIF ./projectManifest.js + l'identité réelle +
 *     les capacités de sync dérivées du code, validé avant d'être servi ;
 *   - sync push : accusés conformes (idempotence par writeId) ; seul le type
 *     DIAGNOSTIC est appliqué (enregistré en mémoire, aucun effet métier) ;
 *     tout autre type répond REJECTED / BRIDGE_ENTITY_TYPE_UNSUPPORTED —
 *     les lots métier arrivent en Phase 3+ ;
 *   - sync pull : journal local VIDE (le journal persistant des écritures
 *     locales est un livrable ultérieur — voir PHASE_2_PREPARATION.md) ;
 *   - catalogue d'opérations : VIDE (les opérations arrivent lot par lot en
 *     Phase 3+) ; toute invocation répond BRIDGE_OPERATION_UNKNOWN.
 * Les SIGNATURES et les DTO, eux, sont figés.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from '../../config/env.js';
import {
  CONTRACT_VERSION,
  MANIFEST_FORMAT_VERSION,
  EMITTERS,
  ACK_STATUS,
  APPLIED_ENTITY_TYPES,
  identitySchema,
  projectManifestSchema,
  parseOrThrow,
  nowIso,
} from '../panelBridge/bridgeContract.js';
import { bridgeError, BRIDGE_ERROR_CODES } from '../panelBridge/bridgeErrors.js';
import { clearPairing } from '../panelBridge/pairingStore.js';
import { alreadyApplied, recordApplied, resolveDeadLettersFor } from '../panelBridge/consumptionStore.js';
import {
  describeContractOperations,
  invokeContractOperation,
  listOperationIds,
} from './contractOperations.js';
import { INSTALLED_MODULES,
  PROJECT_DESCRIPTOR, PROJECT_FEATURES } from './projectManifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(__dirname, '../../../build-manifest.json');

/** Idempotence des livraisons entrantes (writeId -> accusé rendu). RAM Phase 1. */
const deliveredAcks = new Map();
/** Écritures DIAGNOSTIC appliquées (observabilité des tests de canal). */
const appliedDiagnostics = [];

let cachedSoftwareVersion = null;

/**
 * PROVIDERS INJECTÉS au bootstrap (même patron que le runtime du pont).
 *
 * Ce module expose une surface au Panel ; il ne doit pas savoir ce qu'est une
 * « entreprise » ni comment on la range en base. Ce qui relève du métier lui
 * est confié de l'extérieur.
 */
let changeAppliers = {};
let appliedConfigurationProvider = null;
/**
 * PRÉSENTATION du projet (nom commercial, slogan, logo, contacts, URLs) —
 * fournie par INJECTION comme la convergence : ce module ne lit ni Company ni
 * SystemConfiguration, il les reçoit déjà résolus.
 */
let presentationProvider = null;

export function configureProjectBridge(opts = {}) {
  if (opts.changeAppliers) changeAppliers = opts.changeAppliers;
  if (opts.appliedConfigurationProvider) {
    appliedConfigurationProvider = opts.appliedConfigurationProvider;
  }
  if (opts.presentationProvider) presentationProvider = opts.presentationProvider;
}

/**
 * Version logicielle courte : manifeste embarqué au build (déployé), sinon
 * « dev » (lancé depuis la source). Jamais d'exécution de commande ici.
 */
async function readSoftwareVersion() {
  if (cachedSoftwareVersion) return cachedSoftwareVersion;
  try {
    const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
    cachedSoftwareVersion = manifest.shortCommit || manifest.commitHash || 'dev';
  } catch {
    cachedSoftwareVersion = 'dev';
  }
  return cachedSoftwareVersion;
}

/** Clé stable et lisible dérivée du nom du projet (« SB Auto 06 » -> « sb-auto-06 »). */
function deriveProjectKey(projectName) {
  const slug = String(projectName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length >= 3 ? slug : `projet-${slug || 'sans-nom'}`;
}

/** Identité du projet — DTO `Identity` du contrat, validée avant d'être servie. */
export async function getBridgeIdentity({ withAppliedConfiguration = true } = {}) {
  const projectName = config.projectName || 'Projet sans nom';

  // CONVERGENCE (contrat >= 1.3.0) : ce que le projet a réellement appliqué.
  // Fourni par INJECTION — ce module ne connaît ni modèle ni base, et ne doit
  // pas commencer à en connaître pour publier un numéro de version.
  // Best-effort : une identité sans convergence vaut mieux qu'une identité
  // indisponible.
  let appliedConfiguration;
  if (withAppliedConfiguration && typeof appliedConfigurationProvider === 'function') {
    try {
      appliedConfiguration = await appliedConfigurationProvider();
    } catch {
      appliedConfiguration = undefined;
    }
  }

  return parseOrThrow(
    identitySchema,
    {
      projectKey: deriveProjectKey(projectName),
      projectName,
      environment: config.env,
      softwareVersion: await readSoftwareVersion(),
      contractVersion: CONTRACT_VERSION,
      ...(appliedConfiguration ? { appliedConfiguration } : {}),
    },
    'Identity'
  );
}

/** Santé résumée NON sensible (le détail vit dans le Manager). */
export function getBridgeHealth() {
  return { status: 'OK', details: null, time: nowIso() };
}

/**
 * MANIFESTE OFFICIEL du projet (objectif 4 de la Phase 2A) : identité réelle
 * + registre déclaratif (projectManifest.js) + capacités de synchronisation
 * dérivées du contrat. Validé contre le schéma AVANT d'être servi — un
 * manifeste non conforme est un bug, jamais une réponse.
 * Le Panel le lit via GET /manifest et le reçoit au bootstrap : il ne déduit
 * JAMAIS ces informations.
 */
export async function buildProjectManifest() {
  const identity = await getBridgeIdentity();
  // PRÉSENTATION (contrat >= 1.4.x, additif) — le Panel affichait le nom
  // TECHNIQUE du projet et l'URL de l'API comme s'il s'agissait du site du
  // client. Le projet publie donc ce qui le désigne réellement : nom
  // commercial, slogan, logo, contacts, adresses du site et du Manager.
  // Best-effort : une identité sans présentation vaut mieux qu'un manifeste
  // indisponible.
  let presentation;
  let publicUrls;
  if (typeof presentationProvider === 'function') {
    try {
      const p = await presentationProvider();
      presentation = p?.presentation;
      publicUrls = p?.urls;
    } catch {
      presentation = undefined;
      publicUrls = undefined;
    }
  }
  return parseOrThrow(
    projectManifestSchema,
    {
      manifestVersion: MANIFEST_FORMAT_VERSION,
      project: {
        key: identity.projectKey,
        name: identity.projectName,
        environment: identity.environment,
        softwareVersion: identity.softwareVersion,
      },
      bridge: {
        contractVersion: CONTRACT_VERSION,
        projectBridgeBasePath: '/api/project-bridge/v1',
      },
      contracts: { panelBridge: CONTRACT_VERSION, projectBridge: CONTRACT_VERSION },
      // Contrat >= 1.2.0 — supervision en lecture seule. Optionnels : ils
      // décrivent le projet, ils n'engagent aucun comportement.
      ...(engineVersions() ? { engines: engineVersions() } : {}),
      // RÉSEAU (Phase 4) — déclaré parce que le Panel en a besoin pour
      // rappeler le projet. Le champ existait au schéma depuis la 1.2.0 mais
      // n'était jamais rempli : le Panel voyait donc un projet sans adresse,
      // et son moteur d'exécution le jugeait injoignable.
      ...(networkDescriptor(publicUrls) ? { network: networkDescriptor(publicUrls) } : {}),
      ...(presentation ? { presentation } : {}),
      // La DESCRIPTION du descripteur décrit le PROJET MODÈLE, pas le client :
      // tout duplicata en héritait mot pour mot, et le Panel l'affichait comme
      // si elle présentait le garage. Le slogan de l'entreprise, quand il
      // existe, la remplace ; la phrase technique ne subsiste qu'à défaut.
      descriptor: {
        ...PROJECT_DESCRIPTOR,
        name: identity.projectName,
        ...(presentation?.tagline ? { description: presentation.tagline } : {}),
      },
      sync: {
        // Dérivé du CODE (jamais du registre) : ce que le projet applique
        // réellement aujourd'hui, et les opérations réellement invocables.
        supportedEntityTypes: [...APPLIED_ENTITY_TYPES],
        operations: listOperationIds(),
      },
      modules: [...INSTALLED_MODULES],
      features: [...PROJECT_FEATURES],
    },
    'ProjectManifest'
  );
}

/**
 * Livraison entrante (Panel -> projet) : accusé PAR écriture, jamais un échec
 * global. Règles appliquées dans l'ordre : sens (emitter=PANEL), idempotence
 * (writeId déjà accusé -> même accusé, DUPLICATE), type supporté en Phase 1.
 */
export async function acknowledgePanelChanges(changes) {
  const results = [];
  for (const change of changes) {
    if (change.emitter !== EMITTERS.PANEL) {
      results.push({
        writeId: change.writeId,
        status: ACK_STATUS.REJECTED,
        code: BRIDGE_ERROR_CODES.INVALID_PAYLOAD,
        message: 'emitter doit être PANEL sur ce sens.',
      });
      continue;
    }
    /**
     * ══ L'IDEMPOTENCE D'UNE LIVRAISON POUSSÉE EST DURABLE ═══════════════════
     *
     * `deliveredAcks` était une `Map` mémoire — « RAM Phase 1 ». Un
     * redémarrage l'effaçait, et la relivraison suivante RÉAPPLIQUAIT. Les
     * applicateurs étant idempotents, rien ne se corrompait ; mais l'accusé
     * rendu changeait — `APPLIED` au lieu de `DUPLICATE` —, et c'est cet
     * accusé que le Panel lit pour savoir ce qu'il en est.
     *
     * La fenêtre récente du magasin de consommation, elle, SURVIT au
     * redémarrage. On la consulte donc en second : la mémoire répond vite sur
     * le chemin chaud, le durable rattrape après un arrêt.
     */
    if (deliveredAcks.has(change.writeId)) {
      results.push({ ...deliveredAcks.get(change.writeId), status: ACK_STATUS.DUPLICATE });
      continue;
    }
    if (alreadyApplied(change.writeId)) {
      const ack = { writeId: change.writeId, status: ACK_STATUS.DUPLICATE };
      deliveredAcks.set(change.writeId, { writeId: change.writeId, status: ACK_STATUS.APPLIED });
      results.push(ack);
      continue;
    }
    if (!APPLIED_ENTITY_TYPES.includes(change.entityType)) {
      // Type déclaré au contrat mais dont le lot n'est pas livré : refus
      // PROPRE et explicite — jamais un 500, jamais une application partielle.
      const ack = {
        writeId: change.writeId,
        status: ACK_STATUS.REJECTED,
        code: BRIDGE_ERROR_CODES.ENTITY_TYPE_UNSUPPORTED,
        message: `Type ${change.entityType} non synchronisé par cette version du projet.`,
      };
      deliveredAcks.set(change.writeId, ack);
      results.push(ack);
      continue;
    }

    // Le Panel peut LIVRER (push) au lieu d'attendre que le projet TIRE.
    // Les deux chemins doivent produire le même effet — sinon la
    // configuration dépendrait de la façon dont elle est arrivée.
    let ack;
    try {
      await applyPanelChange(change);
      ack = { writeId: change.writeId, status: ACK_STATUS.APPLIED };
    } catch (err) {
      // Un échec d'application n'est PAS consigné : la relivraison, elle,
      // pourra réussir. Consigner l'accusé condamnerait l'écriture.
      results.push({
        writeId: change.writeId,
        status: ACK_STATUS.REJECTED,
        code: BRIDGE_ERROR_CODES.INTERNAL,
        message: `Application impossible : ${err.message}`,
      });
      continue;
    }
    deliveredAcks.set(change.writeId, ack);
    /**
     * LA MÊME FENÊTRE QUE LE TIRAGE, ET C'EST VOULU.
     *
     * Une écriture peut arriver par les DEUX chemins — poussée par le Panel,
     * puis retirée dans la page suivante avant que le curseur ne l'ait
     * dépassée. Les inscrire dans la même fenêtre est ce qui empêche la
     * seconde arrivée de refaire le travail de la première.
     */
    await recordApplied(change.writeId);
    /**
     * ══ CE QUI ÉTAIT GARÉ SUR CETTE ENTITÉ EST DÉBLOQUÉ — ICI AUSSI ═══════
     *
     * ── LE DÉFAUT QUE CETTE LIGNE FERME ─────────────────────────────────
     *
     * Le TIRAGE levait déjà la lettre morte après une application réussie.
     * La livraison IMMÉDIATE ne le faisait pas — et c'est par elle que
     * passent la plupart des republications, puisque le Panel pousse avant
     * que le projet ne tire.
     *
     * Conséquence observée : après la mise à niveau qui a réparé un type
     * inconnu, les documents étaient bel et bien appliqués, mais les
     * écritures garées pendant l'incident restaient `PARKED` POUR TOUJOURS.
     * Le Panel lisait `parkedChanges > 0` à chaque battement et affichait un
     * projet dégradé qui ne le sera plus jamais — une alerte permanente,
     * c'est-à-dire une alerte que tout le monde apprend à ignorer.
     *
     * ── LE RAPPROCHEMENT SE FAIT SUR L'IDENTITÉ MÉTIER ──────────────────
     *
     * Une republication porte un NOUVEAU `writeId` : seul le couple
     * `(entityType, entityId)` relie le fait garé au fait enfin passé. Peu
     * importe le chemin — poussée ou tirage — le blocage n'existe plus, et
     * le dire est le rôle de cet appel.
     */
    await resolveDeadLettersFor({
      entityType: change.entityType,
      entityId: change.entityId,
      byWriteId: change.writeId,
    }).catch(() => null);
    results.push(ack);
  }
  return { results };
}

/**
 * Applique UNE écriture du Panel. Table de dispatch, jamais de cascade de
 * `if` : ajouter un type synchronisé consiste à l'inscrire au contrat et à
 * poser son applicateur ici.
 */
async function applyPanelChange(change) {
  if (change.entityType === 'DIAGNOSTIC') {
    // DIAGNOSTIC reste un échange de test, sans effet métier.
    appliedDiagnostics.push({ change, appliedAt: nowIso() });
    return;
  }
  // Les applicateurs métier sont INJECTÉS au bootstrap. Ce module reste
  // ignorant de ce qu'est une entreprise ou une API intégrée — il sait
  // seulement qu'un type déclaré applicable doit trouver son applicateur.
  const applier = changeAppliers[change.entityType];
  if (!applier) {
    throw new Error(
      `Aucun applicateur branché pour ${change.entityType} : le type est déclaré applicable mais rien ne sait le traiter.`,
    );
  }
  await applier({ change });
}

/**
 * Lecture des écritures locales (rattrapage côté Panel). Phase 1 : le projet
 * ne journalise pas encore ses écritures locales -> page vide, curseur stable.
 */
export function readLocalChanges({ cursor } = {}) {
  return { changes: [], cursor: cursor || '0', hasMore: false };
}

/**
 * Catalogue FERMÉ des opérations invocables.
 *
 * Il n'est plus vide : les opérations contractuelles y entrent. Ce que le
 * Panel n'y lit pas n'existe pas pour lui — et la garde correspondante vit
 * dans l'opération elle-même, jamais seulement dans le catalogue.
 */
export async function getOperationCatalog() {
  const { operations, contractProtection } = await describeContractOperations();
  /**
   * `contractProtection` voyage AVEC le catalogue, et pour une raison précise :
   * la projection CONTRACT s'efface (tombstone) quand le projet n'a aucun
   * contrat, c'est-à-dire exactement quand ce réglage décide de l'accès. Le
   * catalogue, relu en direct à chaque affichage, est le seul canal qui rende
   * l'état réel dans ce cas-là. Le Panel le LIT, il n'en garde pas de copie.
   */
  return { contractVersion: CONTRACT_VERSION, operations, contractProtection };
}

/**
 * Invocation d'une opération du catalogue.
 *
 * Idempotente par `invocationId` : une relivraison ne résilie pas deux fois.
 * L'exécution appartient au moteur local, avec SES gardes — le pont ne fait
 * que transporter la demande.
 */
export async function invokeOperation(operationId, invocation) {
  return invokeContractOperation(operationId, invocation);
}

/**
 * Notification de révocation par le Panel : le projet efface son appairage et
 * redevient STANDALONE. Idempotent. (La purge de l'outbox du PanelBridge
 * accompagnera la persistance de celle-ci — Phase 2.)
 */
export async function notifyUnpair() {
  await clearPairing();
  return { unpaired: true };
}

/** Observabilité des tests : écritures DIAGNOSTIC reçues et appliquées. */
export function listAppliedDiagnostics() {
  return [...appliedDiagnostics];
}

/** Réinitialisation complète (tests uniquement). */
export function resetProjectBridgeStateForTests() {
  deliveredAcks.clear();
  appliedDiagnostics.length = 0;
  cachedSoftwareVersion = null;
}



/**
 * Adresses publiques de CE projet, telles que le Panel doit les employer.
 *
 * `PUBLIC_BACKEND_URL` prime : c'est l'adresse par laquelle le Panel joint
 * réellement le backend. `PUBLIC_URL` sert de repli, et vaut `localhost` en
 * développement — ce qui est correct pour un Panel lui aussi local, et
 * inutilisable autrement. On ne devine rien de plus : une adresse inventée
 * serait pire qu'une adresse absente.
 */
function networkDescriptor(publicUrls) {
  const backendUrl = publicUrls?.backend || config.panel.publicBackendUrl || config.publicUrl || null;
  const websiteUrl = publicUrls?.website || null;
  const managerUrl = publicUrls?.manager || null;
  if (!backendUrl && !websiteUrl) return undefined;

  // Le domaine PRINCIPAL est celui du SITE quand on le connaît. Publier celui
  // de l'API donnait au Panel « api.<domaine> » comme adresse du client, ce
  // qu'aucun écran métier ne devrait montrer.
  const hostOf = (url) => {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  };
  const primaryDomain = hostOf(websiteUrl) ?? hostOf(backendUrl);
  if (!primaryDomain) return undefined;

  const urls = {
    ...(websiteUrl ? { website: websiteUrl } : {}),
    ...(managerUrl ? { manager: managerUrl } : {}),
    ...(backendUrl ? { backend: backendUrl } : {}),
  };
  return { primaryDomain, urls };
}

/** Versions des moteurs standards embarqués, lues dans leurs manifestes. */
function engineVersions() {
  const engines = {};
  for (const [key, dir] of [['deployment', 'deployment-engine'], ['duplication', 'duplication-engine']]) {
    try {
      const url = new URL(`../../${dir}/engine.manifest.json`, import.meta.url);
      const manifest = JSON.parse(readFileSync(url, 'utf8'));
      if (/^\d+\.\d+\.\d+$/.test(manifest.version)) engines[key] = manifest.version;
    } catch {
      // Moteur absent : rien à publier.
    }
  }
  return Object.keys(engines).length > 0 ? engines : undefined;
}
