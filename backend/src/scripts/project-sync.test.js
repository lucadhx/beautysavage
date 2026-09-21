/**
 * SYNCHRONISATION MÉTIER — outbox durable, déclencheurs, projections.
 *
 * Ce que ces contrôles verrouillent : qu'une modification faite dans le Manager
 * parte d'elle-même, qu'elle SURVIVE à un redémarrage, et qu'une panne du Panel
 * ne fasse jamais échouer une sauvegarde métier.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'sync_test';
process.env.DB_PROD = 'sync_prod';
process.env.JWT_SECRET = 'test-secret-jwt-long-enough-32chars!!';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
process.env.PROJECT_NAME = ''; // projet SANS nom — la condition de production
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

const { PanelOutboxEntry, OUTBOX_STATUS } = await import('../models/PanelOutboxEntry.model.js');
const outbox = await import('../services/panelBridge/persistence/mongoOutboxAdapter.js');
const { Company } = await import('../models/Company.model.js');
const { getSingleton } = await import('../utils/singleton.js');
const { hasSyncListener } = await import('../utils/syncNotifier.js');
const { isSyncWired, buildContractProjection } = await import(
  '../services/projectBridge/projectSync.service.js'
);

const settle = (ms = 1200) => new Promise((r) => setTimeout(r, ms));

/* ────────────────────────────────────────────────────────────────────────── */
section('1. La chaîne est branchée');
{
  check('un auditeur écoute les sauvegardes', hasSyncListener());
  check('la projection sait mettre en file', isSyncWired());
}

section('2. writeId déterministe — une version, une entrée');
{
  const a = outbox.deterministicWriteId('PROJECT_PRESENTATION', 'p1', '2026-08-03T10:00:00.000Z');
  const b = outbox.deterministicWriteId('PROJECT_PRESENTATION', 'p1', '2026-08-03T10:00:00.000Z');
  const c = outbox.deterministicWriteId('PROJECT_PRESENTATION', 'p1', '2026-08-03T10:00:01.000Z');
  check('même état → même writeId', a === b);
  check('état plus récent → writeId différent', a !== c);
  check('format UUID exigé par le contrat',
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a));

  /**
   * ── LA GÉNÉRATION EST INJECTÉE, ET SON ABSENCE EST FATALE ────────────────
   *
   * L'environnement entre dans la graine du `writeId` : sans lui, une recette
   * et une production dériveraient le MÊME identifiant pour des données
   * différentes, et le Panel répondrait « doublon » sans rien appliquer.
   *
   * Ce module appartient au pont : il ne lit pas la configuration, il la
   * reçoit du bootstrap. Un repli silencieux ferait exactement le mélange
   * qu'on cherche à empêcher — on refuse donc d'écrire plutôt qu'écrire faux.
   */
  const generationCourante = outbox.configureOutboxGeneration(null);
  check('sans génération déclarée, aucune graine n’est inventée', generationCourante === null);
  let refus = null;
  try { outbox.deterministicWriteId('DIAGNOSTIC', 'x', '2026-01-01T00:00:00.000Z'); }
  catch (err) { refus = err; }
  check('…et dériver un writeId est REFUSÉ, pas déduit', refus !== null);
  check('…avec un message qui dit quoi faire',
    /generation/i.test(refus?.message ?? ''));

  // Une génération explicite reste utilisable sans configuration globale :
  // c'est ce qui rend la fonction pure et testable.
  const explicite = outbox.deterministicWriteId('DIAGNOSTIC', 'x', '2026-01-01T00:00:00.000Z', 'TEST');
  check('une génération passée explicitement suffit', typeof explicite === 'string');
  check('…et deux mondes ne partagent JAMAIS la même graine',
    explicite !== outbox.deterministicWriteId('DIAGNOSTIC', 'x', '2026-01-01T00:00:00.000Z', 'PROD'));

  // On rétablit l'état que le bootstrap avait posé, pour la suite du fichier.
  outbox.configureOutboxGeneration('TEST');

  // On compte l'entrée PRÉCISE : la réconciliation du démarrage écrit ses
  // propres projections en parallèle, un compteur global serait instable.
  const change = {
    entityType: 'DIAGNOSTIC', entityId: 'e1', payload: { x: 1 },
    modifiedAt: '2026-08-03T10:00:00.000Z',
  };
  await outbox.enqueueProjection(change);
  await outbox.enqueueProjection(change);
  check('mettre deux fois le même état en file ne crée qu’une entrée',
    (await PanelOutboxEntry.countDocuments({ entityId: 'e1' })) === 1);
}

