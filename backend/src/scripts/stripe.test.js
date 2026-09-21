/* Tests Stripe : Checkout (frais + abonnement), idempotence, webhook, statuts.
 * Provider simulé (STRIPE_PROVIDER=stub). Runner autonome. */
import { MongoMemoryServer } from 'mongodb-memory-server';
const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.STRIPE_PROVIDER = 'stub';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}
function section(n) {
  console.log(`\n${n}`);
}

const stripe = await import('../services/stripe/stripe.service.js');
const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
await connectDatabase();
await bootstrap(); // seed STRIPE (activeMode=TEST) -> metadata.providerMode résolu
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();

const contract = {
  _id: 'c1',
  reference: 'CTR-2026-0001',
  pricing: {
    launchFee: { enabled: true, amountExcludingTax: 99000, taxRate: 20, taxAmount: 19800, amountIncludingTax: 118800, currency: 'EUR' },
    subscription: { enabled: true, amountExcludingTax: 4900, taxRate: 20, taxAmount: 980, amountIncludingTax: 5880, currency: 'EUR', interval: 'MONTH' },
  },
};
const urls = { successUrl: 'https://manager.test/retour-paiement?ok=1', cancelUrl: 'https://manager.test/retour-paiement?cancel=1' };

// --- Frais de lancement : la porte locale est FERMÉE (L6.2B) ----------------
section('Checkout frais de lancement — plus aucun chemin local');
{
  /**
   * L6.3C — IL N'Y A PLUS DE PILOTE À SIMULER.
   *
   * Ces sections ouvraient sur « le provider est bien le double de test ».
   * Le double, comme le vrai, a été supprimé avec le dernier appel qui les
   * justifiait. L'ouverture devient donc l'affirmation la plus forte de tout
   * le programme Stripe : le projet n'a plus de pilote du tout.
   */
  check('le projet n’expose plus aucun pilote Stripe',
    stripe.getStripeProvider === undefined);

  /**
   * CE QUE CETTE SECTION PROUVAIT, ET OÙ LA PREUVE EST PASSÉE.
   *
   * Elle vérifiait les paramètres de la session de frais de lancement — mode,
   * montant TTC, metadata, clé d'idempotence. Ces paramètres ne sont plus
   * construits ici : le Panel les construit depuis SA projection de contrat,
   * et la preuve vit désormais dans `Panel/tests/stripe-checkout-cutover-e2e`.
   *
   * Ce qui reste à prouver ICI est l'inverse : qu'aucun chemin local ne peut
   * plus ouvrir un paiement de frais de lancement. Un constructeur laissé en
   * place, même inutilisé, redeviendrait le repli du prochain incident.
   */
  check('createLaunchFeeCheckout n’existe plus dans le service',
    stripe.createLaunchFeeCheckout === undefined);
  check('…ni dans son export par défaut',
    stripe.default?.createLaunchFeeCheckout === undefined);

  /**
   * L6.3 — LE VERBE LUI-MÊME A DISPARU DU PROVIDER.
   *
   * Jusqu'ici on vérifiait seulement que le SERVICE ne l'exposait plus : le
   * pilote, lui, gardait `createCheckoutSession` « au cas où ». C'était une
   * porte fermée à clé avec la clé sur la serrure — trois lignes suffisaient
   * pour la rouvrir, et rien n'aurait prévenu.
   */
  check('…ni aucun pilote susceptible d’en ouvrir une', stripe.getStripeProvider === undefined);
}

// --- Abonnement : la porte locale est FERMÉE aussi (L6.2E) ------------------
section('Checkout abonnement — plus aucun chemin local');
{
  /**
   * Même sort que les frais au lot L6.2B, et pour la même raison portée plus
   * loin : une session d'abonnement référence un client et un tarif créés avant
   * elle. Tant que le projet les créait avec SA clé, la session devait partir
   * avec la même — donc rester locale.
   *
   * L6.2D lui a retiré le client, L6.2E le tarif. Le constructeur de session
   * d'abonnement n'a plus de raison d'exister, et il est SUPPRIMÉ plutôt que
   * laissé en place : un constructeur inutilisé est le repli du prochain
   * incident.
   */
  check('createSubscriptionCheckout n’existe plus dans le service',
    stripe.createSubscriptionCheckout === undefined);
  check('…ni dans son export par défaut',
    stripe.default?.createSubscriptionCheckout === undefined);
  check('createLaunchFeeCheckout reste supprimée (L6.2B)',
    stripe.createLaunchFeeCheckout === undefined);

  /**
   * L6.3 — le pilote ne sait plus ouvrir de session, ni pour les frais ni pour
   * l'abonnement. Le portail et les lectures, eux, gardent leurs verbes : c'est
   * la surface exacte que `stripe-local-surface.test.js` gèle.
   */
  check('…et il n’existe plus aucun pilote local', stripe.getStripeProvider === undefined);
}

