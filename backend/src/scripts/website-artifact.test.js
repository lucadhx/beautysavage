/*
 * BUG 1 — Vitrine obsolète : empreinte web + contrôle d'artefact servi + cache.
 *
 * Couvre :
 *   - webFingerprint : sha index.html + JS d'entrée (nom = hash contenu Vite) ;
 *   - checkWebsiteArtifact : détecte un SPA servi ≠ artefact construit ;
 *   - renderNginxConfig : politique de cache correcte (index no-cache, assets
 *     immutable, 404 sur asset absent — plus de retombée HTML pour un .js).
 * Aucun VPS : FakeTransport + dist temporaire réel.
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { webFingerprint } from '../deployment-engine/build.js';
import { checkWebsiteArtifact } from '../deployment-engine/health.js';
import { renderNginxConfig } from '../deployment-engine/nginx.js';
import { parseTargetUrl } from '../deployment-engine/url.js';
import { FakeTransport } from '../deployment-engine/transport/FakeTransport.js';

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const sha = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

async function makeDist(base, { jsName = 'index-ABC123.js', jsBody = 'console.log(1)' } = {}) {
  const dist = await fs.mkdtemp(path.join(base, 'dist-'));
  await fs.mkdir(path.join(dist, 'assets'), { recursive: true });
  const html = `<!doctype html><html><head><script type="module" src="/assets/${jsName}"></script></head><body></body></html>`;
  await fs.writeFile(path.join(dist, 'index.html'), html);
  await fs.writeFile(path.join(dist, 'assets', jsName), jsBody);
  return { dist, html, jsName, jsBody };
}

/** Fake transport dont `curl <url>` renvoie le corps mappé (sinon __ERR__). */
function curlTransport(map) {
  const t = new FakeTransport();
  t.exec = async (cmd) => {
    const m = cmd.match(/curl[^']*'([^']+)'/);
    const url = m?.[1];
    if (url && Object.prototype.hasOwnProperty.call(map, url)) return { code: 0, stdout: map[url], stderr: '' };
    return { code: 0, stdout: '__ERR__', stderr: '' };
  };
  return t;
}

async function main() {
  const TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'sbauto-web-'));

  /* -------- webFingerprint -------- */
  const { dist, html, jsName, jsBody } = await makeDist(TMP);
  const fp = await webFingerprint(dist);
  check('webFingerprint : indexHash = sha(index.html)', fp.indexHash === sha(html));
  check('webFingerprint : mainJs.name extrait', fp.mainJs?.name === jsName);
  check('webFingerprint : mainJs.hash = sha(js)', fp.mainJs?.hash === sha(jsBody));
  const fpMissing = await webFingerprint(path.join(TMP, 'nope'));
  check('webFingerprint : dist absent -> nulls', fpMissing.indexHash === null && fpMissing.mainJs === null);

  /* -------- checkWebsiteArtifact -------- */
  const HOST = 'demo.example.com';
  const expected = fp;

  // (a) tout correspond
  const okTx = curlTransport({ [`https://${HOST}/`]: html, [`https://${HOST}/assets/${jsName}`]: jsBody });
  const rOk = await checkWebsiteArtifact(okTx, HOST, expected);
  check('artefact identique -> ok', rOk.ok && rOk.indexMatch && rOk.jsMatch);

  // (b) index distant différent (ancienne version)
  const staleHtml = html.replace(jsName, 'index-OLD000.js');
  const staleTx = curlTransport({ [`https://${HOST}/`]: staleHtml, [`https://${HOST}/assets/${jsName}`]: jsBody });
  const rStale = await checkWebsiteArtifact(staleTx, HOST, expected);
  check('index divergent -> mismatch', rStale.reachable && !rStale.ok && rStale.indexMatch === false);

  // (c) JS servi au contenu différent
  const badJsTx = curlTransport({ [`https://${HOST}/`]: html, [`https://${HOST}/assets/${jsName}`]: 'console.log(2)' });
  const rBadJs = await checkWebsiteArtifact(badJsTx, HOST, expected);
  check('JS divergent -> mismatch', rBadJs.reachable && !rBadJs.ok && rBadJs.jsMatch === false);

  // (d) site injoignable
  const downTx = curlTransport({});
  const rDown = await checkWebsiteArtifact(downTx, HOST, expected);
  check('site injoignable -> non ok, reachable=false', rDown.reachable === false && rDown.ok === false);

  // (e) pas d'empreinte attendue -> skip non bloquant
  const rSkip = await checkWebsiteArtifact(okTx, HOST, null);
  check('empreinte absente -> skipped ok', rSkip.ok === true && rSkip.skipped === true);

  /* -------- version.json servie == manifeste construit -------- */
  const COMMIT = 'cafe0123456789abcdef';
  const expectedV = { ...fp, commitHash: COMMIT };

  // (f) commit servi identique -> ok
  const vOkTx = curlTransport({
    [`https://${HOST}/`]: html,
    [`https://${HOST}/assets/${jsName}`]: jsBody,
    [`https://${HOST}/version.json`]: JSON.stringify({ commitHash: COMMIT }),
  });
  const rVOk = await checkWebsiteArtifact(vOkTx, HOST, expectedV);
  check('version.json identique -> ok', rVOk.ok === true && rVOk.versionMatch === true);

  // (g) commit servi divergent (vieille version encore en ligne) -> mismatch
  const vBadTx = curlTransport({
    [`https://${HOST}/`]: html,
    [`https://${HOST}/assets/${jsName}`]: jsBody,
    [`https://${HOST}/version.json`]: JSON.stringify({ commitHash: 'old0000000000000000' }),
  });
  const rVBad = await checkWebsiteArtifact(vBadTx, HOST, expectedV);
  check('version.json divergente -> mismatch', rVBad.reachable && rVBad.ok === false && rVBad.versionMatch === false);

  // (h) version.json ABSENTE à distance (seule une vieille version ne l'embarque pas) -> mismatch
  const vMissTx = curlTransport({
    [`https://${HOST}/`]: html,
    [`https://${HOST}/assets/${jsName}`]: jsBody,
  });
  const rVMiss = await checkWebsiteArtifact(vMissTx, HOST, expectedV);
  check('version.json absente -> mismatch', rVMiss.reachable && rVMiss.ok === false && rVMiss.versionMatch === false);

  /* -------- nginx : politique de cache -------- */
  const target = parseTargetUrl('https://demo-sbauto.ly-solution.com', { wildcardBases: ['ly-solution.com'] });
  const cfg = renderNginxConfig(target, { webRoot: '/w', managerRoot: '/m', backendPort: 5005 });
  check('nginx : index.html no-cache', cfg.includes('location = /index.html { add_header Cache-Control "no-cache"; }'));
  check('nginx : version.json no-cache', cfg.includes('location = /version.json { add_header Cache-Control "no-cache"; }'));
  check('nginx : assets immutable', /location \/assets\/ \{[\s\S]*immutable/.test(cfg));
  check('nginx : assets expires 1y', /location \/assets\/ \{[\s\S]*expires 1y/.test(cfg));
  check('nginx : asset absent -> 404 (pas de HTML)', /location \/assets\/ \{[\s\S]*try_files \$uri =404/.test(cfg));
  check('nginx : SPA fallback conservé', cfg.includes('try_files $uri $uri/ /index.html;'));
  // Politique appliquée AUX DEUX sites (vitrine + manager).
  check('nginx : cache appliqué 2 fois (vitrine + manager)', (cfg.match(/location \/assets\//g) || []).length === 2);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