section('3. Une modification du Manager part TOUTE SEULE');
{
  await PanelOutboxEntry.deleteMany({});
  const doc = await getSingleton(Company);
  doc.set({ name: 'Garage de la Gare', tagline: 'Depuis 1998' });
  await doc.save();
  await settle();

  const entries = await PanelOutboxEntry.find({ entityType: 'PROJECT_PRESENTATION' }).lean();
  check('une projection d’identité est en file', entries.length === 1);
  check('…avec le nouveau nom commercial', entries[0]?.payload?.companyName === 'Garage de la Gare');
  check('…et le slogan', entries[0]?.payload?.tagline === 'Depuis 1998');
  check('…émise par le PROJET', entries[0]?.emitter === 'PROJECT');
  check('…en attente de livraison', entries[0]?.status === OUTBOX_STATUS.PENDING);
}

section('4. Une rafale de sauvegardes ne produit qu’une photographie');
{
  await PanelOutboxEntry.deleteMany({});
  const doc = await getSingleton(Company);
  doc.set({ name: 'Étape 1' });
  await doc.save();
  const doc2 = await getSingleton(Company);
  doc2.set({ name: 'Étape 2' });
  await doc2.save();
  const doc3 = await getSingleton(Company);
  doc3.set({ name: 'Étape finale' });
  await doc3.save();
  await settle();

  const entries = await PanelOutboxEntry.find({ entityType: 'PROJECT_PRESENTATION' }).lean();
  check(`une seule projection pour trois sauvegardes (${entries.length})`, entries.length === 1);
  check('…et c’est l’état FINAL', entries[0]?.payload?.companyName === 'Étape finale');
}

section('5. Une écriture sans changement métier n’émet rien');
{
  await PanelOutboxEntry.deleteMany({});
  const doc = await getSingleton(Company);
  doc.set({ satisfiedClients: 42 }); // champ hors périmètre de la projection
  await doc.save();
  await settle();
  check('aucune projection pour un champ non surveillé',
    (await PanelOutboxEntry.countDocuments({ entityType: 'PROJECT_PRESENTATION' })) === 0);
}

