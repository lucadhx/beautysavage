// SSH, PM2 ET REDÉMARRAGE ATTENDU — les trois angles morts de l'incident.
//
// ══ CE QU'ILS COÛTAIENT ═════════════════════════════════════════════════════
//
// Le run du 06/08 est resté figé 8 min 36 s sur `ssh.connect` sans qu'aucune
// trace ne dise pourquoi. Le redémarrage que le backend s'inflige en déployant
// sa propre application était classé « interrompu », comme un plantage. Et un
// `pm2 restart` rendant 0 valait preuve de démarrage — c'est ainsi qu'un
// ancien service a pu garder un port pendant que le nouveau bouclait.
//
// Chaque test ci-dessous rend l'un de ces trois faits observable.
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'TEST';

const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default;

const serveur = await MongoMemoryServer.create();
process.env.MONGODB_URI = serveur.getUri();
await mongoose.connect(serveur.getUri(), { dbName: 'ssh-restart' });

const { SshTransport } = await import('../deployment-engine/transport/SshTransport.js');
const DeploymentRun = (await import('../models/DeploymentRun.model.js')).default;
const { DeploymentTarget } = await import('../models/DeploymentTarget.model.js');
const marqueur = await import('../services/deployment/forensics/restartMarker.service.js');
const etapes = await import('../services/deployment/forensics/runSteps.service.js');

let ok = 0;
let ko = 0;
const check = (libelle, condition) => {
  if (condition) { ok += 1; console.log(`  ✓ ${libelle}`); }
  else { ko += 1; console.log(`  ✗ ${libelle}`); }
};
const section = (titre) => console.log(`\n${titre}`);

await DeploymentTarget.init();

/**
 * UN CLIENT ssh2 SIMULÉ — il émet ce qu'on lui demande, quand on veut.
 *
 * Les vrais chemins de sortie de ssh2 sont exactement ceux-ci : `ready`,
 * `error`, `close`, `end`, `timeout`. Les éprouver avec un double est la seule
 * façon de vérifier qu'AUCUN ne laisse la promesse pendante — ce qui était
 * précisément le défaut.
 */
function clientSimule(evenement, { delaiMs = 5 } = {}) {
  const c = new EventEmitter();
  c.connect = () => {
    if (evenement === 'rien') return; // ne règle jamais : c'est le cas du blocage
    setTimeout(() => c.emit(evenement, evenement === 'error' ? Object.assign(new Error('refusé'), { code: 'ECONNREFUSED' }) : undefined), delaiMs);
  };
  c.end = () => {};
  c.destroy = () => {};
  return c;
}

const connecter = async (evenement, opts = {}) => {
  const vus = [];
  const tx = new SshTransport({
    host: '203.0.113.10', username: 'root', password: 'SECRET-A-NE-PAS-VOIR',
    connectTimeoutMs: opts.connectTimeoutMs ?? 200,
    clientFactory: () => clientSimule(evenement, opts),
    observer: (e) => vus.push(e),
  });
  let erreur = null;
  try { await tx._connect(); } catch (e) { erreur = e; }
  return { vus, erreur };
};

