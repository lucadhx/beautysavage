/**
 * Migration P2.4 — reconstruit le PLAN DE CONTRÔLE (DeploymentTarget +
 * DeploymentRelease) à partir des anciennes cibles/déploiements métier.
 *
 * Source : anciennes `deploymenttargets` (base métier, connexion par défaut).
 * Cible  : base du plan de contrôle (config.controlDbName).
 *
 * Idempotente (createOrResolve), rejouable, non destructive, journalisée, sans
 * secret. Si une ancienne cible ne permet pas une reconstruction fiable, elle est
 * signalée `CONTROL_PLANE_MIGRATION_INCOMPLETE` (jamais de fausse destination).
 *
 * Usage :
 *   node src/scripts/migrate-deployment-control-plane.js --env=PROD            # dry-run
 *   node src/scripts/migrate-deployment-control-plane.js --env=PROD --apply
 *   node src/scripts/migrate-deployment-control-plane.js --env=PROD --verify
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { deriveHostnames, urlsFromHostnames } from '../services/controlPlane/validators.js';
import { PROJECT_ID } from '../deployment-engine/config/project.profile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/** Infère l'environnement cible d'une ancienne cible (dbName → PROD/TEST, défaut PROD). */
export function inferTargetEnvironment(oldTarget) {
  const db = String(oldTarget?.dbName || '').toLowerCase();
  if (/_test$|test/.test(db)) return 'TEST';
  if (/_prod$|prod/.test(db)) return 'PROD';
  return 'PROD'; // défaut : un déploiement piloté vise PROD (cf. contrôleur)
}

/**
 * Transforme UNE ancienne cible en entrée de plan de contrôle, ou signale les
 * champs manquants. PURE (testable). @returns {{ok, input?, missing?}}
 */
export function reconstructTarget(oldTarget, { latestOkRun } = {}) {
  const host = oldTarget?.host;
  // Reconstruction fiable IMPOSSIBLE sans hôte : on signale, on n'invente rien.
  if (!host) return { ok: false, missing: ['host'], host: null };

  const hostnames = deriveHostnames({ siteHostname: host });
  const urls = urlsFromHostnames(hostnames);
  const targetEnvironment = inferTargetEnvironment(oldTarget);
  const input = {
    projectKey: PROJECT_ID,
    name: oldTarget.name || host,
    targetEnvironment,
    ...hostnames,
    ...urls,
    backendPort: oldTarget.backendPort || 5001,
    server: { host: oldTarget.sshHost || null, username: oldTarget.sshUser || 'root' },
    remoteRoot: oldTarget.remoteRoot || '/var/www',
    dbName: oldTarget.dbName || null,
  };

  // Une RELEASE ACTIVE n'est reconstruite que si un déploiement a RÉELLEMENT
  // réussi (sinon la destination existe mais sans version active — pas de fausse
  // release). La destination, elle, reste enregistrée (visible dans le Manager).
  const deployedOnce = oldTarget?.state === 'DEPLOYED' || (oldTarget?.history || []).some((h) => h.success);
  const release = deployedOnce
    ? {
        version: oldTarget.currentVersion || null,
        releaseKey: `legacy-${oldTarget.currentVersion || 'unknown'}`,
        remotePath: `${input.remoteRoot}/${host}`,
        runId: latestOkRun ? String(latestOkRun._id) : null,
        commitHash: oldTarget.currentVersion || null,
      }
    : null;
  return { ok: true, input, release, deployedOnce, initialStatus: deployedOnce ? 'HEALTHY' : 'READY', deployedAt: oldTarget.lastDeployedAt || null };
}

/* --------------------------------- Runner --------------------------------- */

