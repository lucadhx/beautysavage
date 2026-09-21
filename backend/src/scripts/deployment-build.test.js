/*
 * Non-régression : construction LOCALE de l'artefact (artifact.build).
 *
 * Cause racine corrigée : `npm ci` en place supprimait node_modules et tentait
 * d'unlink un fichier verrouillé par le serveur Vite vivant (esbuild.exe →
 * EPERM Windows). Le build s'exécute désormais dans un STAGING isolé.
 *
 * Ces tests ne dépendent PAS du réseau : l'exécuteur de commandes est injecté
 * (npm/npm ci simulés). La copie de staging, elle, est réelle (fs).
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { buildArtifact } from '../deployment-engine/build.js';
import { DeploymentEngine } from '../deployment-engine/DeploymentEngine.js';
import { FakeTransport } from '../deployment-engine/transport/FakeTransport.js';
import { RunRecorder } from '../deployment-engine/report/RunRecorder.js';
import { createRedactor } from '../deployment-engine/report/sanitize.js';

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const exists = async (p) => { try { await fs.access(p); return true; } catch { return false; } };

/** Crée un faux monorepo (vitrine/manager/backend) avec sources + secrets. */
async function makeSource(base, { managerLock = true, vitrineLock = true } = {}) {
  const root = await fs.mkdtemp(path.join(base, 'src-'));
  for (const app of ['vitrine', 'manager', 'backend']) {
    const d = path.join(root, app);
    await fs.mkdir(path.join(d, 'src'), { recursive: true });
    await fs.writeFile(path.join(d, 'package.json'), JSON.stringify({ name: app, scripts: { build: 'vite build' } }));
    await fs.writeFile(path.join(d, 'src', 'main.ts'), `// ${app}`);
    // node_modules : DOIT être exclu de la copie de staging.
    await fs.mkdir(path.join(d, 'node_modules', '@esbuild'), { recursive: true });
    await fs.writeFile(path.join(d, 'node_modules', '@esbuild', 'esbuild.exe'), 'BINARY');
  }
  if (vitrineLock) await fs.writeFile(path.join(root, 'vitrine', 'package-lock.json'), '{}');
  if (managerLock) await fs.writeFile(path.join(root, 'manager', 'package-lock.json'), '{}');
  // Override DEV du frontend : VITE_API_URL local NE DOIT PAS être baked au déploiement.
  await fs.writeFile(path.join(root, 'manager', '.env.local'), 'VITE_API_URL=http://localhost:6070');
  await fs.writeFile(path.join(root, 'vitrine', '.env.local'), 'VITE_API_URL=http://localhost:6060');
  // Secrets backend : NE DOIVENT PAS être embarqués dans l'artefact.
  await fs.writeFile(path.join(root, 'backend', 'package-lock.json'), '{}');
  await fs.writeFile(path.join(root, 'backend', '.env'), 'MONGODB_URI=mongodb://u:p@h/db\nJWT_SECRET=shhh');
  await fs.mkdir(path.join(root, 'backend', 'uploads'), { recursive: true });
  await fs.writeFile(path.join(root, 'backend', 'uploads', 'x.bin'), 'x');
  return root;
}

/**
 * Exécuteur injecté. `plan` mappe `${app}:${ci|build}` -> comportement :
 *   { code, signal, stdout, stderr, throw } ; un build à code 0 crée dist/.
 */
