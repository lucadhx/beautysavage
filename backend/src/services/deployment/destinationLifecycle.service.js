// CYCLE DE VIE D'UNE DESTINATION — identique au Panel.
//
// ══ LA CAUSE TRAITÉE ════════════════════════════════════════════════════════
//
// Une fiche de destination n'EST pas la destination : elle la décrit. Tant que
// le serveur porte encore le service, le port, le routage et les fichiers, la
// destination existe — même si plus personne ne la voit dans l'interface.
//
// C'est exactement ce qui s'est produit en production : la fiche
// supprimée, sont restés un process PM2 en ligne détenant le port 5100, une
// configuration Nginx active et 49 Mo de fichiers. Le port ayant été recyclé
// pour la destination suivante, l'ancien backend le tenait et le nouveau
// bouclait sur EADDRINUSE — plus de 7 000 redémarrages — pendant que Nginx
// envoyait le nouveau domaine vers l'ANCIEN code.
//
// Ce module rend cette situation impossible : une destination ACTIVE ne peut
// plus être supprimée. Elle doit d'abord être VIDÉE, et l'état de ce vidage
// est écrit sur la fiche.
//
// ══ LES TRANSITIONS ═════════════════════════════════════════════════════════
//
//   ACTIVE ──────────► DEPROVISIONING ──────► EMPTY ──────► DELETED
//                            │                   ▲
//                            └► DEPROVISION_FAILED┘   (reprise : on relance)
//
// Toutes les écritures de transition sont des `findOneAndUpdate` CONDITIONNELS
// sur l'état de départ. Deux processus qui tentent la même transition ne
// peuvent donc pas réussir tous les deux : le second ne trouve plus de
// document correspondant à sa condition, et le sait.
import DeploymentTarget from '../../models/DeploymentTarget.model.js';
import { ApiError } from '../../utils/ApiError.js';
import logger from '../../utils/logger.js';

/** Horodatage ISO — les transitions n'écrivent que des valeurs comparables. */
const nowIso = () => new Date();

/** États du cycle de vie — jamais des chaînes libres dans le code appelant. */
export const LIFECYCLE = Object.freeze({
  ACTIVE: 'ACTIVE',
  RETIRED: 'RETIRED',
  DEPROVISIONING: 'DEPROVISIONING',
  EMPTY: 'EMPTY',
  DEPROVISION_FAILED: 'DEPROVISION_FAILED',
  DELETED: 'DELETED',
});

/**
 * ÉTATS DEPUIS LESQUELS UN RETRAIT PEUT (RE)DÉMARRER.
 *
 * ── POURQUOI CETTE LISTE EST EXPORTÉE ───────────────────────────────────────
 * Elle ne l'était pas, et la sérialisation des destinations en a recopié une
 * seconde version — sans `RETIRED`. Le service AUTORISAIT donc le retrait
 * d'une ancienne destination pendant que l'écran désactivait le bouton : la
 * seule voie pour nettoyer un serveur était fermée par un doublon de règle.
 *
 * Une règle, un propriétaire. Tout ce qui a besoin de la connaître l'importe.
 */
export const DEPROVISIONABLE = Object.freeze([
  LIFECYCLE.ACTIVE,
  // Une destination remplacée porte encore ses fichiers : c'est justement
  // celle qu'on retire.
  LIFECYCLE.RETIRED,
  LIFECYCLE.DEPROVISION_FAILED,
  // Reprise après interruption : un retrait dont le worker est mort a laissé
  // la fiche en DEPROVISIONING. Le relancer est le comportement voulu — les
  // étapes déjà accomplies sont idempotentes.
  LIFECYCLE.DEPROVISIONING,
]);

/** Libellé humain d'un état — l'interface et les messages d'erreur le partagent. */
export function lifecycleLabel(status) {
  return {
    ACTIVE: 'active',
    RETIRED: 'remplacée — encore présente sur le serveur',
    DEPROVISIONING: 'en cours de retrait',
    EMPTY: 'vidée',
    DEPROVISION_FAILED: 'retrait en échec',
    DELETED: 'supprimée',
  }[status] ?? String(status ?? 'inconnu');
}

