/**
 * OÙ EN EST CE PROJET DANS LE JOURNAL DU PANEL — le cache, et sa persistance.
 *
 * ══ LA DETTE QUE CE MODULE FERME ════════════════════════════════════════════
 *
 * `pullCursor`, `appliedWriteIds` et `localWriteIds` vivaient dans des
 * propriétés d'instance du pont. Aucun ne survivait à un redémarrage :
 *
 *     consommer les écritures 1 à 100
 *     redémarrer
 *     → le tirage suivant repartait de ZÉRO
 *
 * Les protections d'idempotence (LWW sur `modifiedAt`, anti-rejeu par
 * `writeId`) évitaient la corruption. Elles n'évitaient ni le coût, ni le
 * bruit, ni — surtout — l'impossibilité pour le Panel de savoir ce qu'un
 * projet avait réellement consommé.
 *
 * ══ MÊME PATRON QUE `pairingStore` — ET C'EST DÉLIBÉRÉ ══════════════════════
 *
 *   · les LECTURES sont SYNCHRONES sur un cache mémoire : elles sont sur le
 *     chemin de chaque page de tirage, et de chaque écriture appliquée ;
 *   · les ÉCRITURES traversent un adaptateur INJECTÉ — le cœur du pont
 *     n'importe aucun modèle, `bridge-conformity` le vérifie ;
 *   · `hydrate()` recharge le cache au démarrage. C'est LUI, et lui seul, qui
 *     ferme la dette.
 *
 * Sans adaptateur (tests unitaires purs), le store fonctionne en mémoire :
 * exactement le comportement d'avant, et aucun test n'a besoin d'une base.
 *
 * ══ CE QUI EST DÉLIBÉRÉMENT NON PERSISTÉ ═══════════════════════════════════
 *
 * `localWriteIds` — les écritures ÉMISES par ce projet, retenues pour ne pas
 * se les réappliquer au tirage. Elles ne sont PAS persistées, et c'est correct :
 * le Panel exclut lui-même l'émetteur d'origine (`originProjectId: { $ne }`)
 * dans `pullForProject`. Le filtre local est une ceinture, pas la protection —
 * et une ceinture qu'on persisterait grandirait sans fin pour ne rien garantir
 * de plus.
 */
import crypto from 'node:crypto';
import os from 'node:os';

import { nowIso } from './bridgeContract.js';

/**
 * ══ QUI A LE DROIT DE CONSOMMER, EN CE MOMENT ══════════════════════════
 *
 * ── CE QUI TENAIT LIEU DE GARANTIE ─────────────────────────────────
 *
 * « le tirage est mono-consommateur par construction ». C'était vrai de la
 * CONFIGURATION, jamais du code : ce magasin est un cache MÉMOIRE par
 * processus, sauvegardé en écrasant le document entier. Deux runtimes du même
 * projet sur la même base, c'est deux caches, et le dernier qui écrit gagne :
 *
 *     A tire 1..50, applique, sauvegarde curseur=50
 *     B (cache à 0) sauvegarde curseur=0        →  RÉGRESSION
 *     ou B à 100 écrase le curseur RETENU de A  →  écritures SAUTÉES
 *
 * La seconde est exactement le mensonge que le lot précédent a fermé, revenu
 * par une autre porte.
 *
 * ── LE BAIL N'EST PAS LE CURSEUR ──────────────────────────────────
 *
 *     bail     QUI a le droit de consommer maintenant
 *     curseur  JUSQU'OÙ le projet a réellement appliqué — l'accusé durable
 *
 * Les fusionner perdrait le second : un bail rendu effacerait un accusé. Ils
 * vivent donc dans le même document, et ne se touchent jamais.
 */

/**
 * L'IDENTITÉ DE CE RUNTIME — et le nonce en est la seule partie sérieuse.
 *
 * Hôte et pid sont du confort de diagnostic. Le nonce, tiré une fois au
 * chargement du module, distingue CE processus de son propre fantôme : un
 * processus redémarré peut réutiliser un pid sur le même hôte, et se croirait
 * alors titulaire d'un bail qu'il a perdu en mourant.
 */
const NONCE_DEMARRAGE = crypto.randomBytes(6).toString('hex');
export const PROCESS_IDENTITY = `${os.hostname()}:${process.pid}:${NONCE_DEMARRAGE}`;

function positiveEnv(nom, defaut) {
  const brut = Number.parseInt(process.env[nom] ?? '', 10);
  return Number.isFinite(brut) && brut > 0 ? brut : defaut;
}