async function run() {
  const args = process.argv.slice(2);
  const has = (f) => args.includes(f);
  const val = (f) => { const a = args.find((x) => x.startsWith(`${f}=`)); return a ? a.split('=')[1] : null; };
  const apply = has('--apply');
  const verify = has('--verify');
  const envArg = (val('--env') || '').toUpperCase();
  const mongoUri = process.env.MONGODB_URI;
  const sourceDb = val('--source-db') || (envArg === 'TEST' ? process.env.DB_TEST : process.env.DB_PROD);
  const { config } = await import('../config/env.js').catch(() => ({ config: null }));
  const controlDb = val('--control-db') || process.env.CONTROL_DB_NAME || (config?.controlDbName);

  if (!mongoUri || !sourceDb || !controlDb) { console.error('MONGODB_URI / base source / base contrôle manquants (voir --env, --source-db, --control-db).'); process.exit(1); }

  const mongoose = (await import('mongoose')).default;
  const source = mongoose.createConnection(mongoUri, { dbName: sourceDb });
  const control = mongoose.createConnection(mongoUri, { dbName: controlDb });
  await Promise.all([source.asPromise(), control.asPromise()]);
  const mode = apply ? 'APPLY' : verify ? 'VERIFY' : 'DRY-RUN';
  console.log(`\n=== Migration plan de contrôle — source ${sourceDb} → contrôle ${controlDb} — ${mode} ===\n`);

  const targetSvc = await import('../services/controlPlane/target.service.js');
  const releaseSvc = await import('../services/controlPlane/release.service.js');

  let created = 0, resolved = 0, incomplete = 0, releasesCreated = 0;
  try {
    const oldTargets = await source.collection('deploymenttargets').find({}).toArray();
    for (const ot of oldTargets) {
      const latestOkRun = await source.collection('deploymentruns').find({ target: ot._id, status: 'ok' }).sort({ createdAt: -1 }).limit(1).next().catch(() => null);
      const rec = reconstructTarget(ot, { latestOkRun });
      if (!rec.ok) {
        incomplete += 1;
        console.log(`  ⚠ CONTROL_PLANE_MIGRATION_INCOMPLETE ${ot.host || ot._id} — champs manquants : ${rec.missing.join(', ')}`);
        continue;
      }
      console.log(`  • ${rec.input.siteHostname} (${rec.input.targetEnvironment}) → api=${rec.input.apiHostname} port=${rec.input.backendPort} · statut=${rec.initialStatus}${rec.release?.version ? ` v=${rec.release.version}` : ' (aucune release réussie)'}`);
      if (!apply) continue;
      const res = await targetSvc.createOrResolveTarget(rec.input, { conn: control });
      res.created ? (created += 1) : (resolved += 1);
      if (!rec.release) {
        // Destination enregistrée mais sans version active (jamais déployée avec succès).
        await targetSvc.recordHealth(res.target.id, { healthStatus: 'UNKNOWN', conn: control });
        continue;
      }
      // Release ACTIVE reconstruite (idempotent : on n'écrase pas une active existante).
      try {
        const existingActive = await releaseSvc.getActiveRelease(res.target.id, { conn: control });
        if (!existingActive) {
          const rel = await releaseSvc.createRelease({ targetId: res.target.id, releaseKey: rec.release.releaseKey, version: rec.release.version, commitHash: rec.release.commitHash, remotePath: rec.release.remotePath, remoteRoot: rec.input.remoteRoot, deploymentRunId: rec.release.runId, conn: control });
          await releaseSvc.markReleaseInstalled(rel.id, { conn: control });
          await releaseSvc.activateRelease(rel.id, { conn: control });
          await targetSvc.markTargetHealthy(res.target.id, { version: rec.release.version, commit: rec.release.commitHash, releaseId: rel.id, runId: rec.release.runId, symlinkPath: rec.release.remotePath, conn: control });
          releasesCreated += 1;
        }
      } catch (e) { console.log(`    (release non reconstruite pour ${rec.input.siteHostname} : ${e.code || e.message})`); }
    }

    if (verify) {
      const all = await targetSvc.listTargets({ conn: control });
      console.log(`\nVERIFY : ${all.length} destination(s) dans le plan de contrôle.`);
    }
  } finally {
    await Promise.all([source.close().catch(() => {}), control.close().catch(() => {})]);
  }

  console.log(`\nRésumé : ${created} créée(s), ${resolved} résolue(s), ${releasesCreated} release(s), ${incomplete} incomplète(s).`);
  if (!apply && !verify) console.log('(dry-run — relancez avec --apply pour écrire.)');
}

if (process.argv[1] && process.argv[1].endsWith('migrate-deployment-control-plane.js')) {
  run().catch((err) => { console.error('MIGRATION PLAN DE CONTRÔLE ÉCHOUÉE:', err.message); process.exit(1); });
}