/** Statut de cycle de vie d'une fiche, avec le repli des fiches antérieures. */
export function statusOf(target) {
  return target?.lifecycleStatus ?? LIFECYCLE.ACTIVE;
}

/* -------------------------------------------------------------------------- */
/*  GARDES                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Un déploiement peut-il démarrer sur cette destination ?
 *
 * Déployer pendant un retrait produirait un état que personne ne sait décrire :
 * des fichiers réécrits sous un dossier en cours de suppression, un service
 * relancé sur un port qu'on vient de libérer. On refuse, en nommant l'état.
 */
export function assertDeployable(target) {
  const status = statusOf(target);
  if (status === LIFECYCLE.RETIRED) {
    throw ApiError.conflict(
      `Déploiement refusé parce que « ${target.name} » a été remplacée par une autre destination. `
      + 'Retirez-la du serveur pour la vider, ou déployez sur la destination active.');
  }
  if (status === LIFECYCLE.DEPROVISIONING) {
    throw ApiError.conflict(`Déploiement refusé parce que « ${target.name} » est en cours de retrait. `
      + 'Attendez la fin du retrait, ou reprenez-le s’il a été interrompu.');
  }
  if (status === LIFECYCLE.DELETED) {
    throw ApiError.conflict(`Déploiement refusé parce que la destination « ${target.name} » a été supprimée.`);
  }
  return true;
}

/**
 * Un retrait peut-il démarrer ?
 *
 * Refusé pendant un déploiement : le retrait couperait le service au milieu
 * d'une mise en ligne, et le déploiement continuerait d'écrire dans un dossier
 * qu'on est en train d'effacer.
 */
export function assertDeprovisionable(target, { activeRun = null } = {}) {
  const status = statusOf(target);
  if (status === LIFECYCLE.DELETED) {
    throw ApiError.conflict('Retrait refusé parce que cette destination a déjà été supprimée.');
  }
  if (status === LIFECYCLE.EMPTY) {
    /**
     * ── CE MESSAGE MENTAIT, ET IL A ENFERMÉ UN OPÉRATEUR ────────────────────
     *
     * Il disait « vous pouvez supprimer sa fiche ». La suppression répondait
     * alors « le domaine est encore neutralisé (410) : utilisez Supprimer la
     * destination avec une session serveur ouverte » — c'est-à-dire l'action
     * qu'elle refusait. Deux gardes se renvoyaient l'une à l'autre, et il n'y
     * avait aucune sortie.
     *
     * Le refus lui-même est JUSTE : le retrait a fait son travail, et la
     * quarantaine 410 est son état final voulu, pas un reliquat. Ce qui
     * manquait était le second geste, qui la lève. Le message le dit
     * maintenant, et l'écran l'offre.
     */
    throw ApiError.conflict(
      `Retrait déjà effectué : « ${target.name} » est vidée.`
      + (target.quarantineEnabled === true
        ? ` Son domaine répond 410 — c’est voulu tant que la fiche existe. `
          + `« Supprimer la destination » lèvera cette quarantaine et retirera la fiche.`
        : ' Vous pouvez supprimer sa fiche.'),
      { lifecycleStatus: status, quarantineEnabled: target.quarantineEnabled === true, nextAction: 'DESTINATION_DELETE' },
    );
  }
  if (!DEPROVISIONABLE.includes(status)) {
    throw ApiError.conflict(`Retrait refusé : la destination est ${lifecycleLabel(status)}.`);
  }
  if (activeRun && activeRun.operationType !== 'DEPROVISION') {
    throw ApiError.conflict(`Retrait refusé parce qu’une opération est en cours sur « ${target.name} » `
      + `(${activeRun.operationType}).`, { runId: activeRun.runId });
  }
  if (target.state === 'DEPLOYING') {
    throw ApiError.conflict('Retrait refusé parce qu’un déploiement est en cours sur cette destination.');
  }
  return true;
}

