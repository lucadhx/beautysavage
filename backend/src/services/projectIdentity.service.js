/**
 * PARENTÉ DES DESTINATIONS — la seule autorité qui dit « c'est le même projet ».
 *
 * ── LA RÈGLE, ET RIEN D'AUTRE ───────────────────────────────────────────────
 * Deux destinations appartiennent au même projet UNIQUEMENT si quelqu'un l'a
 * déclaré. Ce module ne rapproche jamais deux cibles par leur base, leur
 * domaine, leur serveur, leur environnement ni leur nom : deux projets
 * distincts peuvent partager les cinq, et le jour où l'un d'eux serait rapproché
 * à tort, ce sont les médias d'un client qui atterriraient chez un autre.
 *
 * C'est ici, et seulement ici, que naît le droit de migrer des fichiers.
 */
import { ProjectIdentity } from '../models/ProjectIdentity.model.js';
import { DeploymentLocationHistory } from '../models/DeploymentLocationHistory.model.js';
import { DeploymentTarget } from '../models/DeploymentTarget.model.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Garantit qu'une destination porte une identité, en lui en donnant une PROPRE
 * si elle n'en a pas.
 *
 * Jamais de fusion : une destination sans identité devient son propre projet.
 * C'est le choix conservateur — il ne crée aucun droit de migration qui
 * n'existait pas. Rapprocher deux destinations reste un acte déclaré.
 */
export async function ensureOwnIdentity(target, { origin = 'MIGRATION', actor = null, reason = null } = {}) {
  if (target.projectIdentityId) {
    const existante = await ProjectIdentity.findOne({ identityId: target.projectIdentityId });
    if (existante) return existante;
    // L'identité référencée a disparu : on ne devine pas laquelle c'était, et
    // on n'en recrée surtout pas une — la destination perdrait sa parenté et
    // donc l'accès aux médias de ses emplacements antérieurs, en silence.
    throw ApiError.conflict(`Identité de projet introuvable pour la destination ${target.host}.`);
  }

  const identite = await ProjectIdentity.create({
    label: target.name || target.host,
    links: [{ deploymentTargetId: target._id, host: target.host, origin, actor, reason }],
  });
  target.projectIdentityId = identite.identityId;
  await target.save();
  return identite;
}

/**
 * Rattache une destination à une identité EXISTANTE — la déclaration de parenté.
 *
 * Refuse si la destination appartient déjà à un AUTRE projet : un changement de
 * parent réécrirait l'histoire et ouvrirait un droit de copie entre deux projets
 * qui n'en ont jamais partagé. Rejouable sans effet si le lien existe déjà.
 */
export async function attachTargetToIdentity(target, identityId, { origin = 'DECLARED', actor = null, reason = null } = {}) {
  const identite = await ProjectIdentity.findOne({ identityId });
  if (!identite) throw ApiError.notFound('Projet parent introuvable.');

  if (target.projectIdentityId && target.projectIdentityId !== identityId) {
    throw ApiError.conflict(
      `La destination ${target.host} appartient déjà à un autre projet. Un rattachement ne peut pas être réécrit automatiquement.`,
    );
  }

  if (target.projectIdentityId === identityId) {
    return { identity: identite, alreadyLinked: true };
  }

  target.projectIdentityId = identityId;
  await target.save();

  const dejaJournalise = (identite.links || []).some((l) => String(l.deploymentTargetId) === String(target._id));
  if (!dejaJournalise) {
    identite.links.push({ deploymentTargetId: target._id, host: target.host, origin, actor, reason });
    await identite.save();
  }
  return { identity: identite, alreadyLinked: false };
}

/**
 * Enregistre l'emplacement d'un déploiement en cours.
 * Idempotent sur le couple (destination, run) : un rejeu ne duplique rien.
 */
export async function recordLocation({
  projectIdentityId, deploymentTargetId, host, siteRoot, sharedUploadsPath,
  sharedStoragePath = null, sshHost = null, environment, deploymentRunId = null, commit = null,
}) {
  return DeploymentLocationHistory.findOneAndUpdate(
    { deploymentTargetId, deploymentRunId },
    {
      $set: {
        projectIdentityId, host, siteRoot, sharedUploadsPath, sharedStoragePath,
        sshHost, environment, commit, status: 'DEPLOYING',
      },
      $setOnInsert: { deployedAt: new Date() },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

/**
 * Promeut un emplacement en `HEALTHY` — après validation publique, jamais avant.
 *
 * Seul un emplacement sain sert de SOURCE à une migration future : un
 * déploiement qui a échoué avant l'upload n'a peut-être reçu aucun fichier, et
 * en faire une source reviendrait à migrer du vide en croyant migrer des médias.
 */
export async function markLocationHealthy(locationId, { deploymentRunId = null } = {}) {
  const doc = await DeploymentLocationHistory.findById(locationId);
  if (!doc) return null;
  doc.status = 'HEALTHY';
  if (deploymentRunId) doc.deploymentRunId = deploymentRunId;
  await doc.save();

  await DeploymentTarget.updateOne(
    { _id: doc.deploymentTargetId },
    { $set: { currentSiteRoot: doc.siteRoot, lastHealthyDeploymentRunId: doc.deploymentRunId || null } },
  );
  return doc;
}

export async function markLocationFailed(locationId) {
  if (!locationId) return null;
  return DeploymentLocationHistory.findByIdAndUpdate(locationId, { $set: { status: 'FAILED' } }, { new: true });
}

/**
 * Emplacements depuis lesquels une destination a le DROIT de récupérer des médias.
 *
 * Trois filtres, tous nécessaires :
 *   - même identité DÉCLARÉE (le droit lui-même) ;
 *   - `HEALTHY` (l'emplacement a réellement servi, ses fichiers sont crédibles) ;
 *   - un autre chemin que la destination (on ne se copie pas sur soi-même).
 *
 * Le tri du plus récent au plus ancien n'est pas cosmétique : en cas de doublon
 * de nom, c'est la version la plus récemment servie qui est retenue en premier.
 */
export async function resolveUploadsSources({ projectIdentityId, deploymentTargetId, sharedUploadsPath }) {
  if (!projectIdentityId) return { identityId: null, sources: [] };

  const emplacements = await DeploymentLocationHistory.find({
    projectIdentityId,
    status: 'HEALTHY',
  })
    .sort({ deployedAt: -1 })
    .lean();

  const vus = new Set();
  const sources = [];
  for (const e of emplacements) {
    if (String(e.deploymentTargetId) === String(deploymentTargetId)) continue;
    if (e.sharedUploadsPath === sharedUploadsPath) continue;
    if (vus.has(e.sharedUploadsPath)) continue;
    vus.add(e.sharedUploadsPath);
    sources.push({
      host: e.host,
      sharedUploadsPath: e.sharedUploadsPath,
      projectIdentityId: e.projectIdentityId,
      deployedAt: e.deployedAt,
    });
  }
  return { identityId: projectIdentityId, sources };
}

/** Liste les destinations d'un projet — l'écran « ce projet vit à ces adresses ». */
export async function listTargetsOfIdentity(identityId) {
  return DeploymentTarget.find({ projectIdentityId: identityId }).sort({ createdAt: 1 });
}

export default {
  ensureOwnIdentity,
  attachTargetToIdentity,
  recordLocation,
  markLocationHealthy,
  markLocationFailed,
  resolveUploadsSources,
  listTargetsOfIdentity,
};
