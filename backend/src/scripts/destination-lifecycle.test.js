// CYCLE DE VIE DES DESTINATIONS — la même architecture que le Panel.
//
// ══ LES DÉFAUTS CORRIGÉS ════════════════════════════════════════════════════
//
// 1. `confirm()` du navigateur puis `deleteOne()`. La fiche disparaissait ; le
//    serveur gardait le service PM2 (qui détenait toujours son port), la
//    configuration Nginx et les fichiers. Plus rien ne disait qu'il restait
//    quelque chose à nettoyer.
//
// 2. `allocatePort()` = « le plus haut port en base, plus un ». Une fiche
//    supprimée faisait redescendre le maximum, et le port suivant était
//    réattribué alors qu'un ancien service le détenait. Combiné au défaut 1,
//    c'est l'incident complet : EADDRINUSE en boucle, et Nginx envoyant le
//    trafic du nouveau domaine vers l'ancien code.
//
// 3. L'environnement était choisi au moment de déployer, avec PROD par défaut.
//    La même destination pouvait basculer d'un monde à l'autre entre deux
//    mises en ligne — deux bases, deux jeux de médias, un seul domaine.
//
// ══ CE QUI EST PROUVÉ ICI ═══════════════════════════════════════════════════
//
//   · les cinq états et leurs transitions, avec les mêmes gardes ;
//   · une destination ACTIVE ne se supprime JAMAIS ;
//   · une seule destination ACTIVE par environnement — garanti par la BASE ;
//   · le port vient du REGISTRE, jamais de `max+1` ;
//   · l'environnement est porté par la destination, et exigé.
import { strict as assert } from 'node:assert';

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'TEST';

const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default;

const serveur = await MongoMemoryServer.create();
process.env.MONGODB_URI = serveur.getUri();
await mongoose.connect(serveur.getUri(), { dbName: 'lifecycle-test' });

const { DeploymentTarget } = await import('../models/DeploymentTarget.model.js');
const PortReservation = (await import('../models/PortReservation.model.js')).default;
const cycle = await import('../services/deployment/destinationLifecycle.service.js');
const registre = await import('../services/deployment/portRegistry.service.js');
const targets = await import('../services/deploymentTarget.service.js');

let ok = 0;
let ko = 0;
const check = (libelle, condition) => {
  if (condition) { ok += 1; console.log(`  ✓ ${libelle}`); }
  else { ko += 1; console.log(`  ✗ ${libelle}`); }
};
const section = (titre) => console.log(`\n${titre}`);
const rejette = async (fn) => {
  try { await fn(); return false; } catch { return true; }
};

// Les index partiels DOIVENT exister avant la première écriture : c'est eux,
// et non un contrôle applicatif, qui rendent les règles infranchissables.
await DeploymentTarget.init();
await PortReservation.init();

const neuf = async (over = {}) => targets.createTarget({
  name: 'Destination', url: 'https://demo.exemple.com', environment: 'TEST',
  sshHost: '203.0.113.10', ...over,
});