// --- Résiliations : plus aucun chemin local (L6.2G) -------------------------
section('Résiliations — la porte locale est fermée');
{
  /**
   * Les deux résiliations passaient par ce service : le drapeau de fin de
   * période avec la clé du projet, et la coupure immédiate directement sur le
   * pilote, SANS aucune clé d'idempotence — le plus vieux défaut connu du parc.
   *
   * Elles passent désormais par le Control Plane, qui vérifie l'appartenance de
   * l'abonnement puis relit son ÉTAT avant de muter. La preuve du non-doublon
   * vit dans `Panel/tests/stripe-subscription-cancellation-e2e.test.js`.
   */
  check('cancelSubscriptionAtPeriodEnd n’existe plus dans le service',
    stripe.cancelSubscriptionAtPeriodEnd === undefined);
  check('…ni dans son export par défaut',
    stripe.default?.cancelSubscriptionAtPeriodEnd === undefined);

  /**
   * L6.3 — LES DEUX VERBES ONT ÉTÉ RETIRÉS DU PILOTE.
   *
   * L6.2G avait fermé les quatre appelants ; il restait la capacité technique
   * de couper un abonnement depuis le projet. Elle n'existe plus : couper
   * exige désormais de passer par le Panel, qui vérifie l'appartenance et
   * relit l'état avant de muter.
   */
  check('…et il n’existe plus aucun pilote capable de couper',
    stripe.getStripeProvider === undefined);
}

// --- Webhook (signature Stripe) ---------------------------------------------
section('Webhook Stripe');
{
  const secret = 'whsec_stripe_test';
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const t = 1_800_000_000; // timestamp fixe (déterministe)
  const header = stripe.buildTestSignatureHeader(body, secret, t);

  check('signature valide acceptée', stripe.verifyWebhookSignature(body, header, secret, { nowSec: t }) === true);
  check('corps altéré rejeté', stripe.verifyWebhookSignature(body + 'x', header, secret, { nowSec: t }) === false);
  check('mauvais secret rejeté', stripe.verifyWebhookSignature(body, header, 'autre', { nowSec: t }) === false);
  check('header absent rejeté', stripe.verifyWebhookSignature(body, '', secret, { nowSec: t }) === false);
  check('header malformé rejeté', stripe.verifyWebhookSignature(body, 'garbage', secret, { nowSec: t }) === false);
  check('timestamp hors tolérance rejeté', stripe.verifyWebhookSignature(body, header, secret, { nowSec: t + 10_000 }) === false);
  check('tolérance désactivée -> accepté malgré ancienneté', stripe.verifyWebhookSignature(body, header, secret, { toleranceSec: 0 }) === true);
}

// --- Mapping statuts abonnement ---------------------------------------------
section('Mapping statuts abonnement');
{
  check('active -> ACTIVE', stripe.mapSubscriptionStatus('active') === 'ACTIVE');
  check('active + cancelAtPeriodEnd -> CANCEL_AT_PERIOD_END', stripe.mapSubscriptionStatus('active', { cancelAtPeriodEnd: true }) === 'CANCEL_AT_PERIOD_END');
  check('trialing -> TRIALING', stripe.mapSubscriptionStatus('trialing') === 'TRIALING');
  check('past_due -> PAST_DUE', stripe.mapSubscriptionStatus('past_due') === 'PAST_DUE');
  check('unpaid -> UNPAID', stripe.mapSubscriptionStatus('unpaid') === 'UNPAID');
  check('paused -> PAUSED', stripe.mapSubscriptionStatus('paused') === 'PAUSED');
  check('canceled -> ENDED (fin effective)', stripe.mapSubscriptionStatus('canceled') === 'ENDED');
  check('incomplete -> INCOMPLETE', stripe.mapSubscriptionStatus('incomplete') === 'INCOMPLETE');
  check('incomplete_expired -> FAILED', stripe.mapSubscriptionStatus('incomplete_expired') === 'FAILED');
  check('inconnu -> NONE', stripe.mapSubscriptionStatus('???') === 'NONE');
}

await disconnectDatabase();
await mongod.stop();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
