/* LA RÉCURRENCE D'ABONNEMENT — « tous les N mois », « tous les N ans ».
 *
 * ══ CE QUE CETTE SUITE GARDE ═══════════════════════════════════════════════
 *
 * La périodicité d'un contrat n'est plus un choix entre deux mots. Elle porte
 * deux dimensions — un nombre de pas et une unité — et cette suite éprouve
 * chacune des quatre frontières qu'elle traverse :
 *
 *   · LA VALIDATION      ce qui n'a pas de sens n'entre pas, même forgé à la
 *                        main. Le formulaire n'est pas une garantie ;
 *   · LA PERSISTANCE     ce qui a été choisi se relit à l'identique, et une
 *                        mise à jour de MONTANT SEUL ne réécrit pas la
 *                        périodicité — c'est par là qu'un trimestriel
 *                        redeviendrait mensuel sans que nul ne l'ait demandé ;
 *   · LA MIGRATION       le parc existant garde sa périodicité et ses montants,
 *                        et le backfill se rejoue sans rien abîmer ;
 *   · LA PROJECTION      ce que le Panel reçoit suffit à créer le bon tarif.
 *
 * Providers SIMULÉS. Aucun appel réseau réel. */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'rec_test';
process.env.DB_PROD = 'rec_prod';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4173';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SIGNATURE_PROVIDER = 'stub';
process.env.STRIPE_PROVIDER = 'stub';

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
const { createApp } = await import('../app.js');
await connectDatabase();
await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();
// LOT 2C — le DÉCOR de recette (dev@mail.com, admin@mail.com) ne vient plus du
// produit : `bootstrap()` ne pose aucun mot de passe. Voir helpers/testAccounts.helper.js.
await (await import("./helpers/testAccounts.helper.js")).seedTestAccounts();
const app = createApp();
const server = app.listen(4173);
const base = 'http://localhost:4173';

const { Contract } = await import('../models/Contract.model.js');
const recurrenceModule = await import('../utils/subscriptionRecurrence.js');
const {
  normalizeSubscriptionRecurrence, recurrenceOf, describeRecurrence,
  toStripeRecurring, monthsPerCycle, isPaidUpfront,
} = recurrenceModule;
const { monthlyEquivalentCents } = await import('../utils/money.js');
const { getSubscriptionStatus } = await import('../services/subscription.service.js');

async function api(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + path, { method, headers, body: payload });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* */ }
  return { status: res.status, json };
}
const login = async (e, p) => (await api('POST', '/api/auth/login', { body: { email: e, password: p } })).json?.data?.token;
const devToken = await login('dev@mail.com', '123dev');

/** Un brouillon neuf, prêt à recevoir une tarification. */
const nouveauContrat = async () =>
  (await api('POST', '/api/contracts', { token: devToken })).json.data._id;

/** Enregistre une tarification d'abonnement et rend la réponse brute. */
const enregistrer = (id, subscription, extra = {}) =>
  api('PUT', `/api/contracts/${id}/draft`, {
    token: devToken,
    body: { subscription, taxRate: 20, ...extra },
  });

/** Relit le contrat par l'API — la persistance se prouve au RECHARGEMENT. */
const relire = async (id) => (await api('GET', `/api/contracts/${id}`, { token: devToken })).json.data;