/**
 * UNE OPÉRATION SUR A NE DOIT JAMAIS POUVOIR TOUCHER B.
 *
 * ══ POURQUOI CET INVARIANT EXISTE ═══════════════════════════════════════════
 *
 * Le moteur dérive TOUT de l'hôte : le nom du process PM2, le chemin Nginx, le
 * chemin de quarantaine, le dossier du site. Deux destinations d'hôtes
 * différents ne peuvent donc pas se marcher dessus — par construction, et
 * `assertSafeSiteRoot` le vérifie une seconde fois sur le chemin.
 *
 * Le PORT, lui, ne se dérive pas : il est DÉCLARÉ dans la fiche. Un numéro
 * recyclé, une fiche importée, une saisie manuelle, et le retrait de A
 * relâcherait le port de B — puis, au déploiement suivant, deux services se
 * disputeraient la même socket. C'est exactement l'incident d'origine, dans
 * l'autre sens.
 *
 * On refuse donc AVANT d'agir, plutôt que de constater après. Le contrôle est
 * gratuit ; la panne qu'il évite ne l'est pas.
 *
 * @param {object} target   la destination visée
 * @param {object[]} autres les autres fiches du parc (projections `serializeTarget`)
 */
export function assertOperationIsolated(target, autres = []) {
  const moi = String(target._id ?? target.id);
  const monHote = String(target.host ?? '').toLowerCase();
  const monPort = target.backendPort ?? null;

  const vivantes = autres.filter((t) => {
    const id = String(t.id ?? t._id);
    if (id === moi) return false;
    const statut = t.lifecycleStatus ?? LIFECYCLE.ACTIVE;
    return statut !== LIFECYCLE.DELETED;
  });

  const memeHote = vivantes.find((t) => String(t.host ?? '').toLowerCase() === monHote);
  if (memeHote) {
    throw ApiError.conflict(
      `Opération refusée : « ${memeHote.name} » déclare le même hôte « ${monHote} ». `
      + 'Deux fiches pour un seul domaine rendent toute opération ambiguë.',
      { code: 'DESTINATION_HOST_SHARED', conflictingId: String(memeHote.id ?? memeHote._id) },
    );
  }

  if (monPort) {
    const memePort = vivantes.find((t) => t.backendPort === monPort);
    if (memePort) {
      throw ApiError.conflict(
        `Opération refusée : le port ${monPort} est aussi déclaré par « ${memePort.name} » `
        + `(${memePort.host}). Libérer ce port couperait cette autre destination.`,
        { code: 'DESTINATION_PORT_SHARED', port: monPort, conflictingId: String(memePort.id ?? memePort._id) },
      );
    }
  }

  return true;
}

/**
 * La fiche peut-elle être supprimée ?
 *
 * C'est LA règle du lot : une destination qui n'est pas EMPTY ne se supprime
 * pas. Le message dit quoi faire — refuser sans indiquer la sortie ne serait
 * qu'un mur.
 */
