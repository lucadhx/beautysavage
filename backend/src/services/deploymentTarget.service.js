/**
 * Service de persistance des cibles de déploiement.
 *
 * Fine couche au-dessus du modèle DeploymentTarget : création (avec déduction
 * d'URL via le moteur), allocation de port, enregistrement de l'historique. Ne
 * contient AUCUNE logique de déploiement (celle-ci vit dans le moteur), ni de
 * logique HTTP.
 */
import { DeploymentTarget } from '../models/DeploymentTarget.model.js';
import { parseTargetUrl, wildcardBasesFromEnv } from '../deployment-engine/url.js';
// Le moteur expose la topologie par RÔLE ; « Manager » est le vocabulaire de CE
// projet pour son front sur sous-domaine (rôle `web-sub` de son profil).
import { derivePrimarySubHost, derivePrimarySubUrl } from '../deployment-engine/hostnames.js';
import { ApiError } from '../utils/ApiError.js';
import {
  DEPROVISIONABLE, LIFECYCLE, assertDeletable, lifecycleLabel, softDelete, statusOf,
} from './deployment/destinationLifecycle.service.js';
import {
  describeReservation, moveReservationToServer, reservePort, rollbackReservation,
} from './deployment/portRegistry.service.js';

/**
 * ── `allocatePort()` A DISPARU ──────────────────────────────────────────────
 *
 * Elle rendait « le plus haut port déjà attribué en base, plus un ». Cette
 * règle ne consulte qu'une seule source : les fiches connues. Elle ignore les
 * process encore en ligne dont la fiche a disparu, les sockets réellement
 * ouvertes, et les services système. Une fiche supprimée faisait redescendre
 * le maximum, et le port suivant était réattribué alors qu'un ancien service
 * le détenait toujours.
 *
 * L'autorité appartient désormais à `portRegistry.service.js`, qui croise la
 * base, PM2 et les sockets, et n'active une réservation qu'après preuve.
 */

