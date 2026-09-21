/*
 * Non-régression : vérification de la SOURCE Git + MANIFESTE de version (LOT 4/5).
 * git + npm injectés (aucune commande réelle). Copie de staging réelle (fs).
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { buildArtifact, getGitSourceInfo } from '../deployment-engine/build.js';

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const TMP = path.join(os.tmpdir(), 'sbauto-src-manifest');

async function makeSource(base) {
  const root = await fs.mkdtemp(path.join(base, 'src-'));
  for (const app of ['vitrine', 'manager', 'backend']) {
    const d = path.join(root, app);
    await fs.mkdir(path.join(d, 'src'), { recursive: true });
    await fs.writeFile(path.join(d, 'package.json'), JSON.stringify({ name: app, scripts: { build: 'vite build' } }));
    await fs.writeFile(path.join(d, 'src', 'main.ts'), `// ${app}`);
    await fs.writeFile(path.join(d, 'package-lock.json'), '{}');
  }
  await fs.writeFile(path.join(root, 'backend', 'package-lock.json'), '{}');
  return root;
}

/** exec injecté : git (rev-parse/status) + npm (ci/build crée dist). */
function gitNpmExec({ commit = 'abc123def4567890abcdef', branch = 'feat/unified-production-baseline', dirty = false, noGit = false } = {}) {
  return async (cmd, args, { cwd }) => {
    if (cmd === 'git') {
      if (noGit) return { code: 128, stdout: '', stderr: 'not a git repo' };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { code: 0, stdout: `${commit}\n` };
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { code: 0, stdout: `${branch}\n` };
      if (args[0] === 'status') return { code: 0, stdout: dirty ? ' M backend/src/x.js\n' : '' };
      return { code: 0, stdout: '' };
    }
    if (args[0] !== 'ci') { await fs.mkdir(path.join(cwd, 'dist'), { recursive: true }); await fs.writeFile(path.join(cwd, 'dist', 'index.html'), '<html>'); }
    return { code: 0, stdout: '', stderr: '', signal: null };
  };
}

async function main() {
  await fs.mkdir(TMP, { recursive: true });

  /* getGitSourceInfo */
  const clean = await getGitSourceInfo('/x', gitNpmExec({ dirty: false }));
  check('1. git info : commit + short + branche + clean', clean.isGit && clean.commitHash.startsWith('abc123') && clean.shortCommit === 'abc123d' && clean.branch === 'feat/unified-production-baseline' && clean.isDirty === false);
  const dirty = await getGitSourceInfo('/x', gitNpmExec({ dirty: true }));
  check('2. git info : dirty détecté', dirty.isDirty === true);
  const nogit = await getGitSourceInfo('/x', gitNpmExec({ noGit: true }));
  check('3. hors dépôt git : isGit=false', nogit.isGit === false && nogit.commitHash === null);

  /* requireCleanSource : source dirty -> DEPLOY_SOURCE_DIRTY */
  {
    const root = await makeSource(TMP);
    let e = null;
    try { await buildArtifact({ root, stagingBase: TMP, exec: gitNpmExec({ dirty: true }), requireCleanSource: true }); } catch (err) { e = err; }
    check('4. source dirty + requireCleanSource -> DEPLOY_SOURCE_DIRTY', e?.code === 'DEPLOY_SOURCE_DIRTY');
  }

  /* Manifeste généré + embarqué */
  {
    const root = await makeSource(TMP);
    const art = await buildArtifact({ root, stagingBase: TMP, exec: gitNpmExec({ dirty: false }), requireCleanSource: true, builtAt: '2026-07-22T10:00:00Z' });
    check('5. manifeste : commit + branche + builtAt', art.manifest.commitHash.startsWith('abc123') && art.manifest.branch === 'feat/unified-production-baseline' && art.manifest.builtAt === '2026-07-22T10:00:00Z');
    check('5b. manifeste : un hash par application construite', Object.keys(art.manifest.appArtifactHashes).join(',') === 'vitrine,manager' && Object.values(art.manifest.appArtifactHashes).every((h) => typeof h === 'string' && h.length === 16) && typeof art.manifest.backendSourceHash === 'string');
    check('5c. build-manifest.json embarqué dans le backend', JSON.parse(await fs.readFile(path.join(art.backendDir, 'build-manifest.json'), 'utf8')).commitHash === art.manifest.commitHash);
    check('5d. version.json dans chaque dist du profil', (await fs.readFile(path.join(art.dists.vitrine, 'version.json'), 'utf8')).includes('abc123') && (await fs.readFile(path.join(art.dists.manager, 'version.json'), 'utf8')).includes('abc123'));
    check('5e. manifeste ne fuit AUCUN chemin local ni secret', !/[A-Z]:\\|\/Users\/|password|secret|token|MONGODB/i.test(JSON.stringify(art.manifest)));
    await art.cleanup();
  }

  await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
}

main().then(() => process.exit(fail === 0 ? 0 : 1)).catch((err) => { console.error('SOURCE/MANIFEST TEST CRASHED:', err); process.exit(1); });
