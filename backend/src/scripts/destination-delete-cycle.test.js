/**
 * LE CYCLE COMPLET : DEPROVISION → EMPTY → DESTINATION_DELETE
 *
 * ══ L'IMPASSE RECONSTITUÉE ══════════════════════════════════════════════════
 *
 * Le forensique du 2026-08-08 est sans ambiguïté : le premier retrait de
 * `demo-sbauto.lycarz.com` a RÉUSSI — dix étapes, toutes `ok`, en onze
 * secondes, quarantaine 410 posée comprise. Ce n'est pas le retrait qui a
 * échoué.
 *
 * Ce qui a échoué, c'est la SORTIE. Deux gardes se renvoyaient l'une à l'autre :
 *
 *   retrait      → « déjà vidée, vous pouvez supprimer sa fiche »
 *   suppression  → « le domaine est encore neutralisé (410) : utilisez
 *                   Supprimer la destination avec une session serveur ouverte »
 *
 * … c'est-à-dire l'action qu'elle refusait. Et `removeQuarantine`, capable de
 * lever ce 410 depuis toujours, n'était appelée par personne.
 *
 * ══ CE QUE CE FICHIER VERROUILLE ════════════════════════════════════════════
 *
 *   · un retrait interrompu se REPREND et finit en EMPTY (jamais « inutile ») ;
 *   · une destination EMPTY + quarantinée se SUPPRIME, quarantaine levée ;
 *   · retirer A ne touche jamais B — ni son port, ni son service ;
 *   · aucune étape n'est inventée : le plan vient du moteur.
 *
 * Le transport est le seul élément simulé. Modèles, services, cycle de vie et
 * contrôleurs sont les vrais.
 */
import { strict as assert } from 'node:assert';

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'TEST';
process.env.ENV = process.env.ENV || 'TEST';

const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default;

const serveur = await MongoMemoryServer.create();
process.env.MONGODB_URI = serveur.getUri();
await mongoose.connect(serveur.getUri(), { dbName: 'destination-delete-test' });

const { DeploymentTarget } = await import('../models/DeploymentTarget.model.js');
const { DeploymentRun } = await import('../models/DeploymentRun.model.js');
const PortReservation = (await import('../models/PortReservation.model.js')).default;
const controller = await import('../controllers/deployment.controller.js');
const lifecycle = await import('../services/deployment/destinationLifecycle.service.js');
const { FakeTransport } = await import('../deployment-engine/transport/FakeTransport.js');
const vault = await import('../deployment-engine/passwordVault.js');
const {
  DEPROVISION_STEPS, DESTINATION_DELETE_STEPS, quarantineEnabledPath, quarantineConfigPath,
} = await import('../deployment-engine/deprovision.js');
const { serviceName } = await import('../deployment-engine/config/project.profile.js');

await DeploymentTarget.init();
await PortReservation.init();

let ok = 0;
let ko = 0;
const check = (libelle, condition) => {
  if (condition) { ok += 1; console.log(`  ✓ ${libelle}`); }
  else { ko += 1; console.log(`  ✗ ${libelle}`); }
};
const section = (titre) => console.log(`\n${titre}`);

/* ══════════════════════════════════════════════════════════════════════════
   UN SERVEUR SIMULÉ QUI SE SOUVIENT — sinon rien ne prouve l'idempotence.

   Un double qui répond « 0 » à tout ne peut pas distinguer « je viens de le
   faire » de « c'était déjà fait ». Celui-ci tient un état : PM2, port,
   fichiers, vhost, quarantaine — et répond comme un vrai serveur y répondrait.
   ══════════════════════════════════════════════════════════════════════════ */
