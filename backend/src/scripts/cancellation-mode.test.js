/* Résiliation par environnement (LOT recette) :
 *  - ENV=TEST : résiliation IMMÉDIATE (abonnement Stripe annulé immédiatement,
 *    contrat ENDED, site suspendu immédiatement) ;
 *  - ENV=PROD : comportement historique STRICTEMENT inchangé (cancel at period
 *    end, contrat CANCEL_AT_PERIOD_END, site actif jusqu'à l'échéance).
 * Stripe simulé (stub, journal d'appels). Runner autonome. */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'cancel_test';
process.env.DB_PROD = 'cancel_prod';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SIGNATURE_PROVIDER = 'stub';
process.env.STRIPE_PROVIDER = 'stub';
// La protection contractuelle n'est plus un drapeau d'environnement : elle
// s'active sur la fiche du site, une fois la base connectée (voir plus bas).

let pass = 0;
let fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
await connectDatabase();
await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();

const { config } = await import('../config/env.js');
const { Contract } = await import('../models/Contract.model.js');
const { SiteStatus } = await import('../models/SiteStatus.model.js');
const { getSingleton } = await import('../utils/singleton.js');
const stripeSvcL63C = await import('../services/stripe/stripe.service.js');
const contractSvc = await import('../services/contract.service.js');

// L6.3C — il n'y a plus de pilote local : l'état d'abonnement est déclaré au
// double du PANEL, qui est désormais la seule autorité que le projet consulte.
const ACTOR = { _id: '507f1f77bcf86cd799439011', role: 'ADMIN' };

/**
 * L6.2G — les résiliations passent par le Panel. Ce n'est donc plus le pilote
 * local qu'on interroge, mais le double : c'est lui qui compte les mutations
 * RÉELLEMENT émises, et ce compteur est la preuve du non-doublon.
 */
const { pairWithCheckoutPanel } = await import('./helpers/panelCheckoutDouble.helper.js');
const panel = await pairWithCheckoutPanel();

const CANCEL_NOW = 'billing.subscription.cancel_now';
const CANCEL_AT_END = 'billing.subscription.cancel_at_period_end';

/** Les mutations émises pour cet abonnement, par verbe. */
function mutations(code, subId) {
  return panel.cancellations.filter((c) => c.code === code && c.subscriptionId === subId);
}

/** Déclare un abonnement possédé et lisible côté Panel. */
function abonnement(subId) {
  panel.setSubscription(subId, { status: 'active', cancelAtPeriodEnd: false });
}

async function makeActiveContract(reference, subId) {
  return Contract.create({
    reference,
    name: `Contrat ${reference}`,
    status: 'ACTIVE',
    environment: 'TEST',
    stripe: {
      subscription: {
        subscriptionId: subId,
        status: 'ACTIVE',
        currentPeriodEnd: new Date('2026-08-15T00:00:00.000Z'),
      },
    },
  });
}

try {
  // L'accès doit être retiré à la résiliation : la protection contractuelle
  // est donc ACTIVE pour tout ce scénario.
  const { setContractProtection } = await import('../services/siteEnforcement.service.js');
  await setContractProtection({ enabled: true });

  /* ----------------------- 1. ENV=TEST : résiliation IMMÉDIATE ----------------------- */
  section('1. TEST → résiliation immédiate');
  check('environnement applicatif = TEST', config.isTest === true);
  abonnement('sub_test_1');
  const c1 = await makeActiveContract('CTR-2026-0100', 'sub_test_1');
  const out = await contractSvc.requestCancellation(c1, ACTOR);

  const fresh1 = await Contract.findById(c1._id);
  check('contrat terminé IMMÉDIATEMENT (ENDED)', fresh1.status === 'ENDED');
  check('la valeur retournée reflète l’état final', out.status === 'ENDED');
  check('abonnement projeté ENDED', fresh1.stripe.subscription.status === 'ENDED');
  check('endedAt posé', Boolean(fresh1.stripe.subscription.endedAt));
  check('cancelledAt posé', Boolean(fresh1.stripe.subscription.cancelledAt));
  check('Stripe : annulation IMMÉDIATE demandée au Panel', mutations(CANCEL_NOW, 'sub_test_1').length === 1);
  check('Stripe : PAS de cancel_at_period_end en TEST', mutations(CANCEL_AT_END, 'sub_test_1').length === 0);
  check('…et le projet n’a plus aucun pilote Stripe',
    stripeSvcL63C.getStripeProvider === undefined);

  const site1 = await getSingleton(SiteStatus);
  check('accès retiré immédiatement (site SUSPENDED)', site1.status === 'SUSPENDED');

  // Un contrat ENDED ne peut pas être résilié deux fois.
  let rethrew = false;
  try { await contractSvc.requestCancellation(fresh1, ACTOR); } catch { rethrew = true; }
  check('double résiliation refusée (contrat non actif)', rethrew);

  /* --------------------- 2. ENV=PROD : comportement INCHANGÉ --------------------- */
  section('2. PROD → cancel at period end (inchangé)');
  // config est un singleton mutable : on bascule l'environnement APPLICATIF le
  // temps du scénario (même levier que la garde fail-closed du service).
  const saved = { env: config.env, isProd: config.isProd, isTest: config.isTest };
  config.env = 'PROD'; config.isProd = true; config.isTest = false;
  try {
    abonnement('sub_prod_1');
    const c2 = await makeActiveContract('CTR-2026-0101', 'sub_prod_1');
    await contractSvc.requestCancellation(c2, ACTOR);

    const fresh2 = await Contract.findById(c2._id);
    check('contrat en CANCEL_AT_PERIOD_END', fresh2.status === 'CANCEL_AT_PERIOD_END');
    check('abonnement marqué cancelAtPeriodEnd', fresh2.stripe.subscription.cancelAtPeriodEnd === true);
    check('Stripe : cancel_at_period_end demandé au Panel', mutations(CANCEL_AT_END, 'sub_prod_1').length === 1);
    check('Stripe : JAMAIS d’annulation immédiate en PROD', mutations(CANCEL_NOW, 'sub_prod_1').length === 0);
    check('…et toujours aucun pilote local',
      stripeSvcL63C.getStripeProvider === undefined);

    // Un contrat CANCEL_AT_PERIOD_END reste SERVEABLE : l'enforcement doit
    // remettre/laisser le site actif jusqu'à l'échéance.
    const { reconcileSiteStatus } = await import('../services/siteEnforcement.service.js');
    await reconcileSiteStatus({});
    const site2 = await getSingleton(SiteStatus);
    check('site TOUJOURS servi (résilié mais payé jusqu’à l’échéance)', site2.status === 'ACTIVE');
  } finally {
    config.env = saved.env; config.isProd = saved.isProd; config.isTest = saved.isTest;
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (err) {
  console.error('CANCELLATION MODE TEST CRASHED:', err);
  fail++;
} finally {
  await disconnectDatabase().catch(() => {});
  await mongod.stop();
  process.exit(fail === 0 ? 0 : 1);
}