section('6. La file survit, se réclame et se reprend');
{
  await PanelOutboxEntry.deleteMany({});
  await outbox.enqueueProjection({
    entityType: 'DIAGNOSTIC', entityId: 'e-survie', payload: { a: 1 },
    modifiedAt: new Date().toISOString(),
  });

  const claimed = await outbox.claimBatch(10);
  check('une entrée due est réclamée', claimed.length === 1);
  check('…et marquée en vol',
    (await PanelOutboxEntry.findOne({ writeId: claimed[0].writeId }).lean())?.status
      === OUTBOX_STATUS.SENDING);
  check('une seconde réclamation ne la reprend pas', (await outbox.claimBatch(10)).length === 0);

  // Échec de transport : rendue à la file, avec un délai.
  await outbox.deferAfterFailure([claimed[0].writeId], 'PANEL_UNREACHABLE');
  const deferred = await PanelOutboxEntry.findOne({ writeId: claimed[0].writeId }).lean();
  check('un échec de transport la REND à la file', deferred.status === OUTBOX_STATUS.PENDING);
  check('…avec un report dans le futur', new Date(deferred.nextAttemptAt).getTime() > Date.now());
  check('…et le motif conservé', deferred.lastError === 'PANEL_UNREACHABLE');
  check('elle n’est pas due immédiatement', (await outbox.claimBatch(10)).length === 0);

  // Entrée orpheline : le processus qui la tenait est mort.
  await PanelOutboxEntry.updateOne(
    { writeId: claimed[0].writeId },
    { $set: { status: OUTBOX_STATUS.SENDING, lastAttemptAt: new Date(Date.now() - 10 * 60_000), nextAttemptAt: new Date() } },
  );
  check('une entrée SENDING orpheline est libérée', (await outbox.releaseOrphans()) === 1);
  check('…et redevient livrable', (await outbox.claimBatch(10)).length === 1);

  await outbox.acknowledge(claimed[0].writeId, 'APPLIED');
  const acked = await PanelOutboxEntry.findOne({ writeId: claimed[0].writeId }).lean();
  check('un accusé la sort de la file', acked.status === OUTBOX_STATUS.ACKNOWLEDGED);
  check('…horodaté pour la rétention', acked.acknowledgedAt instanceof Date);

  await outbox.enqueueProjection({
    entityType: 'DIAGNOSTIC', entityId: 'e-refus', payload: { a: 1 },
    modifiedAt: new Date().toISOString(),
  });
  const [refused] = await outbox.claimBatch(1);
  await outbox.acknowledge(refused.writeId, 'REJECTED');
  check('un refus ne bouche pas la file',
    (await PanelOutboxEntry.findOne({ writeId: refused.writeId }).lean())?.status
      === OUTBOX_STATUS.REJECTED);
}

section('7. Projet SANS nom : aucun champ ne doit valoir null');
{
  // Reproduit la condition de production (`projectKey: projet-sans-nom`).
  // La file étant persistée, Mongoose écrit `undefined` comme `null` dans un
  // payload Mixed : une clé posée à `undefined` revenait à `null` et le Panel
  // la refusait. Un projet sans PROJECT_NAME ne publiait donc jamais son
  // identité — alors que son contrat passait.
  await PanelOutboxEntry.deleteMany({});
  const doc = await getSingleton(Company);
  doc.set({ name: 'SB Auto 07', tagline: 'Entretien depuis 1998' });
  await doc.save();
  await settle();

  const entree = await PanelOutboxEntry.findOne({ entityType: 'PROJECT_PRESENTATION' }).lean();
  check('une projection est bien en file', !!entree);
  check('…avec le nouveau nom', entree?.payload?.companyName === 'SB Auto 07');

  const nulsProfonds = (o, chemin = '') => Object.entries(o ?? {}).flatMap(([k, v]) =>
    v === null ? [`${chemin}${k}`]
      : (v && typeof v === 'object' ? nulsProfonds(v, `${chemin}${k}.`) : []));
  const nuls = nulsProfonds(entree?.payload);
  check(`aucun champ null APRÈS aller-retour en base (${nuls.join(', ') || 'aucun'})`,
    nuls.length === 0);
  check('la clé `project.name` est OMISE, pas mise à null',
    entree?.payload?.project === undefined
      || !Object.prototype.hasOwnProperty.call(entree.payload.project, 'name'));
}