/**
 * ══ LA DURÉE DU BAIL — 45 s, ET VOICI POURQUOI ═══════════════════════
 *
 * Mesure du travail réel : un cycle de tirage enchaîne au plus dix pages de
 * cent écritures, chacune appliquée par un `upsert` local. Les cycles observés
 * en exploitation se comptent en centaines de millisecondes ; la borne dure du
 * code est `MAX_PULL_PAGES_PER_RUN`, et un cycle pathologique reste sous
 * quelques secondes.
 *
 * 45 s est donc largement au-dessus du pire cas, et bien en dessous du délai
 * qu'un exploitant tolérerait avant reprise. Les deux bornes comptent :
 *
 *   trop COURT  →  un consommateur sain perd son bail EN TRAVAILLANT, et un
 *                  autre reprend une page qu'il tenait. L'idempotence tiendrait,
 *                  mais on l'aurait sollicitée pour rien.
 *   trop LONG   →  après un `kill -9`, le projet ne consomme plus rien pendant
 *                  tout ce temps — et personne ne le sait.
 */
export const CONSUMER_LEASE_TTL_MS = positiveEnv('BRIDGE_CONSUMER_LEASE_TTL_MS', 45_000);

/**
 * LE RENOUVELLEMENT EST TROIS FOIS PLUS FRÉQUENT QUE L'ÉCHÉANCE.
 *
 * Un renouvellement à la moitié du TTL ne laisse qu'UNE occasion de rattraper
 * un renouvellement manqué — un cycle réseau lent suffirait à perdre un bail
 * qu'on tient parfaitement. Le tiers en laisse deux.
 */
export const LEASE_RENEW_INTERVAL_MS = Math.max(1, Math.floor(CONSUMER_LEASE_TTL_MS / 3));

/**
 * LA FENÊTRE D'IDEMPOTENCE — bornée, et la borne est justifiée.
 *
 * Le curseur durable rend l'ensemble des `writeId` inutile pour l'essentiel :
 * une écriture au-delà du curseur ne sera jamais reservie. Le seul rejeu
 * possible est INTRA-PAGE — une écriture livrée en poussée immédiate puis
 * retirée dans la page suivante, avant que le curseur ne l'ait dépassée.
 *
 * Une page vaut cent écritures (`limit` par défaut). Le triple couvre
 * largement cette fenêtre, y compris quand plusieurs pages s'enchaînent dans
 * un même cycle.
 */
export const RECENT_WRITE_IDS_MAX = 300;

/** L'état COURANT, en mémoire. `null` tant que rien n'a été hydraté ni écrit. */
let etat = null;
/** Adaptateur { load(), save(e), clear() } — null = mémoire seule (tests). */
let persistance = null;

/**
 * ══ COMBIEN DE FOIS ON REPRÉSENTE UNE ÉCRITURE AVANT DE RENONCER ════════════
 *
 * Le curseur ne dépasse plus une écriture non appliquée : la page entière est
 * reprise au cycle suivant. C'est ce qui rend le curseur HONNÊTE — le Panel le
 * lit comme un accusé, et il doit donc dire la vérité.
 *
 * Mais une écriture qu'aucune tentative ne peut appliquer bloquerait alors le
 * flux POUR TOUJOURS, et tout ce qui la suit avec elle. Cinq tentatives — une
 * par cycle de tirage, donc quelques minutes — laissent largement place à une
 * dépendance momentanément indisponible sans transformer un défaut en arrêt
 * définitif de la synchronisation.
 *
 * Au-delà, l'écriture est GARÉE (lettre morte durable) et le curseur passe.
 * Jamais silencieusement : c'est la différence entre renoncer et perdre.
 */
export const MAX_APPLY_ATTEMPTS = (() => {
  const brut = Number.parseInt(process.env.BRIDGE_MAX_APPLY_ATTEMPTS ?? '', 10);
  return Number.isFinite(brut) && brut > 0 ? brut : 5;
})();

/** Borne de la lettre morte : un incident se lit, il ne s'accumule pas sans fin. */
export const DEAD_LETTER_MAX = 200;

const neuf = ({ projectId = null, generation = null } = {}) => ({
  projectId,
  generation,
  pullCursor: null,
  lastCursorAdvanceAt: null,
  lastSuccessfulApplyAt: null,
  consecutivePullFailures: 0,
  consecutiveUnreadableChanges: 0,
  appliedTotal: 0,
  recentWriteIds: [],
  /**
   * ÉCHECS D'APPLICATION EN COURS — `{ [writeId]: n }`.
   *
   * Persisté, parce qu'un compteur en mémoire remettrait le plafond à zéro à
   * chaque redémarrage : une écriture toxique reprise indéfiniment n'atteindrait
   * jamais la lettre morte, et bloquerait le flux à vie.
   */
  applyFailures: {},
  /**
   * LES ÉCRITURES GARÉES — celles qu'on a renoncé à appliquer, et qui le DISENT.
   *
   * Aucune charge utile : un type, un identifiant, un `writeId`, un motif, une
   * date, un nombre de tentatives. Assez pour ouvrir une enquête, rien qui
   * transforme la lettre morte en second entrepôt de données personnelles.
   */
  deadLetters: [],
});

/** Branche l'adaptateur de persistance (bootstrap). */
export function configureConsumptionPersistence(adapter) {
  persistance = adapter || null;
}

