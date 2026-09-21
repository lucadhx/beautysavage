/**
 * OPÉRATIONS CONTRACTUELLES INVOCABLES PAR LE PANEL.
 *
 * Ce que ces contrôles verrouillent : que le Panel puisse DEMANDER une
 * résiliation sans jamais pouvoir en décider, que la résiliation immédiate
 * reste enfermée dans les environnements de test, et que le document
 * contractuel remonte en MÉTADONNÉES — jamais en fichier.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'ops_test';
process.env.DB_PROD = 'ops_prod';
process.env.JWT_SECRET = 'test-secret-jwt-long-enough-32chars!!';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
process.env.PANEL_SCHEDULER_ENABLED = 'false';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();
const { bootstrap } = await import('../config/bootstrap.js');
await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();

const { config } = await import('../config/env.js');
const { default: Contract } = await import('../models/Contract.model.js');
const { CONTRACT_STATUS } = await import('../utils/contractConstants.js');
const ops = await import('../services/projectBridge/contractOperations.js');
const { buildContractProjection } = await import('../services/projectBridge/projectSync.service.js');
const { PanelOutboxEntry } = await import('../models/PanelOutboxEntry.model.js');

const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));

/** Les opérations que ce test décrit : celles qui mettent fin à un contrat. */
const estResiliation = (o) => o.id === 'contract.cancel_at_period_end' || o.id === 'contract.cancel_now';

/* ────────────────────────────────────────────────────────────────────────── */
section('1. Sans contrat vivant, on le DIT — on ne casse pas');
{
  const { operations } = await ops.describeContractOperations();
  check('la résiliation à l’échéance est toujours publiée',
    operations.some((o) => o.id === 'contract.cancel_at_period_end'));
  // La disponibilité ne se juge que sur les RÉSILIATIONS : le catalogue porte
  // aussi le réglage de la protection contractuelle, qui ne dépend d'aucun
  // contrat et reste disponible par construction.
  check('…mais annoncée indisponible',
    operations.filter((o) => estResiliation(o)).every((o) => o.available === false));

  let refus = null;
  await ops.invokeContractOperation('contract.cancel_at_period_end', { invocationId: 'inv-0' })
    .catch((e) => { refus = e; });
  check('l’invoquer échoue proprement', refus?.code === 'BRIDGE_OPERATION_FAILED');
  check('…en disant pourquoi', /aucun contrat actif/i.test(refus?.message ?? ''));
}

section('2. Catalogue : la résiliation immédiate est un privilège de TEST');
{
  const contrat = await Contract.create({
    reference: 'CTR-TEST-0001',
    status: CONTRACT_STATUS.ACTIVE,
    environment: 'TEST',
    pricing: { subscription: { enabled: true, amountIncludingTax: 4900, currency: 'EUR', interval: 'MONTH' } },
  });

  const { operations } = await ops.describeContractOperations();
  const resiliations = operations.filter((o) => estResiliation(o));
  check('en TEST, les deux actions sont publiées', resiliations.length === 2);
  check('…et disponibles', resiliations.every((o) => o.available === true));
  check('la résiliation immédiate annonce son effet',
    operations.find((o) => o.id === 'contract.cancel_now')?.effect === 'ENDED');

  // On simule la PRODUCTION sans redémarrer : la garde est dans l'opération,
  // pas seulement dans le catalogue.
  const vraiIsTest = config.isTest;
  config.isTest = false;
  const enProd = await ops.describeContractOperations();
  check('en PROD, la résiliation immédiate DISPARAÎT du catalogue',
    enProd.operations.every((o) => o.id !== 'contract.cancel_now'));

  let refus = null;
  await ops.invokeContractOperation('contract.cancel_now', { invocationId: 'inv-prod' })
    .catch((e) => { refus = e; });
  check('…et l’invoquer directement est REFUSÉ', refus?.code === 'BRIDGE_OPERATION_FAILED');
  check('…sans toucher au contrat',
    (await Contract.findById(contrat._id).lean())?.status === CONTRACT_STATUS.ACTIVE);
  config.isTest = vraiIsTest;

  let inconnue = null;
  await ops.invokeContractOperation('contract.delete_everything', { invocationId: 'inv-x' })
    .catch((e) => { inconnue = e; });
  check('une opération hors catalogue est inconnue', inconnue?.code === 'BRIDGE_OPERATION_UNKNOWN');
}

