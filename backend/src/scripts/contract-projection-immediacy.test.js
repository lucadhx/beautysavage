/**
 * TOUTE MODIFICATION MÉTIER PROJETTE IMMÉDIATEMENT.
 *
 * ── LA RÈGLE ────────────────────────────────────────────────────────────────
 *   modification métier → projection → outbox → pont → Panel
 *
 * Jamais :
 *   modification → … → attente d'un redémarrage → réconciliation
 *
 * `reconcileAll()` est un filet de rattrapage après panne, pas le mode de
 * fonctionnement normal. Ce runner vérifie donc, fait par fait, qu'une entrée
 * CONTRACT apparaît dans la file DÈS l'écriture — et que la réconciliation, sur
 * un état inchangé, ne produit rien.
 *
 * Il vérifie aussi la garantie d'architecture : tout champ LU par la projection
 * doit être SURVEILLÉ par un déclencheur. Un champ ajouté sans son chemin fait
 * échouer ce test, et non une observation en production trois semaines plus tard.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'immediacy_test';
process.env.DB_PROD = 'immediacy_prod';
process.env.JWT_SECRET = 'test-secret-jwt-long-enough-32chars!!';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
process.env.PANEL_SCHEDULER_ENABLED = 'false';

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); } else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (titre) => console.log(`\n${titre}`);

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();
const { bootstrap } = await import('../config/bootstrap.js');
await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();

const { Contract } = await import('../models/Contract.model.js');
const { PanelOutboxEntry } = await import('../models/PanelOutboxEntry.model.js');
const { CONTRACT_STATUS } = await import('../utils/contractConstants.js');
const projectSync = await import('../services/projectBridge/projectSync.service.js');

/** La fenêtre de regroupement des projections est de 500 ms : on l'attend. */
const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));

/**
 * ══ ATTENDRE UNE CONDITION, JAMAIS UNE DURÉE ═══════════════════════════════
 *
 * ── LE DÉFAUT QUE CE VERBE FERME ───────────────────────────────────────────
 *
 * Les constats d'APPARITION s'appuyaient sur `settle(900)` — 900 ms fixes pour
 * une fenêtre de regroupement de 500 ms. Une marge de 400 ms suffit sur une
 * machine au repos ; elle ne suffit pas quand la suite complète tourne et que
 * plusieurs bases en mémoire se disputent le processeur. La recette échouait
 * alors sur « suppression par requête → tombstone immédiat (1 → 1) », en
 * annonçant une projection perdue là où elle était seulement en retard.
 *
 * Une attente fixe ne peut pas être juste : trop courte, elle invente des
 * pannes ; trop longue, elle ralentit chaque exécution pour rien.
 *
 * On attend donc que le fait SOIT VRAI, avec un plafond qui n'est qu'un filet.
 * Le cas nominal devient plus RAPIDE que les 900 ms d'avant, et le cas chargé
 * cesse d'être un faux échec.
 *
 * ⚠️ Ce verbe ne vaut QUE pour prouver une apparition. Prouver qu'il ne se
 * passe rien (section 3) exige toujours d'attendre réellement : `settle()` y
 * reste, et c'est correct.
 */
async function jusqua(predicat, { limiteMs = 8_000, pasMs = 50 } = {}) {
  const echeance = Date.now() + limiteMs;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    if (await predicat()) return true;
    if (Date.now() >= echeance) return false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, pasMs); });
  }
}

const entreesContrat = () => PanelOutboxEntry.countDocuments({ entityType: 'CONTRACT' });

/**
 * Exécute une modification métier et rend le nombre d'entrées CONTRACT
 * apparues. C'est la mesure exacte de « la projection est-elle partie ? ».
 */
