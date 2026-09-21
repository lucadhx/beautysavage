/* Tests de la promotion TEST -> PROD sur une MongoDB en mémoire.
 * Style aligné sur smoke-test.js (runner autonome, sans framework). */
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import {
  assertSafety,
  connectClients,
  closeClients,
  listUserCollections,
  countByCollection,
  fingerprintDatabase,
  globalFingerprint,
  fingerprintCollection,
  scanRiskyUrls,
  scanSecretFields,
  collectUploadRefs,
  getCopyableIndexes,
  checkIntegrity,
  copyCollection,
  dropProdCollections,
} from './lib/promotion-core.js';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

const mongod = await MongoMemoryServer.create();
const uri = mongod.getUri();
const TEST = 'sbauto_test';
const PROD = 'sbauto_prod';

const seedClient = new MongoClient(uri);
await seedClient.connect();
const t = seedClient.db(TEST);

// ---- Jeu de données source (types BSON variés + refs + URLs) ----
const adminId = new ObjectId();
const devId = new ObjectId();
const chapterId = new ObjectId();
const now = new Date('2024-05-01T10:00:00.000Z');

await t.collection('users').insertMany([
  { _id: devId, email: 'dev@mail.com', role: 'DEV', name: 'Dev', password: '$2a$10$hashhashhashhashhashha', createdAt: now, updatedAt: now },
  { _id: adminId, email: 'admin@mail.com', role: 'ADMIN', name: 'Admin', password: '$2a$10$otherotherotherotherot', createdAt: now, updatedAt: now },
]);
await t.collection('users').createIndex({ email: 1 }, { unique: true, name: 'email_1' });

await t.collection('chapters').insertMany([
  { _id: chapterId, title: 'Conception', slug: 'conception', layout: 'PILLARS', heroImage: 'http://localhost:6060/uploads/img-123.webp', navOrder: 10, order: 10, published: true, createdAt: now, updatedAt: now, items: [] },
]);
await t.collection('chapters').createIndex({ slug: 1 }, { unique: true, name: 'slug_1' });

await t.collection('companies').insertOne({ _id: new ObjectId(), name: 'SB Auto', logos: { header: 'http://localhost:6060/uploads/favicon-9.png', favicon: '' }, createdAt: now, updatedAt: now });
/*
  LE CONTENU D'ACCUEIL EST UN SINGLETON DÉCLARÉ — il doit donc exister dans la
  base de départ.

  `SINGLETON_COLLECTIONS` l'a gagné (`promotion-core.js`) sans que ce décor le
  sème : le contrôle d'intégrité comptait alors ZÉRO document `homecontents`
  après promotion et refusait, à juste titre. Un registre explicite se paie en
  fixtures — c'est exactement le prix que son commentaire annonce.
*/
await t.collection('homecontents').insertOne({
  _id: new ObjectId(),
  hero: { title: 'Accroche de recette', proofs: [] },
  showcase: { navItems: [], cards: [] },
  outcomes: { items: [] },
  positioning: {},
  trust: { items: [] },
  invitation: {},
  createdAt: now,
  updatedAt: now,
});
await t.collection('themes').insertOne({ _id: new ObjectId(), colors: { background: '#0a0d14' }, createdAt: now, updatedAt: now });
await t.collection('managerthemes').insertOne({ _id: new ObjectId(), radius: '0.5rem', createdAt: now, updatedAt: now });
await t.collection('sitestatuses').insertOne({ _id: new ObjectId(), status: 'ACTIVE', createdAt: now, updatedAt: now });
await t.collection('devcompanies').insertOne({ _id: new ObjectId(), name: 'Studio', logo: 'https://abc.ngrok-free.app/uploads/logo.webp', references: [], createdAt: now, updatedAt: now });
await t.collection('systemconfigurations').insertOne({ _id: new ObjectId(), network: { backendUrl: 'http://localhost:6060', managerUrl: 'http://localhost:6061', websiteUrl: 'http://localhost:6062' }, updatedBy: adminId, createdAt: now, updatedAt: now });
await t.collection('roleappearances').insertOne({ _id: new ObjectId(), roles: { DEV: { background: '#7c3aed', foreground: '#ffffff' }, ADMIN: { background: '#2563eb', foreground: '#ffffff' } }, createdAt: now, updatedAt: now });

