/*
 * Plan de contrôle (P2) — DeploymentTarget + DeploymentRelease + validators.
 * Base réelle EN MÉMOIRE (mongodb-memory-server), connexion INJECTÉE. Indépendant
 * de process.env.ENV (on le force à TEST tout en créant des destinations PROD).
 */
process.env.ENV = process.env.ENV || 'TEST';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:1/x';
process.env.DB_TEST = process.env.DB_TEST || 'x_test';
process.env.DB_PROD = process.env.DB_PROD || 'x_prod';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'a'.repeat(40);
process.env.INTEGRATED_API_ENCRYPTION_KEY = process.env.INTEGRATED_API_ENCRYPTION_KEY || 'a'.repeat(64);

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as targets from '../services/controlPlane/target.service.js';
import * as releases from '../services/controlPlane/release.service.js';
import { validateTargetInput, deriveHostnames, isValidPublicHttpsUrl } from '../services/controlPlane/validators.js';

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const code = async (fn) => { try { await fn(); return null; } catch (e) { return e.code; } };

const baseInput = (over = {}) => ({ name: 'Démo', targetEnvironment: 'PROD', siteHostname: 'demo-sbauto.lycarz.com', backendPort: 5001, server: { host: '195.35.0.211' }, ...over });

async function main() {
  const mem = await MongoMemoryServer.create();
  const conn = mongoose.createConnection(mem.getUri(), { dbName: 'ctrl' });
  await conn.asPromise();
  const O = { conn };

  try {
    /* ---- Validators (purs) ---- */
    const d = deriveHostnames({ siteHostname: 'demo-sbauto.lycarz.com' });
    check('V. dérive manager./api.', d.managerHostname === 'manager.demo-sbauto.lycarz.com' && d.apiHostname === 'api.demo-sbauto.lycarz.com');
    check('V. hostname explicite prime', deriveHostnames({ siteHostname: 's.com', apiHostname: 'x.api.com' }).apiHostname === 'x.api.com');
    check('V. https public valide', isValidPublicHttpsUrl('https://demo.lycarz.com') && !isValidPublicHttpsUrl('http://demo.lycarz.com') && !isValidPublicHttpsUrl('https://localhost'));
    check('V. validateTargetInput refuse port invalide', (() => { try { validateTargetInput(baseInput({ backendPort: 0 })); return false; } catch { return true; } })());
    check('V. refuse hostname avec protocole', (() => { try { validateTargetInput(baseInput({ siteHostname: 'https://x.com' })); return false; } catch { return true; } })());

    /* ---- Target : création TEST + PROD (moteur en ENV=TEST) ---- */
    const rTest = await targets.createOrResolveTarget(baseInput({ targetEnvironment: 'TEST', name: 'Démo TEST', siteHostname: 'test-sbauto.lycarz.com' }), O);
    check('1. création TEST', rTest.created && rTest.target.targetEnvironment === 'TEST');
    const rProd = await targets.createOrResolveTarget(baseInput(), O);
    check('2. création PROD depuis moteur ENV=TEST', rProd.created && rProd.target.targetEnvironment === 'PROD' && process.env.ENV === 'TEST');
    check('2b. domaines dérivés + urls https', rProd.target.apiHostname === 'api.demo-sbauto.lycarz.com' && rProd.target.apiUrl === 'https://api.demo-sbauto.lycarz.com');

    /* ---- Visible indépendamment de l'ENV local ---- */
    const listAsTest = await targets.listTargets(O);
    process.env.ENV = 'PROD';
    const listAsProd = await targets.listTargets(O);
    process.env.ENV = 'TEST';
    check('3. destinations visibles quel que soit l\'ENV local', listAsTest.length === 2 && listAsProd.length === 2);

    /* ---- Idempotence + unicité + conflit ---- */
    const again = await targets.createOrResolveTarget(baseInput({ name: 'Démo renommée' }), O);
    check('4. idempotent : 2e create = created:false + maj nom', again.created === false && again.target.name === 'Démo renommée');
    check('4b. pas de doublon (toujours 2 destinations)', (await targets.listTargets(O)).length === 2);

    /* ---- Invariants URL/port ---- */
    check('5. URL HTTP refusée', (await code(() => targets.createOrResolveTarget(baseInput({ siteHostname: 'x.com', targetEnvironment: 'PROD', server: {}, name: 'z', backendPort: 5010, apiHostname: 'x.com', managerHostname: 'x.com' }), O))) === 'DEPLOYMENT_TARGET_INVALID');
    check('5b. localhost refusé', (await code(() => targets.createOrResolveTarget(baseInput({ siteHostname: 'localhost', name: 'l' }), O))) === 'DEPLOYMENT_TARGET_INVALID');
    check('5c. port invalide refusé', (await code(() => targets.createOrResolveTarget(baseInput({ siteHostname: 'p.lycarz.com', backendPort: 99999, name: 'p' }), O))) === 'DEPLOYMENT_TARGET_INVALID');

    /* ---- Statut vs santé (indépendants) ---- */
    await targets.markTargetDeploying(rProd.target.id, O);
    let t = await targets.getTargetById(rProd.target.id, O);
    check('6. status=DEPLOYING, health=UNKNOWN (indépendants)', t.status === 'DEPLOYING' && t.healthStatus === 'UNKNOWN');

    /* ---- Release : cycle complet ---- */
    const rel1 = await releases.createRelease({ targetId: rProd.target.id, releaseKey: 'r-1', version: 'v1', commitHash: 'abc123', remotePath: '/var/www/demo-sbauto.lycarz.com/releases/r-1', remoteRoot: '/var/www', artifactChecksum: 'sha1', ...O });
    check('7. release créée en PREPARING', rel1.status === 'PREPARING' && rel1.commitHash === 'abc123');
    await releases.markReleaseUploaded(rel1.id, O);
    await releases.markReleaseInstalled(rel1.id, O);
    const act1 = await releases.activateRelease(rel1.id, O);
    check('7b. activation OK, previous=null (1re)', act1.release.status === 'ACTIVE' && act1.previousReleaseId === null);
    await targets.markTargetHealthy(rProd.target.id, { version: 'v1', commit: 'abc123', releaseId: rel1.id, runId: 'run-1', ...O });
    t = await targets.getTargetById(rProd.target.id, O);
    check('7c. target HEALTHY + currentReleaseId + run relié', t.status === 'HEALTHY' && t.healthStatus === 'HEALTHY' && t.currentReleaseId === rel1.id && t.lastDeploymentRunId === 'run-1');

    /* ---- 2e release : activation désactive l'ancienne, conserve la précédente ---- */
    const rel2 = await releases.createRelease({ targetId: rProd.target.id, releaseKey: 'r-2', version: 'v2', remotePath: '/var/www/demo-sbauto.lycarz.com/releases/r-2', remoteRoot: '/var/www', ...O });
    const act2 = await releases.activateRelease(rel2.id, O);
    check('8. 2e activation : previous = release 1', act2.previousReleaseId === rel1.id);
    const active = await releases.getActiveRelease(rProd.target.id, O);
    check('8b. une SEULE release active (r-2)', active.id === rel2.id);
    const list = await releases.listReleasesForTarget(rProd.target.id, O);
    check('8c. r-1 désormais INACTIVE (précédente conservée)', list.find((r) => r.id === rel1.id)?.status === 'INACTIVE' && list.length === 2);
    check('8d. activer une release déjà active -> ALREADY_ACTIVE', (await code(() => releases.activateRelease(rel2.id, O))) === 'DEPLOYMENT_RELEASE_ALREADY_ACTIVE');

    /* ---- Chemin de release hors répertoire -> refusé ---- */
    check('9. remotePath hors remoteRoot -> PATH_INVALID', (await code(() => releases.createRelease({ targetId: rProd.target.id, releaseKey: 'r-x', remotePath: '/etc/passwd', remoteRoot: '/var/www', ...O }))) === 'DEPLOYMENT_RELEASE_PATH_INVALID');
    check('9b. traversée ".." -> PATH_INVALID', (await code(() => releases.createRelease({ targetId: rProd.target.id, releaseKey: 'r-y', remotePath: '/var/www/demo-sbauto.lycarz.com/../../etc', remoteRoot: '/var/www', ...O }))) === 'DEPLOYMENT_RELEASE_PATH_INVALID');

    /* ---- Échec de release ---- */
    const relF = await releases.createRelease({ targetId: rProd.target.id, releaseKey: 'r-fail', remotePath: '/var/www/demo-sbauto.lycarz.com/releases/r-fail', remoteRoot: '/var/www', ...O });
    await releases.markReleaseFailed(relF.id, O);
    check('10. release FAILED n\'affecte pas l\'active', (await releases.getActiveRelease(rProd.target.id, O)).id === rel2.id);

    /* ---- Soft-delete ---- */
    await targets.softDeleteTarget(rTest.target.id, O);
    check('11. soft-delete : exclu de la liste par défaut', (await targets.listTargets(O)).length === 1);
    check('11b. inclus si includeDeleted', (await targets.listTargets({ ...O, includeDeleted: true })).length === 2);
    check('11c. destination supprimée introuvable par défaut', (await code(() => targets.getTargetById(rTest.target.id, O))) === 'DEPLOYMENT_TARGET_NOT_FOUND');

    /* ---- Aucun secret dans la sérialisation ---- */
    const blob = JSON.stringify(await targets.getTargetById(rProd.target.id, O));
    check('12. sérialisation sans secret (pas de password/token/.env)', !/password|secret|token|privateKey|MONGODB_URI/i.test(blob));

    console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  } catch (err) {
    console.error('CONTROL PLANE TEST CRASHED:', err);
    fail++;
  } finally {
    await conn.close().catch(() => {});
    await mem.stop().catch(() => {});
    process.exit(fail === 0 ? 0 : 1);
  }
}

main();
