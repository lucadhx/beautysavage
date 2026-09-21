/*
 * Non-régression : synchronisation de la configuration réseau (LOT 3) + test
 * fonctionnel des médias (LOT 12). Connexion base INJECTÉE (aucun réseau).
 */
import { validateNetworkUrls, deriveNetworkUrls, syncRuntimeNetworkConfiguration, RuntimeConfigError } from '../deployment-engine/runtimeConfig.js';
import { runPipeline, PIPELINE_STEPS } from '../deployment-engine/pipeline.js';
import { checkPublicMedia } from '../deployment-engine/health.js';
import { planTopology } from '../deployment-engine/topology.js';

// Origines servies, dérivées du PROFIL (vitrine + manager) — plus de `managerHost`.
const ORIGINES = (host) => planTopology({ host }).publishable.map((a) => ({ label: a.id, host: a.host }));
import { FakeTransport } from '../deployment-engine/transport/FakeTransport.js';

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };

/** Connexion Mongo simulée : une collection en mémoire. */
function fakeConnect(seed = null) {
  const store = seed ? [seed] : [];
  const conn = {
    _store: store,
    closed: false,
    collection: () => ({
      findOne: async () => store[0] || null,
      updateOne: async (_f, { $set }) => {
        const doc = store[0] || (store[0] = { _id: 'x', network: {} });
        for (const [k, v] of Object.entries($set)) {
          if (k.startsWith('network.')) { doc.network = doc.network || {}; doc.network[k.slice(8)] = v; }
          else doc[k] = v;
        }
      },
      insertOne: async (d) => { store[0] = { _id: 'new', ...d }; },
    }),
    close: async () => { conn.closed = true; },
  };
  return conn;
}

const URLS = { backendUrl: 'https://demo-sbauto.lycarz.com', managerUrl: 'https://manager.demo-sbauto.lycarz.com', websiteUrl: 'https://demo-sbauto.lycarz.com' };