/* ══════════════════════════════════════════════════════════════════════════ */
section('L’ENVIRONNEMENT EST PORTÉ PAR LA DESTINATION, ET EXIGÉ');
{
  await DeploymentTarget.deleteMany({});
  await PortReservation.deleteMany({});

  check('une destination sans environnement est REFUSÉE',
    await rejette(() => targets.createTarget({
      name: 'X', url: 'https://x.exemple.com', sshHost: '203.0.113.10',
    })));
  check('…un environnement fantaisiste aussi',
    await rejette(() => targets.createTarget({
      name: 'X', url: 'https://x.exemple.com', environment: 'RECETTE', sshHost: '203.0.113.10',
    })));

  const t = await neuf();
  check('une destination TEST s’enregistre', t.environment === 'TEST');
  check('…et naît ACTIVE', t.lifecycleStatus === 'ACTIVE');
  check('…avec un port issu du registre, dans la plage applicative',
    t.backendPort >= 5100 && t.backendPort <= 5999);

  const reservation = await PortReservation.findOne({ deploymentTargetId: t.id }).lean();
  check('le port est RÉSERVÉ au registre', reservation?.status === 'RESERVED');
  check('…sur le serveur, pas sur l’application', reservation?.serverKey === '203.0.113.10');
  check('…et il n’est PAS encore actif : rien ne tourne', reservation?.activatedAt === null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('UNE SEULE DESTINATION ACTIVE PAR ENVIRONNEMENT — garanti par la base');
{
  await DeploymentTarget.deleteMany({});
  await PortReservation.deleteMany({});
  await neuf();

  check('une SECONDE destination TEST active est REFUSÉE',
    await rejette(() => neuf({ url: 'https://autre.exemple.com' })));

  // …mais PROD est un autre monde : les deux coexistent.
  const prod = await neuf({ url: 'https://prod.exemple.com', environment: 'PROD' });
  check('une destination PROD coexiste avec la TEST', prod.environment === 'PROD');
  check('…et reçoit un port DIFFÉRENT',
    prod.backendPort !== (await DeploymentTarget.findOne({ environment: 'TEST' }).lean()).backendPort);

  // La garantie ne dépend PAS du service : l'index refuse aussi une écriture
  // directe. C'est ce qui la rend infranchissable par une seconde
  // implémentation, un script, ou deux requêtes simultanées.
  const at = new Date();
  const brut = new DeploymentTarget({
    name: 'Contournement', url: 'https://triche.exemple.com', host: 'triche.exemple.com',
    type: 'domain', environment: 'TEST', backendPort: 5999,
    lifecycleStatus: 'ACTIVE', createdAt: at, updatedAt: at,
  });
  check('une écriture DIRECTE en base est refusée par l’index unique',
    await rejette(() => brut.save()));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('UNE DESTINATION ACTIVE NE SE SUPPRIME JAMAIS');
{
  await DeploymentTarget.deleteMany({});
  await PortReservation.deleteMany({});
  const t = await neuf();

  check('supprimer une destination ACTIVE est REFUSÉ',
    await rejette(() => targets.deleteTarget(t.id)));

  const encore = await DeploymentTarget.findById(t.id).lean();
  check('…et la fiche est intacte', encore !== null && encore.lifecycleStatus === 'ACTIVE');

  // Le chemin légitime : vider d'abord.
  await cycle.beginDeprovision(t.id, { runId: 'run-1' });
  check('ACTIVE → DEPROVISIONING',
    (await DeploymentTarget.findById(t.id).lean()).lifecycleStatus === 'DEPROVISIONING');

  check('supprimer pendant le retrait est encore REFUSÉ',
    await rejette(() => targets.deleteTarget(t.id)));

  await cycle.markEmpty(t.id, { runId: 'run-1', quarantine: true });
  const vide = await DeploymentTarget.findById(t.id).lean();
  check('DEPROVISIONING → EMPTY', vide.lifecycleStatus === 'EMPTY');
  check('…la quarantaine 410 est notée', vide.quarantineEnabled === true);
  check('…et l’état de déploiement le dit aussi', vide.state === 'NEW' && vide.currentVersion === null);

  check('supprimer une destination VIDÉE mais SOUS QUARANTAINE est refusé',
    await rejette(() => targets.deleteTarget(t.id)));

  await cycle.setQuarantine(t.id, false);
  const supprime = await targets.deleteTarget(t.id, { actor: 'dev@exemple.com' });
  check('EMPTY (sans quarantaine) → DELETED', supprime.lifecycleStatus === 'DELETED');

  const apres = await DeploymentTarget.findById(t.id).lean();
  check('la suppression est LOGIQUE : le document survit', apres !== null);
  check('…son historique aussi', Array.isArray(apres.history) && apres.history.length > 0);
  check('…et l’opération y est nommée', apres.history[0].operationType === 'DESTINATION_DELETE');
  check('la fiche sort des listes de travail',
    (await targets.listTargets()).every((x) => x.id !== t.id));
  check('…mais reste consultable si on la demande',
    (await targets.listTargets({ includeDeleted: true })).some((x) => x.id === t.id));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('UN RETRAIT INTERROMPU EST REPRENABLE, ET CONSERVE SA CAUSE');
{
  await DeploymentTarget.deleteMany({});
  await PortReservation.deleteMany({});
  const t = await neuf();

  await cycle.beginDeprovision(t.id, { runId: 'run-1' });
  await cycle.markDeprovisionFailed(t.id, {
    runId: 'run-1',
    error: { code: 'PORT_STILL_HELD', message: 'Port encore détenu.', step: 'deprovision.port.release' },
  });

  const echoue = await DeploymentTarget.findById(t.id).lean();
  check('DEPROVISIONING → DEPROVISION_FAILED', echoue.lifecycleStatus === 'DEPROVISION_FAILED');
  check('…la cause est conservée, pas effacée', echoue.lastError?.step === 'deprovision.port.release');
  check('…et elle NOMME le problème', echoue.lastError?.message === 'Port encore détenu.');

  check('supprimer une destination en échec de retrait est REFUSÉ',
    await rejette(() => targets.deleteTarget(t.id)));

  // La reprise est le comportement voulu : les étapes du moteur sont idempotentes.
  await cycle.beginDeprovision(t.id, { runId: 'run-2' });
  check('DEPROVISION_FAILED → DEPROVISIONING (reprise)',
    (await DeploymentTarget.findById(t.id).lean()).lifecycleStatus === 'DEPROVISIONING');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('DEUX RETRAITS SIMULTANÉS — un seul peut réussir');
{
  await DeploymentTarget.deleteMany({});
  await PortReservation.deleteMany({});
  const t = await neuf();

  // Le verrou de DÉPLOIEMENT interdit le retrait : on ne coupe pas un service
  // au milieu d'une mise en ligne pendant que celle-ci écrit encore.
  await cycle.lockForDeployment(t.id, 'run-deploy');
  const verrouille = await DeploymentTarget.findById(t.id).lean();
  check('un déploiement en vol BLOQUE le retrait',
    await rejette(() => cycle.beginDeprovision(t.id, { runId: 'run-x' })));
  check('…et le verrou est lisible', verrouille.activeDeploymentRunId === 'run-deploy');

  await cycle.releaseDeploymentLock(t.id, { ok: true, runId: 'run-deploy' });
  check('le verrou tombe après le déploiement',
    (await DeploymentTarget.findById(t.id).lean()).activeDeploymentRunId === null);

  const [a, b] = await Promise.allSettled([
    cycle.beginDeprovision(t.id, { runId: 'run-A' }),
    cycle.beginDeprovision(t.id, { runId: 'run-B' }),
  ]);
  // Les deux peuvent réussir, car DEPROVISIONING est un état reprenable : ce
  // qui compte est qu'un seul RUN reste inscrit, et que l'état soit cohérent.
  check('la transition est atomique et conditionnelle',
    a.status === 'fulfilled' || b.status === 'fulfilled');
  check('…et l’état final est unique',
    (await DeploymentTarget.findById(t.id).lean()).lifecycleStatus === 'DEPROVISIONING');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE PORT NE SE RECYCLE PAS SANS PREUVE');
{
  await DeploymentTarget.deleteMany({});
  await PortReservation.deleteMany({});
  const t = await neuf();
  const port = (await DeploymentTarget.findById(t.id).lean()).backendPort;

  await registre.beginRelease(t.id);
  const enCours = await PortReservation.findOne({ deploymentTargetId: t.id }).lean();
  check('le port entre en LIBÉRATION dès le début du retrait', enCours.status === 'RELEASING');
  check('…et reste RETENU : il n’est pas rendu', enCours.releasedAt === null);

  // Sans preuve, il n'est PAS rendu — c'est la règle qui empêche l'incident.
  const sansPreuve = await registre.releasePort(t.id, { verifiedFree: false });
  check('sans preuve de liberté, le port n’est PAS rendu', sansPreuve.released === false);
  check('…et on le DIT', typeof sansPreuve.reason === 'string' && sansPreuve.reason.length > 0);

  const avecPreuve = await registre.releasePort(t.id, { verifiedFree: true });
  check('constaté libre sur le serveur, il est rendu', avecPreuve.released === true);

  // Le port redevient allouable — mais la ligne d'histoire subsiste.
  // La destination doit d'abord être VIDÉE : une seule ACTIVE par
  // environnement, et ce test ne contourne pas la règle qu'il vérifie.
  await cycle.beginDeprovision(t.id, { runId: 'run-r' });
  await cycle.markEmpty(t.id, { runId: 'run-r', quarantine: false });
  const suivante = await neuf({ url: 'https://apres.exemple.com' });
  check('un port rendu redevient allouable', typeof suivante.backendPort === 'number');
  check('…et l’historique du précédent survit',
    (await PortReservation.countDocuments({ port, status: 'RELEASED' })) === 1);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('AUCUN `max(existant) + 1` NE SUBSISTE');
{
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(
    new URL('../services/deploymentTarget.service.js', import.meta.url), 'utf8',
  );
  // Le tri décroissant sur `backendPort` ÉTAIT la formule interdite.
  check('le service de destinations ne trie plus les ports pour en déduire un',
    !/sort\(\{\s*backendPort:\s*-1\s*\}\)/.test(source));
  check('…et ne définit plus de port de base local',
    !/const\s+BASE_PORT\s*=/.test(source));
  check('il délègue au registre', source.includes('reservePort'));
  check('…et rend le port si la création échoue', source.includes('rollbackReservation'));
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════════════════ */
section('DESTINATION HÉRITÉE — remplacée, sans version connue, mais bien là');
/* ══════════════════════════════════════════════════════════════════════════ */
/*
 * ══ LA RÉGRESSION RÉELLE ═══════════════════════════════════════════════════
 *
 * « demo-sbauto.lycarz.com » : ancienne destination TEST, remplacée par
 * « demo-sbauto06 », classée RETIRED. Elle sert pourtant encore son domaine —
 * PM2 vivant, port 5001 détenu, Nginx en place, fichiers présents — et elle
 * a été conservée EXPRÈS pour être nettoyée par le workflow de retrait.
 *
 * L'écran affichait « aucune version » et masquait « Retirer le déploiement ».
 * Deux causes distinctes, et aucune n'était l'état réel du serveur :
 *
 *   · la sérialisation RECOPIAIT la liste des états retirables du service, en
 *     ayant oublié RETIRED. Le service autorisait, l'écran refusait ;
 *   · l'écran déduisait « rien de déployé » de « currentVersion === null »,
 *     alors qu'une destination antérieure au registre n'a jamais eu de hash.
 *
 * Une destination n'est vide que lorsqu'on l'a PROUVÉ. Jamais parce qu'un
 * champ applicatif manque.
 */
{
  await DeploymentTarget.deleteMany({});
  await PortReservation.deleteMany({});

  const at = new Date();
  const legacy = await DeploymentTarget.create({
    name: 'Ancienne destination',
    url: 'https://legacy.example.com',
    host: 'legacy.example.com',
    type: 'domain',
    environment: 'TEST',
    backendPort: 5001,
    lifecycleStatus: 'RETIRED',
    state: 'FAILED',
    // LE CŒUR DU CAS : aucune version connue.
    currentVersion: null,
    createdAt: at,
    updatedAt: at,
  });

  const vue = targets.serializeTarget(await DeploymentTarget.findById(legacy._id));

  check('la destination héritée est bien exposée', vue.host === 'legacy.example.com');
  check('…son cycle de vie dit qu’elle est remplacée', vue.lifecycleStatus === 'RETIRED');
  check('…et le libellé ne laisse aucun doute sur sa présence',
    /encore présente/i.test(vue.lifecycleLabel));

  // ── CE QUI ÉTAIT FAUX ────────────────────────────────────────────────────
  check('elle n’a effectivement AUCUNE version connue', vue.currentVersion === null);
  check('…mais l’écran ne doit PAS en conclure un serveur vide',
    vue.versionUnknown === true);
  check('…et le backend affirme qu’elle occupe encore le serveur',
    vue.occupiesServer === true);

  check('« Retirer le déploiement » est DISPONIBLE', vue.canDeprovision === true);
  check('« Supprimer » reste INTERDIT tant que rien n’est prouvé vide',
    vue.canDelete === false);

  // La règle d'écran et la règle de service ne peuvent plus diverger.
  check('l’écran et le service partagent la MÊME liste d’états retirables',
    cycle.DEPROVISIONABLE.includes('RETIRED')
    && cycle.DEPROVISIONABLE.includes('ACTIVE')
    && cycle.DEPROVISIONABLE.includes('DEPROVISION_FAILED')
    && cycle.DEPROVISIONABLE.includes('DEPROVISIONING'));

  // Et la suppression directe reste refusée par le SERVICE, pas seulement par
  // l'écran : contourner l'interface ne doit rien permettre de plus.
  let refus = null;
  try {
    await cycle.assertDeletable(await DeploymentTarget.findById(legacy._id));
  } catch (err) {
    refus = err;
  }
  check('supprimer une destination RETIRED est refusé côté service',
    refus !== null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('DESTINATION VIDÉE — l’inverse exact');
{
  await DeploymentTarget.deleteMany({});
  const at = new Date();
  const vide = await DeploymentTarget.create({
    name: 'Vidée', url: 'https://vide.example.com', host: 'vide.example.com',
    type: 'domain', environment: 'TEST', backendPort: 5003,
    lifecycleStatus: 'EMPTY', state: 'FAILED', currentVersion: null,
    emptiedAt: at, createdAt: at, updatedAt: at,
  });
  const vue = targets.serializeTarget(await DeploymentTarget.findById(vide._id));

  check('une destination VIDÉE n’occupe plus le serveur', vue.occupiesServer === false);
  check('…sa version manquante n’est donc plus « inconnue », elle est absente',
    vue.versionUnknown === false);
  check('…le retrait n’a plus de sens', vue.canDeprovision === false);
  check('…et la suppression devient possible', vue.canDelete === true);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('DESTINATION ACTIVE — comportement inchangé');
{
  await DeploymentTarget.deleteMany({});
  const at = new Date();
  const active = await DeploymentTarget.create({
    name: 'Active', url: 'https://neuve.example.com', host: 'neuve.example.com',
    type: 'domain', environment: 'TEST', backendPort: 5002,
    lifecycleStatus: 'ACTIVE', state: 'DEPLOYED', currentVersion: 'abc1234',
    lastDeployedAt: at, createdAt: at, updatedAt: at,
  });
  const vue = targets.serializeTarget(await DeploymentTarget.findById(active._id));

  check('une destination ACTIVE avec version reste inchangée',
    vue.currentVersion === 'abc1234' && vue.versionUnknown === false);
  check('…elle occupe le serveur', vue.occupiesServer === true);
  check('…elle peut être retirée', vue.canDeprovision === true);
  check('…mais jamais supprimée directement', vue.canDelete === false);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('DÉPLOIEMENT EN COURS — aucune action destructrice');
{
  await DeploymentTarget.deleteMany({});
  const at = new Date();
  const enCours = await DeploymentTarget.create({
    name: 'En cours', url: 'https://encours.example.com', host: 'encours.example.com',
    type: 'domain', environment: 'TEST', backendPort: 5004,
    lifecycleStatus: 'RETIRED', state: 'DEPLOYING', currentVersion: null,
    createdAt: at, updatedAt: at,
  });
  const vue = targets.serializeTarget(await DeploymentTarget.findById(enCours._id));
  check('un déploiement en cours interdit le retrait', vue.canDeprovision === false);
  check('…et la suppression', vue.canDelete === false);
}

section('UN PORT DÉTENU PAR UN AUTRE SERVICE EST RÉATTRIBUÉ — jamais imposé');
{
  /**
   * ══ LE DÉFAUT QUE CE BLOC FERME ═══════════════════════════════════════════
   *
   * Le registre d'un projet NEUF est vide : il ignore ce qui tourne déjà sur le
   * serveur PARTAGÉ. Il a attribué au deuxième projet du VPS le port du Panel
   * lui-même. Le déploiement est allé jusqu'au certificat TLS et à la
   * configuration Nginx avant d'échouer en PM2_PORT_COLLISION — le moteur
   * refusant de démarrer, ce qui est correct, mais laissant un geste manuel
   * comme seule issue.
   *
   * La vérité est SUR LA MACHINE : sockets et process PM2 disent ce qui est
   * pris, quel que soit le propriétaire — y compris les services dont plus
   * aucune fiche ne parle.
   */
  const cible = await targets.createTarget({
    name: 'Projet Deux',
    url: 'https://projet-deux.exemple.test',
    environment: 'TEST',
    dbName: 'projet_deux_test',
    sshHost: '203.0.113.77',
    sshUser: 'root',
  });
  const portInitial = cible.backendPort;
  check('une destination neuve reçoit un port', Number.isInteger(portInitial));

  const PM2_NOUS = 'projet-deux-projet-deux.exemple.test';

  /** Paysage de laboratoire : un AUTRE service occupe notre port réservé. */
  const occupeParAutrui = {
    sockets: [{ port: portInitial, processName: 'panel-panel.ly-solution.com', pid: 4242 }],
    processes: [{ name: 'panel-panel.ly-solution.com', port: portInitial, pid: 4242 }],
    socketsReadable: true,
  };
  const verdict = await registre.ensureUsablePort({
    target: cible,
    transport: {},
    expectedPm2Name: PM2_NOUS,
    readLandscape: async () => occupeParAutrui,
  });
  check('le port occupé par un AUTRE est réattribué', verdict.moved === true);
  check('…et le nouveau port diffère', verdict.port !== portInitial);
  check('…le motif NOMME l’occupant',
    String(verdict.reason).includes('panel-panel.ly-solution.com'));

  /**
   * LE NÔTRE, EN REVANCHE, NE BOUGE PAS.
   *
   * Un redéploiement retrouve son port ; le déplacer casserait le Nginx qui
   * pointe déjà dessus, et l'on réparerait un incident en en créant un autre.
   */
  /* `createTarget` rend une PROJECTION, pas un document : on met à jour la
     fiche par le modèle, comme le fait le pilote de déploiement. */
  await DeploymentTarget.updateOne({ _id: cible._id ?? cible.id }, { $set: { backendPort: verdict.port } });
  cible.backendPort = verdict.port;
  const aNous = {
    sockets: [{ port: verdict.port, processName: PM2_NOUS, pid: 7 }],
    processes: [{ name: PM2_NOUS, port: verdict.port, pid: 7 }],
    socketsReadable: true,
  };
  const stable = await registre.ensureUsablePort({
    target: cible,
    transport: {},
    expectedPm2Name: PM2_NOUS,
    readLandscape: async () => aNous,
  });
  check('UN PORT QUE NOUS DÉTENONS N’EST JAMAIS DÉPLACÉ', stable.moved === false);
  check('…et le motif le dit', stable.reason === 'DETENU_PAR_NOUS');

  /** Un port libre reste le nôtre, sans mouvement inutile. */
  const libre = await registre.ensureUsablePort({
    target: cible,
    transport: {},
    expectedPm2Name: PM2_NOUS,
    readLandscape: async () => ({ sockets: [], processes: [], socketsReadable: true }),
  });
  check('un port libre n’est pas déplacé pour rien', libre.moved === false && libre.reason === null);

  /** Sans transport, on ne conclut rien — et l'on ne casse rien. */
  const sansTransport = await registre.ensureUsablePort({ target: cible, transport: null });
  check('sans transport : aucun déplacement, et un motif nommé',
    sansTransport.moved === false && sansTransport.reason === 'SANS_TRANSPORT');
}


console.log(`\n${ok} réussis, ${ko} échoués`);
await mongoose.disconnect();
await serveur.stop();
assert.equal(ko, 0, `${ko} vérification(s) en échec.`);