/** Sérialise une cible pour l'API (aucun secret : il n'y en a pas dans ce modèle). */
export function serializeTarget(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    url: doc.url,
    host: doc.host,
    managerHost: derivePrimarySubHost(doc.host),
    managerUrl: derivePrimarySubUrl(doc.host),
    type: doc.type,
    environment: doc.environment,
    registrableDomain: doc.registrableDomain,
    subdomain: doc.subdomain,
    wildcardBase: doc.wildcardBase,
    sshHost: doc.sshHost,
    sshUser: doc.sshUser || 'root',
    backendPort: doc.backendPort,
    dbName: doc.dbName,
    remoteRoot: doc.remoteRoot,
    state: doc.state,

    /* — CYCLE DE VIE — ce que la destination occupe encore sur le serveur.
       Volontairement distinct de `state`, qui décrit le dernier déploiement :
       une destination peut avoir été « déployée » avec succès ET être vidée
       aujourd'hui. Confondre les deux laisserait croire qu'un site est en
       ligne alors qu'il n'y a plus rien. */
    lifecycleStatus: statusOf(doc),
    lifecycleLabel: lifecycleLabel(statusOf(doc)),
    quarantineEnabled: doc.quarantineEnabled === true,
    emptiedAt: doc.emptiedAt ?? null,
    deletedAt: doc.deletedAt ?? null,
    lastError: doc.lastError?.message ? doc.lastError : null,

    /* — CE QUE L'INTERFACE A LE DROIT DE PROPOSER —
       Les mêmes règles que le backend applique, rendues lisibles. L'écran ne
       les REDÉCIDE pas : il les affiche. Une seule source. */
    canDeploy: statusOf(doc) !== LIFECYCLE.DEPROVISIONING && statusOf(doc) !== LIFECYCLE.DELETED,
    /**
     * LA LISTE VIENT DU SERVICE — elle était recopiée ici, et elle a dérivé.
     *
     * Sans `RETIRED`, l'écran désactivait « Retirer » sur les destinations
     * REMPLACÉES : c'est-à-dire exactement celles qu'on veut nettoyer. Le
     * service, lui, les acceptait. Une ancienne destination servant encore un
     * domaine devenait donc impossible à retirer par l'interface.
     */
    canDeprovision: DEPROVISIONABLE.includes(statusOf(doc)) && doc.state !== 'DEPLOYING',
    canDelete: statusOf(doc) === LIFECYCLE.EMPTY && doc.state !== 'DEPLOYING',

    currentVersion: doc.currentVersion,
    /**
     * CETTE DESTINATION OCCUPE-T-ELLE ENCORE LE SERVEUR ?
     *
     * ── LE DÉFAUT QUE CE CHAMP FERME ──────────────────────────────────────
     * L'écran déduisait « rien de déployé » de `currentVersion === null` et
     * affichait « aucune version ». Or une destination reprise d'avant le
     * registre — ou déployée par un outil antérieur — n'a jamais eu de hash,
     * tout en servant réellement un domaine, avec son PM2, son Nginx et ses
     * fichiers. L'écran annonçait un serveur vide devant un serveur plein.
     *
     * `currentVersion` décrit une VERSION APPLICATIVE CONNUE. Elle ne prouve
     * ni la présence ni l'absence d'un déploiement physique. Seule
     * l'inspection le prouve ; en attendant, le cycle de vie dit ce qu'on sait.
     */
    occupiesServer: statusOf(doc) !== LIFECYCLE.EMPTY && statusOf(doc) !== LIFECYCLE.DELETED,
    /** Déployée sans version connue : le hash manque, pas le déploiement. */
    versionUnknown: !doc.currentVersion
      && statusOf(doc) !== LIFECYCLE.EMPTY
      && statusOf(doc) !== LIFECYCLE.DELETED,
    lastDeployedAt: doc.lastDeployedAt,
    history: (doc.history || []).map((h) => ({
      id: String(h._id),
      at: h.at,
      operationType: h.operationType ?? 'DEPLOYMENT',
      version: h.version,
      user: h.user,
      durationMs: h.durationMs,
      success: h.success,
      failedStep: h.failedStep,
      error: h.error,
      steps: h.steps,
    })),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Liste les destinations VIVANTES (les plus récemment déployées en tête).
 *
 * Une fiche supprimée conserve son document — c'est ce qui rend son audit
 * relisible — mais n'a plus à figurer dans les listes de travail.
 */
export async function listTargets({ includeDeleted = false } = {}) {
  const query = includeDeleted ? {} : { lifecycleStatus: { $ne: LIFECYCLE.DELETED } };
  const docs = await DeploymentTarget.find(query).sort({ lastDeployedAt: -1, createdAt: -1 });
  return docs.map(serializeTarget);
}

export async function getTargetOr404(id) {
  const doc = await DeploymentTarget.findById(id);
  if (!doc) throw ApiError.notFound('Cible de déploiement introuvable.');
  return doc;
}

/**
 * Crée une destination depuis un nom, une URL COMPLÈTE et un ENVIRONNEMENT.
 *
 * ── DEUX RÈGLES QUE LA BASE GARANTIT, PAS CE SERVICE ────────────────────────
 * L'unicité de l'hôte parmi les destinations vivantes, et l'unicité de la
 * destination ACTIVE par environnement, sont des index uniques partiels. Les
 * contrôles ci-dessous ne servent qu'à formuler un refus lisible : deux
 * requêtes simultanées passeraient toutes deux une simple lecture, l'index
 * non.
 *
 * ── L'ENVIRONNEMENT EST PORTÉ PAR LA DESTINATION ────────────────────────────
 * Il était choisi au moment de déployer, avec PROD par défaut. La même
 * destination pouvait donc basculer d'un monde à l'autre entre deux mises en
 * ligne — deux bases, deux jeux de médias, un seul domaine.
 */
export async function createTarget({
  name, url, environment, dbName, remoteRoot, sshHost, sshUser,
}) {
  const env = String(environment ?? '').trim().toUpperCase();
  if (env !== 'TEST' && env !== 'PROD') {
    throw ApiError.badRequest(
      'Environnement requis : TEST ou PROD. Il appartient à la destination, '
      + 'pas au geste de déploiement — une même adresse ne peut pas servir les deux.',
    );
  }

  const parsed = parseTargetUrl(url, { wildcardBases: wildcardBasesFromEnv() });
  const existing = await DeploymentTarget.findOne({
    host: parsed.host,
    lifecycleStatus: { $in: ['ACTIVE', 'DEPROVISIONING', 'EMPTY', 'DEPROVISION_FAILED'] },
  });
  if (existing) throw ApiError.conflict(`Une destination existe déjà pour ${parsed.host}.`);

  const dejaActive = await DeploymentTarget.findOne({
    environment: env, lifecycleStatus: LIFECYCLE.ACTIVE,
  });
  if (dejaActive) {
    throw ApiError.conflict(
      `Une destination ${env} est déjà active : « ${dejaActive.name} » (${dejaActive.host}). `
      + 'Un projet a une destination active par environnement, et une seule — sans quoi la '
      + 'résolution des adresses et la publication des médias deviennent arbitraires. '
      + 'Retirez la destination existante avant d’en déclarer une nouvelle.',
      { host: dejaActive.host, environment: env },
    );
  }

  // Le port est RÉSERVÉ avant la création : une fiche sans port est
  // inexploitable, et un port réservé pour une fiche qui n'existe pas est
  // rendu par le rollback ci-dessous.
  const doc = new DeploymentTarget({
    name,
    url: parsed.canonicalUrl,
    host: parsed.host,
    type: parsed.type,
    environment: env,
    registrableDomain: parsed.registrableDomain,
    subdomain: parsed.subdomain,
    wildcardBase: parsed.wildcardBase,
    sshHost: sshHost ? sshHost.trim() : null,
    sshUser: sshUser && sshUser.trim() ? sshUser.trim() : 'root',
    backendPort: 0,
    dbName: dbName || null,
    remoteRoot: remoteRoot || '/var/www',
    state: 'NEW',
    lifecycleStatus: LIFECYCLE.ACTIVE,
  });

  const reservation = await reservePort({ target: doc });
  doc.backendPort = reservation.port;
  try {
    await doc.save();
  } catch (err) {
    // La fiche n'existera pas : son port ne doit pas rester retenu, sinon la
    // plage se viderait à chaque tentative ratée.
    await rollbackReservation(String(doc._id), { reason: 'création de destination refusée' });
    if (err?.code === 11000) {
      throw ApiError.conflict(
        `Une destination occupe déjà ${parsed.host} ou l’environnement ${env}.`,
      );
    }
    throw err;
  }
  return serializeTarget(doc);
}

/**
 * SUPPRESSION D'UNE FICHE — jamais d'une destination en place.
 *
 * ── LE DÉFAUT CORRIGÉ ───────────────────────────────────────────────────────
 * `doc.deleteOne()` détruisait la fiche sans rien retirer du serveur : process
 * PM2 en ligne détenant le port, configuration Nginx active, fichiers. Plus
 * aucune fiche ne disait qu'il restait à nettoyer, et l'allocation de port
 * recyclait un numéro encore détenu.
 *
 * On vide d'abord (`deprovision`), on supprime ensuite. La suppression est
 * LOGIQUE : l'historique reste lisible.
 */
export async function deleteTarget(id, { actor = null } = {}) {
  const doc = await getTargetOr404(id);
  assertDeletable(doc);
  if (doc.quarantineEnabled === true) {
    /**
     * ── CE GARDE EST JUSTE ; C'EST L'ISSUE QUI MANQUAIT ────────────────────
     *
     * `softDelete` met `quarantineEnabled: false` en base. Supprimer la fiche
     * ici laisserait donc un 410 sur le serveur avec plus AUCUNE fiche pour le
     * dire — un domaine neutralisé que plus personne ne sait libérer.
     *
     * Mais le message renvoyait vers « Supprimer la destination avec une
     * session serveur ouverte », c'est-à-dire vers l'action qu'il refusait, et
     * rien n'appelait jamais `removeQuarantine`. L'opérateur était enfermé.
     *
     * Ce chemin existe maintenant : `POST /deployment/destination-delete/stream`
     * prouve que le serveur est vide, lève la quarantaine, re-prouve, puis
     * appelle cette fonction — quarantaine déjà retombée à `false`.
     */
    throw ApiError.conflict(
      `Le domaine « ${doc.host} » répond encore 410 sur le serveur. `
      + 'Cette suppression-ci ne touche pas au serveur : utilisez la suppression '
      + 'avec session serveur, qui lève la quarantaine avant de retirer la fiche.',
      { code: 'QUARANTINE_STILL_ENABLED', host: doc.host, requiresSsh: true, stream: '/deployment/destination-delete/stream' },
    );
  }
  const deleted = await softDelete(String(doc._id), { actor });
  return {
    deleted: true,
    id: String(doc._id),
    lifecycleStatus: deleted.lifecycleStatus,
    deletedAt: deleted.deletedAt,
  };
}

/**
 * Marque une destination « en cours de déploiement », et pose le VERROU.
 *
 * Le verrou (`activeDeploymentRunId`) est ce que lit `assertDeprovisionable` :
 * sans lui, un retrait pourrait couper le service au milieu d'une mise en
 * ligne, pendant que le déploiement continue d'écrire dans un dossier qu'on
 * est en train d'effacer.
 */
export async function markDeploying(id, runId = null) {
  const doc = await getTargetOr404(id);
  const { assertDeployable, lockForDeployment } = await import('./deployment/destinationLifecycle.service.js');
  assertDeployable(doc);
  doc.state = 'DEPLOYING';
  await doc.save();
  await lockForDeployment(String(doc._id), runId);
  return doc;
}

/** La réservation de port vivante d'une destination — lisible par l'écran. */
export async function portReservationOf(id) {
  const { reservationFor } = await import('./deployment/portRegistry.service.js');
  return describeReservation(await reservationFor(String(id)));
}

/**
 * Change de serveur : la réservation SUIT, sans changer de port.
 *
 * Changer de port casserait la configuration Nginx et le service PM2 déjà
 * posés. En revanche la réservation cesse d'être vérifiée — le nouveau serveur
 * n'a jamais été consulté.
 */
export async function moveTargetToServer(id, sshHost) {
  return moveReservationToServer(String(id), sshHost);
}

/**
 * Enregistre le résultat d'un déploiement (succès ou échec) dans l'historique
 * et met à jour l'état/version de la cible.
 * @param {string} id
 * @param {object} result Résultat de DeploymentEngine.deploy (+ user, durationMs).
 */
export async function recordDeployment(id, { pipeline, version, ok, user, durationMs, error }) {
  const doc = await getTargetOr404(id);
  const entry = {
    at: new Date(),
    operationType: 'DEPLOYMENT',
    version,
    user: user || null,
    durationMs: durationMs ?? pipeline?.durationMs ?? null,
    success: Boolean(ok),
    failedStep: pipeline?.failedStep || null,
    error: error || pipeline?.error?.message || null,
    steps: (pipeline?.steps || []).map((s) => ({
      step: s.step,
      label: s.label,
      status: s.status,
      durationMs: s.durationMs,
    })),
  };
  doc.pushHistory(entry);
  if (ok) {
    doc.state = 'DEPLOYED';
    doc.currentVersion = version;
    doc.lastDeployedAt = entry.at;
  } else {
    doc.state = 'FAILED';
  }
  await doc.save();

  /**
   * LE VERROU TOMBE ICI, et une destination VIDÉE redevient ACTIVE.
   *
   * C'est le seul chemin de retour depuis EMPTY, et il passe par une mise en
   * ligne réellement vérifiée — jamais par un changement d'état à la main.
   */
  const { releaseDeploymentLock } = await import('./deployment/destinationLifecycle.service.js');
  await releaseDeploymentLock(String(doc._id), { ok: Boolean(ok), runId: null });

  return serializeTarget(await getTargetOr404(id));
}

export default {
  listTargets,
  getTargetOr404,
  createTarget,
  deleteTarget,
  markDeploying,
  recordDeployment,
  serializeTarget,
  portReservationOf,
  moveTargetToServer,
};