function serveurSimule(etatInitial = {}) {
  const etat = {
    ...etatInitial,
    // Les collections vivantes viennent APRÈS l'étalement : sinon les tableaux
    // bruts de la fixture écraseraient les Set/Map, et l'état ne se souviendrait
    // de rien — un double amnésique ne prouve aucune idempotence.
    pm2: new Set(etatInitial.pm2 ?? []),
    ports: new Map(etatInitial.ports ?? []),
    fichiers: new Set(etatInitial.fichiers ?? []),
    nginx: new Set(etatInitial.nginx ?? []),
  };
  const tx = new FakeTransport({ defaultResponse: { code: 0, stdout: '', stderr: '' } });
  const vrai = tx.exec.bind(tx);

  tx.etat = etat;
  tx.exec = async (commande, opts) => {
    const cmd = String(commande);

    // — PM2 —
    if (/^pm2 jlist/.test(cmd)) {
      return { code: 0, stdout: JSON.stringify([...etat.pm2].map((n) => ({ name: n, pid: 1, pm2_env: { status: 'online' } }))), stderr: '' };
    }
    const del = cmd.match(/pm2 delete ([\w.-]+)/);
    if (del) { etat.pm2.delete(del[1]); return { code: 0, stdout: '', stderr: '' }; }

    // — SOCKETS —
    const ss = cmd.match(/ss -ltnp[\s\S]*grep ':(\d+) '/);
    if (ss) {
      const port = Number(ss[1]);
      const detenteur = etat.ports.get(port);
      return { code: 0, stdout: detenteur ? `LISTEN 0 511 *:${port} users:(("node",pid=1))` : 'LIBRE', stderr: '' };
    }

    // — EXISTENCE DE FICHIERS / LIENS —
    const testD = cmd.match(/^test -d (\S+) && echo OUI \|\| echo NON$/);
    if (testD) return { code: 0, stdout: etat.fichiers.has(testD[1]) ? 'OUI' : 'NON', stderr: '' };
    const testE = cmd.match(/^test -e (\S+) && echo OUI \|\| echo NON$/);
    if (testE) return { code: 0, stdout: etat.nginx.has(testE[1]) ? 'OUI' : 'NON', stderr: '' };
    const testDeux = cmd.match(/^\{ test -e (\S+) \|\| test -e (\S+); \} && echo OUI \|\| echo NON$/);
    if (testDeux) {
      return { code: 0, stdout: (etat.nginx.has(testDeux[1]) || etat.nginx.has(testDeux[2])) ? 'OUI' : 'NON', stderr: '' };
    }

    // — ÉCRITURES —
    const rm = cmd.match(/(?:sudo )?rm -f (\S+)/);
    if (rm) { etat.nginx.delete(rm[1]); return { code: 0, stdout: '', stderr: '' }; }
    const rmrf = cmd.match(/^rm -rf (\S+)$/);
    if (rmrf) { etat.fichiers.delete(rmrf[1]); return { code: 0, stdout: '', stderr: '' }; }
    const ln = cmd.match(/sudo ln -sf \S+ (\S+)/);
    if (ln) { etat.nginx.add(ln[1]); return { code: 0, stdout: '', stderr: '' }; }
    const mv = cmd.match(/sudo mv \S+ (\S+)/);
    if (mv) { etat.nginx.add(mv[1]); return { code: 0, stdout: '', stderr: '' }; }
    if (/nginx -t/.test(cmd)) {
      return { code: 0, stdout: 'syntax is ok\ntest is successful', stderr: '' };
    }
    return vrai(commande, opts);
  };
  return tx;
}

/** Un flux NDJSON capturé — la réponse Express telle que l'écran la lit. */
function fauxFlux() {
  const lignes = [];
  return {
    lignes,
    res: {
      headersSent: false, writableEnded: false, statusCode: 200, body: null,
      setHeader() {}, flushHeaders() { this.headersSent = true; }, flush() {},
      write(chunk) {
        for (const l of String(chunk).split('\n')) if (l.trim()) lignes.push(JSON.parse(l));
        return true;
      },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; this.writableEnded = true; return this; },
      end() { this.writableEnded = true; return this; },
    },
  };
}

const HOTE_A = 'legacy.exemple.test';
const HOTE_B = 'actuelle.exemple.test';
const RACINE = '/var/www';

