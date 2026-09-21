/**
 * Service DeploymentTarget (plan de contrôle P2.8).
 *
 * Toute la logique de persistance/validation des destinations. AUCUN secret ;
 * INDÉPENDANT de process.env.ENV (les modèles vivent sur la connexion du plan de
 * contrôle). La connexion est injectable (tests avec mongodb-memory-server).
 */
import { getControlConnection } from '../../config/controlDb.js';
import { getDeploymentTargetModel } from '../../models/controlPlane/deploymentTarget.model.js';
import { getDeploymentReleaseModel } from '../../models/controlPlane/deploymentRelease.model.js';
import { validateTargetInput } from './validators.js';
import { cpError } from './errors.js';

/** Modèles du plan de contrôle (connexion injectable pour les tests). */
export async function getControlModels(conn) {
  const c = conn || (await getControlConnection());
  return { conn: c, Target: getDeploymentTargetModel(c), Release: getDeploymentReleaseModel(c) };
}

/** Allocation de port : max des ports existants (destinations vivantes) + 1. */
async function allocatePort(Target) {
  const max = await Target.findOne({ deletedAt: null }).sort({ backendPort: -1 }).select('backendPort').lean();
  return max ? max.backendPort + 1 : 5001;
}

/** Sérialisation SÛRE (aucun secret ; server.username exposé mais jamais de mot de passe). */
export function serializeTarget(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    projectKey: doc.projectKey,
    name: doc.name,
    targetEnvironment: doc.targetEnvironment,
    siteHostname: doc.siteHostname,
    managerHostname: doc.managerHostname,
    apiHostname: doc.apiHostname,
    siteUrl: doc.siteUrl,
    managerUrl: doc.managerUrl,
    apiUrl: doc.apiUrl,
    backendPort: doc.backendPort,
    server: { host: doc.server?.host || null, port: doc.server?.port || 22, username: doc.server?.username || 'root' },
    dnsProvider: doc.dnsProvider,
    dnsZone: doc.dnsZone,
    remoteRoot: doc.remoteRoot,
    currentSymlinkPath: doc.currentSymlinkPath,
    currentReleaseId: doc.currentReleaseId ? String(doc.currentReleaseId) : null,
    previousReleaseId: doc.previousReleaseId ? String(doc.previousReleaseId) : null,
    lastDeploymentRunId: doc.lastDeploymentRunId || null,
    dbName: doc.dbName,
    status: doc.status,
    healthStatus: doc.healthStatus,
    currentVersion: doc.currentVersion,
    currentCommit: doc.currentCommit,
    lastSuccessfulDeploymentAt: doc.lastSuccessfulDeploymentAt,
    lastHealthcheckAt: doc.lastHealthcheckAt,
    disabledAt: doc.disabledAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Crée OU résout une destination (idempotent sur projectKey+env+siteHostname).
 * Si elle existe (non supprimée), met à jour ses métadonnées non structurantes.
 */
export async function createOrResolveTarget(input, { conn } = {}) {
  const norm = validateTargetInput(input);
  const { Target } = await getControlModels(conn);

  const key = { projectKey: norm.projectKey, targetEnvironment: norm.targetEnvironment, siteHostname: norm.siteHostname, deletedAt: null };
  const existing = await Target.findOne(key);
  if (existing) {
    // Conflit d'hostname manager/api avec une AUTRE destination.
    existing.name = norm.name;
    existing.managerHostname = norm.managerHostname;
    existing.apiHostname = norm.apiHostname;
    existing.siteUrl = norm.siteUrl; existing.managerUrl = norm.managerUrl; existing.apiUrl = norm.apiUrl;
    if (norm.server) existing.server = { ...existing.server?.toObject?.() , ...norm.server };
    existing.dnsProvider = norm.dnsProvider ?? existing.dnsProvider;
    existing.dnsZone = norm.dnsZone ?? existing.dnsZone;
    existing.dbName = norm.dbName ?? existing.dbName;
    await existing.save();
    return { target: serializeTarget(existing), created: false, _doc: existing };
  }

  const backendPort = input.backendPort || (await allocatePort(Target));
  try {
    const doc = await Target.create({ ...norm, backendPort, status: 'DRAFT', healthStatus: 'UNKNOWN' });
    return { target: serializeTarget(doc), created: true, _doc: doc };
  } catch (err) {
    if (err?.code === 11000) throw cpError('DEPLOYMENT_TARGET_CONFLICT', `Une destination existe déjà pour ${norm.siteHostname} (${norm.targetEnvironment}).`);
    throw cpError('DEPLOYMENT_TARGET_PERSIST_FAILED', `Enregistrement de la destination impossible : ${err.message}.`);
  }
}

export async function getTargetDoc(id, { conn } = {}) {
  const { Target } = await getControlModels(conn);
  const doc = await Target.findOne({ _id: id, deletedAt: null }).catch(() => null);
  if (!doc) throw cpError('DEPLOYMENT_TARGET_NOT_FOUND', 'Destination introuvable.');
  return doc;
}

export async function getTargetById(id, opts = {}) {
  return serializeTarget(await getTargetDoc(id, opts));
}

export async function listTargets({ conn, includeDeleted = false } = {}) {
  const { Target } = await getControlModels(conn);
  const filter = includeDeleted ? {} : { deletedAt: null };
  const docs = await Target.find(filter).sort({ lastSuccessfulDeploymentAt: -1, createdAt: -1 });
  return docs.map(serializeTarget);
}

/** Met à jour des métadonnées NON structurantes (name, server, dns). */
export async function updateTargetMetadata(id, patch = {}, { conn } = {}) {
  const doc = await getTargetDoc(id, { conn });
  const allowed = ['name', 'dnsProvider', 'dnsZone', 'remoteRoot'];
  for (const k of allowed) if (patch[k] !== undefined) doc[k] = patch[k];
  if (patch.server) doc.server = { ...(doc.server?.toObject?.() || {}), ...patch.server };
  await doc.save();
  return serializeTarget(doc);
}

async function setStatus(id, fields, { conn } = {}) {
  const doc = await getTargetDoc(id, { conn });
  Object.assign(doc, fields);
  await doc.save();
  return serializeTarget(doc);
}

export const markTargetDeploying = (id, o) => setStatus(id, { status: 'DEPLOYING' }, o);
export const markTargetUpdating = (id, o) => setStatus(id, { status: 'UPDATING' }, o);
export const markTargetFailed = (id, o) => setStatus(id, { status: 'FAILED', healthStatus: 'UNKNOWN' }, o);

export async function markTargetHealthy(id, { version, commit, runId, releaseId, previousReleaseId, symlinkPath, conn } = {}) {
  const doc = await getTargetDoc(id, { conn });
  doc.status = 'HEALTHY';
  doc.healthStatus = 'HEALTHY';
  if (version !== undefined) doc.currentVersion = version;
  if (commit !== undefined) doc.currentCommit = commit;
  if (runId !== undefined) doc.lastDeploymentRunId = runId;
  if (releaseId !== undefined) { doc.previousReleaseId = doc.currentReleaseId || previousReleaseId || null; doc.currentReleaseId = releaseId; }
  if (symlinkPath !== undefined) doc.currentSymlinkPath = symlinkPath;
  doc.lastSuccessfulDeploymentAt = new Date();
  await doc.save();
  return serializeTarget(doc);
}

export async function recordHealth(id, { healthStatus, conn } = {}) {
  return setStatus(id, { healthStatus: healthStatus || 'UNKNOWN', lastHealthcheckAt: new Date() }, { conn });
}

/** Soft-delete : la destination n'est plus utilisable par défaut mais l'historique reste. */
export async function softDeleteTarget(id, { conn } = {}) {
  const doc = await getTargetDoc(id, { conn });
  doc.deletedAt = new Date();
  doc.status = 'DISABLED';
  await doc.save();
  return { deleted: true };
}

export default {
  getControlModels, serializeTarget, createOrResolveTarget, getTargetDoc, getTargetById, listTargets,
  updateTargetMetadata, markTargetDeploying, markTargetUpdating, markTargetFailed, markTargetHealthy,
  recordHealth, softDeleteTarget,
};