function fakeExec(plan = {}) {
  const seen = [];
  const fn = async (cmd, args, { cwd }) => {
    const app = path.basename(cwd);
    const action = args[0] === 'ci' ? 'ci' : 'build';
    seen.push({ app, action, cmd, args, cwd });
    const r = plan[`${app}:${action}`] || { code: 0 };
    if (r.throw) throw r.throw;
    const code = 'code' in r ? r.code : 0; // préserve un code null explicite (signal)
    if (action === 'build' && code === 0) {
      await fs.mkdir(path.join(cwd, 'dist'), { recursive: true });
      await fs.writeFile(path.join(cwd, 'dist', 'index.html'), '<html></html>');
    }
    return { code, signal: r.signal ?? null, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  fn.seen = seen;
  return fn;
}

const TMP = path.join(os.tmpdir(), 'sbauto-build-tests');

async function main() {
  await fs.mkdir(TMP, { recursive: true });

  /* ---- 1. Installation + build réussis (chemin nominal) ---- */
  {
    const root = await makeSource(TMP);
    const phases = [];
    const art = await buildArtifact({ root, exec: fakeExec(), stagingBase: TMP, onPhase: (r) => phases.push(r) });
    check('1. build réussi : un dist par application du profil', await exists(art.dists.vitrine) && await exists(art.dists.manager));
    check('1b. backend inclus dans l\'artefact', await exists(path.join(art.backendDir, 'package.json')));
    check('1c. SECRET .env backend JAMAIS embarqué', !(await exists(path.join(art.backendDir, '.env'))));
    check('1d. node_modules JAMAIS copié dans le staging', !(await exists(path.join(art.backendDir, 'node_modules'))));
    check('1e. uploads/ runtime backend exclu', !(await exists(path.join(art.backendDir, 'uploads'))));
    check('1f. 4 phases journalisées (install/build × 2)', phases.length === 4 && phases.map((p) => p.phase).join(',') === 'install_site,build_site,install_manager,build_manager');
    await art.cleanup();
    check('1g. cleanup() supprime le staging', !(await exists(art.stagingRoot)));
  }

  /* ---- 1bis. Config front PRODUCTION : pas d'URL de dev baked ---- */
  {
    const root = await makeSource(TMP);
    const art = await buildArtifact({ root, exec: fakeExec(), stagingBase: TMP });
    const stManager = path.join(art.stagingRoot, 'manager');
    const stVitrine = path.join(art.stagingRoot, 'vitrine');
    check('1h. override DEV .env.local EXCLU du staging (manager)', !(await exists(path.join(stManager, '.env.local'))));
    check('1i. override DEV .env.local EXCLU du staging (vitrine)', !(await exists(path.join(stVitrine, '.env.local'))));
    const prodEnv = await fs.readFile(path.join(stManager, '.env.production.local'), 'utf8').catch(() => '');
    check('1j. .env.production.local force VITE_API_URL vide (relatif)', /^VITE_API_URL=\s*$/m.test(prodEnv));
    check('1k. .env.production.local écrit aussi côté vitrine', await exists(path.join(stVitrine, '.env.production.local')));
    check('1l. frontendEnv retourné (traçable dans le rapport)', art.frontendEnv?.VITE_API_URL === '');
    await art.cleanup();

    // Override explicite possible (ex. URL absolue si un jour nécessaire).
    const art2 = await buildArtifact({ root, exec: fakeExec(), stagingBase: TMP, frontendEnv: { VITE_API_URL: 'https://x.example.com' } });
    const prod2 = await fs.readFile(path.join(art2.stagingRoot, 'manager', '.env.production.local'), 'utf8').catch(() => '');
    check('1m. frontendEnv override respecté', prod2.includes('VITE_API_URL=https://x.example.com'));
    await art2.cleanup();
  }

  /* ---- 2. Install Manager échoue (code non nul) ---- */
  {
    const root = await makeSource(TMP);
    let e = null;
    try {
      await buildArtifact({ root, stagingBase: TMP, exec: fakeExec({ 'manager:ci': { code: 1, stderr: 'npm error code EPERM\nunlink esbuild.exe' } }) });
    } catch (err) { e = err; }
    check('2. échec install Manager → DeploymentError', e && e.name === 'DeploymentError');
    check('6a. code spécialisé ARTIFACT_INSTALL_MANAGER_FAILED', e?.code === 'ARTIFACT_INSTALL_MANAGER_FAILED');
    check('3. stderr conservé dans details.stderrExcerpt', /EPERM/.test(e?.details?.stderrExcerpt || ''));
    check('5. commande + cwd présents dans details', e?.details?.command === 'npm ci' && /manager$/.test(e?.details?.cwd || ''));
  }

  /* ---- 3+4. stdout & stderr conservés dans le record de phase ---- */
  {
    const root = await makeSource(TMP);
    const phases = [];
    let e = null;
    try {
      await buildArtifact({ root, stagingBase: TMP, onPhase: (r) => phases.push(r), exec: fakeExec({ 'manager:ci': { code: 1, stdout: 'resolving deps', stderr: 'EPERM boom' } }) });
    } catch (err) { e = err; }
    const rec = phases.find((p) => p.phase === 'install_manager');
    check('4. stdout conservé dans le record de phase', rec?.stdout === 'resolving deps');
    check('3b. stderr conservé dans le record de phase', rec?.stderr === 'EPERM boom');
    check('3c. code de sortie porté par le record', rec?.code === 1 && e?.code === 'ARTIFACT_INSTALL_MANAGER_FAILED');
  }

  /* ---- 6. Codes spécialisés par phase ---- */
  {
    const root = await makeSource(TMP);
    const codeFor = async (plan) => { try { await buildArtifact({ root, stagingBase: TMP, exec: fakeExec(plan) }); return null; } catch (e) { return e.code; } };
    check('6b. install_site → ARTIFACT_INSTALL_SITE_FAILED', (await codeFor({ 'vitrine:ci': { code: 2 } })) === 'ARTIFACT_INSTALL_SITE_FAILED');
    check('6c. build_site → ARTIFACT_BUILD_SITE_FAILED', (await codeFor({ 'vitrine:build': { code: 1 } })) === 'ARTIFACT_BUILD_SITE_FAILED');
    check('6d. build_manager → ARTIFACT_BUILD_MANAGER_FAILED', (await codeFor({ 'manager:build': { code: 1 } })) === 'ARTIFACT_BUILD_MANAGER_FAILED');
  }

  /* ---- 7. Secrets dans stderr masqués (via RunRecorder, comme le moteur) ---- */
  {
    const root = await makeSource(TMP);
    const redactor = createRedactor([]);
    const secret = 'Sup3rSecretPwd!';
    redactor.addSecret(secret);
    const recorder = new RunRecorder({ redactor, identification: {} });
    recorder.markStep('artifact.build', { status: 'running' }); // le moteur crée l'étape avant de journaliser
    recorder.setCurrentStep('artifact.build');
    try {
      await buildArtifact({
        root, stagingBase: TMP,
        exec: fakeExec({ 'manager:ci': { code: 1, stderr: `login failed for ${secret}` } }),
        onPhase: (r) => recorder.recordExec(`[${r.phase}] ${r.command} ${r.args.join(' ')}`, { code: r.code, stdout: r.stdout, stderr: r.stderr }),
      });
    } catch { /* attendu */ }
    const step = recorder.steps.get('artifact.build');
    const joined = JSON.stringify(step?.execs || []);
    check('7. secret présent dans stderr → masqué dans le rapport', !joined.includes(secret) && step.execs.some((x) => x.stderr.includes('[REDACTED')));
  }

  /* ---- 9. Répertoire temporaire nettoyé après échec ---- */
  {
    const base = await fs.mkdtemp(path.join(TMP, 'clean-'));
    const root = await makeSource(TMP);
    try { await buildArtifact({ root, stagingBase: base, exec: fakeExec({ 'manager:ci': { code: 1 } }) }); } catch { /* attendu */ }
    const left = (await fs.readdir(base)).filter((n) => n.startsWith('sbauto-build-'));
    check('9. staging supprimé après échec (aucun résidu)', left.length === 0);
  }

  /* ---- 10. Retry immédiat après échec ---- */
  {
    const root = await makeSource(TMP);
    try { await buildArtifact({ root, stagingBase: TMP, exec: fakeExec({ 'manager:ci': { code: 1 } }) }); } catch { /* 1er échec */ }
    const art = await buildArtifact({ root, stagingBase: TMP, exec: fakeExec() });
    check('10. retry après échec : build réussi et indépendant', await exists(art.dists.manager));
    await art.cleanup();
  }

  /* ---- 11. Chemin AVEC ESPACES (cas réel Windows « SB Auto 06 -- … ») ---- */
  {
    const spaced = await fs.mkdtemp(path.join(TMP, 'has space '));
    const root = await makeSource(spaced);
    const art = await buildArtifact({ root, stagingBase: TMP, exec: fakeExec() });
    check('11. chemin source avec espaces : build réussi', await exists(art.dists.vitrine));
    await art.cleanup();
  }

  /* ---- 12. Chemins portables (aucune hypothèse de séparateur) ---- */
  {
    const root = await makeSource(TMP);
    const art = await buildArtifact({ root, stagingBase: TMP, exec: fakeExec() });
    const rel = path.relative(art.stagingRoot, art.dists.manager);
    check('12. dist résolu par path.join sous le staging (portable Linux/Windows)', !rel.startsWith('..') && art.dists.manager === path.join(art.stagingRoot, 'manager', 'dist'));
    await art.cleanup();
  }

  /* ---- 13. package-lock.json absent → npm ci impossible ---- */
  {
    const root = await makeSource(TMP, { managerLock: false });
    let e = null;
    try { await buildArtifact({ root, stagingBase: TMP, exec: fakeExec() }); } catch (err) { e = err; }
    check('13. lockfile manquant → ARTIFACT_PATH_INVALID (explicite)', e?.code === 'ARTIFACT_PATH_INVALID' && /package-lock/.test(e.message));
  }

  /* ---- 14. package-lock invalide (npm ci refuse) ---- */
  {
    const root = await makeSource(TMP);
    let e = null;
    try { await buildArtifact({ root, stagingBase: TMP, exec: fakeExec({ 'manager:ci': { code: 1, stderr: 'npm ci can only install with an existing package-lock.json' } }) }); } catch (err) { e = err; }
    check('14. lockfile désynchronisé → INSTALL_MANAGER_FAILED + stderr', e?.code === 'ARTIFACT_INSTALL_MANAGER_FAILED' && /package-lock/.test(e.details?.stderrExcerpt || ''));
  }

  /* ---- 15+16. npm introuvable (spawn ENOENT) ---- */
  {
    const root = await makeSource(TMP);
    const enoent = Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT' });
    let e = null;
    try { await buildArtifact({ root, stagingBase: TMP, exec: fakeExec({ 'vitrine:ci': { throw: enoent } }) }); } catch (err) { e = err; }
    check('15. npm introuvable → ARTIFACT_INSTALL_SITE_FAILED', e?.code === 'ARTIFACT_INSTALL_SITE_FAILED');
    check('16. ENOENT tracé (message lisible + details.error)', /introuvable/.test(e?.message || '') && /ENOENT/.test(e?.details?.error || ''));
    check('16b. code de sortie null quand spawn échoue', e?.details?.code === null);
  }

  /* ---- 17. Processus interrompu par signal ---- */
  {
    const root = await makeSource(TMP);
    let e = null;
    try { await buildArtifact({ root, stagingBase: TMP, exec: fakeExec({ 'manager:build': { code: null, signal: 'SIGKILL' } }) }); } catch (err) { e = err; }
    check('17. signal (SIGKILL) → échec avec signal tracé', e?.code === 'ARTIFACT_BUILD_MANAGER_FAILED' && e.details?.signal === 'SIGKILL');
  }

  /* ---- 18. Timeout de commande ---- */
  {
    const root = await makeSource(TMP);
    let e = null;
    try { await buildArtifact({ root, stagingBase: TMP, exec: fakeExec({ 'vitrine:build': { throw: new Error('Timeout build local (600000 ms) : npm run build') } }) }); } catch (err) { e = err; }
    check('18. timeout → ARTIFACT_BUILD_SITE_FAILED (délai dépassé)', e?.code === 'ARTIFACT_BUILD_SITE_FAILED' && /délai/.test(e.message));
  }

  /* ---- 19. build site OK puis install Manager échoue ---- */
  {
    const root = await makeSource(TMP);
    const phases = [];
    let e = null;
    try { await buildArtifact({ root, stagingBase: TMP, onPhase: (r) => phases.push(r), exec: fakeExec({ 'manager:ci': { code: 1 } }) }); } catch (err) { e = err; }
    const ok = phases.filter((p) => p.code === 0).map((p) => p.phase);
    check('19. vitrine construite AVANT l\'échec Manager', ok.includes('install_site') && ok.includes('build_site') && e?.code === 'ARTIFACT_INSTALL_MANAGER_FAILED');
  }

  /* ================= Intégration moteur (8 & 20) ================= */
  const IP = '203.0.113.10';
  function healthyVps() {
    return new FakeTransport()
      .on('id -un', { stdout: 'deploy' })
      .on('command -v nginx', { stdout: 'OK' }).on('command -v node', { stdout: 'OK' }).on('command -v pm2', { stdout: 'OK' })
      .on('command -v certbot', { stdout: 'OK' }).on('command -v mongod', { stdout: 'OK' })
      .on('nginx -t', { stdout: 'syntax is ok\ntest is successful' })
      .on('test -w /var/www', { stdout: 'WRITABLE' }).on(/df -Pk/, { stdout: '2000000' })
      .on(/cat \/etc\/nginx\/sites-available/, { stdout: '__NONE__' }).on('fullchain.pem', { stdout: 'OK' })
      .on('pm2 jlist', { stdout: '[]' })
      .on(/127\.0\.0\.1.*health/, { stdout: '200' })
      .on(/https:\/\/.*\/health/, { stdout: '{"success":true,"data":{"env":"PROD"}}\n200' });
  }
  const FAST = { localRetries: 1, localDelayMs: 0, publicRetries: 1, publicDelayMs: 0 };
  const DNS_FAST = { timeoutMs: 400, minIntervalMs: 1, maxIntervalMs: 1 };

  {
    const engine = new DeploymentEngine({ wildcardBases: ['ly-solution.com'] });
    const tx = healthyVps();
    const root = await makeSource(TMP);
    const res = await engine.deployWithReport({
      url: 'https://demo.ly-solution.com',
      transport: tx,
      options: {
        backendPort: 5001, dnsExpectedIp: IP, version: 't', health: FAST, dnsResolutionOpts: DNS_FAST,
        buildRoot: root, buildStagingBase: TMP, buildExec: fakeExec({ 'manager:ci': { code: 1, stderr: 'EPERM esbuild.exe' } }),
      },
    });
    check('8. échec build Manager → déploiement en échec à artifact.build', res.ok === false && res.finalStepId === 'artifact.build');
    check('8b. code d\'erreur spécialisé remonté au moteur', res.errorSummary?.code === 'ARTIFACT_INSTALL_MANAGER_FAILED');
    check('8c. AUCUN upload VPS après échec build (atomicité)', tx.uploads.length === 0);
    check('8d. aucune release/backend distant écrit', !tx.commands.some((c) => /npm ci --omit=dev|pm2 (start|restart)/.test(c.command)));
    // 20. Rapport toujours disponible + logs de build présents et redigés.
    const step = res.structuredReport.steps.find((s) => s.id === 'artifact.build');
    check('20. rapport structuré disponible après échec', Boolean(res.structuredReport) && step?.status === 'error');
    check('20b. commandes de build journalisées dans le rapport', (step?.execs || []).some((x) => /install_manager/.test(x.command)));
    check('20c. rapport Markdown produit', typeof res.markdownReport === 'string' && res.markdownReport.length > 0);
    check('20d. diagnostic lisible (pas « exception non prévue »)', !res.markdownReport.toLowerCase().includes('exception non prévue'));
  }

  // Cleanup best-effort du dossier de tests.
  await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
}

main().then(() => process.exit(fail === 0 ? 0 : 1)).catch((err) => { console.error('BUILD TEST CRASHED:', err); process.exit(1); });