async function ficheNeuve({ host, port, statut = 'ACTIVE', quarantine = false, nom }) {
  return DeploymentTarget.create({
    name: nom, url: `https://${host}`, host,
    type: 'subdomain', registrableDomain: 'exemple.test', subdomain: host.split('.')[0],
    environment: 'TEST', projectKey: host.split('.')[0],
    sshHost: '203.0.113.10', sshUser: 'root', backendPort: port, remoteRoot: RACINE,
    lifecycleStatus: statut, state: statut === 'ACTIVE' ? 'DEPLOYED' : 'NEW',
    quarantineEnabled: quarantine,
    currentVersion: statut === 'ACTIVE' ? 'abc1234' : null,
  });
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('INTERRUPTED_DEPROVISION_RESUME — reprendre n’est pas « inutile »');
{
  await DeploymentRun.deleteMany({});
  await DeploymentTarget.deleteMany({});
  const cible = await ficheNeuve({ host: HOTE_A, port: 5001, statut: 'RETIRED', nom: 'Legacy' });
  const pm2Nom = serviceName(HOTE_A);

  const serveurEtat = {
    pm2: [pm2Nom],
    ports: [[5001, pm2Nom]],
    fichiers: [`${RACINE}/${HOTE_A}`],
    nginx: [`/etc/nginx/sites-enabled/${HOTE_A}.conf`],
  };
  const tx = serveurSimule(serveurEtat);
  controller.useDeploymentTransportFactory(() => tx);
  const session = vault.openSession({ host: '203.0.113.10', username: 'root', password: 'x' });

  const corps = {
    targetId: String(cible._id), sessionId: session.sessionId,
    confirmHostname: HOTE_A, removePersistentData: false,
  };

  /* — PREMIER RETRAIT, INTERROMPU APRÈS LA QUARANTAINE ——————————————— */
  // Le port se libère quand PM2 disparaît : c'est ce que fait un vrai serveur.
  const suppressionPm2 = tx.exec;
  tx.exec = async (c, o) => {
    const r = await suppressionPm2(c, o);
    if (/pm2 delete/.test(String(c))) tx.etat.ports.delete(5001);
    return r;
  };

  // Interruption RÉELLE : la vérification finale échoue une fois, comme si le
  // processus avait été coupé avant d'avoir pu conclure.
  let interrompu = false;
  const avantVerif = tx.exec;
  tx.exec = async (c, o) => {
    if (!interrompu && /test -d .*legacy.* && echo OUI/.test(String(c))
        && tx.etat.nginx.has(quarantineEnabledPath(HOTE_A))) {
      interrompu = true;
      throw new Error('coupure simulée pendant la vérification finale');
    }
    return avantVerif(c, o);
  };

  const flux1 = fauxFlux();
  await controller.deprovisionStream({ body: corps, user: { email: 'dev@test' }, on() {} }, flux1.res);
  const etapes1 = flux1.lignes.filter((l) => l.type === 'step');
  const echec1 = flux1.lignes.find((l) => l.type === 'deprovision.failed');

  check('le premier retrait est interrompu, et le dit', Boolean(echec1));
  check('…mais il a bien posé la quarantaine avant',
    tx.etat.nginx.has(quarantineEnabledPath(HOTE_A)));
  check('…PM2 a réellement disparu', !tx.etat.pm2.has(pm2Nom));
  check('…le port est réellement libre', !tx.etat.ports.has(5001));
  // La coupure est intervenue APRÈS la quarantaine et AVANT la suppression
  // des fichiers — environ 70 % du chemin. C'est le cas le plus intéressant :
  // le serveur est à moitié vidé, et rien en base ne dit lesquelles des dix
  // étapes ont abouti.
  check('…mais les fichiers, eux, sont encore là', tx.etat.fichiers.has(`${RACINE}/${HOTE_A}`));

  const apres1 = await DeploymentTarget.findById(cible._id).lean();
  check('la fiche reste en échec de retrait, pas en EMPTY',
    apres1.lifecycleStatus === 'DEPROVISION_FAILED');

  /* — DEUXIÈME RETRAIT : REPRISE ——————————————————————————————————— */
  tx.exec = avantVerif; // la coupure ne se reproduit pas
  const flux2 = fauxFlux();
  await controller.deprovisionStream({ body: corps, user: { email: 'dev@test' }, on() {} }, flux2.res);

  const refus = flux2.res.body;
  check('la reprise n’est PAS refusée comme « inutile »',
    !refus || !/inutile/i.test(String(refus.message ?? '')));

  const succes2 = flux2.lignes.find((l) => l.type === 'deprovision.succeeded');
  check('…elle aboutit', Boolean(succes2));

  const etapes2 = flux2.lignes.filter((l) => l.type === 'step' && l.status !== 'running');
  const parId = new Map(etapes2.map((e) => [e.step, e]));
  check('…toutes les étapes du moteur sont repassées',
    DEPROVISION_STEPS.every((s) => parId.has(s.id)));
  /**
   * LA PREUVE D'IDEMPOTENCE : les étapes dont le travail était DÉJÀ fait
   * repassent en succès au lieu d'échouer. PM2 était supprimé, le port libre,
   * le routage retiré, la quarantaine posée — les quatre repassent `ok`.
   */
  for (const id of ['deprovision.services.stop', 'deprovision.services.verify',
    'deprovision.port.release', 'deprovision.nginx.remove', 'deprovision.quarantine']) {
    check(`…« ${id} » repasse sans erreur alors que c'était déjà fait`,
      parId.get(id)?.status === 'ok');
  }
  check('…et la suppression des fichiers, elle, s’exécute vraiment cette fois',
    parId.get('deprovision.files.remove')?.detail?.removed === true);
  check('…le dossier a bien disparu du serveur',
    !tx.etat.fichiers.has(`${RACINE}/${HOTE_A}`));
  check('…et aucune étape n’est en erreur',
    [...parId.values()].every((e) => e.status !== 'error'));

  const apres2 = await DeploymentTarget.findById(cible._id).lean();
  check('la destination est EMPTY', apres2.lifecycleStatus === 'EMPTY');
  check('…la quarantaine est connue de la fiche', apres2.quarantineEnabled === true);
  check('…et aucun verrou ne subsiste', !apres2.activeDeploymentRunId);

  const runs = await DeploymentRun.find({ operationType: 'DEPROVISION' }).lean();
  check('deux runs de retrait sont persistés, pas un', runs.length === 2);
  check('…le second est ok', runs[1].status === 'ok');
  check('…et il porte son rapport',
    runs[1].structuredReport?.identification?.operationType === 'DEPROVISION');

  controller.useDeploymentTransportFactory(null);
  vault.closeAll();
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('EMPTY_QUARANTINED_DESTINATION_DELETE — la sortie existe enfin');
{
  await DeploymentRun.deleteMany({});
  await DeploymentTarget.deleteMany({});
  const cible = await ficheNeuve({
    host: HOTE_A, port: 5001, statut: 'EMPTY', quarantine: true, nom: 'Démo',
  });

  /* — LE PIÈGE, REPRODUIT À L'IDENTIQUE ————————————————————————————— */
  let refusRetrait = null;
  try { lifecycle.assertDeprovisionable(await DeploymentTarget.findById(cible._id).lean()); }
  catch (err) { refusRetrait = err; }
  check('le retrait refuse toujours une destination déjà vidée', refusRetrait !== null);
  check('…mais il ne prétend plus qu’il suffit de supprimer la fiche',
    !/vous pouvez supprimer sa fiche/i.test(refusRetrait.message));
  check('…il nomme l’action qui débloque', /Supprimer la destination/i.test(refusRetrait.message));
  check('…et la donne à lire au client', refusRetrait.details?.nextAction === 'DESTINATION_DELETE');

  /* — LA SUPPRESSION FAIT LE TRAVAIL ————————————————————————————————— */
  const tx = serveurSimule({
    pm2: [], ports: [], fichiers: [],
    nginx: [quarantineEnabledPath(HOTE_A), quarantineConfigPath(HOTE_A)],
  });
  controller.useDeploymentTransportFactory(() => tx);
  const session = vault.openSession({ host: '203.0.113.10', username: 'root', password: 'x' });

  const flux = fauxFlux();
  await controller.destinationDeleteStream({
    body: { targetId: String(cible._id), sessionId: session.sessionId, confirmHostname: HOTE_A },
    user: { email: 'dev@test' }, on() {},
  }, flux.res);

  check('le flux s’ouvre sur le plan de la suppression',
    flux.lignes[0]?.type === 'delete.started');
  check('…qui vient du MOTEUR, pas d’une copie de l’écran',
    (flux.lignes[0]?.steps ?? []).map((s) => s.id).join()
      === DESTINATION_DELETE_STEPS.map((s) => s.id).join());
  check('…et le run est annoncé', flux.lignes.some((l) => l.type === 'delete.run'));

  const etapes = flux.lignes.filter((l) => l.type === 'step' && l.status !== 'running');
  const parId = new Map(etapes.map((e) => [e.step, e]));
  check('la levée de quarantaine est réellement exécutée',
    parId.get('delete.quarantine.release')?.status === 'ok');
  check('…la fiche est retirée', parId.get('delete.record.remove')?.status === 'ok');
  check('…toutes les étapes du plan sont passées',
    DESTINATION_DELETE_STEPS.every((s) => parId.has(s.id)));

  check('LA QUARANTAINE A DISPARU DU SERVEUR',
    !tx.etat.nginx.has(quarantineEnabledPath(HOTE_A))
    && !tx.etat.nginx.has(quarantineConfigPath(HOTE_A)));

  const succes = flux.lignes.find((l) => l.type === 'delete.succeeded');
  check('la suppression réussit', Boolean(succes));
  check('…avec son rapport', succes?.report?.identification?.operationType === 'DESTINATION_DELETE');
  check('…qui dit que la quarantaine a été levée', succes?.report?.removed?.quarantine410 === true);
  check('…et que plus rien ne reste', succes?.report?.verifications?.quarantineAbsent === true);

  const finale = await DeploymentTarget.findById(cible._id).lean();
  check('la fiche est supprimée logiquement', finale.lifecycleStatus === 'DELETED');
  check('…son historique reste lisible', finale.deletedAt != null);
  check('…et elle n’annonce plus de quarantaine', finale.quarantineEnabled === false);

  const run = await DeploymentRun.findOne({ operationType: 'DESTINATION_DELETE' }).lean();
  check('un run de suppression est persisté', Boolean(run));
  check('…terminé', run?.status === 'ok');
  check('…avec ses étapes', (run?.steps ?? []).length >= 5);

  controller.useDeploymentTransportFactory(null);
  vault.closeAll();
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('DEPROVISION_ISOLATION — retirer A ne coupe jamais B');
{
  await DeploymentRun.deleteMany({});
  await DeploymentTarget.deleteMany({});
  const legacy = await ficheNeuve({ host: HOTE_A, port: 5001, statut: 'RETIRED', nom: 'Legacy 5001' });
  const active = await ficheNeuve({ host: HOTE_B, port: 5002, statut: 'ACTIVE', nom: 'Active 5002' });

  const pm2A = serviceName(HOTE_A);
  const pm2B = serviceName(HOTE_B);
  const tx = serveurSimule({
    pm2: [pm2A, pm2B],
    ports: [[5001, pm2A], [5002, pm2B], [5100, 'panel']],
    fichiers: [`${RACINE}/${HOTE_A}`, `${RACINE}/${HOTE_B}`],
    nginx: [`/etc/nginx/sites-enabled/${HOTE_A}.conf`, `/etc/nginx/sites-enabled/${HOTE_B}.conf`],
  });
  const base = tx.exec;
  tx.exec = async (c, o) => {
    const nom = (String(c).match(/pm2 delete ([\w.-]+)/) ?? [])[1];
    const r = await base(c, o);
    // SEUL le port du process réellement supprimé se libère. Libérer tout ce
    // qui n'est pas dans PM2 effacerait le port du Panel, qui n'y est pas —
    // et le test prouverait alors le contraire de ce qu'il croit prouver.
    if (nom) {
      for (const [port, detenteur] of [...tx.etat.ports]) {
        if (detenteur === nom) tx.etat.ports.delete(port);
      }
    }
    return r;
  };
  controller.useDeploymentTransportFactory(() => tx);
  const session = vault.openSession({ host: '203.0.113.10', username: 'root', password: 'x' });

  const flux = fauxFlux();
  await controller.deprovisionStream({
    body: {
      targetId: String(legacy._id), sessionId: session.sessionId,
      confirmHostname: HOTE_A, removePersistentData: false,
    },
    user: { email: 'dev@test' }, on() {},
  }, flux.res);

  check('le retrait de la legacy aboutit',
    flux.lignes.some((l) => l.type === 'deprovision.succeeded'));

  check('LE SERVICE DE LA DESTINATION ACTIVE EST TOUJOURS LÀ', tx.etat.pm2.has(pm2B));
  check('…son port 5002 est toujours détenu', tx.etat.ports.get(5002) === pm2B);
  check('…son routage Nginx est intact',
    tx.etat.nginx.has(`/etc/nginx/sites-enabled/${HOTE_B}.conf`));
  check('…ses fichiers sont intacts', tx.etat.fichiers.has(`${RACINE}/${HOTE_B}`));
  check('LE PORT DU PANEL (5100) N’A PAS ÉTÉ TOUCHÉ', tx.etat.ports.get(5100) === 'panel');

  check('la legacy, elle, est bien vidée',
    !tx.etat.pm2.has(pm2A) && !tx.etat.ports.has(5001)
    && !tx.etat.fichiers.has(`${RACINE}/${HOTE_A}`));

  const etatB = await DeploymentTarget.findById(active._id).lean();
  check('…et la fiche de l’active n’a pas bougé',
    etatB.lifecycleStatus === 'ACTIVE' && etatB.quarantineEnabled !== true);

  /* — LE PORT PARTAGÉ EST REFUSÉ AVANT TOUTE COMMANDE ————————————————— */
  await DeploymentTarget.updateOne({ _id: active._id }, { $set: { backendPort: 5001 } });
  const doublon = await DeploymentTarget.findById(legacy._id).lean();
  const autres = await (await import('../services/deploymentTarget.service.js')).listTargets();
  let refus = null;
  try { lifecycle.assertOperationIsolated(doublon, autres); } catch (err) { refus = err; }
  check('deux fiches qui déclarent le même port : opération REFUSÉE', refus !== null);
  check('…avec un code nommé', refus?.details?.code === 'DESTINATION_PORT_SHARED');
  check('…et le nom de la destination en conflit', /Active 5002/.test(refus?.message ?? ''));

  controller.useDeploymentTransportFactory(null);
  vault.closeAll();
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('SUPPRESSION SANS QUARANTAINE — aucune session exigée pour ne rien faire');
{
  await DeploymentRun.deleteMany({});
  await DeploymentTarget.deleteMany({});
  const cible = await ficheNeuve({
    host: HOTE_A, port: 5001, statut: 'EMPTY', quarantine: false, nom: 'Sans quarantaine',
  });

  const flux = fauxFlux();
  await controller.destinationDeleteStream({
    body: { targetId: String(cible._id), confirmHostname: HOTE_A },
    user: { email: 'dev@test' }, on() {},
  }, flux.res);

  const etapes = flux.lignes.filter((l) => l.type === 'step' && l.status !== 'running');
  const parId = new Map(etapes.map((e) => [e.step, e]));
  check('les étapes serveur sont SAUTÉES, pas exécutées',
    parId.get('delete.quarantine.release')?.status === 'skipped');
  check('…avec leur raison', parId.get('delete.quarantine.release')?.reason === 'already_absent');
  check('la suppression aboutit sans session serveur',
    flux.lignes.some((l) => l.type === 'delete.succeeded'));
  check('…et la fiche est supprimée',
    (await DeploymentTarget.findById(cible._id).lean()).lifecycleStatus === 'DELETED');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('SUPPRESSION AVEC QUARANTAINE, SANS SESSION — refus explicite, pas de mur');
{
  await DeploymentRun.deleteMany({});
  await DeploymentTarget.deleteMany({});
  const cible = await ficheNeuve({
    host: HOTE_A, port: 5001, statut: 'EMPTY', quarantine: true, nom: 'Démo',
  });

  const flux = fauxFlux();
  await controller.destinationDeleteStream({
    body: { targetId: String(cible._id), confirmHostname: HOTE_A },
    user: { email: 'dev@test' }, on() {},
  }, flux.res);

  check('la suppression est refusée AVANT d’ouvrir un flux', flux.res.statusCode === 400);
  check('…avec un code exploitable', flux.res.body?.code === 'SESSION_REQUIRED');
  check('…et une consigne actionnable',
    /session serveur/i.test(flux.res.body?.message ?? ''));
  check('aucun run n’a été créé pour rien',
    (await DeploymentRun.countDocuments({ operationType: 'DESTINATION_DELETE' })) === 0);
}

/* ══════════════════════════════════════════════════════════════════════════ */
console.log(`\n${ok} réussis, ${ko} échoués`);
await mongoose.disconnect();
await serveur.stop();
assert.equal(ko, 0, `${ko} vérification(s) en échec.`);
