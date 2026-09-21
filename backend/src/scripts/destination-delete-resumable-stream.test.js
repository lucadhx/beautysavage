/**
 * LE RUN SURVIT À TOUT — flux coupé, client parti, destination disparue.
 *
 * ══ CE QUE CE FICHIER FERME ═════════════════════════════════════════════════
 *
 * Une suppression qui aboutit fait disparaître la destination PENDANT que le
 * flux est encore ouvert. Si le canal se rompt à cet instant — onglet
 * rafraîchi, réseau qui hoquette, composant remonté — le travail est fait et
 * l'écran ne le sait pas. Il n'avait alors plus aucune source : la fiche
 * n'existe plus, et le flux est mort.
 *
 * Le RUN est cette source. Il porte son plan, ses étapes, son verdict, son
 * rapport et l'instantané de ce qui a disparu. Ce fichier prouve qu'il suffit
 * — c'est-à-dire qu'on peut reconstruire l'écran de succès en n'ayant RIEN
 * d'autre que lui.
 *
 * Le transport est le seul élément simulé. Contrôleur, moteur, modèles, cycle
 * de vie et journal forensique sont les vrais.
 */
import { strict as assert } from 'node:assert';

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'TEST';
process.env.ENV = process.env.ENV || 'TEST';

const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default;

const serveur = await MongoMemoryServer.create();
process.env.MONGODB_URI = serveur.getUri();
await mongoose.connect(serveur.getUri(), { dbName: 'delete-resumable-test' });

const { DeploymentTarget } = await import('../models/DeploymentTarget.model.js');
const { DeploymentRun } = await import('../models/DeploymentRun.model.js');
const { DeploymentAttempt } = await import('../models/DeploymentAttempt.model.js');
const PortReservation = (await import('../models/PortReservation.model.js')).default;
const controller = await import('../controllers/deployment.controller.js');
const runs = await import('../services/deploymentRun.service.js');
const { FakeTransport } = await import('../deployment-engine/transport/FakeTransport.js');
const vault = await import('../deployment-engine/passwordVault.js');
const { quarantineEnabledPath, quarantineConfigPath } = await import('../deployment-engine/deprovision.js');
const { ROUTES_TRACEES } = await import('../services/deployment/forensics/httpTrace.js');

await DeploymentTarget.init();
await PortReservation.init();

let ok = 0;
let ko = 0;
const check = (libelle, condition) => {
  if (condition) { ok += 1; console.log(`  ✓ ${libelle}`); }
  else { ko += 1; console.log(`  ✗ ${libelle}`); }
};
const section = (titre) => console.log(`\n${titre}`);

const HOTE = 'legacy.exemple.test';
const HOTE_ACTIF = 'actuelle.exemple.test';

