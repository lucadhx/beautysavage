/**
 * PRÉREQUIS LOCAUX — un dépôt non commité ne démarre AUCUN déploiement.
 *
 * ── LE DÉFAUT CORRIGÉ ───────────────────────────────────────────────────────
 * `checkLocalPrerequisites` existait dans le moteur mais n'était appelé nulle
 * part par ce contrôleur : le contrôle de source Git n'intervenait qu'à
 * `artifact.build`, via `requireCleanSource`. L'ordre réel du pipeline étant
 *   initialize → dns.* → ssh.connect → server.preflight → remote.safety
 *   → dns.site → dns.apps → dns.verify → artifact.build ✗
 * un dépôt non commité en PRODUCTION faisait créer un DeploymentRun, sa
 * checklist, marquait la cible « en cours », ouvrait SSH et faisait tourner
 * les phases DNS — puis échouait sur DEPLOY_SOURCE_DIRTY en laissant derrière
 * lui le rapport persisté d'un déploiement qui n'aurait jamais dû commencer.
 *
 * Ce fichier ne lit AUCUN code source : il envoie la vraie requête HTTP et
 * regarde ce qui existe en base après le refus.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import fs from 'node:fs';
import path from 'node:path';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt-long-enough-32chars!!';
process.env.PORT = '4162';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.PROJECT_NAME = 'SB Auto 06';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
await connectDatabase();
await bootstrap(); // seed des comptes DEV/ADMIN
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();
// LOT 2C — le DÉCOR de recette (dev@mail.com, admin@mail.com) ne vient plus du
// produit : `bootstrap()` ne pose aucun mot de passe. Voir helpers/testAccounts.helper.js.
await (await import("./helpers/testAccounts.helper.js")).seedTestAccounts();

const { createApp } = await import('../app.js');
const { PROJECT_ROOT } = await import('../deployment-engine/build.js');
const { runLocalPreflight } = await import('../deployment-engine/localPreflight.js');
const DeploymentRun = (await import('../models/DeploymentRun.model.js')).default;
const DeploymentTarget = (await import('../models/DeploymentTarget.model.js')).default;

const app = createApp();
const server = app.listen(4162);
const base = 'http://localhost:4162';

async function api(method, p, { token, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* flux NDJSON : non-JSON */ }
  return { status: res.status, json, text, contentType: res.headers.get('content-type') ?? '' };
}

const devToken = (await api('POST', '/api/auth/login', {
  body: { email: 'dev@mail.com', password: '123dev' },
})).json?.data?.token;

// Le dépôt est rendu DÉTERMINISTEMENT non commité : un fichier non suivi
// suffit, et il est retiré quoi qu'il arrive. Sans cela, le test dépendrait de
// l'état de travail du poste — vert par hasard sur un dépôt propre.
const probeFile = path.join(PROJECT_ROOT, `.deploy-gate-probe-${process.pid}.tmp`);
fs.writeFileSync(probeFile, 'sonde de test — supprimée automatiquement\n');