/**
 * ÉCRIT LE CACHE VERS LA PERSISTANCE — SOUS CONDITION DE POSSESSION.
 *
 * ── POURQUOI LA CONDITION EST OBLIGATOIRE ─────────────────────────────
 *
 * Le cas qui rend le bail nécessaire n'est pas « deux runtimes démarrent
 * ensemble » — celui-là, la réclamation atomique le tranche. C'est celui-ci :
 *
 *     A tient le bail  →  A ralentit  →  le bail expire  →  B reprend
 *     →  A finit son travail, SANS SAVOIR qu'il n'est plus propriétaire
 *
 * Si A pouvait encore écrire, il effacerait le travail de B et acquitterait des
 * écritures que personne n'a appliquées. L'écriture est donc conditionnée à
 * `leaseOwner`, EN BASE : c'est Mongo qui refuse, pas une vérification locale
 * que le temps aurait périmée entre le test et l'écriture.
 *
 * Sans persistance (tests unitaires purs) et sans bail pris, on écrit : le
 * comportement mono-processus d'avant est intégralement préservé.
 *
 * @returns {Promise<{written: boolean, reason?: string}>}
 */
async function persister() {
  if (!persistance || !etat) return { written: true };
  /**
   * Aucun bail pris par PERSONNE : on écrit. C'est le cas d'un runtime seul qui
   * n'a jamais réclamé — et lui refuser d'écrire casserait tout le parc pour
   * une garantie dont il n'a pas besoin.
   */
  const r = await persistance.save(etat, { expectedOwner: bailTente ? PROCESS_IDENTITY : null });
  if (r && r.written === false) {
    return { written: false, reason: r.reason ?? 'LEASE_LOST' };
  }
  return { written: true };
}

/**
 * ══ DEUX DRAPEAUX, ET LA DISTINCTION EST TOUT ═══════════════════════════
 *
 * `bailTente`  ce runtime a un jour RÉCLAMÉ — gagné OU perdu. À partir de là,
 *              toutes ses écritures sont conditionnées à sa possession.
 * `bailPris`   ce runtime a GAGNÉ la dernière réclamation.
 *
 * ── POURQUOI « TENTÉ » ET PAS SEULEMENT « PRIS » ──────────────────────
 *
 * Le PERDANT n'a pas de bail. Si la condition d'écriture ne s'appliquait qu'aux
 * titulaires, il écrirait donc SANS CONDITION — et écraserait le travail du
 * gagnant. Mesuré : le perdant avançait le curseur à 999.
 *
 * Un runtime qui n'a JAMAIS réclamé écrit sans condition, et c'est voulu : le
 * comportement mono-processus d'avant reste intégralement préservé.
 */
let bailTente = false;
let bailPris = false;
/** L'échéance de NOTRE bail, telle que nous l'avons obtenue. */
let bailExpireA = 0;

/**
 * RECHARGE l'état persisté — le geste qui ferme la dette.
 *
 * ══ LES DEUX REMISES À ZÉRO LÉGITIMES, ET IL N'Y EN A QUE DEUX ═════════════
 *
 *   1. LE PROJET A CHANGÉ. Un curseur est une position dans un journal FILTRÉ
 *      par destinataire. Le conserver après un réappairage ferait démarrer le
 *      nouveau projet au milieu d'un journal qui ne le concernait pas : il
 *      sauterait, définitivement, tout ce qui précède cette position.
 *
 *   2. LA GÉNÉRATION A CHANGÉ. Un projet redéployé d'un monde à l'autre parle
 *      à un autre Panel, avec un autre journal. Même conséquence.
 *
 * Tout le reste — un Panel redémarré, un projet redéployé dans le même monde,
 * un curseur ancien — n'est PAS une raison de repartir de zéro. C'est même le
 * cas nominal que ce module existe pour servir.
 *
 * @param {object} contexte
 * @param {string|null} contexte.projectId    le projet APPAIRÉ à cet instant
 * @param {string|null} contexte.generation   l'environnement courant
 * @returns {Promise<{restored: boolean, reason?: string, cursor: string|null}>}
 */