/**
 * UNE PAGE ÉDITORIALE — pour que la promotion copie plus d'une collection
 * métier, et que le contrôle d'unicité des slugs porte sur deux d'entre elles.
 */
await t.collection('sitepages').insertOne({
  _id: new ObjectId(), title: 'Mentions', slug: 'mentions', navOrder: 0, order: 0,
  published: true, blocks: [], createdAt: now, updatedAt: now,
});

try {
  // ---------- Sécurité ----------
  let threw = false;
  try { assertSafety({ mongoUri: uri, dbTest: 'same', dbProd: 'same' }); } catch { threw = true; }
  check('refuse DB_TEST === DB_PROD', threw);
  let threw2 = false;
  try { assertSafety({ mongoUri: uri, dbTest: '', dbProd: PROD }); } catch { threw2 = true; }
  check('refuse DB_TEST manquant', threw2);
  check('accepte DB_TEST != DB_PROD', (() => { try { assertSafety({ mongoUri: uri, dbTest: TEST, dbProd: PROD }); return true; } catch { return false; } })());

  // ---------- Connexions séparées ----------
  const clients = await connectClients({ mongoUri: uri, dbTest: TEST, dbProd: PROD });
  const { srcDb, dstDb } = clients;

  const srcColls = await listUserCollections(srcDb);
  check('découverte des collections', srcColls.length === 11 && srcColls.includes('users') && srcColls.includes('systemconfigurations'));

  // Empreinte TEST avant toute opération.
  const testFpBefore = await fingerprintDatabase(srcDb, srcColls);
  const testGlobalBefore = globalFingerprint(testFpBefore);

  // ---------- Dry-run : aucune écriture ----------
  for (const name of srcColls) {
    const plan = await copyCollection({ srcDb, dstDb, name, dryRun: true });
    check(`dry-run ${name} n'écrit rien`, plan.copied === 0 && plan.destAfter === 0 && plan.wouldCopy === testFpBefore[name].count);
  }
  const prodCountsAfterDry = await countByCollection(dstDb, srcColls);
  check('PROD toujours vide après dry-run', Object.values(prodCountsAfterDry).every((c) => c === 0));

  // ---------- Copie réelle ----------
  for (const name of srcColls) {
    const res = await copyCollection({ srcDb, dstDb, name, dryRun: false });
    check(`copie ${name} (count identique)`, res.destAfter === res.sourceCount && res.copied === res.sourceCount);
  }

  // _id préservés
  const srcUser = await srcDb.collection('users').findOne({ email: 'admin@mail.com' });
  const dstUser = await dstDb.collection('users').findOne({ email: 'admin@mail.com' });
  check('_id préservé', String(srcUser._id) === String(dstUser._id) && String(dstUser._id) === String(adminId));
  check('timestamps préservés (Date)', dstUser.createdAt instanceof Date && dstUser.createdAt.getTime() === now.getTime());
  const dstCfg = await dstDb.collection('systemconfigurations').findOne({});
  check('référence ObjectId préservée', String(dstCfg.updatedBy) === String(adminId));

  // ---------- Parité ----------
  const testFpAfter = await fingerprintDatabase(srcDb, srcColls);
  const prodFp = await fingerprintDatabase(dstDb, srcColls);
  let allMatch = true;
  for (const name of srcColls) {
    const m = testFpAfter[name].hash === prodFp[name].hash && testFpAfter[name].count === prodFp[name].count;
    if (!m) allMatch = false;
  }
  check('parité TEST/PROD (empreintes identiques)', allMatch);
  check('empreinte par collection déterministe', (await fingerprintCollection(dstDb, 'users')).hash === testFpAfter.users.hash);

  // ---------- TEST inchangée ----------
  check('TEST inchangée (empreinte globale identique)', globalFingerprint(testFpAfter) === testGlobalBefore);

  // ---------- Index préservés ----------
  const dstUserIdx = await getCopyableIndexes(dstDb, 'users');
  const dstSvcIdx = await getCopyableIndexes(dstDb, 'chapters');
  check('index unique email recréé', dstUserIdx.some((i) => i.options.unique && i.key.email === 1));
  check('index unique slug recréé', dstSvcIdx.some((i) => i.options.unique && i.key.slug === 1));

  // ---------- Intégrité PROD ----------
  const integ = await checkIntegrity(dstDb, srcColls);
  check('singletons uniques (1 chacun)', Object.values(integ.singletons).every((c) => c === 1));
  check('comptes copiés (2, rôles présents)',
    integ.accounts.total === 2
    && integ.accounts.expected.DEV.present && integ.accounts.expected.ADMIN.present);
  check('l’intégrité se juge sur les RÔLES, pas sur des adresses codées en dur',
    !JSON.stringify(integ.accounts.expected).includes('@'));
  /**
   * LA RÉFÉRENCE CASSÉE QUI SUBSISTE — et pourquoi ce n'est plus celle d'un avis.
   *
   * Le contrôle portait sur `reviews.prestation.serviceId → services._id`, une
   * référence SOUPLE du catalogue. Les deux collections ont quitté le projet, et
   * le contrôle avec elles : le laisser aurait fait échouer la promotion sur une
   * jointure que plus personne n'écrit.
   *
   * Ce qui reste, et qui compte davantage, est une référence DURE :
   * `systemconfigurations.updatedBy → users._id`. Une configuration réseau qui
   * pointerait vers un compte absent de la base promue ferait afficher un
   * « modifié par » vide sur l'écran le plus sensible du Manager.
   */
  check('base cohérente → aucune référence cassée', integ.brokenRefs.length === 0);

  /**
   * …ET LE DÉTECTEUR DÉTECTE VRAIMENT.
   *
   * Un contrôle qui ne rapporte rien sur une base saine ne prouve pas qu'il
   * regarde : il pourrait ne rien regarder du tout. On casse donc la référence
   * délibérément, sur la base PROMUE, on vérifie qu'elle est vue, et on la
   * rétablit. C'est la seule façon de distinguer « aucune anomalie » de
   * « aucun contrôle ».
   */
  await dstDb.collection('systemconfigurations')
    .updateOne({}, { $set: { updatedBy: new ObjectId() } });
  const casse = await checkIntegrity(dstDb, srcColls);
  check('référence cassée détectée (configuration système → compte absent)',
    casse.brokenRefs.some((b) => b.collection === 'systemconfigurations' && b.field === 'updatedBy'));
  await dstDb.collection('systemconfigurations')
    .updateOne({}, { $set: { updatedBy: adminId } });
  check('aucune erreur bloquante (ref souple = warning)', integ.errors.length === 0);

  // ---------- Scans transverses (unitaires) ----------
  check('détecte URL localhost', scanRiskyUrls({ _id: 'x', bannerImage: 'http://localhost:6060/uploads/a.webp' }, 'services').length === 1);
  check('détecte URL ngrok', scanRiskyUrls({ _id: 'x', logo: 'https://abc.ngrok-free.app/uploads/b.webp' }, 'devcompanies').length === 1);
  check('ignore URL de prod normale', scanRiskyUrls({ _id: 'x', url: 'https://sbauto.fr/uploads/c.webp' }, 'services').length === 0);
  const secretHits = scanSecretFields({ password: 'x', name: 'ok' }, 'users');
  check('détecte champ secret (password) sans valeur', secretHits.length === 1 && secretHits[0].field === 'password' && !('value' in secretHits[0]) && secretHits[0].knownSafe);
  check('détecte token non-safe', scanSecretFields({ apiToken: 'x' }, 'misc').some((h) => !h.knownSafe));
  check('extrait fichiers uploads', collectUploadRefs({ a: 'http://x/uploads/img-1.webp', b: 'http://x/uploads/img-2.png', c: 'no' }).length === 2);

  // ---------- Reset PROD (sécurité) ----------
  let resetRefused = false;
  try { await dropProdCollections({ dstDb, dbTest: TEST, dbProd: 'not-the-prod-db' }); } catch { resetRefused = true; }
  check('reset refuse si le handle != DB_PROD', resetRefused);
  let resetRefusedTest = false;
  try { await dropProdCollections({ dstDb, dbTest: PROD, dbProd: PROD }); } catch { resetRefusedTest = true; }
  check('reset refuse si la cible est DB_TEST', resetRefusedTest);
  const dropped = await dropProdCollections({ dstDb, dbTest: TEST, dbProd: PROD });
  check('reset PROD supprime les collections métier', dropped.length === srcColls.length);
  check('PROD vide après reset', (await listUserCollections(dstDb)).length === 0);
  // TEST intacte après reset PROD
  check('TEST intacte après reset PROD', globalFingerprint(await fingerprintDatabase(srcDb, srcColls)) === testGlobalBefore);

  await closeClients(clients);

  // ---------- Bootstrap PROD : aucun seed de démo ----------
  process.env.ENV = 'PROD';
  /*
    ══ « SANS IDENTITÉ EXPLICITE » DOIT VRAIMENT VOULOIR DIRE SANS IDENTITÉ ════

    Le contrôle qui suit affirme qu'un amorçage PROD ne fabrique AUCUN compte
    tant qu'aucune adresse n'est déclarée. Sur un poste de développement, le
    `.env` en déclare une (`FIRST_DEV_EMAIL`) : l'amorçage créait donc un DEV,
    et l'assertion tombait — chez le développeur seulement, jamais ailleurs.

    On les VIDE plutôt que de les supprimer : `dotenv` ne remplace pas une
    variable déjà posée, mais il remplit celles qui manquent.
  */
  process.env.FIRST_DEV_EMAIL = '';
  process.env.SEED_DEV_EMAIL = '';
  process.env.FIRST_ADMIN_EMAIL = '';
  process.env.MONGODB_URI = uri;
  process.env.DB_TEST = TEST;
  process.env.DB_PROD = 'sbauto_boot_prod';
  process.env.JWT_SECRET = 'test-secret';
  process.env.PORT = '4599';
  // La PROD exige la clé maître de chiffrement (fail-closed) — la fournir ici.
  process.env.INTEGRATED_API_ENCRYPTION_KEY =
    'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
  const { bootstrap } = await import('../config/bootstrap.js');
  const { Chapter } = await import('../models/Chapter.model.js');
  const { SitePage } = await import('../models/SitePage.model.js');
  const { User } = await import('../models/User.model.js');
  const { Company } = await import('../models/Company.model.js');
  await connectDatabase();
  await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();
  /**
   * UN DÉMARRAGE NE SÈME AUCUN CONTENU — ni chapitre, ni page.
   *
   * Un projet neuf démarre VIDE. Le contenu vient du Manager, d'un import ou
   * d'un seed client explicite, jamais du runtime générique : un chapitre de
   * démonstration apparu tout seul en production est un chapitre que personne
   * n'a écrit et que tout le monde peut lire.
   */
  check('bootstrap PROD : 0 chapitre de démo', (await Chapter.countDocuments()) === 0);
  check('bootstrap PROD : 0 page de démo', (await SitePage.countDocuments()) === 0);
  /**
   * LOT 2C — UN BOOTSTRAP PROD NE FABRIQUE PLUS D'ADMINISTRATEUR.
   *
   * Il en créait deux, avec des mots de passe connus de tout le parc. Sans
   * `FIRST_DEV_EMAIL`, il n'en crée AUCUN : une base PROD vierge est un cas
   * anormal, et la bonne réponse est de le signaler, pas d'y poser une porte
   * dont l'adresse est publique. Les comptes réels arrivent par la migration
   * TEST → PROD, qui est précisément ce que cette suite éprouve.
   */
  check('bootstrap PROD : AUCUN compte fabriqué sans identité explicite',
    (await User.countDocuments()) === 0);
  check('bootstrap PROD : singleton company créé', (await Company.countDocuments()) === 1);
  await disconnectDatabase();

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (err) {
  console.error('MIGRATION TEST CRASHED:', err);
  fail++;
} finally {
  await seedClient.close();
  await mongod.stop();
  process.exit(fail === 0 ? 0 : 1);
}