section('8. Un refus du Panel n’est pas une perte définitive');
{
  await PanelOutboxEntry.deleteMany({});
  const etat = {
    entityType: 'PROJECT_PRESENTATION', entityId: 'p-refus', payload: { companyName: 'Garage du Nord' },
    modifiedAt: '2026-08-03T12:00:00.000Z',
  };

  // Le Panel refuse — typiquement parce qu'il n'est pas encore à jour.
  await outbox.enqueueProjection(etat);
  const [envoyee] = await outbox.claimBatch(1);
  await outbox.acknowledge(envoyee.writeId, 'REJECTED');
  check('l’écriture refusée sort de la file',
    (await PanelOutboxEntry.findOne({ writeId: envoyee.writeId }).lean())?.status
      === OUTBOX_STATUS.REJECTED);
  check('…et n’est plus livrable en l’état', (await outbox.claimBatch(10)).length === 0);

  // Le Panel est corrigé ; la réconciliation réaffirme le MÊME état.
  const rejoue = await outbox.enqueueProjection(etat);
  check('réaffirmer un état refusé le REMET en file', rejoue.revived === true);
  check('…sans créer de doublon',
    (await PanelOutboxEntry.countDocuments({ entityId: 'p-refus' })) === 1);
  const remise = await PanelOutboxEntry.findOne({ writeId: envoyee.writeId }).lean();
  check('…en repartant de zéro tentative', remise.attempts === 0);
  check('…et elle est de nouveau livrable', (await outbox.claimBatch(10)).length === 1);

  // Une écriture ACQUITTÉE, elle, ne doit jamais être réveillée : insister
  // sur une réponse déjà obtenue tournerait en boucle.
  await outbox.acknowledge(envoyee.writeId, 'APPLIED');
  const acquittee = await outbox.enqueueProjection(etat);
  check('une écriture déjà acquittée n’est PAS réveillée', acquittee.revived !== true);
  check('…et reste hors de la file',
    (await PanelOutboxEntry.findOne({ writeId: envoyee.writeId }).lean())?.status
      === OUTBOX_STATUS.ACKNOWLEDGED);
}

section('9. Contrat : règle de sélection déterministe');
{
  const projection = await buildContractProjection();
  check('sans contrat, on émet un TOMBSTONE explicite',
    projection.entityType === 'CONTRACT' && projection.deleted === true && projection.payload === null);
  check('…avec un entityId stable', typeof projection.entityId === 'string' && projection.entityId.length > 0);
}