try {
  /* ─────────────────────────────────────────────────────────────────────── */
  section('1. Le module pur — ce qui est accepté, et ce qui ne l’est pas');

  for (const [unit, interval] of [['MONTH', 1], ['MONTH', 3], ['MONTH', 12], ['YEAR', 1], ['YEAR', 3]]) {
    const r = normalizeSubscriptionRecurrence({ unit, interval });
    check(`${interval} ${unit} accepté`, r.unit === unit && r.interval === interval);
  }

  /**
   * LES REFUS. Chacun décrit une saisie qu'aucun écran ne compose, et que
   * seule une requête forgée — ou un client mal à jour — peut produire.
   */
  const refuse = (input, quoi, code) => {
    try {
      normalizeSubscriptionRecurrence(input);
      check(`${quoi} : REFUSÉ`, false);
    } catch (e) {
      check(`${quoi} : refusé (${e.details?.code})`, e.details?.code === code);
    }
  };
  const INTERVALLE = 'SUBSCRIPTION_RECURRENCE_INTERVAL_INVALID';
  const UNITE = 'SUBSCRIPTION_RECURRENCE_UNIT_UNKNOWN';
  refuse({ unit: 'MONTH', interval: 0 }, '0 MONTH', INTERVALLE);
  refuse({ unit: 'MONTH', interval: -1 }, '-1 MONTH', INTERVALLE);
  refuse({ unit: 'MONTH', interval: 1.5 }, '1.5 MONTH', INTERVALLE);
  refuse({ unit: 'WEEK', interval: 1 }, '1 WEEK', UNITE);
  refuse({ unit: 'random', interval: 1 }, 'unité arbitraire', UNITE);
  refuse({ unit: 'MONTH' }, 'intervalle absent', INTERVALLE);
  refuse({ unit: 'MONTH', interval: '' }, 'intervalle vide (Number("") vaut 0)', INTERVALLE);
  refuse({ unit: 'MONTH', interval: null }, 'intervalle null', INTERVALLE);
  /**
   * LE PLAFOND DU FOURNISSEUR. Stripe borne une période à trois ans ; au-delà,
   * la création du Price échouerait — devant un client qui paie, des semaines
   * après la signature. On refuse à la SAISIE.
   */
  refuse({ unit: 'MONTH', interval: 37 }, '37 mois (au-delà de trois ans)', INTERVALLE);
  refuse({ unit: 'YEAR', interval: 4 }, '4 ans (au-delà de trois ans)', INTERVALLE);
  check('36 mois : accepté (la borne exacte)', normalizeSubscriptionRecurrence({ unit: 'MONTH', interval: 36 }).interval === 36);
  check('3 ans : accepté (la borne exacte)', normalizeSubscriptionRecurrence({ unit: 'YEAR', interval: 3 }).interval === 3);

  /* ─────────────────────────────────────────────────────────────────────── */
  section('2. La priorité de lecture — une seule règle, écrite une seule fois');

  check('récurrence complète : elle fait foi',
    JSON.stringify(recurrenceOf({ recurrence: { unit: 'YEAR', interval: 2 } })) === JSON.stringify({ unit: 'YEAR', interval: 2 }));
  check('la récurrence bat l’héritage contradictoire',
    recurrenceOf({ interval: 'MONTH', recurrence: { unit: 'YEAR', interval: 2 } }).unit === 'YEAR');
  check('héritage seul : « YEAR » se lit « tous les 1 an »',
    JSON.stringify(recurrenceOf({ interval: 'YEAR' })) === JSON.stringify({ unit: 'YEAR', interval: 1 }));
  check('rien : le défaut historique du parc (tous les mois)',
    JSON.stringify(recurrenceOf(null)) === JSON.stringify({ unit: 'MONTH', interval: 1 }));
  check('récurrence corrompue : l’héritage reprend la main',
    recurrenceOf({ interval: 'YEAR', recurrence: { unit: 'MONTH', interval: 0 } }).unit === 'YEAR');

  section('3. Grammaire, repères et traduction Stripe');
  check('1 MONTH → Tous les mois', describeRecurrence({ unit: 'MONTH', interval: 1 }) === 'Tous les mois');
  check('3 MONTH → Tous les 3 mois', describeRecurrence({ unit: 'MONTH', interval: 3 }) === 'Tous les 3 mois');
  check('1 YEAR → Tous les ans', describeRecurrence({ unit: 'YEAR', interval: 1 }) === 'Tous les ans');
  check('2 YEAR → Tous les 2 ans', describeRecurrence({ unit: 'YEAR', interval: 2 }) === 'Tous les 2 ans');
  check('MONTH+3 → month / interval_count=3',
    JSON.stringify(toStripeRecurring({ unit: 'MONTH', interval: 3 })) === JSON.stringify({ interval: 'month', interval_count: 3 }));
  check('YEAR+2 → year / interval_count=2',
    JSON.stringify(toStripeRecurring({ unit: 'YEAR', interval: 2 })) === JSON.stringify({ interval: 'year', interval_count: 2 }));
  check('trois mois couvrent trois mois', monthsPerCycle({ unit: 'MONTH', interval: 3 }) === 3);
  check('deux ans couvrent vingt-quatre mois', monthsPerCycle({ unit: 'YEAR', interval: 2 }) === 24);
  check('une échéance pluri-mensuelle est payée d’avance', isPaidUpfront({ unit: 'MONTH', interval: 3 }) === true);
  check('un mensuel ne l’est pas', isPaidUpfront({ unit: 'MONTH', interval: 1 }) === false);

  /**
   * L'ÉQUIVALENT MENSUEL est un REPÈRE. 900 € tous les 3 mois valent 300 €/mois
   * pour comparer — mais le client paie 900 €, trois fois moins souvent.
   */
  check('900 € tous les 3 mois → repère 300 €/mois',
    monthlyEquivalentCents(90000, { unit: 'MONTH', interval: 3 }) === 30000);
  check('76800 annuel → 6400/mois', monthlyEquivalentCents(76800, { unit: 'YEAR', interval: 1 }) === 6400);
  check('sur 3 ans : 500000 → 13889/mois (arrondi au centime)',
    monthlyEquivalentCents(500000, { unit: 'YEAR', interval: 3 }) === Math.round(500000 / 36));
  check('mensuel : le repère EST l’échéance', monthlyEquivalentCents(8000, { unit: 'MONTH', interval: 1 }) === 8000);
  check('ancienne signature (chaîne) toujours honorée', monthlyEquivalentCents(76800, 'YEAR') === 6400);

  /* ─────────────────────────────────────────────────────────────────────── */
  section('4. L’API — le serveur ne fait jamais confiance au formulaire');

  const id = await nouveauContrat();
  const ok3m = await enregistrer(id, { enabled: true, amountExcludingTax: 750, recurrence: { unit: 'MONTH', interval: 3 } });
  check('3 MONTH accepté (200)', ok3m.status === 200);
  check('récurrence sérialisée',
    ok3m.json.data.pricing.subscription.recurrence.unit === 'MONTH'
    && ok3m.json.data.pricing.subscription.recurrence.interval === 3);
  /**
   * LE MONTANT N'EST PAS RAMENÉ AU MOIS. 750 € HT + 20 % = 900 € TTC débités
   * TOUS LES TROIS MOIS — et non 300 €/mois.
   */
  check('montant de l’échéance intact (75000 HT / 90000 TTC)',
    ok3m.json.data.pricing.subscription.amountExcludingTax === 75000
    && ok3m.json.data.pricing.subscription.amountIncludingTax === 90000);

  for (const [quoi, recurrence] of [
    ['0 MONTH', { unit: 'MONTH', interval: 0 }],
    ['-1 MONTH', { unit: 'MONTH', interval: -1 }],
    ['1.5 MONTH', { unit: 'MONTH', interval: 1.5 }],
    ['1 WEEK', { unit: 'WEEK', interval: 1 }],
    ['unité arbitraire', { unit: 'random', interval: 1 }],
    ['37 mois', { unit: 'MONTH', interval: 37 }],
    ['4 ans', { unit: 'YEAR', interval: 4 }],
  ]) {
    const res = await enregistrer(id, { enabled: true, amountExcludingTax: 100, recurrence });
    check(`${quoi} : refusé par l’API (${res.status})`, res.status === 400);
  }

  // La saisie refusée n'a rien écrasé : le contrat garde ce qu'il avait.
  const apresRefus = await relire(id);
  check('après refus : la récurrence valide est intacte',
    apresRefus.pricing.subscription.recurrence.interval === 3
    && apresRefus.pricing.subscription.recurrence.unit === 'MONTH');

  /* ─────────────────────────────────────────────────────────────────────── */
  section('5. Persistance — création, édition, rechargement');

  const relu3m = await relire(id);
  check('après rechargement : toujours 3 MONTH',
    relu3m.pricing.subscription.recurrence.unit === 'MONTH'
    && relu3m.pricing.subscription.recurrence.interval === 3);

  const ok2a = await enregistrer(id, { enabled: true, amountExcludingTax: 5000, recurrence: { unit: 'YEAR', interval: 2 } });
  check('édition vers 2 YEAR acceptée', ok2a.status === 200);
  const relu2a = await relire(id);
  check('après rechargement : 2 YEAR',
    relu2a.pricing.subscription.recurrence.unit === 'YEAR'
    && relu2a.pricing.subscription.recurrence.interval === 2);
  check('montant 5 000 € HT conservé tel quel', relu2a.pricing.subscription.amountExcludingTax === 500000);

  /**
   * LA RÉGRESSION LA PLUS COÛTEUSE, ET LA PLUS DISCRÈTE : changer le seul
   * montant ne doit pas réinitialiser la périodicité. Sans la conservation
   * explicite dans `updateDraft`, ce contrat serait redevenu mensuel ici —
   * sans erreur, sans trace, et le client aurait été débité douze fois par an.
   */
  await enregistrer(id, { enabled: true, amountExcludingTax: 6000 });
  const apresMontantSeul = await relire(id);
  check('mise à jour du MONTANT SEUL : la récurrence 2 YEAR survit',
    apresMontantSeul.pricing.subscription.recurrence.unit === 'YEAR'
    && apresMontantSeul.pricing.subscription.recurrence.interval === 2);

  // Désactiver l'abonnement conserve la périodicité choisie : la réactiver ne
  // doit pas exiger de la ressaisir.
  await enregistrer(id, { enabled: false });
  const desactive = await relire(id);
  check('abonnement désactivé : la récurrence reste mémorisée',
    desactive.pricing.subscription.recurrence.interval === 2);

  // Le miroir d'héritage suit l'unité, sans jamais la décider.
  const doc = await Contract.findById(id);
  check('miroir hérité `interval` = unité courante', doc.pricing.subscription.interval === 'YEAR');

  section('6. Compatibilité ascendante — un Manager non rechargé');
  const idHerite = await nouveauContrat();
  const okHerite = await enregistrer(idHerite, { enabled: true, amountExcludingTax: 640, interval: 'YEAR' });
  check('ancien corps (`interval` seul) toujours accepté', okHerite.status === 200);
  check('lu comme « tous les 1 an »',
    okHerite.json.data.pricing.subscription.recurrence.unit === 'YEAR'
    && okHerite.json.data.pricing.subscription.recurrence.interval === 1);

  /* ─────────────────────────────────────────────────────────────────────── */
  section('7. MIGRATION — le parc existant, et l’idempotence du backfill');

  /**
   * On fabrique l'état d'AVANT : des contrats qui ne portent que `interval`, et
   * aucune `recurrence`. L'écriture passe par le driver natif — Mongoose
   * refuserait d'écrire un document sans le champ qu'il déclare.
   */
  const legacy = async (interval, montantTtc) => {
    const res = await Contract.collection.insertOne({
      reference: `LEG-${interval}-${montantTtc}`,
      status: 'DRAFT',
      environment: 'TEST',
      taxRate: 20,
      pricing: {
        subscription: {
          enabled: true,
          amountExcludingTax: Math.round(montantTtc / 1.2),
          taxRate: 20,
          amountIncludingTax: montantTtc,
          currency: 'EUR',
          interval,
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return res.insertedId;
  };
  const idMensuel = await legacy('MONTH', 11880);
  const idAnnuel = await legacy('YEAR', 92160);
  // Un brouillon d'avant l'abonnement : aucune périodicité du tout.
  const idSansRien = (await Contract.collection.insertOne({
    reference: 'LEG-VIDE', status: 'DRAFT', environment: 'TEST', taxRate: 20,
    pricing: { subscription: { enabled: false, amountExcludingTax: 0, currency: 'EUR' } },
    createdAt: new Date(), updatedAt: new Date(),
  })).insertedId;

  const brut = (id2) => Contract.collection.findOne({ _id: id2 });
  check('avant migration : aucune récurrence',
    (await brut(idMensuel)).pricing.subscription.recurrence === undefined);

  await bootstrap(); // rejoue le backfill

  const mensuelMigre = await brut(idMensuel);
  const annuelMigre = await brut(idAnnuel);
  check('mensuel → 1 MONTH',
    mensuelMigre.pricing.subscription.recurrence.unit === 'MONTH'
    && mensuelMigre.pricing.subscription.recurrence.interval === 1);
  check('annuel → 1 YEAR',
    annuelMigre.pricing.subscription.recurrence.unit === 'YEAR'
    && annuelMigre.pricing.subscription.recurrence.interval === 1);
  check('sans périodicité → 1 MONTH (le défaut déjà appliqué à la lecture)',
    (await brut(idSansRien)).pricing.subscription.recurrence.unit === 'MONTH');

  /**
   * AUCUN MONTANT N'EST RECALCULÉ. « 768 € par an » reste « 768 € tous les
   * ans » — le convertir en équivalent mensuel aurait réécrit un engagement.
   */
  check('montant annuel INTACT après migration (92160 TTC)',
    annuelMigre.pricing.subscription.amountIncludingTax === 92160);
  check('montant mensuel INTACT après migration (11880 TTC)',
    mensuelMigre.pricing.subscription.amountIncludingTax === 11880);

  // IDEMPOTENCE : le second passage ne touche rien, et surtout pas un contrat
  // édité depuis. On modifie l'annuel migré en 3 MONTH, on rejoue, on vérifie.
  await Contract.collection.updateOne(
    { _id: idAnnuel },
    { $set: { 'pricing.subscription.recurrence': { unit: 'MONTH', interval: 3 } } },
  );
  await bootstrap();
  await bootstrap();
  const apresRejeu = await brut(idAnnuel);
  check('backfill idempotent : un contrat déjà migré n’est jamais réécrit',
    apresRejeu.pricing.subscription.recurrence.unit === 'MONTH'
    && apresRejeu.pricing.subscription.recurrence.interval === 3);
  check('backfill idempotent : le mensuel migré reste 1 MONTH',
    (await brut(idMensuel)).pricing.subscription.recurrence.interval === 1);

  // Un contrat migré reste ÉDITABLE, et son écran le montre correctement.
  const relectureMigre = await relire(String(idAnnuel));
  check('contrat migré : lisible par l’API', relectureMigre?.pricing?.subscription?.recurrence?.interval === 3);
  const editionMigre = await enregistrer(String(idAnnuel), {
    enabled: true, amountExcludingTax: 900, recurrence: { unit: 'YEAR', interval: 3 },
  });
  check('contrat migré : toujours éditable', editionMigre.status === 200);
  check('contrat migré : nouvelle récurrence persistée',
    (await relire(String(idAnnuel))).pricing.subscription.recurrence.interval === 3);

  /* ─────────────────────────────────────────────────────────────────────── */
  section('8. Ce que voient le parcours client et le Panel');

  const contratStatut = await Contract.findById(id);
  const statut = getSubscriptionStatus(contratStatut);
  check('statut d’abonnement : récurrence complète',
    statut.amount.recurrence.unit === 'YEAR' && statut.amount.recurrence.interval === 2);
  check('statut d’abonnement : libellé prêt à afficher',
    statut.amount.recurrenceLabel === 'Tous les 2 ans');
  check('statut d’abonnement : repère mensuel calculé sur 24 mois',
    statut.amount.monthlyEquivalentIncludingTax === Math.round(statut.amount.includingTax / 24));
  check('statut d’abonnement : `interval` hérité = unité',
    statut.amount.interval === 'YEAR');

  /**
   * LA PROJECTION VERS LE PANEL. C'est elle qui alimente la création du tarif
   * Stripe : si l'intervalle n'y montait pas, un contrat trimestriel deviendrait
   * un abonnement mensuel chez le fournisseur.
   */
  const { buildContractProjection } = await import('../services/projectBridge/projectSync.service.js');

  /**
   * Le contrat COURANT projeté est celui que le projet désigne. On en fabrique
   * un ACTIF portant une récurrence trimestrielle, puis on lit la photographie
   * telle qu'elle partirait sur le pont.
   */
  const idProjete = await nouveauContrat();
  await enregistrer(idProjete, {
    enabled: true, amountExcludingTax: 750, recurrence: { unit: 'MONTH', interval: 3 },
  });
  await Contract.updateOne({ _id: idProjete }, { $set: { status: 'ACTIVE' } });

  const change = await buildContractProjection();
  const projete = change?.payload?.pricing?.subscription;
  check('projection : contrat courant présent', change?.payload?.hasCurrentContract === true);
  check('projection : récurrence complète transmise',
    projete?.recurrence?.unit === 'MONTH' && projete?.recurrence?.interval === 3);
  check('projection : libellé transmis', projete?.recurrenceLabel === 'Tous les 3 mois');
  check('projection : `interval` hérité toujours publié (Panel non redéployé)',
    projete?.interval === 'MONTH');
  /**
   * LE MONTANT PROJETÉ EST CELUI DE L'ÉCHÉANCE. C'est lui que le Panel
   * transmettra à Stripe comme `unit_amount` : le ramener au mois ferait
   * facturer 300 € là où le contrat en dit 900.
   */
  check('projection : montant de l’échéance (90000 TTC), jamais ramené au mois',
    projete?.amountIncludingTax === 90000);
  // Des frais de mise en service n'ont pas de récurrence : lui en publier une
  // inviterait à en chercher le sens.
  check('projection : les frais de lancement ne portent aucune récurrence',
    change?.payload?.pricing?.launchFee?.recurrence === undefined);
} finally {
  await new Promise((r) => server.close(r));
  await disconnectDatabase();
  await mongod.stop();
  console.log(`\n${pass} réussis, ${fail} échoués`);
  process.exit(fail > 0 ? 1 : 0);
}