section('3. Résiliation TEST : le PROJET applique, et le dit');
{
  const avant = await Contract.findOne({ status: CONTRACT_STATUS.ACTIVE }).lean();
  const res = await ops.invokeContractOperation('contract.cancel_now', {
    invocationId: 'inv-1',
    params: { reason: 'Recette de bout en bout' },
  });
  check('l’opération réussit', res.status === 'SUCCEEDED');
  check('…en nommant l’état de départ', res.contract.previousStatus === CONTRACT_STATUS.ACTIVE);
  check('…et l’état d’arrivée', res.contract.newStatus !== CONTRACT_STATUS.ACTIVE);
  check('…avec le motif conservé', res.contract.id === String(avant._id) && res.reason === 'Recette de bout en bout');
  check('le contrat n’est plus actif en base',
    (await Contract.findById(avant._id).lean())?.status !== CONTRACT_STATUS.ACTIVE);

  // Idempotence : le Panel réessaie, le contrat ne se résilie pas deux fois.
  const rejeu = await ops.invokeContractOperation('contract.cancel_now', { invocationId: 'inv-1' });
  check('rejouer la MÊME invocation rend le même résultat',
    rejeu.contract.newStatus === res.contract.newStatus);
}

section('4. Le document remonte en MÉTADONNÉES, jamais en fichier');
{
  await Contract.deleteMany({});
  const contrat = await Contract.create({
    reference: 'CTR-DOC-0002',
    status: CONTRACT_STATUS.ACTIVE,
    environment: 'TEST',
    document: {
      originalFilename: 'a1b2c3d4-e5f6.pdf',
      originalChecksum: 'abc123',
      pageCount: 4,
    },
    signatureConfiguration: { version: 2 },
    yousign: { status: 'DONE' },
  });

  const projection = await buildContractProjection();
  const doc = projection.payload.document;
  check('la projection décrit le document', doc?.available === true);
  check('…référencé mais absent du stockage → INDISPONIBLE', doc.status === 'UNAVAILABLE');
  check('…avec un nom LISIBLE, pas le nom sur disque',
    doc.filename === 'contrat-CTR-DOC-0002.pdf' && !doc.filename.includes('a1b2c3d4'));
  check('…et le téléchargement est annoncé impossible', doc.downloadAvailable === false);
  
  
  


  const brut = JSON.stringify(projection.payload);
  check('AUCUN chemin disque n’est publié', !/storage[/\\]contracts/.test(brut));
  check('aucun fichier n’est transporté',
    !('content' in doc) && !('buffer' in doc) && !('base64' in doc));


}

section('5. Déposer un PDF fait PARTIR la projection');
{
  // Le geste réel du Manager : téléverser le contrat. Il n'écrit QUE
  // `document.*` — si ce chemin n'est pas surveillé, rien ne part, et le Panel
  // affiche « non généré » sur un contrat qui a bel et bien son document.
  await Contract.deleteMany({});
  await PanelOutboxEntry.deleteMany({});
  const c = await Contract.create({
    reference: 'CTR-UPLOAD', status: CONTRACT_STATUS.ACTIVE, environment: 'TEST',
  });
  await settle();
  await PanelOutboxEntry.deleteMany({});

  c.document.originalFilename = 'aaaa-bbbb.pdf';
  c.document.originalChecksum = 'sha256';
  c.document.pageCount = 3;
  await c.save();
  await settle();

  const entree = await PanelOutboxEntry.findOne({ entityType: 'CONTRACT' }).lean();
  check('le dépôt du document déclenche une projection', !!entree);
  check('…qui annonce le document', entree?.payload?.document?.available === true);
  // Aucun fichier n'a été écrit sur le stockage dans cette section : la
  // projection dit donc « référencé mais introuvable », et c'est la vérité.
  check('…en décrivant son état réel', entree?.payload?.document?.status === 'UNAVAILABLE');

  // La SIGNATURE aussi : elle ne touche ni le statut ni le prix.
  await PanelOutboxEntry.deleteMany({});
  c.document.signedFilename = 'cccc-dddd.pdf';
  c.document.signedFetchedAt = new Date();
  c.yousign.status = 'DONE';
  await c.save();
  await settle();
  const signe = await PanelOutboxEntry.findOne({ entityType: 'CONTRACT' }).lean();
  check('la signature déclenche elle aussi une projection', !!signe);
  check('…et la nouvelle photographie est bien émise',
    signe?.payload?.document?.available === true);
}