/** Un serveur qui se souvient — sinon rien ne prouve ce qui a été fait. */
function serveurSimule(nginx = []) {
  const etat = { nginx: new Set(nginx), pm2: new Set(), ports: new Map() };
  const tx = new FakeTransport({ defaultResponse: { code: 0, stdout: '', stderr: '' } });
  tx.etat = etat;
  tx.exec = async (commande) => {
    const cmd = String(commande);
    if (/^pm2 jlist/.test(cmd)) return { code: 0, stdout: '[]', stderr: '' };
    const ss = cmd.match(/ss -ltnp[\s\S]*grep ':(\d+) '/);
    if (ss) return { code: 0, stdout: etat.ports.has(Number(ss[1])) ? 'LISTEN' : 'LIBRE', stderr: '' };
    const testD = cmd.match(/^test -d (\S+) && echo OUI \|\| echo NON$/);
    if (testD) return { code: 0, stdout: 'NON', stderr: '' };
    const testE = cmd.match(/^test -e (\S+) && echo OUI \|\| echo NON$/);
    if (testE) return { code: 0, stdout: etat.nginx.has(testE[1]) ? 'OUI' : 'NON', stderr: '' };
    const deux = cmd.match(/^\{ test -e (\S+) \|\| test -e (\S+); \} && echo OUI \|\| echo NON$/);
    if (deux) return { code: 0, stdout: (etat.nginx.has(deux[1]) || etat.nginx.has(deux[2])) ? 'OUI' : 'NON', stderr: '' };
    const rm = cmd.match(/(?:sudo )?rm -f (\S+)/);
    if (rm) { etat.nginx.delete(rm[1]); return { code: 0, stdout: '', stderr: '' }; }
    if (/nginx -t/.test(cmd)) return { code: 0, stdout: 'syntax is ok\ntest is successful', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  return tx;
}

/**
 * Une réponse Express capturée. `couperApres` simule un CLIENT QUI RACCROCHE :
 * les écritures suivantes échouent, exactement comme sur une socket morte.
 */
function fauxFlux({ couperApres = null, jeterApresHeaders = false } = {}) {
  const lignes = [];
  let ecrites = 0;
  return {
    lignes,
    get coupe() { return couperApres !== null && ecrites >= couperApres; },
    res: {
      headersSent: false, writableEnded: false, statusCode: 200, body: null,
      setHeader() {}, flush() {},
      flushHeaders() {
        this.headersSent = true;
        if (jeterApresHeaders) throw new Error('panne injectée après envoi des en-têtes');
      },
      write(chunk) {
        ecrites += 1;
        if (couperApres !== null && ecrites > couperApres) {
          throw new Error('EPIPE : le client a raccroché');
        }
        for (const l of String(chunk).split('\n')) if (l.trim()) lignes.push(JSON.parse(l));
        return true;
      },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; this.writableEnded = true; return this; },
      end() { this.writableEnded = true; return this; },
    },
  };
}

async function fiche({ host, port, statut = 'EMPTY', quarantine = true, nom }) {
  return DeploymentTarget.create({
    name: nom, url: `https://${host}`, host,
    type: 'subdomain', registrableDomain: 'exemple.test', subdomain: host.split('.')[0],
    environment: 'TEST', projectKey: host.split('.')[0],
    sshHost: '203.0.113.10', sshUser: 'root', backendPort: port, remoteRoot: '/var/www',
    lifecycleStatus: statut, state: 'NEW', quarantineEnabled: quarantine,
  });
}

const requete = (cible, session, extra = {}) => ({
  body: {
    targetId: String(cible._id),
    ...(session ? { sessionId: session.sessionId } : {}),
    confirmHostname: cible.host,
  },
  user: { email: 'dev@test' },
  on() {},
  forensics: { requestId: 'req-test', async lier() {}, async note() {} },
  ...extra,
});

/* ══════════════════════════════════════════════════════════════════════════ */
section('A — SUCCÈS NOMINAL : un clic, un run, un verdict');
{
  await DeploymentRun.deleteMany({}); await DeploymentTarget.deleteMany({});
  const cible = await fiche({ host: HOTE, port: 5001, nom: 'Démo' });
  const tx = serveurSimule([quarantineEnabledPath(HOTE), quarantineConfigPath(HOTE)]);
  controller.useDeploymentTransportFactory(() => tx);
  const session = vault.openSession({ host: '203.0.113.10', username: 'root', password: 'x' });

  const flux = fauxFlux();
  await controller.destinationDeleteStream(requete(cible, session), flux.res);

  check('la suppression aboutit', flux.lignes.some((l) => l.type === 'delete.succeeded'));
  check('UN SEUL run a été créé',
    (await DeploymentRun.countDocuments({ operationType: 'DESTINATION_DELETE' })) === 1);
  check('…et le flux est refermé', flux.res.writableEnded === true);
  check('le runId est annoncé AVANT toute commande distante',
    flux.lignes.findIndex((l) => l.type === 'delete.run')
      < flux.lignes.findIndex((l) => l.type === 'step'));
  vault.closeAll();
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('C/D/F — LE CLIENT RACCROCHE : le serveur finit, le RUN raconte');
{
  await DeploymentRun.deleteMany({}); await DeploymentTarget.deleteMany({});
  const cible = await fiche({ host: HOTE, port: 5001, nom: 'Démo' });
  const tx = serveurSimule([quarantineEnabledPath(HOTE), quarantineConfigPath(HOTE)]);
  controller.useDeploymentTransportFactory(() => tx);
  const session = vault.openSession({ host: '203.0.113.10', username: 'root', password: 'x' });

  // Le client raccroche après trois lignes — bien avant le verdict.
  const flux = fauxFlux({ couperApres: 3 });
  let echappee = null;
  try { await controller.destinationDeleteStream(requete(cible, session), flux.res); }
  catch (err) { echappee = err; }

  check('aucune exception ne s’échappe malgré la socket morte', echappee === null);
  check('le client n’a reçu que le début', flux.lignes.length === 3);
  check('…et n’a JAMAIS vu le verdict',
    !flux.lignes.some((l) => l.type === 'delete.succeeded'));

  /* — LE SERVEUR, LUI, A TERMINÉ — */
  const relue = await DeploymentTarget.findById(cible._id).lean();
  check('LA DESTINATION EST BIEN SUPPRIMÉE', relue.lifecycleStatus === 'DELETED');
  check('…et la quarantaine a été levée sur le serveur',
    !tx.etat.nginx.has(quarantineEnabledPath(HOTE)));

  /* — LE RUN SUFFIT À RECONSTRUIRE L'ÉCRAN — */
  const run = await DeploymentRun.findOne({ operationType: 'DESTINATION_DELETE' }).lean();
  const vue = runs.serializeRunFull(run);
  check('le run est terminal et positif', vue.status === 'ok');
  check('…il porte ses étapes', (vue.steps ?? []).length >= 5);
  check('…son rapport structuré', Boolean(vue.structuredReport));
  check('…et L’INSTANTANÉ de ce qui a disparu',
    vue.structuredReport?.deletedTargetSnapshot?.host === HOTE);
  check('…avec de quoi tout afficher sans la fiche',
    Boolean(vue.structuredReport.deletedTargetSnapshot.name)
    && vue.structuredReport.deletedTargetSnapshot.environment === 'TEST');

  /**
   * LA PREUVE DEMANDÉE : on rend la destination TOTALEMENT inaccessible, et
   * l'écran de succès reste reconstructible depuis le seul run.
   */
  await DeploymentTarget.deleteMany({});
  check('la fiche n’existe plus DU TOUT', (await DeploymentTarget.countDocuments({})) === 0);
  const apres = runs.serializeRunFull(await DeploymentRun.findById(run._id).lean());
  check('le run reste lisible sans aucune destination en base', apres.status === 'ok');
  check('…son rapport aussi', apres.structuredReport.deletedTargetSnapshot.host === HOTE);
  check('…et il nomme son opération', apres.operationType === 'DESTINATION_DELETE');
  vault.closeAll();
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('E — EXCEPTION APRÈS LES EN-TÊTES : verdict d’erreur, jamais le silence');
{
  await DeploymentRun.deleteMany({}); await DeploymentTarget.deleteMany({});
  const cible = await fiche({ host: HOTE, port: 5001, nom: 'Démo' });
  controller.useDeploymentTransportFactory(() => {
    throw new Error('panne injectée pendant la construction du transport');
  });
  const session = vault.openSession({ host: '203.0.113.10', username: 'root', password: 'x' });

  const flux = fauxFlux();
  let echappee = null;
  try { await controller.destinationDeleteStream(requete(cible, session), flux.res); }
  catch (err) { echappee = err; }

  check('aucune exception ne s’échappe du contrôleur', echappee === null);
  const dernier = flux.lignes[flux.lignes.length - 1];
  check('le flux se ferme sur un échec NOMMÉ', dernier?.type === 'delete.failed');
  check('…avec un message lisible', typeof dernier?.message === 'string' && dernier.message.length > 0);
  check('…et la réponse est terminée', flux.res.writableEnded === true);

  const run = await DeploymentRun.findOne({ operationType: 'DESTINATION_DELETE' }).lean();
  check('le run n’est pas resté « en cours »', run.status !== 'running');
  check('…et la destination n’a PAS été supprimée',
    (await DeploymentTarget.findById(cible._id).lean()).lifecycleStatus === 'EMPTY');
  vault.closeAll();
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('ERREUR AVANT LES EN-TÊTES : un vrai statut HTTP, pas un flux');
{
  await DeploymentRun.deleteMany({}); await DeploymentTarget.deleteMany({});
  const cible = await fiche({ host: HOTE, port: 5001, nom: 'Démo' });

  const flux = fauxFlux();
  await controller.destinationDeleteStream(requete(cible, null), flux.res);

  check('la suppression est refusée AVANT l’ouverture du flux', flux.res.statusCode === 400);
  check('…avec un code exploitable', flux.res.body?.code === 'SESSION_REQUIRED');
  check('…et aucun run n’est créé pour rien',
    (await DeploymentRun.countDocuments({ operationType: 'DESTINATION_DELETE' })) === 0);
  check('…aucune ligne NDJSON n’a été écrite', flux.lignes.length === 0);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('G — DOUBLE VERDICT : idempotent, jamais deux suppressions');
{
  await DeploymentRun.deleteMany({}); await DeploymentTarget.deleteMany({});
  const cible = await fiche({ host: HOTE, port: 5001, nom: 'Démo' });
  const tx = serveurSimule([quarantineEnabledPath(HOTE), quarantineConfigPath(HOTE)]);
  controller.useDeploymentTransportFactory(() => tx);
  const session = vault.openSession({ host: '203.0.113.10', username: 'root', password: 'x' });

  const flux1 = fauxFlux();
  await controller.destinationDeleteStream(requete(cible, session), flux1.res);
  check('le premier appel réussit', flux1.lignes.some((l) => l.type === 'delete.succeeded'));

  // Un second clic — ou un second flux — sur une fiche déjà supprimée.
  const flux2 = fauxFlux();
  await controller.destinationDeleteStream(requete(cible, session), flux2.res);

  check('le second est REFUSÉ, pas rejoué', flux2.res.statusCode === 409 || flux2.res.statusCode === 400);
  check('…et il ne crée pas un second run',
    (await DeploymentRun.countDocuments({ operationType: 'DESTINATION_DELETE' })) === 1);
  check('…la destination reste supprimée une seule fois',
    (await DeploymentTarget.findById(cible._id).lean()).lifecycleStatus === 'DELETED');
  vault.closeAll();
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('I — LES AUTRES DESTINATIONS NE BOUGENT PAS');
{
  await DeploymentRun.deleteMany({}); await DeploymentTarget.deleteMany({});
  const legacy = await fiche({ host: HOTE, port: 5001, nom: 'Legacy' });
  const active = await fiche({
    host: HOTE_ACTIF, port: 5002, statut: 'ACTIVE', quarantine: false, nom: 'Active',
  });

  const tx = serveurSimule([quarantineEnabledPath(HOTE), quarantineConfigPath(HOTE)]);
  controller.useDeploymentTransportFactory(() => tx);
  const session = vault.openSession({ host: '203.0.113.10', username: 'root', password: 'x' });

  const flux = fauxFlux();
  await controller.destinationDeleteStream(requete(legacy, session), flux.res);
  check('la legacy est supprimée', flux.lignes.some((l) => l.type === 'delete.succeeded'));

  const restante = await DeploymentTarget.findById(active._id).lean();
  check('LA DESTINATION ACTIVE EST INTACTE', restante.lifecycleStatus === 'ACTIVE');
  check('…son port 5002 n’a pas bougé', restante.backendPort === 5002);
  check('…sa quarantaine n’a pas été touchée', restante.quarantineEnabled !== true);
  check('…et sa configuration Nginx n’a jamais été visée',
    !tx.etat.nginx.has(quarantineEnabledPath(HOTE_ACTIF)));
  vault.closeAll();
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('FORENSICS — la route est tracée, et le run porte son journal');
{
  check('la route de suppression fait partie du périmètre tracé',
    ROUTES_TRACEES.includes('/destination-delete/stream'));

  await DeploymentRun.deleteMany({}); await DeploymentTarget.deleteMany({});
  await DeploymentAttempt.deleteMany({});
  const cible = await fiche({ host: HOTE, port: 5001, nom: 'Démo' });
  const tx = serveurSimule([quarantineEnabledPath(HOTE), quarantineConfigPath(HOTE)]);
  controller.useDeploymentTransportFactory(() => tx);
  const session = vault.openSession({ host: '203.0.113.10', username: 'root', password: 'x' });

  const flux = fauxFlux();
  await controller.destinationDeleteStream(requete(cible, session), flux.res);
  // Le journal s'écrit au mieux, sans bloquer l'opération : on lui laisse le
  // temps d'atterrir avant de le lire.
  await new Promise((r) => { setTimeout(r, 250); });

  const run = await DeploymentRun.findOne({ operationType: 'DESTINATION_DELETE' }).lean();
  // Le journal vit DANS le run — la tentative HTTP, elle, est ouverte par le
  // middleware et n'existe pas quand on appelle le contrôleur directement.
  const journal = run.journal ?? [];
  const codes = journal.map((e) => e.eventCode);

  check(`le run porte un journal (${journal.length} entrée(s))`, journal.length > 0);
  check('…l’ouverture de l’opération y est', codes.includes('HTTP_STREAM_OPENED'));
  check('…les étapes aussi', codes.includes('STEP_SUCCEEDED'));
  check('…et la finalisation', codes.includes('FINALIZATION_SUCCEEDED'));
  check('aucune entrée ne porte de secret',
    !JSON.stringify(journal).match(/password|motdepasse|sshPass/i));
  vault.closeAll();
  controller.useDeploymentTransportFactory(null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
console.log(`\n${ok} réussis, ${ko} échoués`);
await mongoose.disconnect();
await serveur.stop();
assert.equal(ko, 0, `${ko} vérification(s) en échec.`);
