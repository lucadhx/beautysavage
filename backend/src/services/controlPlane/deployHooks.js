/**
 * Intégration du plan de contrôle dans le flux de déploiement (P2.7).
 *
 * Le contrôleur appelle `beginControlPlaneDeployment` AVANT le déploiement puis
 * `finalizeControlPlaneDeployment` APRÈS. La destination et la release sont
 * persistées dans le plan de contrôle (base dédiée, indépendante de l'ENV local).
 * Best-effort : une indisponibilité du plan de contrôle ne casse jamais un
 * déploiement (le contrôleur encapsule ces appels en try/catch).
 */
import { createOrResolveTarget, markTargetDeploying, markTargetHealthy, markTargetFailed } from './target.service.js';
import { PROJECT_ID } from '../../deployment-engine/config/project.profile.js';
import { createRelease, markReleaseInstalled, activateRelease, markReleaseFailed } from './release.service.js';

/** Résout/crée la destination + une release PREPARING, marque la cible DEPLOYING. */
export async function beginControlPlaneDeployment({ metierTarget, env, dbName, runId }) {
  const targetEnvironment = String(env || 'PROD').toUpperCase();
  const remoteRoot = metierTarget.remoteRoot || '/var/www';
  const { target } = await createOrResolveTarget({
    projectKey: PROJECT_ID,
    name: metierTarget.name,
    targetEnvironment,
    siteHostname: metierTarget.host,
    backendPort: metierTarget.backendPort,
    server: { host: metierTarget.sshHost || null, username: metierTarget.sshUser || 'root' },
    dbName: dbName || metierTarget.dbName || null,
  });
  await markTargetDeploying(target.id);
  const release = await createRelease({
    targetId: target.id,
    releaseKey: `rel-${runId}`,
    remotePath: `${remoteRoot}/${metierTarget.host}`,
    remoteRoot,
    deploymentRunId: runId,
  });
  return { targetId: target.id, releaseId: release.id, remoteRoot, host: metierTarget.host };
}

/** Active la release + marque HEALTHY en cas de succès ; sinon FAILED. */
export async function finalizeControlPlaneDeployment({ targetId, releaseId, remoteRoot, host, result, runId }) {
  if (!targetId) return null;
  if (result?.ok) {
    if (releaseId) {
      await markReleaseInstalled(releaseId).catch(() => {});
      await activateRelease(releaseId).catch(() => {});
    }
    const commit = result.structuredReport?.identification?.commit || result.version || null;
    return markTargetHealthy(targetId, { version: result.version, commit, releaseId, runId, symlinkPath: `${remoteRoot}/${host}` });
  }
  if (releaseId) await markReleaseFailed(releaseId).catch(() => {});
  return markTargetFailed(targetId).catch(() => null);
}

export default { beginControlPlaneDeployment, finalizeControlPlaneDeployment };
