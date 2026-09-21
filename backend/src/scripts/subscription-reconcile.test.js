/**
 * ABONNEMENT — la vérité vient de Stripe, et le produit sait la constater.
 *
 * ── LES TROIS DÉFAUTS VERROUILLÉS ───────────────────────────────────────────
 * 1. `markInvoicePaid` ne promouvait qu'depuis `PAST_DUE`. Depuis
 *    `CHECKOUT_CREATED` — l'état normal après une première souscription — une
 *    facture payée enregistrait le règlement et laissait le contrat bloqué à
 *    l'étape « abonnement à régler ». L'argent était encaissé chez Stripe et
 *    tracé ici, mais le parcours ne repartait jamais.
 * 2. `reconcileSubscription` sortait sur `!subscriptionId`, or cet identifiant
 *    n'était écrit QUE par les webhooks : un webhook perdu bloquait le contrat
 *    pour toujours, sans aucun recours dans le produit.
 * 3. La clé d'idempotence était stable. Après un paiement, « Reprendre »
 *    rappelait Stripe avec la même clé : celui-ci rejouait sa réponse et
 *    renvoyait l'URL de la session DÉJÀ complétée — page « Vous avez terminé »
 *    sur un parcours que l'application croyait à faire.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'reconcile_test';
process.env.DB_PROD = 'reconcile_prod';
process.env.JWT_SECRET = 'test-secret-jwt-long-enough-32chars!!';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
process.env.PANEL_SCHEDULER_ENABLED = 'false';
process.env.STRIPE_PROVIDER = 'stub';

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); } else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();

const { Contract } = await import('../models/Contract.model.js');
const { Payment } = await import('../models/Payment.model.js');
const { CONTRACT_STATUS, SUBSCRIPTION_STATUS } = await import('../utils/contractConstants.js');
const sub = await import('../services/subscription.service.js');
const sm = await import('../services/contractStateMachine.js');
// L6.2D — le client Stripe d'un contrat est demandé au Panel, sans repli local.
const { pairWithCheckoutPanel } = await import('./helpers/panelCheckoutDouble.helper.js');
const panel = await pairWithCheckoutPanel();

const nouveau = async (extra = {}) => Contract.create({
  reference: `CTR-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  name: 'Contrat de test',
  status: CONTRACT_STATUS.INACTIVE,
  environment: 'TEST',
  signatureRequirement: 'NOT_REQUIRED',
  pricing: {
    subscription: {
      enabled: true, amountExcludingTax: 10000, taxAmount: 2000,
      amountIncludingTax: 12000, currency: 'EUR', interval: 'MONTH',
    },
  },
  ...extra,
});

/** Fournisseur simulé, piloté cas par cas — aucun appel réseau. */
function faux({ session, subscription, invoice, subscriptions } = {}) {
  const calls = [];
  return {
    calls,
    retrieveCheckoutSession: async (id) => { calls.push(['session', id]); if (!session) throw new Error('no such session'); return session; },
    retrieveSubscription: async (id) => { calls.push(['sub', id]); return subscription; },
    retrieveInvoice: async (id) => { calls.push(['invoice', id]); return invoice; },
    listSubscriptions: async (a) => { calls.push(['list', a]); return { data: subscriptions || [] }; },
    createCheckoutSession: async (p, idem) => { calls.push(['create', idem]); return { id: `cs_${idem}`, url: `https://stripe.test/${idem}`, status: 'open' }; },
    createCustomer: async () => ({ id: 'cus_1' }),
    createProduct: async () => ({ id: 'prod_1' }),
    createPrice: async () => ({ id: 'price_1' }),
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
section('1. Une facture payée active l’abonnement — depuis CHECKOUT_CREATED');
{
  const c = await nouveau({
    stripe: { customerId: 'cus_1', subscription: { status: SUBSCRIPTION_STATUS.CHECKOUT_CREATED } },
  });
  check('au départ, l’étape est bien « abonnement »', sm.deriveActivationStep(c) === 'SUBSCRIPTION');

  await sub.markInvoicePaid(c, {
    id: 'in_1', status: 'paid', paid: true, amount_paid: 12000,
    currency: 'eur', subscription: 'sub_1', period_end: 1790000000,
  }, {});

  check('l’abonnement devient ACTIF', c.stripe.subscription.status === SUBSCRIPTION_STATUS.ACTIVE);
  check('…l’identifiant de souscription est récupéré', c.stripe.subscription.subscriptionId === 'sub_1');
  check('…le règlement est tracé', (await Payment.countDocuments({ contractId: c._id })) === 1);
  check('…et le parcours repart', sm.deriveActivationStep(c) !== 'SUBSCRIPTION');
  check('…l’abonnement compte comme satisfait', sm.subscriptionSatisfied(c) === true);
}

section('1 bis. Mais une facture tardive ne ressuscite pas un contrat clos');
{
  const c = await nouveau({ stripe: { subscription: { status: SUBSCRIPTION_STATUS.CANCELLED } } });
  await sub.markInvoicePaid(c, { id: 'in_2', status: 'paid', paid: true, subscription: 'sub_2' }, {});
  check('le statut terminal est conservé', c.stripe.subscription.status === SUBSCRIPTION_STATUS.CANCELLED);
}

section('1 ter. Deux fois la même facture ne comptent qu’une fois');
{
  const c = await nouveau({ stripe: { customerId: 'cus_1', subscription: { status: SUBSCRIPTION_STATUS.CHECKOUT_CREATED } } });
  const facture = { id: 'in_3', status: 'paid', paid: true, amount_paid: 12000, subscription: 'sub_3' };
  await sub.markInvoicePaid(c, facture, {});
  await sub.markInvoicePaid(c, facture, {});
  check('un seul paiement enregistré', (await Payment.countDocuments({ contractId: c._id })) === 1);
  check('…et l’état reste actif', c.stripe.subscription.status === SUBSCRIPTION_STATUS.ACTIVE);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('2. La réconciliation retrouve la souscription que le local ignore');
{
  // Webhook jamais arrivé : aucun `subscriptionId` local.
  const c = await nouveau({
    stripe: {
      customerId: 'cus_1',
      subscription: { status: SUBSCRIPTION_STATUS.CHECKOUT_CREATED, checkoutSessionId: 'cs_1' },
    },
  });
  check('le local ignore la souscription', !c.stripe.subscription.subscriptionId);

  /**
   * L6.2F — la session ET l'abonnement sont lus par le PANEL. C'est donc son
   * état qu'on déclare, pas celui d'un pilote local : la réparation passe par
   * une ressource dont l'appartenance est prouvée, plus par une devinette.
   */
  panel.setSession('cs_1', { status: 'complete', paymentStatus: 'paid', subscriptionId: 'sub_9' });
  panel.setSubscription('sub_9', {
    status: 'active', customerId: 'cus_1', latestInvoiceId: 'in_9', currentPeriodEnd: 1790000000,
  });
  const provider = faux({
    invoice: { id: 'in_9', status: 'paid', paid: true, amount_paid: 12000, subscription: 'sub_9' },
  });

  const etat = await sub.reconcileAndDescribe(c, {}, provider);
  check('la souscription est retrouvée via la session', c.stripe.subscription.subscriptionId === 'sub_9');
  check('l’état local est réparé', c.stripe.subscription.status === SUBSCRIPTION_STATUS.ACTIVE);
  check('…l’issue métier est « payé »', etat.outcome === 'PAID');
  check('…et le changement est signalé', etat.changed === true);
  check('aucune souscription n’a été créée',
    !provider.calls.some(([n]) => n === 'create'));
}

section('2 bis. LE REPLI PAR METADATA A DISPARU (L6.2F)');
{
  /**
   * ── CE QUE CETTE SECTION PROUVAIT, ET POURQUOI ELLE CHANGE ────────────────
   *
   * Elle vérifiait un repli : à défaut de session, on listait les abonnements du
   * client Stripe du contrat et on retenait celui dont `metadata.contractId`
   * correspondait.
   *
   * Ce repli faisait décider l'appartenance par un champ ÉDITABLE depuis le
   * tableau de bord Stripe, sur une liste demandée plus large que son dû. C'est
   * exactement ce que la doctrine du plan de contrôle interdit — et depuis que
   * l'abonnement est adopté par filiation, ce n'est plus nécessaire.
   *
   * Ce qui reste à prouver est donc l'inverse : sans session connue du Panel, on
   * ne rattrape RIEN plutôt que de se tromper.
   */
  const c = await nouveau({ stripe: { customerId: 'cus_1', subscription: { status: SUBSCRIPTION_STATUS.CHECKOUT_CREATED } } });
  const provider = faux({});
  const etat = await sub.reconcileAndDescribe(c, {}, provider);

  check('aucun rattachement sans session possédée', !c.stripe.subscription.subscriptionId);
  check('…et l’issue reste « en attente »', etat.outcome === 'AWAITING_PAYMENT');
  check('AUCUN listing d’abonnements n’est demandé',
    !provider.calls.some(([n]) => n === 'list'));

  /**
   * Et une session que le Panel ne reconnaît pas — antérieure à la bascule — ne
   * produit pas davantage de devinette.
   */
  const d = await nouveau({
    stripe: {
      customerId: 'cus_2',
      subscription: { status: SUBSCRIPTION_STATUS.CHECKOUT_CREATED, checkoutSessionId: 'cs_inconnue_du_panel' },
    },
  });
  const etatD = await sub.reconcileAndDescribe(d, {}, faux({}));
  check('une session non possédée ne rattache rien', !d.stripe.subscription.subscriptionId);
  check('…et l’issue reste « en attente »', etatD.outcome === 'AWAITING_PAYMENT');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('3. Tentatives : une session OPEN est réutilisée, une COMPLETE jamais');
{
  /**
   * ── CE QUI A CHANGÉ AU LOT L6.2E ─────────────────────────────────────────
   *
   * Ces sections pilotaient un faux fournisseur LOCAL pour décider de l'état de
   * la session en cours. Le projet ne lit plus la session : il la demande au
   * Panel, qui la relit avec la clé qui l'a créée. C'est donc l'état connu du
   * PANEL qu'il faut piloter — ce déplacement est exactement l'objet du lot.
   *
   * Le verdict métier testé, lui, est le même : OPEN se réutilise, COMPLETE ne
   * se recrée jamais, EXPIRED ouvre une tentative.
   */
  const urls = { successUrl: 'https://m.test/ok', cancelUrl: 'https://m.test/ko' };

  // OPEN → réutilisée, quels que soient les clics.
  const ouvert = await nouveau({
    stripe: { customerId: 'cus_1', subscription: { status: SUBSCRIPTION_STATUS.NONE } },
  });
  const avantOuvert = panel.sessions.size;
  const r0 = await sub.createOrReuseSubscriptionCheckout(ouvert, urls, null, faux({}));
  const r1 = await sub.createOrReuseSubscriptionCheckout(ouvert, urls, null, faux({}));
  const r2 = await sub.createOrReuseSubscriptionCheckout(ouvert, urls, null, faux({}));
  check('session OPEN réutilisée', r1.reused === true && r2.reused === true);
  check('…la même URL, à chaque clic', r0.url === r1.url && r1.url === r2.url);
  check('…et UNE seule session ouverte chez le Panel', panel.sessions.size === avantOuvert + 1);
  check('…la tentative n’a pas bougé', (ouvert.stripe.subscription.attempt || 0) === 0);

  // COMPLETE → jamais réutilisée, et surtout jamais recréée.
  const complet = await nouveau({
    stripe: { customerId: 'cus_1', subscription: { status: SUBSCRIPTION_STATUS.NONE } },
  });
  const premiere = await sub.createOrReuseSubscriptionCheckout(complet, urls, null, faux({}));
  const avantComplet = panel.sessions.size;
  // Le paiement a lieu chez Stripe : c'est le Panel qui le constate désormais.
  panel.setSessionState(complet.stripe.subscription.checkoutSessionId, {
    status: 'complete', paymentStatus: 'paid', subscriptionId: 'sub_done',
  });
  // L6.2F — l'abonnement se lit par le Panel, donc c'est lui qu'on déclare.
  panel.setSubscription('sub_done', {
    status: 'active', customerId: 'cus_1', currentPeriodEnd: 1790000000,
  });
  const r3 = await sub.createOrReuseSubscriptionCheckout(complet, urls, null, faux({}));
  check('la première a bien rendu une URL', typeof premiere.url === 'string');
  check('session COMPLETE : aucune URL renvoyée', r3.url === null);
  check('…c’est un « déjà payé »', r3.alreadyPaid === true);
  check('…l’état est réconcilié au passage', complet.stripe.subscription.status === SUBSCRIPTION_STATUS.ACTIVE);
  check('…et AUCUNE nouvelle session', panel.sessions.size === avantComplet);
  check('…la tentative reste la même', (complet.stripe.subscription.attempt || 0) === 0);
}

section('3 bis. Une session EXPIRÉE ouvre une nouvelle tentative');
{
  const urls = { successUrl: 'https://m.test/ok', cancelUrl: 'https://m.test/ko' };
  const c = await nouveau({
    stripe: { customerId: 'cus_1', subscription: { status: SUBSCRIPTION_STATUS.NONE, attempt: 0 } },
  });
  await sub.createOrReuseSubscriptionCheckout(c, urls, null, faux({}));
  panel.setSessionState(c.stripe.subscription.checkoutSessionId, { status: 'expired', url: null });

  const r = await sub.createOrReuseSubscriptionCheckout(c, urls, null, faux({}));
  check('une nouvelle session est créée', typeof r.url === 'string' && r.reused === false);
  check('la tentative a avancé', c.stripe.subscription.attempt === 1);
  const acte = panel.lastCheckout()?.input?.operationId;
  check('…et l’identité de l’acte porte la tentative', /-a1$/.test(acte || ''));
}

section('3 ter. Cinq clics concurrents sur une même tentative → une seule session');
{
  const urls = { successUrl: 'https://m.test/ok', cancelUrl: 'https://m.test/ko' };
  const c = await nouveau({ stripe: { customerId: 'cus_1', subscription: { status: SUBSCRIPTION_STATUS.NONE } } });
  const avant = panel.sessions.size;
  // CINQ instances distinctes du même contrat — c'est ce que produisent cinq
  // requêtes HTTP simultanées. Partager un seul document ne testerait que
  // Mongoose, pas le parcours.
  const instances = await Promise.all(
    Array.from({ length: 5 }, () => Contract.findById(c._id)),
  );
  const rs = await Promise.all(instances.map((doc) =>
    sub.createOrReuseSubscriptionCheckout(doc, urls, null, faux({}))));

  const actes = new Set(panel.invocations
    .filter((i) => i.code === 'billing.checkout.create' && i.input.paymentType === 'SUBSCRIPTION')
    .slice(-5)
    .map((i) => i.input.operationId));
  check('une seule identité d’acte pour les 5 clics', actes.size === 1);
  check('…donc une seule session', panel.sessions.size === avant + 1);
  check('…et la même URL pour tous', new Set(rs.map((r) => r.url)).size === 1);
  check('…la tentative n’a pas bougé', (c.stripe.subscription.attempt || 0) === 0);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('4. Issues métier — l’écran ne dit « terminé » que si c’est vrai');
{
  const cas = [
    [SUBSCRIPTION_STATUS.CHECKOUT_CREATED, 'AWAITING_PAYMENT'],
    [SUBSCRIPTION_STATUS.INCOMPLETE, 'PROCESSING'],
    [SUBSCRIPTION_STATUS.PAST_DUE, 'FAILED'],
    [SUBSCRIPTION_STATUS.ACTIVE, 'PAID'],
    [SUBSCRIPTION_STATUS.CANCELLED, 'ENDED'],
  ];
  for (const [statut, attendu] of cas) {
    const c = await nouveau({ stripe: { subscription: { status: statut } } });
    check(`${statut} → ${attendu}`, sub.decrireIssue(c) === attendu);
  }

  const gratuit = await nouveau({ pricing: { subscription: { enabled: false } } });
  check('abonnement non requis → NOT_REQUIRED', sub.decrireIssue(gratuit) === 'NOT_REQUIRED');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('5. L’interface ne sonde plus son propre état');
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const lire = (rel) => fs.readFile(path.join(racine, rel), 'utf8');

  const retour = await lire('manager/src/pages/ContractReturnPage.tsx');
  const contrat = await lire('manager/src/pages/MyContractPage.tsx');
  const routes = await lire('backend/src/routes/myContract.routes.js');

  check('la route de réconciliation existe',
    /router\.post\('\/subscription\/reconcile', ctrl\.reconcileSubscription\)/.test(routes));
  check('…réservée à l’ADMIN', /authorize\(ROLES\.ADMIN\)/.test(routes));

  check('la page de retour réconcilie', /api\.reconcileSubscription\(\)/.test(retour));
  check('…et ne relit plus le statut local en boucle',
    !/api\.getSubscriptionStatus\(\)/.test(retour));
  check('« terminé » exige une issue PAID', /sub\?\.outcome === 'PAID'/.test(retour));
  check('un échec affiche la cause réelle', /sub\?\.lastError\?\.message/.test(retour));

  check('l’écran propose de VÉRIFIER avant de repayer',
    /Vérifier le paiement/.test(contrat) && /onVerify/.test(contrat));
  // On lit le code RENDU : le commentaire cite le libellé supprimé, c'est son rôle.
  const renduContrat = contrat
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*\*.*$/gm, '');
  check('…le faux « Reprendre la souscription » a disparu',
    !/Reprendre la souscription/.test(renduContrat));
  check('…et un « déjà payé » ne renvoie pas chez Stripe',
    /if \(alreadyPaid\) \{ refresh\(\); timeline\.refresh\(\); return; \}/.test(contrat));
}

await disconnectDatabase();
console.log(`\n${pass} réussis, ${fail} échoués`);
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
