/**
 * Service DeploymentRelease (plan de contrôle P2.8).
 *
 * Une release immuable par version déployée. Invariant central : AU PLUS UNE
 * release ACTIVE par destination ; l'activation désactive l'ancienne et conserve
 * la référence précédente. Aucun secret. Connexion injectable (tests).
 */
import { getControlModels } from './target.service.js';
import { assertReleasePathUnder } from './validators.js';
import { cpError } from './errors.js';

export function serializeRelease(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    targetId: String(doc.targetId),
    releaseKey: doc.releaseKey,
    version: doc.version,
    commitHash: doc.commitHash,
    branch: doc.branch,
    artifactChecksum: doc.artifactChecksum,
    artifactSize: doc.artifactSize,
    remotePath: doc.remotePath,
    status: doc.status,
    deploymentRunId: doc.deploymentRunId,
    previousReleaseId: doc.previousReleaseId ? String(doc.previousReleaseId) : null,
    rollbackOfReleaseId: doc.rollbackOfReleaseId ? String(doc.rollbackOfReleaseId) : null,
    uploadedAt: doc.uploadedAt,
    installedAt: doc.installedAt,
    activatedAt: doc.activatedAt,
    deactivatedAt: doc.deactivatedAt,
    healthcheckResult: doc.healthcheckResult,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Crée une release en statut PREPARING. `remotePath` DOIT rester sous `remoteRoot`.
 * Les métadonnées de commit proviennent du build RÉEL (jamais inventées).
 */
export async function createRelease({ targetId, releaseKey, version = null, commitHash = null, branch = null, remotePath, remoteRoot = '/var/www', artifactChecksum = null, artifactSize = null, deploymentRunId = null, rollbackOfReleaseId = null, conn } = {}) {
  if (!targetId) throw cpError('DEPLOYMENT_RELEASE_INVALID', 'targetId requis.');
  if (!releaseKey) throw cpError('DEPLOYMENT_RELEASE_INVALID', 'releaseKey requis.');
  const safePath = assertReleasePathUnder(remotePath, remoteRoot);
  const { Release } = await getControlModels(conn);
  try {
    const doc = await Release.create({ targetId, releaseKey, version, commitHash, branch, remotePath: safePath, artifactChecksum, artifactSize, deploymentRunId, rollbackOfReleaseId, status: 'PREPARING' });
    return serializeRelease(doc);
  } catch (err) {
    if (err?.code === 11000) throw cpError('DEPLOYMENT_RELEASE_CREATE_FAILED', `Une release "${releaseKey}" existe déjà pour cette destination.`);
    throw cpError('DEPLOYMENT_RELEASE_CREATE_FAILED', `Création de release impossible : ${err.message}.`);
  }
}

async function getReleaseDoc(Release, id) {
  const doc = await Release.findById(id).catch(() => null);
  if (!doc) throw cpError('DEPLOYMENT_RELEASE_INVALID', 'Release introuvable.');
  return doc;
}

async function transition(id, fields, { conn } = {}) {
  const { Release } = await getControlModels(conn);
  const doc = await getReleaseDoc(Release, id);
  Object.assign(doc, fields);
  await doc.save();
  return serializeRelease(doc);
}

export const markReleaseUploaded = (id, o) => transition(id, { status: 'UPLOADED', uploadedAt: new Date() }, o);
export const markReleaseInstalled = (id, o) => transition(id, { status: 'INSTALLED', installedAt: new Date() }, o);
export const markReleaseFailed = (id, o) => transition(id, { status: 'FAILED' }, o);

/**
 * Active une release : l'ancienne ACTIVE passe INACTIVE, la nouvelle devient
 * ACTIVE, la précédente reste RÉFÉRENCÉE. Invariant « une seule active » garanti
 * par l'index partiel unique + désactivation préalable.
 */
export async function activateRelease(id, { conn } = {}) {
  const { Release } = await getControlModels(conn);
  const target = await getReleaseDoc(Release, id);
  if (target.status === 'ACTIVE') throw cpError('DEPLOYMENT_RELEASE_ALREADY_ACTIVE', 'Cette release est déjà active.');

  const current = await Release.findOne({ targetId: target.targetId, status: 'ACTIVE' });
  const previousReleaseId = current ? current._id : null;

  if (current) {
    current.status = 'INACTIVE';
    current.deactivatedAt = new Date();
    await current.save();
  }
  try {
    target.status = 'ACTIVE';
    target.activatedAt = new Date();
    target.previousReleaseId = previousReleaseId;
    await target.save();
  } catch (err) {
    // Compensation : on tente de restaurer l'ancienne active en cas d'échec.
    if (current) { current.status = 'ACTIVE'; current.deactivatedAt = null; await current.save().catch(() => {}); }
    throw cpError('DEPLOYMENT_RELEASE_ACTIVATION_FAILED', `Activation impossible : ${err.message}.`);
  }
  return { release: serializeRelease(target), previousReleaseId: previousReleaseId ? String(previousReleaseId) : null };
}

export async function getActiveRelease(targetId, { conn } = {}) {
  const { Release } = await getControlModels(conn);
  return serializeRelease(await Release.findOne({ targetId, status: 'ACTIVE' }));
}

export async function listReleasesForTarget(targetId, { conn, limit = 20 } = {}) {
  const { Release } = await getControlModels(conn);
  const docs = await Release.find({ targetId }).sort({ createdAt: -1 }).limit(limit);
  return docs.map(serializeRelease);
}

export default {
  serializeRelease, createRelease, markReleaseUploaded, markReleaseInstalled, markReleaseFailed,
  activateRelease, getActiveRelease, listReleasesForTarget,
};
