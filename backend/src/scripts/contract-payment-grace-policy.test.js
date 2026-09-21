/**
 * L10.6B-1 — LA POLITIQUE DE GRÂCE APPARTIENT AU CONTRAT.
 *
 * ── CE QUE CES CONTRÔLES VERROUILLENT ───────────────────────────────────────
 *
 *   · qu'un contrat naisse SANS politique — `null`, jamais un nombre inventé ;
 *   · que `null` et `0` restent DEUX décisions distinctes (aucune clémence
 *     n'est pas l'absence de politique) ;
 *   · que la politique reste modifiable APRÈS le verrouillage du contrat, seul
 *     moment où elle sert réellement ;
 *   · que chaque changement laisse une trace datée et nominative ;
 *   · qu'un changement PARTE tout de suite vers le Panel, sans attendre un
 *     redémarrage ;
 *   · qu'aucun réglage global ne réapparaisse pour répondre à la même question.
 *
 * ── CE QU'ILS NE PROUVENT PAS ───────────────────────────────────────────────
 *
 * L'instantané sur l'incident, l'ancrage de l'échéance sur le premier échec et
 * le refus d'expirer sans politique appartiennent au Panel, qui en est
 * l'autorité. Ils sont prouvés par `finance-payment-default-confirmation`.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'grace_policy_test';
process.env.DB_PROD = 'grace_policy_prod';
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
const { ContractAuditLog } = await import('../models/ContractAuditLog.model.js');
const { PanelOutboxEntry } = await import('../models/PanelOutboxEntry.model.js');
const {
  CONTRACT_STATUS, CONTRACT_AUDIT_ACTION, MAX_PAYMENT_GRACE_DAYS,
} = await import('../utils/contractConstants.js');
const svc = await import('../services/contract.service.js');
const { buildContractProjection } = await import('../services/projectBridge/projectSync.service.js');

const ACTEUR = { _id: '6512f0000000000000000001' };
const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));

const neuf = (statut = CONTRACT_STATUS.DRAFT, reference = `CTR-G-${Math.floor(pass + fail + 1)}`) =>
  Contract.create({
    reference,
    name: 'Contrat de contrôle',
    status: statut,
    environment: 'TEST',
    pricing: {
      subscription: { enabled: true, amountIncludingTax: 9900, currency: 'EUR', interval: 'MONTH' },
    },
  });

const echoue = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };

/* ────────────────────────────────────────────────────────────────────────── */
section('1. Un contrat naît SANS politique');
{
  const c = await neuf(CONTRACT_STATUS.DRAFT, 'CTR-G-NEUF');
  check('AUCUNE valeur par défaut n’est inventée', c.paymentGraceDays === null);

  const vue = svc.serializeContract(c, { role: 'DEV' });
  check('…et l’écran lit bien « aucune politique »', vue.paymentGraceDays === null);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('2. Poser, modifier, retirer');
{
  const c = await neuf(CONTRACT_STATUS.DRAFT, 'CTR-G-CYCLE');

  await svc.updatePaymentGracePolicy(c, { paymentGraceDays: 7 }, ACTEUR);
  check('la politique est posée', c.paymentGraceDays === 7);

  await svc.updatePaymentGracePolicy(c, { paymentGraceDays: 15 }, ACTEUR);
  check('…modifiée', c.paymentGraceDays === 15);

  /**
   * ZÉRO EST UNE POLITIQUE, PAS UN VIDE. C'est même la plus sévère : l'échéance
   * tombe au premier refus. Un `|| null` quelque part la transformerait en
   * « aucune politique », c'est-à-dire en son exact contraire.
   */
  await svc.updatePaymentGracePolicy(c, { paymentGraceDays: 0 }, ACTEUR);
  check('ZÉRO SURVIT — ce n’est pas « aucune politique »', c.paymentGraceDays === 0);
  const relu = await Contract.findById(c._id).lean();
  check('…y compris relu depuis la base', relu.paymentGraceDays === 0);

  await svc.updatePaymentGracePolicy(c, { paymentGraceDays: null }, ACTEUR);
  check('la politique se retire', c.paymentGraceDays === null);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('3. Les saisies impossibles sont refusées');
{
  const c = await neuf(CONTRACT_STATUS.DRAFT, 'CTR-G-REFUS');
  await svc.updatePaymentGracePolicy(c, { paymentGraceDays: 10 }, ACTEUR);

  const cas = [
    ['un délai négatif', -1],
    ['un demi-jour', 3.5],
    ['au-delà de la borne', MAX_PAYMENT_GRACE_DAYS + 1],
    ['un texte', 'sept'],
  ];
  for (const [nom, valeur] of cas) {
    // eslint-disable-next-line no-await-in-loop
    const err = await echoue(() => svc.updatePaymentGracePolicy(c, { paymentGraceDays: valeur }, ACTEUR));
    check(`${nom} est refusé`, err?.details?.code === 'PAYMENT_GRACE_DAYS_INVALID'
      || err?.code === 'PAYMENT_GRACE_DAYS_INVALID');
  }
  check('la borne haute, elle, passe',
    (await svc.updatePaymentGracePolicy(c, { paymentGraceDays: MAX_PAYMENT_GRACE_DAYS }, ACTEUR))
      .paymentGraceDays === MAX_PAYMENT_GRACE_DAYS);

  const apres = await Contract.findById(c._id).lean();
  check('AUCUN refus n’a écrit quoi que ce soit', apres.paymentGraceDays === MAX_PAYMENT_GRACE_DAYS);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('4. LE CAS QUI JUSTIFIE LA ROUTE — un contrat déjà verrouillé');
{
  /**
   * Un délai de grâce ne sert à rien tant qu'il n'y a pas d'abonnement, donc
   * tant que le contrat est un brouillon. Le cas réel est celui d'une facture
   * refusée sur un contrat ACTIF, et d'un accord pour accorder une semaine.
   * `updateDraft` aurait rendu ce geste impossible.
   */
  const c = await neuf(CONTRACT_STATUS.ACTIVE, 'CTR-G-ACTIF');
  c.signatureConfiguration.locked = true;
  await c.save();

  const err = await echoue(() => svc.updateDraft(c, { taxRate: 10 }, ACTEUR));
  check('la TARIFICATION reste verrouillée, comme il se doit', err !== null);

  await svc.updatePaymentGracePolicy(c, { paymentGraceDays: 15 }, ACTEUR);
  check('LA POLITIQUE, ELLE, SE MODIFIE SUR UN CONTRAT ACTIF', c.paymentGraceDays === 15);
  check('…et la tarification n’a pas bougé', c.taxRate !== 10);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('5. Jamais en silence');
{
  const c = await neuf(CONTRACT_STATUS.ACTIVE, 'CTR-G-AUDIT');
  await svc.updatePaymentGracePolicy(c, { paymentGraceDays: 7 }, ACTEUR);
  await svc.updatePaymentGracePolicy(c, { paymentGraceDays: 30 }, ACTEUR);

  const traces = await ContractAuditLog.find({
    contractId: c._id,
    action: CONTRACT_AUDIT_ACTION.PAYMENT_GRACE_POLICY_CHANGED,
  }).sort({ createdAt: 1 }).lean();

  check('chaque changement laisse une trace', traces.length === 2);
  check('la première dit d’où l’on vient',
    traces[0]?.metadataSafe?.previous === null && traces[0]?.metadataSafe?.next === 7);
  check('la seconde aussi',
    traces[1]?.metadataSafe?.previous === 7 && traces[1]?.metadataSafe?.next === 30);

  /** Réécrire la même valeur n'est pas un fait : rien à journaliser. */
  await svc.updatePaymentGracePolicy(c, { paymentGraceDays: 30 }, ACTEUR);
  const encore = await ContractAuditLog.countDocuments({
    contractId: c._id,
    action: CONTRACT_AUDIT_ACTION.PAYMENT_GRACE_POLICY_CHANGED,
  });
  check('une valeur inchangée ne produit AUCUNE trace de plus', encore === 2);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('6. La politique voyage vers le Panel');
{
  const c = await neuf(CONTRACT_STATUS.ACTIVE, 'CTR-G-PROJ');
  await svc.updatePaymentGracePolicy(c, { paymentGraceDays: 21 }, ACTEUR);

  // Le contrat COURANT est projeté à plat, à la racine du payload.
  const { payload } = await buildContractProjection();
  check('le contrat de contrôle est bien le courant', payload?.sourceContractId === String(c._id));
  check('la projection porte la politique', payload?.paymentGraceDays === 21);

  await svc.updatePaymentGracePolicy(c, { paymentGraceDays: null }, ACTEUR);
  const apres = await buildContractProjection();
  /**
   * `null` doit TRAVERSER, et non disparaître : le Panel a besoin de la
   * distinction entre « aucune politique » et « champ jamais reçu » pour
   * refuser de suspendre plutôt que de supposer un délai.
   */
  check('…et « aucune politique » voyage AUSSI, explicitement',
    'paymentGraceDays' in (apres.payload || {}) && apres.payload.paymentGraceDays === null);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('7. Elle part IMMÉDIATEMENT — pas au prochain redémarrage');
{
  /**
   * Le déclencheur ne surveillait ni `taxRate` ni `paymentGraceDays`, alors que
   * la projection lisait déjà le premier depuis L10.5 : changer le taux de TVA
   * n'atteignait le Panel qu'au redémarrage suivant, ou par raccroc. Pour une
   * politique qu'on corrige PENDANT un impayé, l'écart aurait été le lot.
   */
  const c = await neuf(CONTRACT_STATUS.ACTIVE, 'CTR-G-IMMEDIAT');
  await settle();

  const avant = await PanelOutboxEntry.countDocuments({ entityType: 'CONTRACT' });
  await svc.updatePaymentGracePolicy(c, { paymentGraceDays: 12 }, ACTEUR);
  await settle();
  check('un changement de politique met en file tout de suite',
    (await PanelOutboxEntry.countDocuments({ entityType: 'CONTRACT' })) > avant);

  const avantTva = await PanelOutboxEntry.countDocuments({ entityType: 'CONTRACT' });
  c.taxRate = 5.5;
  await c.save();
  await settle();
  check('un changement de TAUX DE TVA aussi (défaut L10.5 corrigé)',
    (await PanelOutboxEntry.countDocuments({ entityType: 'CONTRACT' })) > avantTva);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('8. Garde-fous — une seule autorité, aucune valeur inventée');
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  const ici = path.dirname(url.fileURLToPath(import.meta.url));
  const lire = (rel) => fs.readFileSync(path.resolve(ici, rel), 'utf8');
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

  const service = code(lire('../services/contract.service.js'));
  const modele = code(lire('../models/Contract.model.js'));
  const config = code(lire('../config/env.js'));
  const validateur = code(lire('../validators/contract.validator.js'));
  const declencheurs = lire('../services/projectBridge/syncTriggers.js');

  check('AUCUN réglage global de grâce ne subsiste',
    !/contractPaymentGraceDays|CONTRACT_PAYMENT_GRACE_DAYS/.test(config));
  check('…ni ailleurs dans le service',
    !/process\.env[^;\n]*GRACE/i.test(service));
  check('aucun repli sur une valeur inventée',
    !/paymentGraceDays\s*(\?\?|\|\|)\s*\d/.test(service + modele));
  check('le modèle ne pose aucun défaut numérique',
    /paymentGraceDays:\s*\{[^}]*default:\s*null/.test(modele));
  check('la saisie est bornée côté validateur',
    /paymentGraceDays:[^,]*MAX_PAYMENT_GRACE_DAYS/.test(validateur));
  check('…et le champ y est obligatoire, nul étant une valeur',
    /paymentGraceDays:\s*z[^,\n]*nullable\(\),/.test(validateur));
  check('le déclencheur surveille la politique',
    /'paymentGraceDays'/.test(declencheurs));
  check('…et le taux de TVA', /'taxRate'/.test(declencheurs));

  /**
   * Stripe reste l'unique ordonnanceur des tentatives de collecte. Ce lot
   * n'introduit aucune relance locale : le Panel décide QUAND il agit, jamais
   * QUAND on retente un paiement.
   */
  check('aucun intervalle de relance n’est apparu',
    !/retryInterval/.test(service + modele + config));
}

await Contract.deleteMany({});
await ContractAuditLog.deleteMany({});
await disconnectDatabase();
await mongod.stop();

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
