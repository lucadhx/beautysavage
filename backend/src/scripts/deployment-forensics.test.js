// INSTRUMENTATION FORENSIQUE — un incident doit être lisible sans terminal.
//
// ══ CE QUE CES TESTS FIXENT ═════════════════════════════════════════════════
//
// Diagnostiquer le déploiement du 06/08 a exigé un accès SSH, `pm2 logs`, une
// lecture directe de Mongo et une reproduction locale. Trois des questions
// posées n'ont JAMAIS pu être tranchées, faute de trace :
//
//   · pourquoi le premier clic a rendu 500 — aucun run n'existait ;
//   · pourquoi le run est resté figé 8 min 36 s sur `ssh.connect` ;
//   · si le backend s'est coupé lui-même, ou s'il a levé une erreur.
//
// Chaque test ci-dessous rend l'une de ces questions répondable par la seule
// lecture du run.
import { strict as assert } from 'node:assert';

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'TEST';

const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default;

const serveur = await MongoMemoryServer.create();
process.env.MONGODB_URI = serveur.getUri();
await mongoose.connect(serveur.getUri(), { dbName: 'forensique' });

const DeploymentRun = (await import('../models/DeploymentRun.model.js')).default;
const DeploymentAttempt = (await import('../models/DeploymentAttempt.model.js')).default;
const { DeploymentTarget } = await import('../models/DeploymentTarget.model.js');
const jrn = await import('../services/deployment/forensics/runJournal.service.js');
const etapes = await import('../services/deployment/forensics/runSteps.service.js');
const garde = await import('../services/deployment/forensics/processGuard.js');
const final = await import('../services/deployment/forensics/finalization.service.js');
const { sanitizeHeaders, sanitizeValue } = await import('../services/deployment/forensics/sanitize.js');

let ok = 0;
let ko = 0;
const check = (libelle, condition) => {
  if (condition) { ok += 1; console.log(`  ✓ ${libelle}`); }
  else { ko += 1; console.log(`  ✗ ${libelle}`); }
};
const section = (titre) => console.log(`\n${titre}`);

await DeploymentTarget.init();

let n = 0;
const cible = async (over = {}) => {
  n += 1;
  const at = new Date();
  await DeploymentTarget.deleteMany({});
  return DeploymentTarget.create({
    name: `D${n}`, url: `https://d${n}.exemple.com`, host: `d${n}.exemple.com`,
    type: 'domain', environment: 'TEST', backendPort: 5100 + n,
    lifecycleStatus: 'ACTIVE', state: 'DEPLOYING', createdAt: at, updatedAt: at, ...over,
  });
};
const run = async (target) => DeploymentRun.create({
  target: target._id, targetName: target.name, siteHost: target.host,
  operationType: 'DEPLOYMENT', status: 'running', startedAt: new Date(), steps: [],
});