section('5 bis. La photographie se reconstruit depuis le STOCKAGE');
{
  // LE SCÉNARIO RÉEL : le fichier est déjà là, personne ne le redépose, et le
  // projet redémarre. La projection doit décrire ce qui existe.
  await Contract.deleteMany({});
  await PanelOutboxEntry.deleteMany({});

  const contrat = await Contract.create({
    reference: 'CTR-EXISTANT', status: CONTRACT_STATUS.ACTIVE, environment: 'TEST',
    document: { originalFilename: 'original-deja-la.pdf', originalChecksum: 'abc', pageCount: 5 },
  });

  // On écrit VRAIMENT le fichier là où le projet le rangerait.
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { config } = await import('../config/env.js');
  const dossier = path.join(config.paths.contractStorage, String(contrat._id));
  await fs.mkdir(dossier, { recursive: true });
  await fs.writeFile(path.join(dossier, 'original-deja-la.pdf'), Buffer.from('%PDF-1.4 test'));

  const projection = await buildContractProjection();
  const doc = projection.payload.document;
  check('le document déjà présent est DÉTECTÉ', doc.available === true);
  check('…annoncé GÉNÉRÉ', doc.status === 'GENERATED');
  check('…et téléchargeable', doc.downloadAvailable === true);
  check('…avec ses pages', doc.pages === 5);
  check('…et son empreinte', doc.sha256 === 'abc');

  // Le point CENTRAL : la date de la projection suit le stockage, donc une
  // réconciliation produit une version NOUVELLE — sans quoi le Panel
  // l'écarterait comme n'étant pas plus récente que ce qu'il connaît.
  const surDisque = (await fs.stat(path.join(dossier, 'original-deja-la.pdf'))).mtime.getTime();
  check('la version de la projection suit le fichier',
    new Date(projection.modifiedAt).getTime() >= Math.min(surDisque, Date.now()));

  // Réconciliation SANS aucun réupload ni sauvegarde du contrat.
  const { reconcileAll } = await import('../services/projectBridge/projectSync.service.js');
  await reconcileAll();
  await settle();
  const entree = await PanelOutboxEntry.findOne({ entityType: 'CONTRACT' }).lean();
  check('la réconciliation met la projection en file SANS réupload', !!entree);
  check('…en annonçant le document', entree?.payload?.document?.available === true);
  check('…et son téléchargement', entree?.payload?.document?.downloadAvailable === true);

  // En attente de signature.
  contrat.yousign.status = 'ONGOING';
  await contrat.save();
  check('signature en cours → EN ATTENTE',
    (await buildContractProjection()).payload.document.status === 'PENDING_SIGNATURE');

  // Signé : le fichier signé existe aussi.
  await fs.writeFile(path.join(dossier, 'signe.pdf'), Buffer.from('%PDF-1.4 signe'));
  contrat.document.signedFilename = 'signe.pdf';
  contrat.document.signedChecksum = 'def';
  contrat.document.signedFetchedAt = new Date('2026-08-01T10:00:00.000Z');
  contrat.yousign.status = 'DONE';
  await contrat.save();
  const signe = (await buildContractProjection()).payload.document;
  check('le signé présent → SIGNÉ', signe.status === 'SIGNED');
  check('…avec sa propre empreinte', signe.sha256 === 'def');
  check('…et sa date de signature', signe.signedAt === '2026-08-01T10:00:00.000Z');

  // Fichier effacé du stockage alors que la base le référence encore.
  await fs.rm(dossier, { recursive: true, force: true });
  const perdu = (await buildContractProjection()).payload.document;
  check('référencé mais disparu → INDISPONIBLE', perdu.status === 'UNAVAILABLE');
  check('…et le téléchargement est refusé d’avance', perdu.downloadAvailable === false);
  check('…sans prétendre qu’il n’a jamais existé', perdu.available === true);
}

section('6. Tout champ LU par la projection est SURVEILLÉ');
{
  // La règle qui a manqué : une projection qui lit un champ que son
  // déclencheur ignore produit une donnée qui n'arrive jamais.
  const source = await import('node:fs').then((fs) => fs.readFileSync(
    new URL('../services/projectBridge/projectSync.service.js', import.meta.url), 'utf8',
  ));
  const triggers = await import('node:fs').then((fs) => fs.readFileSync(
    new URL('../services/projectBridge/syncTriggers.js', import.meta.url), 'utf8',
  ));
  const bloc = source.slice(source.indexOf('function describeDocument'));
  const lus = new Set();
  for (const m of bloc.matchAll(/contract\.(\w+)/g)) lus.add(m[1]);
  const surveilles = triggers.slice(triggers.indexOf('const CONTRACT_PATHS'));
  const oublis = [...lus].filter(
    (champ) => !['_id', 'reference', 'createdAt', 'updatedAt'].includes(champ)
      && !surveilles.includes(`'${champ}'`),
  );
  check(`aucun champ du document n’est lu sans être surveillé (${oublis.join(', ') || 'aucun'})`,
    oublis.length === 0);
}

section('7. Sans document, la projection ne ment pas');
{
  await Contract.deleteMany({});
  await Contract.create({ reference: 'CTR-VIDE', status: CONTRACT_STATUS.ACTIVE, environment: 'TEST' });
  const projection = await buildContractProjection();
  check('le document est annoncé ABSENT, sans rien inventer',
    projection.payload.document.status === 'NONE'
    && projection.payload.document.available === false);
}

await disconnectDatabase();
await mongod.stop();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
