/*
 * Migration plan de contrôle (P2.4) — reconstruction PURE depuis une ancienne
 * cible métier. Aucune base requise.
 */
import { reconstructTarget, inferTargetEnvironment } from './migrate-deployment-control-plane.js';

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };

try {
  /* Environnement inféré */
  check('env inféré PROD depuis dbName prod', inferTargetEnvironment({ dbName: 'sbauto06_prod' }) === 'PROD');
  check('env inféré TEST depuis dbName test', inferTargetEnvironment({ dbName: 'sbauto06_test' }) === 'TEST');
  check('env défaut PROD si inconnu', inferTargetEnvironment({ dbName: null }) === 'PROD');

  /* Reconstruction complète */
  const ok = reconstructTarget({ host: 'demo-sbauto.lycarz.com', name: 'Démo', state: 'DEPLOYED', backendPort: 5001, sshHost: '195.35.0.211', dbName: 'sbauto06_prod', currentVersion: 'abc123', remoteRoot: '/var/www', lastDeployedAt: new Date() }, { latestOkRun: { _id: 'run1' } });
  check('reconstruit : ok', ok.ok === true);
  check('reconstruit : domaines site/manager/api', ok.input.siteHostname === 'demo-sbauto.lycarz.com' && ok.input.managerHostname === 'manager.demo-sbauto.lycarz.com' && ok.input.apiHostname === 'api.demo-sbauto.lycarz.com');
  check('reconstruit : urls https', ok.input.apiUrl === 'https://api.demo-sbauto.lycarz.com');
  check('reconstruit : env PROD, port, ssh host', ok.input.targetEnvironment === 'PROD' && ok.input.backendPort === 5001 && ok.input.server.host === '195.35.0.211');
  check('reconstruit : release liée au run', ok.release.runId === 'run1' && ok.release.remotePath === '/var/www/demo-sbauto.lycarz.com');
  check('reconstruit : AUCUN secret (pas de password/token)', !/password|token|secret/i.test(JSON.stringify(ok)));

  /* Données insuffisantes -> incomplet (pas de fausse destination) */
  const noHost = reconstructTarget({ name: 'x', state: 'DEPLOYED' });
  check('incomplet : host manquant signalé', noHost.ok === false && noHost.missing.includes('host'));

  /* Jamais déployé avec succès : destination enregistrée (READY) MAIS pas de release. */
  const neverDeployed = reconstructTarget({ host: 'x.com', name: 'x', state: 'FAILED', history: [], backendPort: 5002 });
  check('jamais réussi : target reconstruit mais release=null', neverDeployed.ok === true && neverDeployed.release === null && neverDeployed.initialStatus === 'READY');

  /* Succès via history même si state=FAILED : release reconstruite, statut HEALTHY. */
  const viaHistory = reconstructTarget({ host: 'y.com', name: 'y', state: 'FAILED', history: [{ success: true }], backendPort: 5002, currentVersion: 'v9' });
  check('réussi via history.success : release + HEALTHY', viaHistory.ok === true && viaHistory.release !== null && viaHistory.initialStatus === 'HEALTHY');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (err) {
  console.error('MIGRATION TEST CRASHED:', err);
  fail++;
} finally {
  process.exit(fail === 0 ? 0 : 1);
}
