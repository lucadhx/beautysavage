/**
 * DEPROVISION_DEPLOYMENT_RUN_RUNTIME_REGRESSION
 *
 * ══ L'INCIDENT, TEL QU'IL S'EST PRODUIT ═════════════════════════════════════
 *
 * Mes sites → Retirer le déploiement → session serveur → inventaire →
 * confirmations → clic. La checklist s'affichait, et plus rien ne bougeait.
 * Jamais. Dans le journal du backend :
 *
 *   [fail] [forensique] rejet non géré :
 *   DeploymentRun validation failed: operationType:
 *   `DEPROVISION` is not a valid enum value for path `operationType`.
 *
 * ══ LA CAUSE, ET ELLE N'A RIEN D'UN HASARD ══════════════════════════════════
 *
 * Le mot `DEPROVISION` existait PARTOUT ailleurs : le moteur (`deprovision.js`
 * et ses `DEPROVISION_STEPS`), les états du cycle de vie (`DEPROVISIONING`,
 * `DEPROVISION_FAILED`), le code d'erreur, et jusqu'à la garde
 * `activeRun.operationType !== 'DEPROVISION'` qui LE LIT pour autoriser une
 * reprise. Seul l'énuméré du modèle `DeploymentRun` ne le connaissait pas.
 *
 * Deux défauts se sont additionnés :
 *
 *   1. l'énuméré refusait une opération que tout le reste du système nomme ;
 *   2. `deprovisionStream` n'avait PAS la ceinture de sécurité de
 *      `deployStream` : l'exception, levée après l'envoi des en-têtes NDJSON,
 *      devenait un rejet non géré. Le flux restait ouvert, muet, pour
 *      toujours — et l'opérateur regardait une checklist qui ne bougerait
 *      jamais.
 *
 * ══ CE QUE CE FICHIER VERROUILLE ════════════════════════════════════════════
 *
 *   · un run de retrait se PERSISTE réellement (vrai modèle, vrai save) ;
 *   · le vocabulaire des opérations est complet et cohérent ;
 *   · le flux annonce son plan AVANT la première commande distante ;
 *   · la checklist reçoit réellement ses étapes ;
 *   · aucune exception ne peut laisser le flux muet.
 *
 * Le modèle `DeploymentRun` n'est JAMAIS simulé : c'est lui qui a refusé
 * l'opération, c'est donc lui qui doit l'accepter.
 */
import { strict as assert } from 'node:assert';

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'TEST';
process.env.ENV = process.env.ENV || 'TEST';

const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default;

const serveur = await MongoMemoryServer.create();
process.env.MONGODB_URI = serveur.getUri();
await mongoose.connect(serveur.getUri(), { dbName: 'deprovision-run-test' });

const { DeploymentRun } = await import('../models/DeploymentRun.model.js');
const { DeploymentTarget } = await import('../models/DeploymentTarget.model.js');
const PortReservation = (await import('../models/PortReservation.model.js')).default;
const runs = await import('../services/deploymentRun.service.js');
const controller = await import('../controllers/deployment.controller.js');
const { FakeTransport } = await import('../deployment-engine/transport/FakeTransport.js');
const vault = await import('../deployment-engine/passwordVault.js');
const { DEPROVISION_STEPS } = await import('../deployment-engine/deprovision.js');

await DeploymentTarget.init();
await PortReservation.init();