export function assertDeletable(target) {
  const status = statusOf(target);
  if (status === LIFECYCLE.DELETED) {
    throw ApiError.conflict('Cette destination est déjà supprimée.');
  }
  if (status !== LIFECYCLE.EMPTY) {
    throw ApiError.conflict(`Suppression refusée parce que « ${target.name} » est ${lifecycleLabel(status)} : `
      + 'ses fichiers, son service et son routage sont peut-être encore sur le serveur. '
      + 'Utilisez « Retirer le déploiement » d’abord — la fiche ne pourra être supprimée '
      + 'qu’une fois la destination vidée.', { lifecycleStatus: status });
  }
  if (target.state === 'DEPLOYING') {
    throw ApiError.conflict('Suppression refusée parce qu’un déploiement est en cours sur cette destination.');
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/*  TRANSITIONS                                                               */
/* -------------------------------------------------------------------------- */

/**
 * ACTIVE | DEPROVISION_FAILED | DEPROVISIONING → DEPROVISIONING.
 *
 * Conditionnelle et atomique : c'est le VERROU. Deux retraits lancés en même
 * temps ne peuvent pas tous deux poser la marque ; celui qui la trouve déjà
 * posée par un AUTRE run est refusé.
 *
 * `deprovisionStartedAt` n'est écrit qu'à la première entrée dans l'état : une
 * reprise ne réécrit pas l'heure de départ, sinon la durée réelle du retrait
 * serait perdue.
 */
export async function beginDeprovision(targetId, { runId }) {
  const at = nowIso();
  const doc = await DeploymentTarget.findOneAndUpdate(
    {
      _id: targetId,
      lifecycleStatus: { $in: DEPROVISIONABLE },
      // Aucun déploiement en vol : le verrou du déploiement fait foi.
      $or: [{ activeDeploymentRunId: null }, { activeDeploymentRunId: { $exists: false } }],
      state: { $ne: 'DEPLOYING' },
    },
    {
      $set: {
        lifecycleStatus: LIFECYCLE.DEPROVISIONING,
        lastDeprovisionRunId: runId,
        deprovisionFailedAt: null,
        updatedAt: at,
      },
    },
    { new: true },
  );
  if (!doc) {
    throw ApiError.conflict('Retrait refusé : la destination est déjà verrouillée par une autre opération, '
      + 'ou son état ne permet pas de démarrer un retrait.');
  }
  if (!doc.deprovisionStartedAt) {
    await DeploymentTarget.updateOne({ _id: targetId }, { $set: { deprovisionStartedAt: at } });
    doc.deprovisionStartedAt = at;
  }
  return doc.toObject();
}

/** DEPROVISIONING → EMPTY. La destination ne porte plus rien sur le serveur. */
export async function markEmpty(targetId, { runId = null, quarantine = true } = {}) {
  const at = nowIso();
  const doc = await DeploymentTarget.findOneAndUpdate(
    { _id: targetId, lifecycleStatus: LIFECYCLE.DEPROVISIONING },
    {
      $set: {
        lifecycleStatus: LIFECYCLE.EMPTY,
        deprovisionCompletedAt: at,
        emptiedAt: at,
        deprovisionFailedAt: null,
        lastError: null,
        quarantineEnabled: quarantine === true,
        lastDeprovisionRunId: runId,
        // Le service n'est plus en ligne : l'état de déploiement doit le dire.
        state: 'NEW',
        currentVersion: null,
        currentSiteRoot: null,
        activeDeploymentRunId: null,
        updatedAt: at,
      },
    },
    { new: true },
  );
  return doc ? doc.toObject() : null;
}

/** DEPROVISIONING → DEPROVISION_FAILED. L'échec est conservé, pas effacé. */
export async function markDeprovisionFailed(targetId, { runId = null, error = null } = {}) {
  const at = nowIso();
  const doc = await DeploymentTarget.findOneAndUpdate(
    { _id: targetId, lifecycleStatus: LIFECYCLE.DEPROVISIONING },
    {
      $set: {
        lifecycleStatus: LIFECYCLE.DEPROVISION_FAILED,
        deprovisionFailedAt: at,
        lastDeprovisionRunId: runId,
        lastError: error
          ? { at, code: error.code ?? 'DEPROVISION_FAILED', message: error.message ?? null, step: error.step ?? null }
          : null,
        updatedAt: at,
      },
    },
    { new: true },
  );
  return doc ? doc.toObject() : null;
}

/** La quarantaine est posée (retrait) ou levée (suppression définitive). */
export async function setQuarantine(targetId, enabled) {
  await DeploymentTarget.updateOne(
    { _id: targetId },
    { $set: { quarantineEnabled: enabled === true, updatedAt: nowIso() } },
  );
}

/**
 * EMPTY → DELETED — suppression LOGIQUE.
 *
 * On ne détruit pas le document : l'historique des déploiements, les erreurs,
 * les dates et l'auteur restent lisibles. Une suppression physique effacerait
 * la seule trace de ce qui a été mis en ligne sur ce domaine — exactement ce
 * qui a rendu l'incident de production si difficile à reconstituer.
 *
 * `ProjectIdentity` n'est jamais touchée ici : elle appartient au PROJET, pas
 * à la destination, et d'autres destinations peuvent la partager.
 */
export async function softDelete(targetId, { actor = null } = {}) {
  const at = nowIso();
  const doc = await DeploymentTarget.findOneAndUpdate(
    { _id: targetId, lifecycleStatus: LIFECYCLE.EMPTY },
    {
      $set: {
        lifecycleStatus: LIFECYCLE.DELETED,
        deletedAt: at,
        quarantineEnabled: false,
        activeDeploymentRunId: null,
        updatedAt: at,
      },
      $push: {
        history: {
          $each: [{
            at,
            operationType: 'DESTINATION_DELETE',
            version: null,
            user: actor?.userEmail ?? actor?.userId ?? null,
            durationMs: null,
            success: true,
            failedStep: null,
            error: null,
            steps: [],
          }],
          $position: 0,
          $slice: 50,
        },
      },
    },
    { new: true },
  );
  if (!doc) {
    throw ApiError.conflict('Suppression refusée : la destination n’est plus dans l’état « vidée ».');
  }
  return doc.toObject();
}

/* -------------------------------------------------------------------------- */
/*  VERROU DE DÉPLOIEMENT                                                     */
/* -------------------------------------------------------------------------- */

/** Pose le verrou de déploiement — lu par `assertDeprovisionable`. */
export async function lockForDeployment(targetId, runId) {
  /**
   * ══ LE VERROU EST UNE ÉCRITURE CONDITIONNELLE, ET C'EST UNE CORRECTION ═════
   *
   * Il était posé par un `$set` inconditionnel : le second déploiement écrasait
   * simplement l'identifiant du premier et poursuivait. Deux pipelines
   * pouvaient donc basculer la même release, redémarrer le même service et se
   * vérifier mutuellement — la recette de bout en bout l'a établi en lançant
   * deux fois la même destination.
   *
   * Le retrait (`beginDeprovision`) prenait pourtant déjà la précaution
   * inverse : il REFUSE de démarrer si un déploiement est en vol. Les deux
   * opérations sont symétriques, et une seule des deux se protégeait.
   *
   * ── POURQUOI CONDITIONNELLE, ET NON « LIRE PUIS ÉCRIRE » ──────────────────
   *
   * Deux requêtes simultanées passeraient toutes deux la lecture et écriraient
   * toutes deux. Le filtre, lui, ne peut pas être contourné : un seul
   * `findOneAndUpdate` trouve un document dont le verrou est libre.
   *
   * ── ET LE VERROU RESTÉ D'UN PROCESS MORT ? ────────────────────────────────
   *
   * Il est repris par le RUN qui le détient, pas par un délai : un déploiement
   * dont le run n'est plus `running` a laissé un verrou orphelin, que la
   * finalisation des runs abandonnés nettoie au démarrage. On accepte donc de
   * le reprendre ici — sinon un redémarrage du Panel condamnerait la
   * destination jusqu'à une intervention manuelle.
   */
  const { DeploymentRun } = await import('../../models/DeploymentRun.model.js');
  const doc = await DeploymentTarget.findOneAndUpdate(
    {
      _id: targetId,
      $or: [{ activeDeploymentRunId: null }, { activeDeploymentRunId: { $exists: false } }],
    },
    { $set: { activeDeploymentRunId: runId, updatedAt: nowIso() } },
    { new: true },
  );
  if (doc) return doc;

  const detenteur = await DeploymentTarget.findById(targetId).select('activeDeploymentRunId name').lean();
  const runEnCours = detenteur?.activeDeploymentRunId
    ? await DeploymentRun.findById(detenteur.activeDeploymentRunId).select('status').lean().catch(() => null)
    : null;
  if (runEnCours && runEnCours.status === 'running') {
    /**
     * ══ LE REFUS NOMME LE RUN QUI OCCUPE LA PLACE ═══════════════════════════
     *
     * Il ne portait qu'une phrase. Un écran qui la recevait ne pouvait donc
     * qu'afficher une erreur — alors que la conduite à tenir est l'inverse
     * d'une erreur : il y a un déploiement en cours, et l'utilisateur veut le
     * VOIR. Sans identifiant, impossible de lui proposer « suivre le
     * déploiement en cours » ; sans code stable, impossible de distinguer ce
     * conflit-là d'un conflit quelconque.
     *
     * Les deux sont donc joints. C'est ce qui permet à un second onglet, ou à
     * un double-clic, de RETOMBER sur le run existant au lieu d'échouer.
     */
    throw ApiError.conflict(
      `Déploiement refusé : « ${detenteur.name} » est déjà en cours de publication. `
      + 'Attendez la fin du déploiement en cours, ou consultez son rapport.',
      {
        code: 'DEPLOYMENT_ALREADY_RUNNING',
        runId: String(detenteur.activeDeploymentRunId),
        targetId: String(targetId),
      },
    );
  }
  // Verrou ORPHELIN : son run ne tourne plus. On le reprend, en le disant.
  return DeploymentTarget.findOneAndUpdate(
    { _id: targetId },
    { $set: { activeDeploymentRunId: runId, updatedAt: nowIso() } },
    { new: true },
  );
}

/**
 * Lève le verrou de déploiement, et remet la destination en ACTIVE quand la
 * mise en ligne a réussi.
 *
 * Redéployer une destination VIDÉE la rend active : c'est le seul chemin de
 * retour depuis EMPTY, et il passe par une mise en ligne réellement vérifiée —
 * jamais par un simple changement d'état à la main.
 */
export async function releaseDeploymentLock(targetId, { ok = false, runId = null, siteRoot = null } = {}) {
  const at = nowIso();
  const set = { activeDeploymentRunId: null, updatedAt: at };
  if (ok) {
    set.lifecycleStatus = LIFECYCLE.ACTIVE;
    set.quarantineEnabled = false;
    set.lastHealthyDeploymentRunId = runId;
    set.deprovisionFailedAt = null;
    set.lastError = null;
    if (siteRoot) set.currentSiteRoot = siteRoot;
  }
  await DeploymentTarget.updateOne(
    { _id: targetId, lifecycleStatus: { $ne: LIFECYCLE.DELETED } },
    { $set: set },
  );
}

/* -------------------------------------------------------------------------- */
/*  MIGRATION                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * CODES D'ARRÊT DE DÉMARRAGE — nommés, parce qu'un arrêt anonyme n'aide personne.
 */
export const MIGRATION_ERRORS = Object.freeze({
  ACTIVE_CONFLICT: 'DEPLOYMENT_ENVIRONMENT_ACTIVE_CONFLICT',
  ACTIVE_INDEX_MISSING: 'DEPLOYMENT_ACTIVE_INDEX_MISSING',
});

/** Le nom de l'index qui PORTE la garantie « une seule ACTIVE par environnement ». */
export const ACTIVE_INDEX_NAME = 'environnement_actif_unique';

/** Une erreur de démarrage : elle porte un code et la liste des fiches en cause. */
class MigrationBlockedError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MigrationBlockedError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Les environnements portant PLUSIEURS destinations ACTIVE.
 *
 * Lu AVANT toute tentative de construction d'index : c'est la seule façon de
 * dire QUELLES fiches posent problème. Une erreur d'index Mongo dit « E11000 »
 * et une clé ; elle ne dit pas quoi arbitrer.
 */
export async function activeConflicts() {
  const actives = await DeploymentTarget.find({ lifecycleStatus: LIFECYCLE.ACTIVE })
    .select('_id host environment backendPort state sshHost')
    .lean();
  const parEnv = new Map();
  for (const t of actives) {
    const cle = t.environment ?? 'SANS_ENVIRONNEMENT';
    if (!parEnv.has(cle)) parEnv.set(cle, []);
    parEnv.get(cle).push(t);
  }
  return [...parEnv.entries()]
    .filter(([, fiches]) => fiches.length > 1)
    .map(([environment, fiches]) => ({ environment, fiches }));
}

/**
 * REPRISE DES FICHES ANTÉRIEURES — appelée au démarrage du backend.
 *
 * ══ FAIL-CLOSED, ET POURQUOI ═══════════════════════════════════════════════
 *
 * Cette fonction avalait l'échec de construction d'index (`.catch(() => {})`).
 * Sur des données réelles portant deux destinations ACTIVE sans environnement,
 * le résultat mesuré était : les deux backfillées dans le même environnement,
 * l'index REFUSÉ, l'échec avalé, le démarrage annoncé sain — et la garantie
 * « une seule ACTIVE par environnement » ABSENTE sans que rien ne le dise.
 *
 * C'est le pire état possible : un système qui paraît conforme et ne l'est
 * pas. Exactement la panne que l'index était censé rendre impossible.
 *
 * Le démarrage S'ARRÊTE donc désormais, dans deux cas et avec deux codes :
 *
 *   · plusieurs ACTIVE pour un même environnement → on nomme les fiches, on
 *     n'en arbitre AUCUNE. Le choix appartient à l'exploitant, pas à une date ;
 *   · l'index n'existe pas après construction → on ne peut pas prouver la
 *     garantie, donc on ne la promet pas.
 *
 * L'ordre compte : on migre les champs, PUIS on détecte les conflits, PUIS on
 * construit, PUIS on RELIT les index de Mongo pour vérifier. Construire avant
 * de détecter ne dirait jamais quelles fiches sont en cause.
 *
 * AUCUNE fiche n'est supprimée, ni vidée, ni arbitrée.
 */
export async function migrateDeploymentTargets() {
  /* ── 1. MIGRER LES CHAMPS ─────────────────────────────────────────────── */

  // Toute destination sans cycle de vie devient ACTIVE : choix conservateur.
  // On ne sait pas ce qu'il y a sur le serveur, donc on suppose que tout y est.
  // Supposer l'inverse autoriserait la suppression d'une fiche dont le service
  // tourne encore.
  const result = await DeploymentTarget.updateMany(
    { $or: [{ lifecycleStatus: { $exists: false } }, { lifecycleStatus: null }] },
    { $set: { lifecycleStatus: LIFECYCLE.ACTIVE } },
  );

  /**
   * L'ENVIRONNEMENT DES FICHES ANTÉRIEURES.
   *
   * Il n'existait pas : il était choisi au déploiement, avec PROD par défaut.
   * On reprend donc ce défaut historique — c'est ce que ces destinations
   * FAISAIENT réellement, et supposer autre chose réécrirait le passé.
   *
   * Quand ce report produit un conflit, il n'est pas résolu ici : il est
   * SIGNALÉ, et le démarrage s'arrête.
   */
  const envResult = await DeploymentTarget.updateMany(
    { $or: [{ environment: { $exists: false } }, { environment: null }] },
    { $set: { environment: 'PROD' } },
  );

  /* ── 2. L'ANCIEN INDEX ABSOLU SUR L'HÔTE ──────────────────────────────── */

  // Il interdisait de recréer une destination sur un domaine libéré, puisqu'une
  // fiche supprimée conserve son hôte. L'index PARTIEL du modèle le remplace.
  let indexDropped = false;
  try {
    const indexes = await DeploymentTarget.collection.indexes();
    const legacy = indexes.find((i) =>
      i.unique === true
      && !i.partialFilterExpression
      && JSON.stringify(i.key) === JSON.stringify({ host: 1 }));
    if (legacy) {
      await DeploymentTarget.collection.dropIndex(legacy.name);
      indexDropped = true;
      logger.info(`Index unique historique « ${legacy.name} » retiré : l'unicité de l'hôte ne vaut plus que parmi les destinations vivantes.`);
    }
  } catch {
    // Collection absente ou index déjà retiré : le retrait de l'ancien index
    // est un confort. La garantie, elle, est vérifiée plus bas — et bloquante.
  }

  /* ── 3. DÉTECTER LES CONFLITS AVANT DE CONSTRUIRE ─────────────────────── */

  const conflits = await activeConflicts();
  if (conflits.length > 0) {
    const detail = conflits
      .map(({ environment, fiches }) =>
        `${environment} : ${fiches.map((f) => `${f.host} (port ${f.backendPort}, _id ${f._id})`).join(' ET ')}`)
      .join(' — ');
    logger.error(`[destinations] Démarrage REFUSÉ : plusieurs destinations ACTIVE pour un même environnement. ${detail}`);
    throw new MigrationBlockedError(
      MIGRATION_ERRORS.ACTIVE_CONFLICT,
      'Démarrage refusé : plusieurs destinations ACTIVE partagent un environnement. '
      + `${detail}. Une seule peut servir un environnement à la fois. Reclassez les autres `
      + '(RETIRED, ou retrait complet) avant de redémarrer — aucune n\'est arbitrée automatiquement.',
      { conflicts: conflits },
    );
  }

  /* ── 4. CONSTRUIRE, PUIS RELIRE POUR VÉRIFIER ─────────────────────────── */

  /**
   * ON CONSTRUIT EXPLICITEMENT, sans dépendre d'`autoIndex`.
   *
   * `init()` respecte le réglage global `autoIndex` : sur une installation qui
   * le désactive — pratique courante en production, pour éviter des
   * constructions d'index surprises au démarrage — l'index n'aurait jamais été
   * créé, et la garantie aurait manqué sans que rien ne le dise. Une invariante
   * ne doit pas dépendre d'un drapeau de confort.
   *
   * `createIndexes()` construit ce que le schéma déclare, quoi qu'il arrive.
   * Son échec n'est PLUS avalé : sans index, la garantie n'existe pas.
   */
  try {
    await DeploymentTarget.createIndexes();
  } catch (err) {
    logger.error(`[destinations] Construction de l'index « ${ACTIVE_INDEX_NAME} » impossible : ${err.message}`);
    throw new MigrationBlockedError(
      MIGRATION_ERRORS.ACTIVE_INDEX_MISSING,
      `Démarrage refusé : l'index « ${ACTIVE_INDEX_NAME} » n'a pas pu être construit (${err.message}). `
      + 'Sans lui, rien n\'empêche deux destinations d\'être actives dans le même environnement.',
      { cause: err.message },
    );
  }

  /**
   * ON RELIT MONGO. Un `init()` qui rend sans lever ne prouve pas qu'un index
   * existe — c'est précisément l'hypothèse qui a échoué en silence avec le
   * filtre partiel en `$ne`. On demande donc à la base ce qu'elle a vraiment.
   */
  const presents = await DeploymentTarget.collection.indexes();
  const garantie = presents.find((i) => i.name === ACTIVE_INDEX_NAME && i.unique === true);
  if (!garantie) {
    logger.error(`[destinations] L'index « ${ACTIVE_INDEX_NAME} » est ABSENT après construction.`);
    throw new MigrationBlockedError(
      MIGRATION_ERRORS.ACTIVE_INDEX_MISSING,
      `Démarrage refusé : l'index « ${ACTIVE_INDEX_NAME} » est absent après construction. `
      + 'La garantie « une seule destination active par environnement » ne peut pas être promise.',
      { indexes: presents.map((i) => i.name) },
    );
  }

  return {
    lifecycleBackfilled: result.modifiedCount ?? 0,
    environmentBackfilled: envResult.modifiedCount ?? 0,
    legacyHostIndexDropped: indexDropped,
    activeIndexVerified: true,
  };
}

export default {
  LIFECYCLE,
  MIGRATION_ERRORS,
  ACTIVE_INDEX_NAME,
  activeConflicts,
  lifecycleLabel,
  statusOf,
  assertDeployable,
  assertDeprovisionable,
  assertDeletable,
  assertOperationIsolated,
  beginDeprovision,
  markEmpty,
  markDeprovisionFailed,
  setQuarantine,
  softDelete,
  lockForDeployment,
  releaseDeploymentLock,
  migrateDeploymentTargets,
};