export async function hydrateConsumption({ projectId = null, generation = null } = {}) {
  if (!persistance) {
    etat = etat ?? neuf({ projectId, generation });
    return { restored: false, reason: 'NO_PERSISTENCE', cursor: etat.pullCursor };
  }

  /**
   * L'INDEX D'UNICITÉ EST POSÉ AVANT TOUTE CHOSE. Le bail n'exclut rien sans
   * lui — deux documents `SINGLETON` rendraient deux propriétaires possibles.
   * L'amorçage passe ici une fois, avant la première réclamation.
   */
  if (typeof persistance.ensureIndexes === 'function') {
    await persistance.ensureIndexes().catch(() => null);
  }

  const stocke = await persistance.load();
  if (!stocke) {
    etat = neuf({ projectId, generation });
    return { restored: false, reason: 'NOTHING_STORED', cursor: null };
  }

  /**
   * ══ UN RÉAPPAIRAGE INVALIDE AUSSI LE BAIL ═══════════════════════════
   *
   * Le curseur repartait bien de zéro, mais le BAIL restait — tenu par un
   * consommateur qui travaillait pour une relation qui n'existe plus. Le
   * laisser expirer ferait taire le projet pendant tout un TTL, sans raison.
   *
   * `resetForGeneration` efface le document entier, bail compris. C'est la
   * seule écriture qui retire un bail sans en être titulaire, et elle est
   * justifiée par un fait extérieur : l'appairage a changé.
   */
  const repartirDeZero = async (reason) => {
    etat = neuf({ projectId, generation });
    bailTente = false;
    bailPris = false;
    bailExpireA = 0;
    if (typeof persistance.resetForGeneration === 'function') {
      await persistance.resetForGeneration({ projectId, generation });
    } else {
      await persister();
    }
    return { restored: false, reason, cursor: null };
  };

  if (projectId && stocke.projectId && stocke.projectId !== projectId) {
    return repartirDeZero('PROJECT_CHANGED');
  }
  if (generation && stocke.generation && stocke.generation !== generation) {
    return repartirDeZero('GENERATION_CHANGED');
  }

  etat = {
    ...stocke,
    /** Le projet et la génération COURANTS priment : ils viennent de l'appairage vivant. */
    projectId: projectId ?? stocke.projectId ?? null,
    generation: generation ?? stocke.generation ?? null,
  };
  return { restored: true, cursor: etat.pullCursor };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  LE BAIL DE CONSOMMATION — qui a le droit de tirer, en ce moment            */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * RÉCLAMER LE BAIL — atomique en base, et c'est Mongo qui arbitre.
 *
 * Le filtre accepte trois situations, et trois seulement :
 *
 *   · aucun bail                  personne ne consomme
 *   · le bail est déjà le nôtre   renouvellement implicite, jamais un vol
 *   · le bail a EXPIRÉ            son titulaire est mort sans le rendre
 *
 * Deux runtimes qui réclament ensemble : le premier passe, le second ne matche
 * plus rien et reçoit un refus. Aucune lecture-puis-décision — entre le `find`
 * et le `update` d'un tel motif, l'autre aurait eu tout le temps de gagner.
 *
 * La GÉNÉRATION fait partie du filtre : un bail pris avant un réappairage ne
 * doit pas bloquer la génération suivante, qui parle à un autre journal.
 *
 * @returns {Promise<{granted: boolean, owner?: string, reason?: string, expiresAt?: string}>}
 */
export async function claimConsumerLease({ projectId = null, generation = null } = {}) {
  etat = etat ?? neuf({ projectId, generation });
  if (!persistance || typeof persistance.claimLease !== 'function') {
    /**
     * SANS PERSISTANCE, LE BAIL EST ACCORDÉ — et c'est honnête.
     *
     * Un runtime sans base est seul par construction (tests unitaires purs).
     * Refuser produirait un mode dégradé que personne n'a demandé ; prétendre
     * garantir l'exclusion serait pire.
     */
    bailTente = true;
    bailPris = true;
    bailExpireA = Date.now() + CONSUMER_LEASE_TTL_MS;
    return { granted: true, owner: PROCESS_IDENTITY, reason: 'NO_PERSISTENCE' };
  }

  const maintenant = Date.now();
  const r = await persistance.claimLease({
    projectId: projectId ?? etat.projectId ?? null,
    generation: generation ?? etat.generation ?? null,
    owner: PROCESS_IDENTITY,
    now: new Date(maintenant),
    expiresAt: new Date(maintenant + CONSUMER_LEASE_TTL_MS),
  });

  bailTente = true;
  bailPris = r.granted === true;
  bailExpireA = r.granted ? maintenant + CONSUMER_LEASE_TTL_MS : 0;
  return r;
}

/**
 * CE RUNTIME A-T-IL LE DROIT DE DÉCLARER SA CONSOMMATION AU PANEL ?
 *
 * ══ L'INCIDENT QUI A CRÉÉ CETTE FONCTION ════════════════════════════════════
 *
 * Le Panel a expédié, pendant une demi-heure, UN COURRIEL PAR MINUTE annonçant
 * qu'un projet « consomme à nouveau les écritures ». Il n'était pas tombé en
 * panne, et il n'avait pas non plus été réparé soixante fois.
 *
 * Deux runtimes du même projet battaient : le déployé, qui tient le bail et
 * consomme réellement, et un poste de développement, démarré sur la MÊME base,
 * qui l'avait perdu. Le second continuait pourtant de publier `consumption`
 * dans son battement — un curseur hydraté au démarrage, puis FIGÉ, puisqu'il
 * n'a plus le droit de tirer.
 *
 * Le Panel mesure le retard d'un projet en comparant son journal à ce curseur.
 * Un battement sur deux lui décrivait donc un retard de plusieurs heures
 * (DEGRADED), l'autre un retard nul (HEALTHY). Ouverture, fermeture, ouverture,
 * fermeture — et un courriel de rétablissement à chaque bascule.
 *
 * ══ LA RÈGLE ═══════════════════════════════════════════════════════════════
 *
 * SEUL LE TITULAIRE DU BAIL DÉCRIT LA CONSOMMATION. Les autres se taisent —
 * et le Panel lit ce silence comme `UNKNOWN`, un verdict qui n'ouvre aucune
 * alerte et n'en referme aucune. C'est exactement le comportement voulu : un
 * runtime qui ne consomme pas n'a rien à dire de la consommation du projet.
 *
 * Un runtime qui n'a JAMAIS réclamé fait autorité (`!bailTente`) : c'est le cas
 * mono-processus, et le seul comportement qu'on ne veut pas changer.
 *
 * @returns {boolean}
 */
export function consumptionIsAuthoritative() {
  return !bailTente || holdsConsumerLease();
}

/**
 * CE RUNTIME TIENT-IL LE BAIL ? — lecture du cache, jamais une preuve.
 *
 * Elle sert à décider s'il vaut la peine de tenter un cycle. La PREUVE reste la
 * condition en base : entre cette lecture et l'écriture, le bail peut expirer,
 * et seul Mongo peut trancher au bon instant.
 */
export function holdsConsumerLease() {
  /**
   * L'ÉCHÉANCE LOCALE COMPTE AUSSI — sans quoi un titulaire périmé se croirait
   * propriétaire jusqu'à sa prochaine écriture refusée. Ce n'est toujours pas
   * une preuve (l'horloge locale dérive, la base tranche), mais c'est honnête :
   * un bail qu'on sait expiré ne se revendique pas.
   */
  return bailPris === true && Date.now() < bailExpireA;
}

/**
 * RENOUVELER — pendant le travail, et seulement si le bail est encore le nôtre.
 *
 * Un renouvellement qui réussirait sans possession serait un vol ; un
 * renouvellement qui échoue est l'information la plus utile qui soit : ce
 * runtime doit cesser de consommer, tout de suite.
 */
export async function renewConsumerLease() {
  if (!persistance || typeof persistance.renewLease !== 'function') {
    return { renewed: bailPris === true, reason: 'NO_PERSISTENCE' };
  }
  const maintenant = Date.now();
  const r = await persistance.renewLease({
    owner: PROCESS_IDENTITY,
    now: new Date(maintenant),
    expiresAt: new Date(maintenant + CONSUMER_LEASE_TTL_MS),
  });
  if (r.renewed === false) { bailPris = false; bailExpireA = 0; }
  else bailExpireA = maintenant + CONSUMER_LEASE_TTL_MS;
  return r;
}

/**
 * RENDRE LE BAIL — à l'arrêt propre, et en BEST-EFFORT.
 *
 * ── LA SÉCURITÉ N'EN DÉPEND PAS, ET C'EST TOUT LE POINT ────────────────────
 *
 * Un `kill -9` ne rend rien. C'est l'EXPIRATION qui débloque, et elle seule.
 * Rendre proprement ne fait qu'éviter d'attendre le TTL — un confort, jamais
 * une garantie. Un mécanisme dont la sûreté reposerait sur un arrêt propre
 * n'aurait de sûreté que le nom.
 */
export async function releaseConsumerLease() {
  if (!persistance || typeof persistance.releaseLease !== 'function') {
    bailPris = false;
    bailExpireA = 0;
    return { released: true, reason: 'NO_PERSISTENCE' };
  }
  const r = await persistance.releaseLease({ owner: PROCESS_IDENTITY });
  if (r.released) { bailPris = false; bailExpireA = 0; }
  return r;
}

/** Ce que la base dit du bail — diagnostic, écran, recette. */
export async function describeConsumerLease() {
  if (!persistance || typeof persistance.readLease !== 'function') return null;
  return persistance.readLease();
}

/** Tests : oublier qu'on a réclamé, sans toucher à la base. */
export function resetLeaseCacheForTests() {
  bailTente = false;
  bailPris = false;
  bailExpireA = 0;
}

/** L'état courant — LECTURE SYNCHRONE, sur le chemin de chaque page. */
export function currentConsumption() {
  return etat ?? neuf();
}

/** Le curseur courant, ou `null`. */
export function currentCursor() {
  return etat?.pullCursor ?? null;
}

/**
 * ENREGISTRE la position atteinte après une page de tirage.
 *
 * `advanced` distingue « le curseur a bougé » de « on a réécrit la même
 * valeur ». C'est cette distinction, et elle seule, qui permet au Panel de
 * répondre à « le tirage progresse-t-il ? » — un curseur identique d'un cycle
 * à l'autre est l'état NORMAL d'un projet à jour.
 */
export async function recordCursor(cursor) {
  etat = etat ?? neuf();
  const avance = typeof cursor === 'string' && cursor !== '' && cursor !== etat.pullCursor;
  const precedent = etat.pullCursor;
  etat.pullCursor = cursor ?? etat.pullCursor;
  if (avance) etat.lastCursorAdvanceAt = nowIso();
  /** Une page tirée sans erreur referme la série d'échecs. */
  etat.consecutivePullFailures = 0;
  const ecrit = await persister();
  if (!ecrit.written) {
    /**
     * LE BAIL EST PERDU — on remet le cache où il était.
     *
     * Sans cela, ce runtime croirait avoir avancé : ses lectures synchrones
     * rendraient un curseur que la base ne porte pas, et son prochain tirage
     * SAUTERAIT des écritures que personne n'a appliquées. Un cache qui ment
     * est pire qu'une écriture refusée.
     */
    etat.pullCursor = precedent;
    return { advanced: false, cursor: precedent, written: false, reason: ecrit.reason };
  }
  return { advanced: avance, cursor: etat.pullCursor, written: true };
}

/** Une écriture vient d'être APPLIQUÉE. */
export async function recordApplied(writeId) {
  etat = etat ?? neuf();
  etat.appliedTotal += 1;
  etat.lastSuccessfulApplyAt = nowIso();
  /** Une application réussie referme la série d'écritures illisibles. */
  etat.consecutiveUnreadableChanges = 0;
  if (writeId) {
    etat.recentWriteIds.push(writeId);
    if (etat.recentWriteIds.length > RECENT_WRITE_IDS_MAX) {
      etat.recentWriteIds = etat.recentWriteIds.slice(-RECENT_WRITE_IDS_MAX);
    }
  }
  return persister();
}

/** Cette écriture a-t-elle déjà été appliquée dans la fenêtre récente ? */
export function alreadyApplied(writeId) {
  return Boolean(writeId) && (etat?.recentWriteIds ?? []).includes(writeId);
}

/**
 * UNE APPLICATION A ÉCHOUÉ — on compte, et le compte est DURABLE.
 *
 * @returns {Promise<{attempts: number, exhausted: boolean}>}
 */
export async function recordApplyFailure(writeId) {
  etat = etat ?? neuf();
  etat.applyFailures = etat.applyFailures ?? {};
  const n = (etat.applyFailures[writeId] ?? 0) + 1;
  etat.applyFailures[writeId] = n;
  const ecrit = await persister();
  if (!ecrit.written) {
    /** Bail perdu : le compteur ne compte pas. On ne l'invente pas non plus. */
    etat.applyFailures[writeId] = n - 1 > 0 ? n - 1 : undefined;
    if (etat.applyFailures[writeId] === undefined) delete etat.applyFailures[writeId];
    return { attempts: n - 1, exhausted: false, written: false, reason: ecrit.reason };
  }
  return { attempts: n, exhausted: n >= MAX_APPLY_ATTEMPTS, written: true };
}

/** L'écriture est passée : on oublie ses échecs, pour ne pas les compter deux fois. */
export async function clearApplyFailure(writeId) {
  if (!etat?.applyFailures || etat.applyFailures[writeId] === undefined) {
    /**
     * RIEN À EFFACER — mais la réponse doit rester HONNÊTE.
     *
     * Un propriétaire périmé dont le cache ne porte aucun compteur « réussirait »
     * à effacer un compteur qu'il ne pouvait pas voir. On refuse donc dès qu'un
     * bail est en jeu et qu'il n'est plus le nôtre.
     */
    if (bailTente && !holdsConsumerLease() && persistance) return { written: false, reason: 'NO_LEASE' };
    return { written: true };
  }
  const precedent = etat.applyFailures[writeId];
  delete etat.applyFailures[writeId];
  const ecrit = await persister();
  if (!ecrit.written) {
    etat.applyFailures[writeId] = precedent;
    return { written: false, reason: ecrit.reason };
  }
  return { written: true };
}

/** Combien de fois cette écriture a-t-elle déjà échoué ? */
export function applyAttempts(writeId) {
  return etat?.applyFailures?.[writeId] ?? 0;
}

/**
 * GARER UNE ÉCRITURE — on renonce, et on le dit.
 *
 * Deux motifs, et un seul est réversible :
 *
 *   `APPLY_EXHAUSTED`  l'application a échoué N fois. Peut-être qu'un correctif
 *                      la rendra applicable ; une nouvelle publication du Panel
 *                      la ramènera alors.
 *   `UNREADABLE`       l'écriture ne respecte pas le contrat de pont. Aucune
 *                      tentative ne la rendra lisible : la garer immédiatement
 *                      évite cinq cycles perdus à prouver l'évidence.
 */
export async function deadLetterChange({ writeId, entityType, entityId, reason, attempts = 0 }) {
  etat = etat ?? neuf();
  etat.deadLetters = etat.deadLetters ?? [];
  etat.deadLetters.push({
    writeId: writeId ?? null,
    entityType: entityType ?? null,
    entityId: entityId ?? null,
    reason: String(reason ?? '').slice(0, 200),
    attempts,
    parkedAt: nowIso(),
    status: 'PARKED',
    resolvedAt: null,
    resolvedByWriteId: null,
  });
  if (etat.deadLetters.length > DEAD_LETTER_MAX) {
    etat.deadLetters = etat.deadLetters.slice(-DEAD_LETTER_MAX);
  }
  if (writeId && etat.applyFailures) delete etat.applyFailures[writeId];
  const ecrit = await persister();
  if (!ecrit.written) {
    etat.deadLetters.pop();
    return { parked: false, written: false, reason: ecrit.reason };
  }
  return { parked: true, written: true, total: etat.deadLetters.length };
}

/** Ce qu'on a renoncé à appliquer — pour l'écran, le battement, l'enquête. */
export function deadLetters() {
  return [...(etat?.deadLetters ?? [])];
}

/** Celles qui BLOQUENT encore — les résolues restent à l'historique. */
export function activeDeadLetters() {
  return (etat?.deadLetters ?? []).filter((d) => (d.status ?? 'PARKED') === 'PARKED');
}

/**
 * ══ UNE ÉCRITURE RÉUSSIE DÉBLOQUE CE QUI ÉTAIT GARÉ SUR LA MÊME ENTITÉ ═════
 *
 * ── POURQUOI L'IDENTITÉ MÉTIER, ET PAS LE `writeId` ────────────────────
 *
 * Le rejeu republie le MÊME FAIT sous un NOUVEAU `writeId` — c'est ce qui
 * permet au projet de le consommer par le pipeline NORMAL, sans savoir qu'il
 * s'agit d'un rejeu. La lettre morte ne peut donc pas se reconnaître à
 * l'identifiant technique : ce qui l'unit à la republication est l'identité
 * MÉTIER, `(entityType, entityId)`.
 *
 * C'est aussi la bonne sémantique : « ce qui était bloqué sur cette entité est
 * passé ». Peu importe par quel chemin — rejeu délibéré ou nouvelle
 * publication ordinaire — le blocage n'existe plus.
 *
 * @returns {Promise<{resolved: number}>}
 */
export async function resolveDeadLettersFor({ entityType, entityId, byWriteId = null }) {
  if (!etat?.deadLetters?.length || !entityType || !entityId) return { resolved: 0 };
  const maintenant = nowIso();
  let n = 0;
  for (const d of etat.deadLetters) {
    if ((d.status ?? 'PARKED') !== 'PARKED') continue;
    if (d.entityType !== entityType || d.entityId !== entityId) continue;
    d.status = 'RESOLVED';
    d.resolvedAt = maintenant;
    d.resolvedByWriteId = byWriteId ?? null;
    n += 1;
  }
  if (n === 0) return { resolved: 0 };
  const ecrit = await persister();
  if (!ecrit.written) return { resolved: 0, written: false, reason: ecrit.reason };
  return { resolved: n, written: true };
}

/** Le tirage a échoué (transport, enveloppe illisible). */
export async function recordPullFailure() {
  etat = etat ?? neuf();
  etat.consecutivePullFailures += 1;
  await persister();
}

/** Une écriture a été ÉCARTÉE parce qu'illisible — une perte, pas un retard. */
export async function recordUnreadableChange() {
  etat = etat ?? neuf();
  etat.consecutiveUnreadableChanges += 1;
  await persister();
}

/**
 * LE CURSEUR EST REFUSÉ PAR LE PANEL — on repart de zéro, en le DISANT.
 *
 * ══ POURQUOI CETTE REMISE À ZÉRO EST SÛRE ══════════════════════════════════
 *
 * Repartir de zéro rejoue le journal depuis son origine. Les applicateurs sont
 * idempotents (LWW sur la version, `upsert` par identité) : le rejeu ne
 * corrompt rien, il coûte. Face à un curseur que le Panel refuse, l'alternative
 * serait un tirage mort pour toujours — exactement la panne que tout ce lot
 * répare.
 *
 * Elle est NOMMÉE et journalisée par l'appelant : une remise à zéro silencieuse
 * ferait réapparaître des applications anciennes sans que personne ne sache
 * pourquoi.
 */
export async function resetCursor(reason) {
  etat = etat ?? neuf();
  etat.pullCursor = null;
  etat.recentWriteIds = [];
  etat.consecutivePullFailures = 0;
  await persister();
  return { reset: true, reason };
}

/** Purge complète — au désappairage : ce qui venait du Panel repart avec lui. */
export async function clearConsumption() {
  etat = null;
  if (persistance) await persistance.clear();
}

/**
 * CE QUE LE BATTEMENT DÉCLARE AU PANEL (contrat >= 1.10.0).
 *
 * Aucune charge utile, aucun secret : un curseur opaque que le Panel a
 * lui-même émis, des compteurs, des dates. C'est exactement ce qu'il faut pour
 * distinguer « rien à recevoir » de « plus rien n'arrive », et rien de plus.
 */
/**
 * L'ÉCRITURE QUI RETIENT LE CURSEUR — déclarée, jamais devinée.
 *
 * ══ POURQUOI ELLE EST PERSISTÉE ═══════════════════════════════════════════
 *
 * Un blocage qui ne survit pas au redémarrage est un blocage qu'on découvre
 * deux fois. Et surtout : c'est le Panel qui doit l'apprendre, au battement.
 * Sans elle, un projet retenu depuis trois jours annonce « CONNECTED » avec un
 * curseur figé — deux faits vrais dont aucun ne dit la cause.
 *
 * On garde le TYPE, l'IDENTITÉ, le MOTIF et les DATES. Aucune charge utile :
 * même discipline que la lettre morte, pour la même raison.
 */
export async function recordBlockingChange({ entityType, entityId, writeId, reason, contractVersion }) {
  etat = etat ?? neuf();
  const memeQueAvant = etat.blockedChange && etat.blockedChange.writeId === (writeId ?? null);
  etat.blockedChange = {
    entityType: entityType ?? null,
    entityId: entityId ?? null,
    writeId: writeId ?? null,
    reason: String(reason ?? '').slice(0, 60),
    contractVersion: contractVersion ?? null,
    /**
     * L'ANCIENNETÉ DU BLOCAGE NE SE RÉINITIALISE PAS À CHAQUE ESSAI.
     *
     * C'est elle qui dit s'il faut s'inquiéter : bloqué depuis deux minutes
     * pendant un déploiement est normal ; bloqué depuis trois jours ne l'est
     * pas. La remettre à l'heure à chaque cycle effacerait exactement
     * l'information qu'on vient chercher.
     */
    since: memeQueAvant ? etat.blockedChange.since : nowIso(),
    lastSeenAt: nowIso(),
    attempts: memeQueAvant ? (etat.blockedChange.attempts ?? 0) + 1 : 1,
  };
  await persister();
  return etat.blockedChange;
}

/**
 * LE BLOCAGE EST LEVÉ — appelé dès qu'une page passe entièrement.
 *
 * Ne rien effacer laisserait le Panel afficher un blocage résolu, et la
 * supervision deviendrait un bruit permanent que tout le monde apprend à
 * ignorer.
 */
export async function clearBlockingChange() {
  if (!etat?.blockedChange) return { cleared: false };
  etat.blockedChange = null;
  await persister();
  return { cleared: true };
}

/** L'écriture qui retient actuellement le curseur, ou null. */
export function blockingChange() {
  return etat?.blockedChange ?? null;
}

export function describeConsumption(state = null) {
  const e = etat ?? neuf();
  return {
    cursor: e.pullCursor,
    lastCursorAdvanceAt: e.lastCursorAdvanceAt,
    lastSuccessfulApplyAt: e.lastSuccessfulApplyAt,
    consecutivePullFailures: e.consecutivePullFailures,
    consecutiveUnreadableChanges: e.consecutiveUnreadableChanges,
    appliedTotal: e.appliedTotal,
    /**
     * ══ CE QU'ON A RENONCÉ À APPLIQUER — SANS QUOI LE PANEL NE LE SAIT PAS ═══
     *
     * Une écriture garée est passée SOUS le curseur : le Panel la compte comme
     * consommée, et son calcul de retard ne la verra jamais. Sans cette
     * déclaration, renoncer proprement redeviendrait perdre en silence — le
     * défaut même que la lettre morte existe pour empêcher.
     *
     * Un COMPTE, pas la liste : le battement n'est pas un canal de transport de
     * données. Le détail se lit sur le projet, et le compte suffit à savoir
     * qu'il faut aller le lire.
     */
    /**
     * SEULES LES GARÉES ACTIVES COMPTENT. Une lettre morte résolue reste à
     * l'historique — elle ne disparaît jamais — mais elle ne bloque plus rien,
     * et la compter ferait de la supervision une alerte permanente que tout le
     * monde apprendrait à ignorer.
     */
    parkedChanges: (e.deadLetters ?? []).filter((d) => (d.status ?? 'PARKED') === 'PARKED').length,
    lastParkedAt: (e.deadLetters ?? [])
      .filter((d) => (d.status ?? 'PARKED') === 'PARKED').at(-1)?.parkedAt ?? null,
    /**
     * CE QUI RETIENT LE CURSEUR — le champ qui empêche « synchronisé » de mentir.
     *
     * Un curseur figé se lit de deux façons : « rien de neuf » ou « je suis
     * bloqué ». Le Panel ne pouvait pas les distinguer ; il le peut désormais,
     * et il affiche « mise à niveau requise » au lieu d'un vert trompeur.
     */
    ...(etat?.blockedChange ? { blocked: etat.blockedChange } : {}),
    ...(state ? { state } : {}),
  };
}

/** Réinitialise le cache SEUL — tests : simule un redémarrage du process. */
export function resetConsumptionCacheForTests() {
  etat = null;
}

export default {
  RECENT_WRITE_IDS_MAX,
  configureConsumptionPersistence,
  hydrateConsumption,
  currentConsumption,
  currentCursor,
  recordCursor,
  recordApplied,
  alreadyApplied,
  recordPullFailure,
  recordUnreadableChange,
  resetCursor,
  clearConsumption,
  describeConsumption,
  consumptionIsAuthoritative,
  resetConsumptionCacheForTests,
};