let ok = 0;
let ko = 0;
const check = (libelle, condition) => {
  if (condition) { ok += 1; console.log(`  ✓ ${libelle}`); }
  else { ko += 1; console.log(`  ✗ ${libelle}`); }
};
const section = (titre) => console.log(`\n${titre}`);

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE VOCABULAIRE DES OPÉRATIONS — un mot par opération, et il est connu');
{
  const chemin = DeploymentRun.schema.path('operationType');
  const valeurs = chemin.enumValues;

  check('le retrait est une opération de premier rang', valeurs.includes('DEPROVISION'));
  check('…la suppression de fiche aussi', valeurs.includes('DESTINATION_DELETE'));
  check('…et les opérations d’origine sont intactes',
    ['PRECHECK', 'DEPLOYMENT', 'ROLLBACK', 'HEALTHCHECK', 'BACKUP'].every((v) => valeurs.includes(v)));

  /**
   * AUCUNE REPRÉSENTATION CONCURRENTE. « REMOVE », « REMOVAL », « UNDEPLOY »,
   * « DELETE » nu : quatre façons de dire la même chose sont quatre façons de
   * ne pas se comprendre. Le mot du moteur fait autorité.
   */
  check('aucun synonyme n’a été introduit',
    !valeurs.some((v) => ['REMOVE', 'REMOVAL', 'UNDEPLOY', 'DELETE', 'DEPLOY'].includes(v)));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LA RÉGRESSION EXACTE — un run de retrait se persiste vraiment');
let cible;
{
  cible = await DeploymentTarget.create({
    name: 'Démo retrait',
    url: 'https://demo-retrait.exemple.test',
    host: 'demo-retrait.exemple.test',
    type: 'subdomain',
    registrableDomain: 'exemple.test',
    subdomain: 'demo-retrait',
    environment: 'TEST',
    projectKey: 'demo-retrait',
    sshHost: '203.0.113.10',
    sshUser: 'root',
    backendPort: 4310,
    remoteRoot: '/var/www',
    lifecycleStatus: 'ACTIVE',
    state: 'DEPLOYED',
    currentVersion: 'abc1234',
  });

  /**
   * C'EST EXACTEMENT L'APPEL QUI LEVAIT.
   *
   * Avant correction : `DeploymentRun validation failed: operationType:
   * DEPROVISION is not a valid enum value`. Aucun double ici — le vrai
   * service, le vrai modèle, une vraie écriture.
   */
  let leve = null;
  let run = null;
  try {
    run = await runs.createRun({
      target: cible, user: 'dev@exemple.test', version: null, operationType: 'DEPROVISION',
    });
  } catch (err) {
    leve = err;
  }

  check('créer un run de retrait ne lève PLUS de ValidationError', leve === null);
  if (leve) console.log(`      → ${leve.message}`);
  check('…le run existe en base', Boolean(run?._id));

  const relu = await DeploymentRun.findById(run?._id).lean();
  check('…et il est relu avec son opération', relu?.operationType === 'DEPROVISION');
  check('…rattaché à sa destination', String(relu?.target) === String(cible._id));
  check('…avec un horodatage de début', relu?.startedAt instanceof Date);
  check('…en statut « en cours »', relu?.status === 'running');
  check('…et l’hôte concerné', relu?.siteHost === 'demo-retrait.exemple.test');

  /** Le résumé d'un retrait ne doit PAS annoncer une publication. */
  const finalise = await runs.finalizeRun(String(run._id), {
    ok: true, status: 'ok', finalStepId: 'deprovision.finalize', steps: [],
  });
  check('un retrait réussi se résume comme un retrait, pas comme une mise en ligne',
    /vidée/i.test(finalise.summary) && !/Publié/i.test(finalise.summary));
  check('…et il porte une durée', typeof finalise.durationMs === 'number');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE FLUX RÉEL — du clic à la checklist, sans VPS mais sans doublure');
{
  await DeploymentRun.deleteMany({});
  await DeploymentTarget.updateOne({ _id: cible._id },
    { $set: { lifecycleStatus: 'ACTIVE', state: 'DEPLOYED' } });

  /**
   * UN SERVEUR SIMULÉ, ET RIEN D'AUTRE.
   *
   * Le transport est le SEUL élément remplacé : ni le contrôleur, ni le
   * moteur, ni le modèle, ni le cycle de vie. Un VPS n'est pas une preuve
   * qu'on peut apporter en test — tout le reste l'est.
   */
  const faux = new FakeTransport({ defaultResponse: { code: 0, stdout: '', stderr: '' } });
  controller.useDeploymentTransportFactory(() => faux);
  const session = vault.openSession({ host: '203.0.113.10', username: 'root', password: 'x' });

  const lignes = [];
  const res = {
    headersSent: false,
    writableEnded: false,
    statusCode: 200,
    setHeader() {},
    flushHeaders() { this.headersSent = true; },
    flush() {},
    write(chunk) {
      for (const l of String(chunk).split('\n')) {
        if (l.trim()) lignes.push(JSON.parse(l));
      }
      return true;
    },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.writableEnded = true; return this; },
    end() { this.writableEnded = true; return this; },
  };
  const req = {
    body: {
      targetId: String(cible._id),
      sessionId: session.sessionId,
      confirmHostname: 'demo-retrait.exemple.test',
      removePersistentData: false,
    },
    user: { email: 'dev@exemple.test' },
    on() {},
  };

  await controller.deprovisionStream(req, res);
  controller.useDeploymentTransportFactory(null);

  const types = lignes.map((l) => l.type);
  check('le flux s’ouvre sur le PLAN de l’opération', types[0] === 'deprovision.started');

  const plan = lignes[0]?.steps ?? [];
  check('…qui porte toutes les étapes du moteur', plan.length === DEPROVISION_STEPS.length);
  check('…dans son ordre exact',
    plan.map((s) => s.id).join() === DEPROVISION_STEPS.map((s) => s.id).join());
  check('…avec les libellés du moteur, pas une copie divergente',
    plan[0].label === DEPROVISION_STEPS[0].label);

  check('le run est annoncé dès sa création', types.includes('deprovision.run'));
  const annonce = lignes.find((l) => l.type === 'deprovision.run');
  check('…avec son identifiant', typeof annonce?.runId === 'string' && annonce.runId.length > 0);

  /* — LA CHECKLIST REÇOIT RÉELLEMENT SES ÉTAPES — */
  const etapes = lignes.filter((l) => l.type === 'step');
  const demarrees = [...new Set(etapes.filter((e) => e.status === 'running').map((e) => e.step))];
  const terminees = [...new Set(etapes.filter((e) => e.status === 'ok').map((e) => e.step))];

  check(`plusieurs étapes sont réellement démarrées (${demarrees.length})`, demarrees.length >= 4);
  check(`…et plusieurs réellement terminées (${terminees.length})`, terminees.length >= 4);
  check('chaque étape est annoncée « en cours » avant son issue',
    terminees.every((id) => demarrees.includes(id)));
  check('les identifiants d’étape sont ceux du moteur',
    demarrees.every((id) => DEPROVISION_STEPS.some((s) => s.id === id)));
  check('le verrouillage est la première étape vécue', demarrees[0] === 'deprovision.lock');
  check('…et l’inventaire la suivante', demarrees[1] === 'deprovision.inventory');

  /* — LE VERDICT ET SON RAPPORT — */
  const terminal = lignes[lignes.length - 1];
  check('le flux se termine par un verdict explicite',
    terminal.type === 'deprovision.succeeded' || terminal.type === 'deprovision.failed');
  check('…qui porte le rapport', Boolean(terminal.report));
  check('…lequel nomme l’opération', terminal.report?.identification?.operationType === 'DEPROVISION');
  check('…la destination', terminal.report?.identification?.host === 'demo-retrait.exemple.test');
  check('…une durée', typeof terminal.report?.identification?.durationMs === 'number');
  check('…les étapes réellement exécutées', (terminal.report?.steps ?? []).length >= 4);
  check('…ce qui a été retiré', terminal.report?.removed !== undefined);
  check('…et ce qui a été vérifié', terminal.report?.verifications !== undefined);
  check('le flux est bien refermé', res.writableEnded === true);

  /* — LE RUN PERSISTÉ PORTE LA MÊME HISTOIRE — */
  const persiste = await DeploymentRun.findOne({ operationType: 'DEPROVISION' }).lean();
  check('un run de retrait est persisté', Boolean(persiste));
  check('…il n’est plus « en cours »', persiste?.status !== 'running');
  check('…il porte ses étapes', (persiste?.steps ?? []).length >= 4);
  check('…et son rapport structuré, relisible après rechargement',
    persiste?.structuredReport?.identification?.operationType === 'DEPROVISION');
  check('le rapport de l’écran EST celui du run',
    persiste?.structuredReport?.identification?.runId === terminal.report?.identification?.runId);

  vault.closeAll();
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('AUCUNE EXCEPTION NE LAISSE LE FLUX MUET');
{
  /**
   * C'est la CLASSE du défaut, pas seulement son occurrence : quelle que soit
   * l'exception levée après l'envoi des en-têtes, le client reçoit un dernier
   * évènement et le flux se ferme. Une checklist qui attend éternellement est
   * pire qu'une erreur : elle ne dit même pas qu'il faut recommencer.
   */
  const cibleKo = await DeploymentTarget.create({
    name: 'Démo panne', url: 'https://demo-panne.exemple.test', host: 'demo-panne.exemple.test',
    type: 'subdomain', registrableDomain: 'exemple.test', subdomain: 'demo-panne',
    environment: 'TEST', projectKey: 'demo-panne', sshHost: '203.0.113.11', sshUser: 'root',
    backendPort: 4311, remoteRoot: '/var/www', lifecycleStatus: 'ACTIVE', state: 'DEPLOYED',
  });

  controller.useDeploymentTransportFactory(() => {
    throw new Error('panne injectée pendant la construction du transport');
  });
  const session = vault.openSession({ host: '203.0.113.11', username: 'root', password: 'x' });

  const lignes = [];
  const res = {
    headersSent: false, writableEnded: false, statusCode: 200,
    setHeader() {}, flushHeaders() { this.headersSent = true; }, flush() {},
    write(chunk) {
      for (const l of String(chunk).split('\n')) if (l.trim()) lignes.push(JSON.parse(l));
      return true;
    },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.writableEnded = true; return this; },
    end() { this.writableEnded = true; return this; },
  };
  const req = {
    body: {
      targetId: String(cibleKo._id), sessionId: session.sessionId,
      confirmHostname: 'demo-panne.exemple.test', removePersistentData: false,
    },
    user: { email: 'dev@exemple.test' },
    on() {},
  };

  let echappee = null;
  try { await controller.deprovisionStream(req, res); } catch (err) { echappee = err; }
  controller.useDeploymentTransportFactory(null);

  check('aucune exception ne s’échappe du contrôleur', echappee === null);
  check('le flux a bien été ouvert', lignes.some((l) => l.type === 'deprovision.started'));
  const dernier = lignes[lignes.length - 1];
  check('…et il se ferme sur un échec NOMMÉ, jamais sur le silence',
    dernier?.type === 'deprovision.failed');
  check('…avec un message lisible', typeof dernier?.message === 'string' && dernier.message.length > 0);
  check('la réponse est terminée', res.writableEnded === true);

  const run = await DeploymentRun.findOne({ target: cibleKo._id }).lean();
  check('le run de cette tentative n’est pas resté « en cours »',
    !run || run.status !== 'running');

  vault.closeAll();
}

/* ══════════════════════════════════════════════════════════════════════════ */
console.log(`\n${ok} réussis, ${ko} échoués`);
await mongoose.disconnect();
await serveur.stop();
assert.equal(ko, 0, `${ko} vérification(s) en échec.`);