async function main() {
  /* 1. validateNetworkUrls */
  check('1. URLs HTTPS publiques : OK', (() => { try { validateNetworkUrls(URLS); return true; } catch { return false; } })());
  const localErr = (() => { try { validateNetworkUrls({ ...URLS, backendUrl: 'http://localhost:6060' }); return null; } catch (e) { return e; } })();
  check('1b. localhost -> RUNTIME_CONFIG_STILL_LOCAL', localErr?.code === 'RUNTIME_CONFIG_STILL_LOCAL');
  const httpErr = (() => { try { validateNetworkUrls({ ...URLS, websiteUrl: 'http://demo.example.com' }); return null; } catch (e) { return e; } })();
  check('1c. http:// public -> RUNTIME_CONFIG_STILL_LOCAL', httpErr?.code === 'RUNTIME_CONFIG_STILL_LOCAL');
  const invErr = (() => { try { validateNetworkUrls({ ...URLS, managerUrl: '' }); return null; } catch (e) { return e; } })();
  check('1d. URL absente -> RUNTIME_CONFIG_INVALID', invErr?.code === 'RUNTIME_CONFIG_INVALID');
  check('1e. localhost toléré si requirePublic=false', (() => { try { validateNetworkUrls({ backendUrl: 'http://localhost:6060', managerUrl: 'http://localhost:6061', websiteUrl: 'http://localhost:6062' }, { requirePublic: false }); return true; } catch { return false; } })());

  /* 2. deriveNetworkUrls */
  const topoD = planTopology({ host: 'demo-sbauto.lycarz.com' });
  const d = deriveNetworkUrls({ siteHost: 'demo-sbauto.lycarz.com', topology: topoD });
  check('2. dérive les URLs déclarées au profil en https', d.websiteUrl === 'https://demo-sbauto.lycarz.com' && d.managerUrl === 'https://manager.demo-sbauto.lycarz.com' && d.backendUrl === 'https://demo-sbauto.lycarz.com');
  const dApi = deriveNetworkUrls({ siteHost: 'demo.lycarz.com', apiHost: 'api.demo.lycarz.com' });
  check('2b. backendUrl = api.<domaine> si fourni', dApi.backendUrl === 'https://api.demo.lycarz.com');

  /* 3. sync : écrit + relit dans une base VIERGE (insert) */
  const c1 = fakeConnect(null);
  const r1 = await syncRuntimeNetworkConfiguration({ mongoUri: 'mongodb+srv://x', dbName: 'sbauto06_prod', urls: URLS, connect: async () => c1, now: '2026-07-22T00:00:00Z' });
  check('3. sync base vierge : created=true, urls relues', r1.ok && r1.created === true && r1.urls.backendUrl === URLS.backendUrl);
  check('3b. connexion fermée après sync', c1.closed === true);

  /* 4. sync : met à jour une config EXISTANTE (localhost -> https) */
  const c2 = fakeConnect({ _id: 'y', network: { backendUrl: 'http://localhost:6060', managerUrl: 'http://localhost:6061', websiteUrl: 'http://localhost:6062' } });
  const r2 = await syncRuntimeNetworkConfiguration({ mongoUri: 'm', dbName: 'db', urls: URLS, connect: async () => c2 });
  check('4. sync existant : created=false, urls mises à jour', r2.ok && r2.created === false && r2.urls.managerUrl === URLS.managerUrl && c2._store[0].network.backendUrl === URLS.backendUrl);

  /* 5. sync : URLs locales refusées AVANT toute écriture */
  const c3 = fakeConnect(null);
  let e5 = null;
  try { await syncRuntimeNetworkConfiguration({ mongoUri: 'm', dbName: 'db', urls: { ...URLS, backendUrl: 'http://localhost:6060' }, connect: async () => c3 }); } catch (e) { e5 = e; }
  check('5. sync refuse localhost (STILL_LOCAL) sans écrire', e5?.code === 'RUNTIME_CONFIG_STILL_LOCAL' && c3._store.length === 0);

  /* 6. sync : relecture incohérente -> READBACK_FAILED */
  const cBad = { closed: false, collection: () => ({ findOne: async () => ({ _id: 'z', network: { backendUrl: 'https://autre.com', managerUrl: URLS.managerUrl, websiteUrl: URLS.websiteUrl } }), updateOne: async () => {}, insertOne: async () => {} }), close: async () => {} };
  let e6 = null;
  try { await syncRuntimeNetworkConfiguration({ mongoUri: 'm', dbName: 'db', urls: URLS, connect: async () => cBad }); } catch (e) { e6 = e; }
  check('6. relecture incohérente -> RUNTIME_CONFIG_READBACK_FAILED', e6?.code === 'RUNTIME_CONFIG_READBACK_FAILED');

  /* 7. checkPublicMedia : URL locale détectée -> ok=false */
  const txMediaBad = new FakeTransport().on(/api\/public\/bootstrap/, { stdout: '{"logo":"http://localhost:6060/uploads/l.png","x":1}' });
  const mb = await checkPublicMedia(txMediaBad, 'demo.lycarz.com', { origins: ORIGINES('demo.lycarz.com') });
  check('7. média local détecté -> ok=false (STILL_LOCAL)', mb.reachable && mb.ok === false && mb.localHits.length === 1);

  /* 7b. média relatif ET réellement téléchargeable (200 + image) depuis les 2 origines */
  const txMediaOk = new FakeTransport()
    .on(/api\/public\/bootstrap/, { stdout: '{"logo":"/uploads/l.png"}' })
    .on(/uploads\/l\.png/, { stdout: '200 image/png' });
  const mo = await checkPublicMedia(txMediaOk, 'demo.lycarz.com', { origins: ORIGINES('demo.lycarz.com') });
  check('7b. média 200+image sur site ET manager -> ok=true', mo.reachable && mo.ok === true && mo.checked.length === 1 && mo.checked[0].origins.vitrine.ok && mo.checked[0].origins.manager.ok);

  /* 7c. média RELATIF mais 404 (fichier absent) -> ok=false, brokenCount>0 */
  const txMedia404 = new FakeTransport()
    .on(/api\/public\/bootstrap/, { stdout: '{"logo":"/uploads/missing.webp"}' })
    .on(/uploads\/missing\.webp/, { stdout: '404 text/html' });
  const m404 = await checkPublicMedia(txMedia404, 'demo.lycarz.com', { origins: ORIGINES('demo.lycarz.com') });
  check('7c. fichier média absent (404) détecté -> ok=false', m404.reachable && m404.ok === false && m404.brokenCount === 1 && m404.localHits.length === 0);

  /* 7d. média OK côté site mais cassé côté Manager -> ok=false (les 2 origines comptent) */
  const txMediaMgr = new FakeTransport()
    .on(/api\/public\/bootstrap/, { stdout: '{"logo":"/uploads/l.png"}' })
    .on(/uploads\/l\.png/, { stdout: '200 image/webp' })
    .on(/manager\.demo\.lycarz\.com\/uploads\/l\.png/, { stdout: '404 text/html' }); // spécifique en DERNIER (last-match-wins)
  const mMgr = await checkPublicMedia(txMediaMgr, 'demo.lycarz.com', { origins: ORIGINES('demo.lycarz.com') });
  check('7d. média cassé côté Manager seul -> ok=false', mMgr.ok === false && mMgr.checked[0].origins.vitrine.ok === true && mMgr.checked[0].origins.manager.ok === false);

  const txMediaErr = new FakeTransport(); // pas de règle -> stdout vide
  const me = await checkPublicMedia(txMediaErr, 'demo.lycarz.com', { origins: ORIGINES('demo.lycarz.com') });
  check('7e. endpoint injoignable -> non bloquant (reachable=false, ok=true)', me.reachable === false && me.ok === true);

  /* 8. Intégration pipeline : runtime.sync INJECTÉ écrit + apparaît dans les steps */
  function healthyVps() {
    return new FakeTransport()
      .on('id -un', { stdout: 'deploy' }).on('command -v nginx', { stdout: 'OK' }).on('command -v node', { stdout: 'OK' }).on('command -v pm2', { stdout: 'OK' }).on('command -v certbot', { stdout: 'OK' }).on('command -v mongod', { stdout: 'OK' })
      .on('nginx -t', { stdout: 'syntax is ok\ntest is successful' }).on('test -w /var/www', { stdout: 'WRITABLE' }).on(/df -Pk/, { stdout: '2000000' })
      .on(/cat \/etc\/nginx\/sites-available/, { stdout: '__NONE__' }).on('fullchain.pem', { stdout: 'OK' })
      .on(/127\.0\.0\.1.*health/, { stdout: '200' }).on(/https:\/\/.*\/health/, { stdout: '{"success":true,"data":{"env":"PROD"}}\n200' });
  }
  const FULL_ENV = { ENV: 'PROD', MONGODB_URI: 'mongodb+srv://u:p@c.mongodb.net/x', DB_PROD: 'sbauto06_prod', JWT_SECRET: 'x'.repeat(40), INTEGRATED_API_ENCRYPTION_KEY: 'a'.repeat(64) };
  const FAST = { localRetries: 1, localDelayMs: 0, publicRetries: 1, publicDelayMs: 0 };
  const sub = { host: 'sbauto06.demo.ly-solution.com', type: 'subdomain', wildcardBase: 'demo.ly-solution.com', canonicalUrl: 'https://sbauto06.demo.ly-solution.com' };
  // Empreinte web factice : PROD fail-closed exige indexHash (le VPS simulé ne
  // servant pas le site, le contrôle reste non bloquant : reachable=false).
  const FP = { indexHash: 'f'.repeat(64), mainJs: null };
  // Artefact au format PROFIL : `dists` indexé par identifiant d'application.
  const ART = { dists: { vitrine: '/l/v', manager: '/l/m' }, backendDir: '/l/b', web: { vitrine: FP, manager: FP } };
  let syncCall = null;
  const okPipe = await runPipeline({
    transport: healthyVps(), target: sub, artifact: ART, version: 'v',
    options: {
      backendPort: 5001, env: 'PROD', remoteEnv: FULL_ENV, health: FAST,
      runtimeConfigSync: async (a) => { syncCall = a; return { ok: true, urls: deriveNetworkUrls({ siteHost: sub.host, topology: planTopology({ host: sub.host }) }), created: false }; },
    },
  });
  check('8. pipeline OK avec runtime.sync injecté', okPipe.ok === true);
  check('8b. étape runtime_config présente', okPipe.steps.some((s) => s.step === 'runtime_config' && s.status === 'ok'));
  check('8c. sync appelé avec la base cible (DB_PROD) + mongoUri', syncCall?.dbName === 'sbauto06_prod' && syncCall?.mongoUri === FULL_ENV.MONGODB_URI);
  check('8d. nombre d\'étapes = PIPELINE_STEPS', okPipe.steps.length === PIPELINE_STEPS.length);

  /* 9. Sans injecteur : runtime.sync neutre (façade/test) — pas d'échec */
  const noInject = await runPipeline({ transport: healthyVps(), target: sub, artifact: ART, version: 'v', options: { backendPort: 5001, env: 'PROD', remoteEnv: FULL_ENV, health: FAST } });
  check('9. sans injecteur : runtime_config neutre (ok)', noInject.ok === true && noInject.steps.find((s) => s.step === 'runtime_config')?.status === 'ok');

  /* 10. Média local en prod public -> MEDIA_STILL_LOCAL bloque validate */
  const txLocalMedia = healthyVps().on(/api\/public\/bootstrap/, { stdout: '{"logo":"http://localhost:6060/uploads/l.png"}' });
  const badMedia = await runPipeline({ transport: txLocalMedia, target: sub, artifact: ART, version: 'v', options: { backendPort: 5001, env: 'PROD', remoteEnv: FULL_ENV, health: FAST } });
  check('10. média local -> échec validate (MEDIA_STILL_LOCAL)', badMedia.ok === false && badMedia.failedStep === 'validate' && badMedia.error?.code === 'MEDIA_STILL_LOCAL');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
}

main().then(() => process.exit(fail === 0 ? 0 : 1)).catch((err) => { console.error('RUNTIME CONFIG TEST CRASHED:', err); process.exit(1); });