async function apresModification(action, { attendue = true } = {}) {
  const avant = await entreesContrat();
  await action();
  /**
   * PROUVER UNE APPARITION et prouver une ABSENCE ne s'attendent pas de la
   * même façon. La première est vraie dès qu'elle est vraie : on la guette.
   * La seconde n'est jamais « déjà vraie » — il faut laisser passer la fenêtre
   * de regroupement en entier avant de pouvoir affirmer que rien n'est parti.
   */
  if (attendue) await jusqua(async () => (await entreesContrat()) > avant);
  else await settle();
  return (await entreesContrat()) - avant;
}

const contrat = await Contract.create({
  reference: 'CTR-IMMEDIAT',
  name: 'Contrat immédiat',
  status: CONTRACT_STATUS.DRAFT,
  environment: 'TEST',
  pricing: {
    subscription: { enabled: true, amountIncludingTax: 9900, currency: 'EUR', interval: 'MONTH' },
    launchFee: { enabled: true, amountIncludingTax: 50000, currency: 'EUR' },
  },
});
await settle();

/* ────────────────────────────────────────────────────────────────────────── */
section('0. La chaîne est branchée');
{
  const { hasSyncListener } = await import('../utils/syncNotifier.js');
  check('un auditeur écoute les sauvegardes', hasSyncListener());
  check('la projection sait mettre en file', projectSync.isSyncWired());
  check('la création du contrat a déjà projeté', (await entreesContrat()) > 0);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('1. Chaque fait métier projette, immédiatement');
{
  const faits = [
    ['changement de statut', async () => {
      contrat.status = CONTRACT_STATUS.PENDING_DEV_SIGNATURE;
      await contrat.save();
    }],
    ['dépôt du document', async () => {
      contrat.document.originalFilename = 'original-11111111-2222-3333-4444-555555555555.pdf';
      contrat.document.pageCount = 3;
      await contrat.save();
    }],
    ['signature', async () => {
      contrat.document.signedFilename = 'signed-11111111-2222-3333-4444-555555555555.pdf';
      contrat.document.signedFetchedAt = new Date();
      await contrat.save();
    }],
    ['configuration de signature', async () => {
      contrat.signatureConfiguration.version = 2;
      await contrat.save();
    }],
    ['suivi du prestataire de signature', async () => {
      contrat.yousign.status = 'ONGOING';
      await contrat.save();
    }],
    ['activation', async () => {
      contrat.status = CONTRACT_STATUS.ACTIVE;
      contrat.activation.activatedAt = new Date();
      await contrat.save();
    }],
    ['changement de montant d’abonnement', async () => {
      contrat.pricing.subscription.amountIncludingTax = 12900;
      await contrat.save();
    }],
    ['changement de frais de mise en service', async () => {
      contrat.pricing.launchFee.amountIncludingTax = 60000;
      await contrat.save();
    }],
    ['modification de l’abonnement (prestataire)', async () => {
      contrat.stripe.subscription.status = 'ACTIVE';
      contrat.stripe.subscription.currentPeriodEnd = new Date('2026-12-31T00:00:00.000Z');
      await contrat.save();
    }],
    ['résiliation fin de période', async () => {
      contrat.status = CONTRACT_STATUS.CANCEL_AT_PERIOD_END;
      contrat.stripe.subscription.cancelAtPeriodEnd = true;
      await contrat.save();
    }],
    ['résiliation immédiate', async () => {
      contrat.status = CONTRACT_STATUS.ENDED;
      contrat.stripe.subscription.endedAt = new Date();
      await contrat.save();
    }],
    ['suppression du document', async () => {
      contrat.document.signedFilename = null;
      await contrat.save();
    }],
    ['archivage', async () => {
      contrat.archived = true;
      await contrat.save();
    }],
    ['désarchivage', async () => {
      contrat.archived = false;
      await contrat.save();
    }],
    ['renouvellement (nouvelle période)', async () => {
      contrat.status = CONTRACT_STATUS.ACTIVE;
      contrat.stripe.subscription.currentPeriodEnd = new Date('2027-12-31T00:00:00.000Z');
      await contrat.save();
    }],
  ];

  for (const [nom, action] of faits) {
    // eslint-disable-next-line no-await-in-loop
    const nouvelles = await apresModification(action);
    check(`${nom} → projection immédiate (${nouvelles} entrée)`, nouvelles >= 1);
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
section('2. La suppression par REQUÊTE projette aussi');
{
  // Les services suppriment par requête (`Contract.deleteOne({ _id })`), forme
  // qui ne passe par aucun document. Le hook de document ne s'y déclenche pas :
  // rien n'était annoncé, et le Panel gardait un contrat qui n'existait plus.
  //
  // On mesure le TOMBSTONE, pas le nombre de lignes : supprimer un contrat
  // parmi d'autres peut redonner un état déjà présent en file, et ne rien
  // écrire de neuf — ce qui est correct. Ne plus avoir AUCUN contrat, en
  // revanche, est un état nouveau, et il doit partir.
  await Contract.deleteMany({ _id: { $ne: contrat._id } });
  await settle();

  const tombstones = () => PanelOutboxEntry.countDocuments({ entityType: 'CONTRACT', deleted: true });

  /**
   * ══ LA MESURE PART D'UNE FILE PROPRE — ET C'EST UN CORRECTIF ═══════════════
   *
   * ── CE QUE CE CONSTAT MESURAIT VRAIMENT ────────────────────────────────────
   *
   * L'outbox DÉDOUBLONNE les tombstones : tant qu'un « plus aucun contrat »
   * attend d'être livré, un second n'apprend rien à personne et n'est pas mis
   * en file (voir `mongoOutboxAdapter`, `alreadyPending`). C'est correct — deux
   * écritures identiques ne valent pas mieux qu'une.
   *
   * Or l'amorçage projette lui aussi la photographie complète, et la base est
   * vide à cet instant : un tombstone y est donc déjà en attente. Le constat
   * « le compte a augmenté » devenait alors faux SANS qu'aucune garantie ne
   * soit rompue.
   *
   * Il ne tenait que parce que la photographie d'amorçage partait en
   * fire-and-forget : elle n'avait, le plus souvent, pas fini quand la recette
   * commençait. Autrement dit, ce constat était vert par COURSE GAGNÉE. Depuis
   * que l'amorçage attend sa photographie — c'est précisément l'invariant que
   * le lot « démarrage déterministe » installe — la course est perdue à tous
   * les coups.
   *
   * ── CE QUI LE REMPLACE ─────────────────────────────────────────────────────
   *
   * On vide la file des projections CONTRACT juste avant de mesurer. Le constat
   * redevient exactement ce que sa phrase annonce : « supprimer le dernier
   * contrat met un tombstone en file », sans dépendre de ce qu'un autre acteur
   * y avait laissé.
   */
  await PanelOutboxEntry.deleteMany({ entityType: 'CONTRACT' });

  const avant = await tombstones();
  await Contract.deleteOne({ _id: contrat._id });
  await jusqua(async () => (await tombstones()) > avant);
  const apres = await tombstones();

  check(`suppression par requête → tombstone immédiat (${avant} → ${apres})`, apres > avant);
  check('…et il ne reste aucun contrat', (await Contract.countDocuments({})) === 0);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* ────────────────────────────────────────────────────────────────────────── */
section('3. reconcileAll() ne crée rien quand rien n’a changé');
{
  // AUCUNE écriture depuis la dernière projection : la réconciliation ne doit
  // rien produire. C'est ce qui la distingue d'une source de vérité — elle
  // rattrape, elle n'invente pas.
  await settle();
  const avant = await entreesContrat();
  await projectSync.reconcileAll();
  await settle();
  const apres = await entreesContrat();
  check(`la réconciliation est un rattrapage, pas une source (${avant} → ${apres})`,
    apres === avant);

  // Deux fois de suite, même résultat.
  await projectSync.reconcileAll();
  await settle();
  check('…et elle reste sans effet si on la rejoue',
    (await entreesContrat()) === avant);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('4. Une écriture SANS portée métier ne déclenche aucune projection');
{
  const autre = await Contract.create({
    reference: 'CTR-NEUTRE',
    name: 'Contrat neutre',
    status: CONTRACT_STATUS.DRAFT,
    environment: 'TEST',
  });
  await settle();

  const nouvelles = await apresModification(async () => {
    autre.name = 'Nom interne, invisible du Panel';
    await autre.save();
  }, { attendue: false });
  check('un champ non projeté ne déclenche rien', nouvelles === 0);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* ────────────────────────────────────────────────────────────────────────── */
section('5. GARANTIE D’ARCHITECTURE — tout champ lu est surveillé, et existe');
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const lire = (rel) => fs.readFile(path.resolve(ici, rel), 'utf8');

  const sync = await lire('../services/projectBridge/projectSync.service.js');
  const selection = await lire('../services/projectBridge/contractSelection.js');
  const triggers = await lire('../services/projectBridge/syncTriggers.js');

  // TOUT le module de projection est inspecté — plus seulement la description
  // du document. Un champ lu par la sélection du contrat courant compte autant
  // que les autres : c'est lui qui décide s'il y a un contrat, ou non.
  const partie = sync.slice(sync.indexOf('export async function buildContractProjection'));
  const code = `${partie}
${selection}`;

  // On relève les CHEMINS COMPLETS, pas seulement le premier segment :
  // `contract.subscription.stripe.endedAt` et `contract.stripe.subscription.endedAt`
  // ont la même racine et ne désignent pas la même chose. L'un existe, l'autre
  // non — et c'est exactement l'erreur qu'on veut voir échouer ici.
  const chemins = new Set();
  for (const m of code.matchAll(/contract[?]?\.((?:\w+[?]?\.)*\w+)/g)) {
    chemins.add(m[1].replace(/\?/g, ''));
  }

  const HORS_PORTEE = ['_id', 'reference', 'createdAt', 'updatedAt'];
  const racines = [...chemins]
    .map((c) => c.split('.')[0])
    .filter((r) => !HORS_PORTEE.includes(r));

  const surveilles = triggers.slice(triggers.indexOf('const CONTRACT_PATHS'));
  const oublis = [...new Set(racines)].filter((r) => !surveilles.includes(`'${r}'`));
  check(`aucun champ lu par la projection n’échappe à un déclencheur (${oublis.join(', ') || 'aucun'})`,
    oublis.length === 0);

  // Un chemin surveillé mais INEXISTANT ne déclenche jamais rien : la lecture
  // rend `undefined` en silence, et le test précédent passerait quand même.
  // On confronte donc chaque chemin au schéma réel du contrat.
  const fantomes = [...chemins].filter((c) => {
    if (HORS_PORTEE.includes(c)) return false;
    if (/\.(filter|map|sort|length|toObject|includes|some|every)$/.test(c)) return false;
    return Contract.schema.pathType(c) === 'adhocOrUndefined';
  });
  check(`aucun chemin lu n’est absent du schéma du contrat (${fantomes.join(', ') || 'aucun'})`,
    fantomes.length === 0);

  check('la date de fin est bien lue là où elle vit',
    /stripe\?\.subscription\?\.endedAt/.test(selection));
  check('…et ce chemin existe',
    Contract.schema.pathType('stripe.subscription.endedAt') === 'real');
  check('…et sa racine est surveillée', surveilles.includes("'stripe'"));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('6. Aucun minuteur ni sondage ajouté');
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const triggers = await fs.readFile(
    path.resolve(ici, '../services/projectBridge/syncTriggers.js'), 'utf8');

  check('les déclencheurs ne posent aucun minuteur',
    !/setInterval|setTimeout/.test(triggers));
  check('…et n’appellent jamais le Panel eux-mêmes',
    !/fetch\(|PanelClient/.test(triggers));
  check('la projection ne relit aucun manifeste', !/manifest/i.test(triggers));
}

await disconnectDatabase();
console.log(`\n${pass} réussis, ${fail} échoués`);
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