try {
  section('Un dépôt non commité en PROD ne crée RIEN');
  check('session DEV ouverte', typeof devToken === 'string' && devToken.length > 0);

  const local = await runLocalPreflight({ env: 'PROD' });
  check('le dépôt de travail est bien non commité pour ce test', local.ok === false);

  /**
   * L'ENVIRONNEMENT EST PORTÉ PAR LA DESTINATION, et le modèle l'exige. Cette
   * fixture précédait l'invariant : elle échouait à la validation, et la suite
   * tombait avant d'avoir rien vérifié.
   *
   * `PROD` est la seule valeur cohérente ici : le préflight qu'on vient de
   * jouer porte sur `{ env: 'PROD' }`, et c'est bien un déploiement de
   * production que ce scénario doit voir refusé. Rien n'est déduit de l'hôte,
   * du port, de la base ni du nom — la destination le déclare.
   */
  const target = await DeploymentTarget.create({
    name: 'Cible de test',
    url: 'https://cible-test.exemple.com',
    host: 'cible-test.exemple.com',
    type: 'domain',
    environment: 'PROD',
    backendPort: 5099,
    remoteRoot: '/var/www',
    state: 'NEW',
  });
  check('la destination déclare son environnement, elle ne le devine pas',
    target.environment === 'PROD');
  const targetId = String(target._id);

  const runsBefore = await DeploymentRun.countDocuments({});
  check('aucun run avant la requête', runsBefore === 0);

  // `sessionId` volontairement INEXISTANT : si le pipeline démarrait, il
  // échouerait en réclamant une session VPS — et aurait déjà créé son run.
  // Le refus attendu prouve donc qu'aucune connexion n'a même été tentée.
  const res = await api('POST', '/api/deployment/deploy/stream', {
    token: devToken,
    body: { targetId, sessionId: 'session-inexistante', env: 'PROD' },
  });

  check('HTTP 400', res.status === 400);
  check('code PANEL_DEPLOY_LOCAL_PREREQUISITES_FAILED',
    res.json?.code === 'PANEL_DEPLOY_LOCAL_PREREQUISITES_FAILED');
  check('message explicite', /Source Git non commitée/.test(res.json?.message ?? ''));
  check('la liste des fichiers fautifs accompagne le refus',
    Array.isArray(res.json?.details?.files) && res.json.details.files.length > 0);
  check('…dont le fichier sonde',
    (res.json?.details?.files ?? []).some((f) => f.path.includes('.deploy-gate-probe-')));
  check('le refus dit que le pipeline n’a pas tourné', res.json?.details?.pipelineExecuted === false);

  // Le refus tombe AVANT les en-têtes NDJSON : c'est une réponse JSON ordinaire,
  // pas un flux dans lequel on aurait glissé une erreur après coup.
  check('réponse JSON, pas un flux NDJSON déjà ouvert',
    res.contentType.includes('application/json') && !res.contentType.includes('ndjson'));

  // ── LE CŒUR DE LA PREUVE ────────────────────────────────────────────────
  check('DeploymentRun créé = 0', (await DeploymentRun.countDocuments({})) === 0);
  check('checklist créée = 0',
    (await DeploymentRun.countDocuments({ 'steps.0': { $exists: true } })) === 0);
  check('aucun rapport de déploiement persisté',
    (await DeploymentRun.countDocuments({ report: { $ne: null } })) === 0);
  check('artifact.build jamais atteint',
    (await DeploymentRun.countDocuments({ 'steps.id': 'artifact.build' })) === 0);

  const after = await DeploymentTarget.findById(targetId).lean();
  check('la cible n’est PAS passée en cours de déploiement', after.state !== 'DEPLOYING');
  check('…et ne porte aucun run', (after.lastDeploymentRunId ?? null) === null);

  section('Non-régression');
  // Un PRÉFLIGHT reste autorisé sur un dépôt non commité : c'est l'opération
  // qu'on lance justement pour constater ce qui ne va pas, et elle ne déploie
  // rien. Elle échoue plus loin (session VPS inexistante), pas sur la garde.
  const pre = await api('POST', '/api/deployment/preflight/stream', {
    token: devToken,
    body: { targetId, sessionId: 'session-inexistante', env: 'PROD' },
  });
  check('un préflight n’est PAS bloqué par la garde locale',
    pre.json?.code !== 'PANEL_DEPLOY_LOCAL_PREREQUISITES_FAILED');

  // En TEST, un dépôt non commité reste déployable : c'est l'environnement où
  // l'on valide précisément du travail en cours.
  const testEnv = await runLocalPreflight({ env: 'TEST' });
  check('dépôt non commité en TEST : la garde n’oppose aucun refus', testEnv.ok === true);
  check('…tout en signalant les fichiers (informatif, non bloquant)',
    testEnv.checks.some((c) => c.id === 'source.clean' && c.required === false));
} finally {
  fs.rmSync(probeFile, { force: true });
  await new Promise((r) => server.close(r));
  await disconnectDatabase();
  await mongod.stop();
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