/* ══════════════════════════════════════════════════════════════════════════ */
section('SSH — chaque chemin de sortie produit SON évènement');
{
  const pret = await connecter('ready');
  check('une connexion réussie émet SSH_CONNECT_STARTED puis SSH_READY',
    pret.vus.map((e) => e.eventCode).join(',') === 'SSH_CONNECT_STARTED,SSH_READY');
  check('…et la promesse se règle sans erreur', pret.erreur === null);
  check('…avec une durée mesurée', typeof pret.vus[1].durationMs === 'number');
  check('…et l’heure de disponibilité', typeof pret.vus[1].readyAt === 'string');

  for (const [evenement, attendu] of [
    ['error', 'SSH_ERROR'],
    ['close', 'SSH_CLOSED'],
    ['end', 'SSH_ENDED'],
    ['timeout', 'SSH_TIMEOUT'],
  ]) {
    const r = await connecter(evenement);
    check(`« ${evenement} » émet ${attendu}, et pas un SSH_ERROR générique`,
      r.vus[1]?.eventCode === attendu);
    check(`…et la promesse est REJETÉE, jamais pendante (${evenement})`, r.erreur !== null);
  }

  // Le cas du 06/08 : le serveur ne répond jamais.
  const muet = await connecter('rien', { connectTimeoutMs: 120 });
  check('un serveur muet finit en SSH_TIMEOUT — plus jamais de blocage',
    muet.vus[1]?.eventCode === 'SSH_TIMEOUT');
  check('…et la promesse se règle', muet.erreur !== null);
  check('…en nommant le plafond dépassé', /Délai de connexion SSH dépassé/.test(muet.erreur.message));

  // Une tentative « started » sans issue serait invisible : on vérifie l'appariement.
  const tous = [...pret.vus, ...muet.vus];
  const demarrages = tous.filter((e) => e.eventCode === 'SSH_CONNECT_STARTED').length;
  const issues = tous.filter((e) => e.eventCode !== 'SSH_CONNECT_STARTED').length;
  check('toute tentature démarrée reçoit exactement une issue', demarrages === issues);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('SSH — aucun secret ne franchit l’observateur');
{
  const r = await connecter('ready');
  const texte = JSON.stringify(r.vus);
  check('le mot de passe n’est jamais publié', !texte.includes('SECRET-A-NE-PAS-VOIR'));
  check('…seule la MÉTHODE d’authentification l’est', r.vus[0].authMethod === 'password');
  check('…avec l’hôte', r.vus[0].host === '203.0.113.10');
  check('…le port', r.vus[0].port === 22);
  check('…et l’utilisateur', r.vus[0].username === 'root');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('SSH — le moteur reste GÉNÉRIQUE');
{
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(
    new URL('../deployment-engine/transport/SshTransport.js', import.meta.url), 'utf8',
  );
  check('le transport n’importe aucun modèle Mongo', !/from '.*models\//.test(source));
  check('…ni aucun service applicatif', !/from '.*services\//.test(source));
  check('…il se contente d’un rappel injecté', /this\._observer/.test(source));

  // Sans observateur, le comportement est strictement inchangé.
  const tx = new SshTransport({
    host: 'h', username: 'u', password: 'p',
    connectTimeoutMs: 80, clientFactory: () => clientSimule('ready'),
  });
  let leve = null;
  try { await tx._connect(); } catch (e) { leve = e; }
  check('un transport SANS observateur fonctionne à l’identique', leve === null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('REDÉMARRAGE ATTENDU — ce n’est pas un plantage');
{
  await DeploymentTarget.deleteMany({});
  const at = new Date();
  const cible = await DeploymentTarget.create({
    name: 'Demo', url: 'https://d.exemple.com', host: 'd.exemple.com', type: 'domain',
    environment: 'TEST', backendPort: 5002, lifecycleStatus: 'ACTIVE', state: 'DEPLOYING',
    createdAt: at, updatedAt: at,
  });
  const run = await DeploymentRun.create({
    target: cible._id, targetName: 'Demo', siteHost: 'd.exemple.com',
    operationType: 'DEPLOYMENT', status: 'running', startedAt: new Date(), steps: [],
  });
  await etapes.recordStep(run._id, { stepId: 'pm2', label: 'Service', status: 'running' });

  const ecrit = await marqueur.ecrireMarqueurReprise({
    runId: run._id, targetId: cible._id, operation: 'DEPLOYMENT',
    nextExpectedStep: 'health', expectedProcessName: 'sbauto-d.exemple.com', expectedPort: 5002,
  });
  check('le marqueur est écrit AVANT le redémarrage', ecrit === true);

  const relu = await marqueur.lireMarqueurReprise();
  check('…il porte le run', String(relu.run) === String(run._id));
  check('…l’étape attendue ensuite', relu.nextExpectedStep === 'health');
  check('…le service et le port attendus',
    relu.expectedProcessName === 'sbauto-d.exemple.com' && relu.expectedPort === 5002);
  check('…et le PID qui s’attendait à mourir', relu.pidBefore === process.pid);

  // Même process : le redémarrage n'a pas eu lieu. On ne conclut RIEN.
  const memeProcess = await marqueur.consommerMarqueurReprise();
  check('un process inchangé ne consomme pas le marqueur', memeProcess.consumed === false);
  check('…et le dit', memeProcess.reason === 'PROCESS_INCHANGE');
  check('…le marqueur est CONSERVÉ, pas effacé', (await marqueur.lireMarqueurReprise()) !== null);

  // Nouveau process : on simule en changeant le PID enregistré.
  const Modele = mongoose.models.DeploymentRestartMarker;
  await Modele.updateOne({ key: 'SINGLETON' }, { $set: { pidBefore: process.pid - 1 } });

  const consomme = await marqueur.consommerMarqueurReprise();
  check('un nouveau process consomme le marqueur', consomme.consumed === true);
  check('…et connaît l’étape à reprendre', consomme.nextExpectedStep === 'health');
  check('le marqueur est effacé APRÈS constat', (await marqueur.lireMarqueurReprise()) === null);

  const journal = (await DeploymentRun.findById(run._id).lean()).journal;
  const fin = journal.find((e) => e.eventCode === 'APPLICATION_RESTART_COMPLETED');
  check('le retour est journalisé', Boolean(fin));
  check('…avec l’ancien et le nouveau PID',
    fin.details.pidBefore === process.pid - 1 && fin.details.pidAfter === process.pid);
  check('…et la durée d’indisponibilité', typeof fin.details.downtimeMs === 'number');
  check('…il porte le service et le port attendus',
    fin.processName === 'sbauto-d.exemple.com' && fin.port === 5002);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('L’ORDRE AU DÉMARRAGE — marqueur d’abord, reprise générique ensuite');
{
  /**
   * ══ LA REPRISE A CHANGÉ DE FICHIER — L'ORDRE, LUI, EST INTACT ════════════
   *
   * Ces constats lisaient `server.js`. Les reprises ont rejoint
   * `structuralRecovery.service.js`, appelé par la phase de PRÉPARATION de
   * l'amorçage : elles s'exécutent désormais avant tout service de fond.
   *
   * L'ordre qu'ils protègent est exactement le même, et pour la même raison :
   * `recoverOrphanRuns()` classe tout run « en cours » comme interrompu.
   * Appelé en premier, il qualifierait d'incident un redémarrage parfaitement
   * attendu — celui que le backend provoque en déployant sa propre application.
   */
  const fs = await import('node:fs/promises');
  const reprises = (await fs.readFile(
    new URL('../services/lifecycle/structuralRecovery.service.js', import.meta.url), 'utf8',
  )).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const iMarqueur = reprises.indexOf('consommerMarqueurReprise()');
  const iReprise = reprises.indexOf('recoverOrphanRuns(');
  check('le marqueur est lu au démarrage', iMarqueur > 0);
  check('la reprise générique aussi', iReprise > 0);
  check('…et le marqueur est lu AVANT elle', iMarqueur < iReprise);

  /**
   * ET CETTE REPRISE PRÉCÈDE LES SERVICES DE FOND — c'est ce déplacement qui
   * empêche un worker d'observer un run que l'amorçage doit encore reclasser.
   */
  const amorcage = (await fs.readFile(new URL('../config/bootstrap.js', import.meta.url), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('…et toutes deux précèdent le démarrage des services de fond',
    amorcage.indexOf('await runStructuralRecovery()') < amorcage.indexOf('await demarrerServices('));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE CONTRÔLEUR ANNONCE LE REDÉMARRAGE AU FRONTEND');
{
  const fs = await import('node:fs/promises');
  const ctrl = (await fs.readFile(new URL('../controllers/deployment.controller.js', import.meta.url), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  check('l’état PM2 est capturé AVANT', /journalPm2Before\(/.test(ctrl));
  check('…et APRÈS', /journalPm2After\(/.test(ctrl));
  check('le marqueur est écrit avant le redémarrage', /ecrireMarqueurReprise\(/.test(ctrl));
  check('…et effacé après le retour du service', /effacerMarqueurReprise\(/.test(ctrl));
  check('le frontend est prévenu par un évènement dédié', /type: 'backend_restarting'/.test(ctrl));
  check('l’observateur SSH est branché sur le moteur', /engine\.transportObserver =/.test(ctrl));
  check('…et écrit dans la source SSH du journal', /source: SOURCES\.SSH/.test(ctrl));

  /**
   * OÙ VIT DÉSORMAIS CETTE GARANTIE.
   *
   * Elle était portée par `DeployRunning.tsx`, qui lisait le flux du POST de
   * lancement et y voyait passer `backend_restarting`. Le suivi appartient
   * maintenant au backend : le lanceur referme ce flux dès `run.created`, et
   * l'observation se fait sur `GET /runs/:id/observe`. L'annonce ne traverse
   * plus l'écran — attendre un `case 'backend_restarting'` reviendrait à
   * attendre un message que plus personne n'envoie.
   *
   * La GARANTIE, elle, est intacte et se vérifie ici sur le code qui la porte :
   * une coupure transitoire n'est pas une erreur de déploiement, on reprend
   * depuis le run PERSISTÉ avec un recul borné, on ne relance jamais rien, et
   * si le service ne revient pas on le DIT. Le déclencheur est même plus large
   * qu'avant : il couvre le redémarrage NON annoncé.
   */
  const hook = (await fs.readFile(
    new URL('../../../manager/src/pages/dev/deployment/useDeploymentResume.ts', import.meta.url), 'utf8',
  )).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const vue = (await fs.readFile(
    new URL('../../../manager/src/pages/dev/deployment/DeploymentFollowUp.tsx', import.meta.url), 'utf8',
  )).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  check('l’écran reconnaît une coupure de backend attendue',
    /estIndisponibiliteTransitoire\s*\(\s*err\s*\)/.test(hook));
  check('…affiche « Redémarrage du serveur… » au lieu d’une erreur',
    /Redémarrage du serveur/.test(hook) && /\{redemarrage\}/.test(vue));
  check('…se reconnecte depuis le RUN PERSISTÉ', /reprendreDepuisLeRun/.test(hook));
  check('…avec un recul borné', /RECULS/.test(hook));
  check('…et ne relance JAMAIS une seconde opération',
    !/streamDeploy|deployStream/.test(hook));
  check('…si le backend ne revient pas, il le DIT',
    /BACKEND_NOT_BACK/.test(hook) && /backendAbsent/.test(vue));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('UN REDÉMARRAGE ATTENDU NE CLÔT PLUS UN RUN ENCORE ACTIF');
{
  /**
   * La même garantie que côté Panel, avec la preuve de vie dont SB Auto
   * dispose : il exécute son pipeline DANS la requête, sans worker à qui
   * demander un battement de cœur — mais chaque étape écrite touche le
   * document, et `timestamps` en garde l'heure.
   *
   * Ce qui était impossible à distinguer : un run que plus personne n'exécute,
   * et un run qu'un autre process d'API est en train de mener. Les deux
   * étaient clos sans distinction, juste après avoir journalisé que le
   * redémarrage était attendu et confirmé.
   */
  await DeploymentTarget.deleteMany({});
  const at = new Date();
  const cible = await DeploymentTarget.create({
    name: 'Demo actif', url: 'https://actif.exemple.com', host: 'actif.exemple.com',
    type: 'domain', environment: 'TEST', backendPort: 5003,
    lifecycleStatus: 'ACTIVE', state: 'DEPLOYING', createdAt: at, updatedAt: at,
  });
  const actif = await DeploymentRun.create({
    target: cible._id, targetName: 'Demo actif', siteHost: 'actif.exemple.com',
    operationType: 'DEPLOYMENT', status: 'running', startedAt: new Date(), steps: [],
    // C'EST CE PID qui fait preuve, et non la fraîcheur des écritures : un run
    // écrit à l'instant par un process disparu est mort, pas vivant.
    executorPid: process.pid,
  });
  await etapes.recordStep(actif._id, { stepId: 'services.start', label: 'Démarrage', status: 'running' });

  await marqueur.ecrireMarqueurReprise({
    runId: actif._id, targetId: cible._id, operation: 'DEPLOYMENT',
    nextExpectedStep: 'services.verify', expectedProcessName: 'sbauto-actif', expectedPort: 5003,
  });
  await mongoose.models.DeploymentRestartMarker
    .updateOne({ key: 'SINGLETON' }, { $set: { pidBefore: process.pid - 7 } });

  const reprise = await marqueur.consommerMarqueurReprise();
  check('le redémarrage attendu est constaté', reprise.consumed === true);

  const bilan = await etapes.recoverOrphanRuns({
    reason: 'process_restart', runRepris: reprise.runId,
  });
  check('un run mené par un process VIVANT n’est pas déclaré interrompu',
    !bilan.runs.some((x) => String(x.runId ?? x) === String(actif._id)));
  check('…il est explicitement épargné',
    bilan.preservedRuns.includes(String(actif._id)));

  const relu = await DeploymentRun.findById(actif._id).lean();
  check('le run reste « en cours »', relu.status === 'running');
  const codes = relu.journal.map((e) => e.eventCode);
  check('APPLICATION_RESTART_COMPLETED est journalisé', codes.includes('APPLICATION_RESTART_COMPLETED'));
  check('…suivi de RUN_RESUMED_AFTER_EXPECTED_RESTART',
    codes.indexOf('RUN_RESUMED_AFTER_EXPECTED_RESTART') > codes.indexOf('APPLICATION_RESTART_COMPLETED'));
  check('…et la paire interdite n’apparaît JAMAIS',
    !codes.includes('RUN_INTERRUPTED_BY_PROCESS_RESTART'));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('UN RUN RÉELLEMENT ABANDONNÉ RESTE CLOS — la reprise n’invente rien');
{
  /* Un PID libre : on en cherche un qu'aucun process ne détient. */
  let pidInexistant = 999_000;
  for (; pidInexistant < 999_100; pidInexistant += 1) {
    try { process.kill(pidInexistant, 0); } catch { break; }
  }
  const cible = await DeploymentTarget.findOne({ host: 'actif.exemple.com' });
  const abandonne = await DeploymentRun.create({
    target: cible._id, targetName: 'Muet', siteHost: 'muet.exemple.com',
    operationType: 'DEPLOYMENT', status: 'running', startedAt: new Date(), steps: [],
  });
  await etapes.recordStep(abandonne._id, { stepId: 'ssh.connect', label: 'Connexion', status: 'running' });
  /**
   * Le process qui l'exécutait n'existe plus.
   *
   * C'est le cas RÉEL du préflight du 06/08 23:02 : le run écrivait encore huit
   * secondes avant le démarrage suivant. Une preuve fondée sur la fraîcheur
   * l'aurait donc épargné, et il serait resté « en cours » à jamais.
   */
  await DeploymentRun.updateOne(
    { _id: abandonne._id },
    { $set: { executorPid: pidInexistant, updatedAt: new Date() } },
  );

  const bilan = await etapes.recoverOrphanRuns({ reason: 'process_restart' });
  check('le silence prolongé vaut mort de l’exécutant', bilan.recovered >= 1);

  const relu = await DeploymentRun.findById(abandonne._id).lean();
  check('…le run est clos comme interrompu', relu.status === 'interrupted');
  check('…l’étape active devient interrompue, jamais en erreur',
    relu.steps.find((s) => s.id === 'ssh.connect').status === 'interrupted');
  check('…la cause est nommée',
    relu.journal.some((e) => e.eventCode === 'RUN_INTERRUPTED_BY_PROCESS_RESTART'));
  check('…et aucune reprise n’est prétendue',
    !relu.journal.some((e) => e.eventCode === 'RUN_RESUMED_AFTER_EXPECTED_RESTART'));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE PRÉFLIGHT DU 06/08 23:02 — un run écrit à l’instant peut être mort');
{
  const cible = await DeploymentTarget.findOne({ host: 'actif.exemple.com' });
  /**
   * Reproduction fidèle : le process s'arrête à 23:02:55.976 en pleine
   * connexion SSH, le suivant démarre huit secondes plus tard. La dernière
   * écriture est donc TRÈS fraîche — et l'exécutant pourtant bien parti.
   */
  let pidMort = 999_200;
  for (; pidMort < 999_300; pidMort += 1) {
    try { process.kill(pidMort, 0); } catch { break; }
  }

  const bloque = await DeploymentRun.create({
    target: cible._id, targetName: 'Préflight', siteHost: 'actif.exemple.com',
    operationType: 'PRECHECK', status: 'running', startedAt: new Date(), steps: [],
    executorPid: pidMort,
  });
  await etapes.recordStep(bloque._id, { stepId: 'ssh.connect', label: 'Connexion sécurisée au serveur', status: 'running' });

  const bilan = await etapes.recoverOrphanRuns({ reason: 'process_restart' });
  check('une écriture de huit secondes ne prouve PAS la vie', bilan.recovered >= 1);
  check('…le run n’est pas épargné', !bilan.preservedRuns.includes(String(bloque._id)));

  const relu = await DeploymentRun.findById(bloque._id).lean();
  check('le préflight bloqué est enfin clos', relu.status === 'interrupted');
  check('…ssh.connect cesse de tourner indéfiniment',
    relu.steps.find((s) => s.id === 'ssh.connect').status === 'interrupted');
  check('…et plus aucune étape courante ne charge', !relu.currentStepId);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('AUCUN SILENCE DU FLUX NE PEUT LAISSER LA VÉRIFICATION EN ATTENTE');
{
  const fs = await import('node:fs/promises');
  const ui = (await fs.readFile(
    new URL('../../../manager/src/pages/dev/deployment/PreflightExperience.tsx', import.meta.url), 'utf8',
  )).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  check('un chien de garde borne le silence du flux', /SILENCE_MAX_MS/.test(ui));
  check('…il est relancé à chaque évènement reçu', (ui.match(/relancerVeille\(\)/g) ?? []).length >= 2);
  check('…un silence prolongé produit un état terminal', /STREAM_SILENT/.test(ui));
  check('…et coupe la requête au lieu de l’attendre', /controller\.abort\(\)/.test(ui));
  check('…le compteur est nettoyé au démontage', /clearTimeout\(veille\)/.test(ui));

  const msg = await fs.readFile(
    new URL('../../../manager/src/pages/dev/deployment/friendly.ts', import.meta.url), 'utf8',
  );
  check('le silence a un message exploitable', /STREAM_SILENT/.test(msg));
  check('…qui dit que rien n’a été déployé', /Rien n’a été déployé/.test(msg));
  check('…et propose de relancer', /Relancez la vérification/.test(msg));
}

/* ══════════════════════════════════════════════════════════════════════════ */
console.log(`\n${ok} réussis, ${ko} échoués`);
await mongoose.disconnect();
await serveur.stop();
assert.equal(ko, 0, `${ko} vérification(s) en échec.`);