section('10. Contrat : la VENTILATION FISCALE monte, sur les DEUX lignes');
{
  /**
   * ── LE DÉFAUT QUE CETTE SECTION VERROUILLE ────────────────────────────────
   *
   * Le contrat de pont 1.10.0 a DÉCLARÉ `amountExcludingTax`, `taxAmount` et
   * `taxRate` sur chaque ligne tarifaire — « la ventilation que
   * `computePricing` calcule DÉJÀ ici et que le projet gardait pour lui ». Le
   * Panel a été construit pour les lire ; la moitié émettrice n'a jamais suivi.
   *
   * Conséquence invisible jusqu'à la première facture : le Panel recevait
   * `amountExcludingTax: null` sur les deux lignes et refusait d'ouvrir le
   * moindre paiement (`CONTRACT_TAX_BREAKDOWN_ABSENT`). Ni les frais de
   * lancement ni l'abonnement n'étaient encaissables.
   *
   * On éprouve donc les DEUX lignes, séparément : elles décrivent des
   * engagements distincts, et n'ont jamais emprunté le même chemin de code.
   */
  const Contract = (await import('../models/Contract.model.js')).default;
  const { computePricing } = await import('../utils/money.js');

  const fraisHT = 29_000;
  const aboHT = 83_988;
  const TAUX = 20;
  const frais = computePricing({ amountExcludingTax: fraisHT, taxRate: TAUX });
  const abo = computePricing({ amountExcludingTax: aboHT, taxRate: TAUX });

  await Contract.create({
    reference: 'CTR-FISCAL-TEST',
    status: 'INACTIVE',
    environment: 'TEST',
    taxRate: TAUX,
    pricing: {
      launchFee: { enabled: true, ...frais },
      subscription: {
        enabled: true, ...abo, recurrence: { unit: 'YEAR', interval: 1 }, interval: 'YEAR',
      },
    },
  });

  const { payload } = await buildContractProjection();
  const lignes = [
    ['frais de lancement', payload.pricing?.launchFee, frais],
    ['abonnement', payload.pricing?.subscription, abo],
  ];

  for (const [nom, ligne, attendu] of lignes) {
    check(`${nom} : la ligne est projetée`, Boolean(ligne));
    check(`${nom} : HT publié et non nul`,
      Number.isInteger(ligne?.amountExcludingTax) && ligne.amountExcludingTax === attendu.amountExcludingTax);
    check(`${nom} : TVA publiée`,
      Number.isInteger(ligne?.taxAmount) && ligne.taxAmount === attendu.taxAmount);
    check(`${nom} : taux publié`, ligne?.taxRate === TAUX);
    check(`${nom} : TTC publié`, ligne?.amountIncludingTax === attendu.amountIncludingTax);
    check(`${nom} : HT + TVA = TTC`,
      ligne.amountExcludingTax + ligne.taxAmount === ligne.amountIncludingTax);
    /**
     * LA SECONDE ÉGALITÉ N'EST PAS REDONDANTE : une ligne qui s'additionne mais
     * dont le taux annoncé ne correspond pas au montant ferait mentionner un
     * taux faux à côté d'un montant juste sur la facture.
     */
    check(`${nom} : TVA = arrondi(HT × taux)`,
      ligne.taxAmount === Math.round((ligne.amountExcludingTax * ligne.taxRate) / 100));
  }

  check('l’abonnement conserve sa récurrence',
    payload.pricing.subscription.recurrence?.unit === 'YEAR'
    && payload.pricing.subscription.recurrence?.interval === 1);
  check('le taux PAR DÉFAUT du contrat monte toujours', payload.taxRate === TAUX);

  /**
   * ── AUCUN RECALCUL À LA PROJECTION ────────────────────────────────────────
   *
   * `computePricing` est l'autorité fiscale, et elle a écrit ces nombres à
   * l'enregistrement. Les recalculer ici en ferait une seconde : deux chemins
   * d'arrondi pour la même ligne divergent d'un centime tôt ou tard, et cet
   * écart-là oppose le contrat SIGNÉ à la facture ÉMISE.
   *
   * On le prouve par l'absurde : un contrat dont les montants stockés sont
   * INCOHÉRENTS est projeté TEL QUEL — la projection ne répare rien, et c'est
   * le Panel qui refusera. Une incohérence doit rester bloquante, pas être
   * silencieusement corrigée en chemin.
   */
  await Contract.deleteMany({});
  await Contract.create({
    reference: 'CTR-FISCAL-INCOHERENT',
    status: 'INACTIVE',
    environment: 'TEST',
    taxRate: TAUX,
    pricing: {
      launchFee: {
        enabled: true,
        amountExcludingTax: 10_000,
        taxRate: TAUX,
        taxAmount: 999,          // faux : 2 000 attendus
        amountIncludingTax: 12_000,
        currency: 'EUR',
      },
    },
  });
  const brut = (await buildContractProjection()).payload.pricing.launchFee;
  check('une ventilation incohérente est projetée TELLE QUELLE, jamais réparée',
    brut.amountExcludingTax === 10_000 && brut.taxAmount === 999 && brut.amountIncludingTax === 12_000);

  /**
   * ── UN CHAMP MANQUANT RESTE `null`, IL NE DEVIENT PAS `0` ────────────────
   *
   * `Number(null)` vaut `0`, et « 0 centime hors taxe » est une AFFIRMATION.
   * Elle ferait échouer le Panel sur « la ventilation ne s'additionne pas » là
   * où il doit dire « il n'y a pas de ventilation » — deux refus qui envoient
   * deux personnes différentes à deux endroits différents.
   */
  await Contract.deleteMany({});
  await Contract.collection.insertOne({
    reference: 'CTR-FISCAL-LEGACY',
    status: 'INACTIVE',
    environment: 'TEST',
    taxRate: TAUX,
    pricing: { launchFee: { enabled: true, amountIncludingTax: 12_000, currency: 'EUR' } },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const ancienne = (await buildContractProjection()).payload.pricing.launchFee;
  check('une ligne sans ventilation publie `null`, jamais `0`',
    ancienne.amountExcludingTax === null && ancienne.taxAmount === null);
  await Contract.deleteMany({});
}

await disconnectDatabase();
await mongod.stop();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