/* ══════════════════════════════════════════════════════════════════════════ */
section('AUCUN SECRET NE PEUT ENTRER DANS LE JOURNAL');
{
  const propre = sanitizeValue({
    sshPassword: 'MonMotDePasse!2026',
    bridgeToken: 'abcdef0123456789abcdef',
    authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.charge.signature',
    imbrique: { apiKey: 'sk_live_ABCDEFGHIJKLMNOP', innocent: 'valeur visible' },
    message: 'échec de connexion à mongodb+srv://user:motdepasse@cluster.mongodb.net/base',
    trace: 'Bearer eyJhbGciOiJIUzI1NiJ9.aaaaaaaaaaaaaaaaaaaaaaaa.bbbb',
  });
  const texte = JSON.stringify(propre);

  check('le mot de passe SSH n’apparaît pas', !texte.includes('MonMotDePasse'));
  check('le jeton de pont non plus', !texte.includes('abcdef0123456789'));
  check('un en-tête d’autorisation non plus', !texte.includes('eyJhbGciOiJIUzI1NiJ9'));
  check('une clé d’API imbriquée non plus', !texte.includes('sk_live_ABCDEFGHIJKLMNOP'));
  check('une URI Mongo avec identifiants non plus', !texte.includes('motdepasse@cluster'));
  check('…mais ce qui n’est pas secret reste lisible', texte.includes('valeur visible'));

  const entetes = sanitizeHeaders({
    authorization: 'Bearer secret', cookie: 'session=abc',
    'content-type': 'application/json', 'user-agent': 'Chrome',
  });
  check('les en-têtes conservent le contenu utile', entetes['content-type'] === 'application/json');
  check('…et rejettent l’autorisation', entetes.authorization === undefined);
  check('…et les cookies', entetes.cookie === undefined);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('UN 500 AVANT LA CRÉATION DU RUN LAISSE UNE TRACE');
{
  await DeploymentAttempt.deleteMany({});
  const tentative = await jrn.openAttempt({
    requestId: 'req-0001', route: '/api/deployment/deploy/stream', method: 'POST', user: 'dev@exemple.com',
  });
  await jrn.journalAttempt(tentative._id, {
    source: jrn.SOURCES.HTTP, level: jrn.LEVELS.ERROR,
    eventCode: jrn.EVENTS.HTTP_REQUEST_FAILED,
    message: 'Erreur avant création du run',
    error: Object.assign(new Error('boom'), { code: 'X_FAIL' }),
    details: { headersSent: false, sshPassword: 'NE-DOIT-PAS-APPARAITRE' },
  });
  await jrn.closeAttempt(tentative._id, { runId: null, status: 'failed', httpStatus: 500 });

  const relue = await DeploymentAttempt.findById(tentative._id).lean();
  check('la tentative existe MÊME SANS run', relue !== null && relue.run === null);
  check('…elle porte la route exacte', relue.route === '/api/deployment/deploy/stream');
  check('…le requestId', relue.requestId === 'req-0001');
  check('…le status HTTP', relue.httpStatus === 500);
  check('…le code d’erreur', relue.journal[0].errorCode === 'X_FAIL');
  check('…la pile', typeof relue.journal[0].stack === 'string' && relue.journal[0].stack.includes('Error'));
  check('…et AUCUN secret', !JSON.stringify(relue).includes('NE-DOIT-PAS-APPARAITRE'));
  check('« aucun run créé donc on ne sait pas » n’est plus une réponse possible',
    relue.journal.length > 0);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('TOUTE ÉTAPE RUNNING FINIT PAR UN ÉTAT TERMINAL');
{
  const t = await cible();
  const r = await run(t);

  await etapes.recordStep(r._id, { stepId: 'ssh.connect', label: 'Connexion sécurisée', status: 'running' });
  let relu = await DeploymentRun.findById(r._id).lean();
  check('l’étape est PERSISTÉE, pas seulement émise', relu.steps[0]?.id === 'ssh.connect');
  check('…marquée en cours', relu.steps[0].status === 'running');
  check('…et le run pointe dessus', relu.currentStepId === 'ssh.connect');
  check('…avec une entrée de journal', relu.journal.some((e) => e.eventCode === 'STEP_STARTED'));

  /**
   * Le process meurt ici — c'est exactement le cas du 06/08.
   *
   * La mort doit être PROUVÉE, pas supposée : la reprise n'épargne un run que
   * s'il écrit encore. On vieillit donc la dernière écriture, ce qui est la
   * traduction fidèle de « plus personne n'exécute ce run » — et ce qui
   * distingue ce cas d'un déploiement simplement traversé par un redémarrage.
   */
  await DeploymentRun.collection.updateOne(
    { _id: r._id }, { $set: { updatedAt: new Date(Date.now() - 10 * 60_000) } },
  );
  const repris = await etapes.recoverOrphanRuns({ reason: 'process_restart' });
  check('au redémarrage, le run orphelin est repris', repris.recovered === 1);

  relu = await DeploymentRun.findById(r._id).lean();
  check('l’étape figée devient INTERRUPTED, pas ERROR',
    relu.steps[0].status === 'interrupted');
  check('…car elle n’a pas échoué : elle a été coupée',
    relu.steps[0].finishedAt !== null);
  check('le run est clos', relu.status === 'interrupted');
  check('…et la cause est nommée',
    relu.journal.some((e) => e.eventCode === 'RUN_INTERRUPTED_BY_PROCESS_RESTART'));
  check('…avec le PID du nouveau process',
    relu.journal.find((e) => e.eventCode === 'RUN_INTERRUPTED_BY_PROCESS_RESTART').details.newPid === process.pid);
  check('plus aucun chargement éternel n’est possible', relu.currentStepId === null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE FILET DE SÉCURITÉ FERME LES ÉTAPES, PAS SEULEMENT LE RUN');
{
  /**
   * ══ DEUX CHEMINS DE REPRISE, UN SEUL ÉTAT FINAL ═════════════════════════
   *
   * `recoverOrphanRuns` (ci-dessus) constate la mort du process par son PID.
   * `finalizeOrphanRuns` est le FILET : il ferme tout run `running` plus vieux
   * qu'un seuil, sans rien demander à personne. C'est lui qui rattrape les runs
   * d'avant l'introduction du PID, et ceux qu'aucune reprise n'a vus.
   *
   * Il fermait le RUN sans toucher à ses ÉTAPES. Une étape restait donc
   * `running` pour toujours derrière un run terminé — l'écran affichait un
   * point pulsant sur une étape morte, et la progression était fausse : ni
   * achevée ni échouée, l'étape ne comptait nulle part.
   *
   * Deux chemins de reprise qui ne laissent pas la base dans le même état
   * finissent toujours par diverger — et c'est celui qu'on oublie de tester qui
   * tourne en production.
   */
  const t = await cible();
  const r = await run(t);

  await etapes.recordStep(r._id, { stepId: 'artifact.upload', label: 'Transfert', status: 'ok' });
  await etapes.recordStep(r._id, { stepId: 'dependencies.install', label: 'Installation', status: 'running' });

  /* Le run est plus vieux que le seuil du filet : personne ne l'exécute plus. */
  await DeploymentRun.collection.updateOne(
    { _id: r._id }, { $set: { startedAt: new Date(Date.now() - 10 * 60_000) } },
  );

  const { finalizeOrphanRuns } = await import('../services/deploymentRun.service.js');
  const closes = await finalizeOrphanRuns();
  check('le filet voit le run abandonné', closes === 1);

  const relu = await DeploymentRun.findById(r._id).lean();
  const install = relu.steps.find((x) => x.id === 'dependencies.install');
  const transfert = relu.steps.find((x) => x.id === 'artifact.upload');

  check('le run est clos', relu.status === 'interrupted');
  check('…l’étape en cours est TERMINALISÉE', install.status === 'interrupted');
  check('…avec une heure de fin', Boolean(install.finishedAt));
  check('…et l’étape déjà réussie n’est pas touchée', transfert.status === 'ok');
  check('AUCUNE étape ne reste « running » derrière un run terminé',
    (relu.steps || []).every((x) => x.status !== 'running'));

  /*
   * LE VERROU DOIT POUVOIR ÊTRE REPRIS — sinon la destination reste condamnée
   * jusqu'à une intervention manuelle, et l'utilisateur ne peut plus déployer.
   */
  const apres = await DeploymentTarget.findById(t._id).lean();
  const verrouLibre = !apres.activeDeploymentRunId
    || String(apres.activeDeploymentRunId) === String(r._id);
  check('le verrou de destination est libérable', verrouLibre);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('UNE ERREUR NON GÉRÉE EST JOURNALISÉE AVANT LA CHUTE');
{
  const t = await cible();
  const r = await run(t);

  garde.resetProcessGuards();
  const silencieux = { error: () => {} };
  const pose = garde.installProcessGuards({ logger: silencieux });
  check('les observateurs s’installent', pose.installed === true);
  check('…et une seconde pose est ignorée',
    garde.installProcessGuards({ logger: silencieux }).installed === false);

  garde.setActiveRun(String(r._id));
  check('le run actif est déclaré au process', garde.getActiveRun() === String(r._id));

  // On déclenche l'observateur comme Node le ferait.
  process.emit('unhandledRejection', Object.assign(new Error('rejet simulé'), { code: 'ECONNRESET' }));
  await new Promise((res) => { setTimeout(res, 120); });

  const relu = await DeploymentRun.findById(r._id).lean();
  const entree = relu.journal.find((e) => e.eventCode === 'UNHANDLED_REJECTION');
  check('le rejet non géré est inscrit DANS LE RUN', Boolean(entree));
  check('…avec son code', entree?.errorCode === 'ECONNRESET');
  check('…sa pile', typeof entree?.stack === 'string');
  check('…et le PID du process qui tombe', entree?.pid === process.pid);

  garde.clearActiveRun(String(r._id));
  check('le run cesse d’être actif après l’opération', garde.getActiveRun() === null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE SUCCÈS EXIGE UNE FINALISATION VÉRIFIÉE');
{
  // 1. Destination NON finalisée : l'état exact du 06/08.
  const t1 = await cible({ state: 'DEPLOYING' });
  const r1 = await run(t1);
  const verdict1 = await final.verifyFinalization(r1._id, t1._id);

  check('une destination restée DEPLOYING n’est PAS finalisée', verdict1.finalized === false);
  check('…et la raison est nommée',
    verdict1.missing.some((m) => m.includes('state=DEPLOYING')));

  const relu1 = await DeploymentRun.findById(r1._id).lean();
  check('le run passe à « finalization_failed »', relu1.status === 'finalization_failed');
  check('…ni succès, ni échec de déploiement', relu1.status !== 'ok' && relu1.status !== 'error');
  check('…le détail des contrôles est conservé', relu1.finalization.checks.stateOk === false);
  check('…et le journal le dit', relu1.journal.some((e) => e.eventCode === 'FINALIZATION_FAILED'));

  // 2. Destination finalisée, mais port non prouvé.
  const t2 = await cible({ state: 'DEPLOYED' });
  const r2 = await run(t2);
  const verdict2 = await final.verifyFinalization(r2._id, t2._id);
  check('un port non ACTIVE suffit à refuser le succès', verdict2.finalized === false);
  check('…et le dit explicitement',
    verdict2.missing.some((m) => m.includes('réservation de port')));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE JOURNAL EST APPEND-ONLY ET EXPOSÉ PAR L’API');
{
  const t = await cible();
  const r = await run(t);

  for (const code of ['PM2_STATE_BEFORE', 'PM2_RESTART_REQUESTED', 'PM2_STATE_AFTER']) {
    await jrn.journal(r._id, {
      source: jrn.SOURCES.PM2, eventCode: code, processName: 'sbauto-demo', port: 5002, pid: 4242,
      message: `étape ${code}`,
    });
  }
  const relu = await DeploymentRun.findById(r._id).lean();
  check('les entrées s’ajoutent dans l’ordre',
    relu.journal.map((e) => e.eventCode).join(',') === 'PM2_STATE_BEFORE,PM2_RESTART_REQUESTED,PM2_STATE_AFTER');
  check('…chacune porte sa source', relu.journal.every((e) => e.source === 'PM2'));
  check('…son process et son port',
    relu.journal[0].processName === 'sbauto-demo' && relu.journal[0].port === 5002);
  check('…et son PID', relu.journal[0].pid === 4242);

  const { serializeRunFull } = await import('../services/deploymentRun.service.js');
  const vue = serializeRunFull(await DeploymentRun.findById(r._id));
  check('l’API expose le journal', Array.isArray(vue.journal) && vue.journal.length === 3);
  check('…et le verdict de finalisation quand il existe', vue.finalization === null);

  // Un runId inconnu ne doit rien casser.
  const ignore = await jrn.journal(null, { eventCode: 'X' });
  check('journaliser sans run est sans effet, pas une erreur', ignore === null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE RAPPORT DIAGNOSTIC — fait observé et cause déduite, jamais confondus');
{
  const fsUi = await import('node:fs/promises');
  const ui = (await fsUi.readFile(new URL('../../../manager/src/pages/dev/deployment/RunDiagnostics.tsx', import.meta.url), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  check('le journal est filtrable par source', /SOURCES/.test(ui));
  check('le rapport complet est copiable en un geste', /Copier le rapport/.test(ui));
  check('la cause déduite est présentée comme telle', /cause déduite/.test(ui));
  check('…distinguée des faits OBSERVÉS', /faits observés/.test(ui));
  check('…et une cause non établie est annoncée comme hypothèse',
    /NON établie/.test(ui) && /hypothèse/.test(ui));
  check('la certitude vient du journal, pas d’une supposition de l’écran',
    /certain === true/.test(ui));
  check('une entrée SANS déduction reste affichée telle quelle',
    /'causeDeduite' in d/.test(ui));
}

/* ══════════════════════════════════════════════════════════════════════════ */
console.log(`\n${ok} réussis, ${ko} échoués`);
await mongoose.disconnect();
await serveur.stop();
assert.equal(ko, 0, `${ko} vérification(s) en échec.`);
