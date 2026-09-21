/* Tests END-TO-END ABONNEMENT Stripe + activation + résiliation + entitlement.
 * HTTP + webhooks signés + services. Provider Stripe SIMULÉ — AUCUN appel réel.
 * Runner autonome. */
import crypto from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { PDFDocument } from 'pdf-lib';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4139';
process.env.CORS_ORIGINS = 'http://localhost:6061';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SIGNATURE_PROVIDER = 'stub';
process.env.STRIPE_PROVIDER = 'stub';
// Protection contractuelle : réglage en base, activé juste après la connexion.

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

const STRIPE_WH_SECRET = 'whsec_stripe_test_secret';
const YOUSIGN_WH_SECRET = 'ys_whsec_test_secret';

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
const server = app.listen(4139);
const base = 'http://localhost:4139';

const { Contract } = await import('../models/Contract.model.js');
const { Payment } = await import('../models/Payment.model.js');
const { ContractAuditLog } = await import('../models/ContractAuditLog.model.js');
const { Company } = await import('../models/Company.model.js');
const { publishDeveloperIdentity } = await import('./helpers/developerIdentity.helper.js');
const { publishClientCompany } = await import('./helpers/clientCompany.helper.js');
// L6.2D — le client Stripe d'un contrat est demandé au Panel, sans repli local.
const { pairWithCheckoutPanel } = await import('./helpers/panelCheckoutDouble.helper.js');
const panel = await pairWithCheckoutPanel();
/**
 * LE DÉCOR DE SIGNATURE (R10.5C).
 *
 * Cette suite a besoin d'un contrat SIGNÉ, pas d'éprouver la signature.
 * Depuis le cutover, signer passe par une capacité de la plateforme : le
 * double de facturation ci-dessus délègue les verbes de signature au stub
 * de base, et ce helper applique les faits comme le pont les livre.
 */
const { signContractFully } = await import('./helpers/signatureFixture.helper.js');
const { IntegratedApi } = await import('../models/IntegratedApi.model.js');
const { getSingleton } = await import('../utils/singleton.js');
const subscriptionSvc = await import('../services/subscription.service.js');
const svc = await import('../services/contract.service.js');
const stripeSvc = await import('../services/stripe/stripe.service.js');
const { reconcileSiteStatus, setContractProtection } =
  await import('../services/siteEnforcement.service.js');
const { verifyEntitlements } = await import('../services/reconciliation.service.js');

// Ce scénario vérifie que l'abonnement pilote l'accès au site : la protection
// contractuelle doit donc être ACTIVE d'un bout à l'autre.
await setContractProtection({ enabled: true });

async function api(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + path, { method, headers, body: payload });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* */ }
  return { status: res.status, json };
}
async function login(email, password) {
  return (await api('POST', '/api/auth/login', { body: { email, password } })).json?.data?.token;
}
async function stripeWebhook(event) {
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', STRIPE_WH_SECRET).update(`${t}.${raw}`).digest('hex');
  const res = await fetch(base + '/api/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${t},v1=${v1}` }, body: raw });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const devToken = await login('dev@mail.com', '123dev');
const adminToken = await login('admin@mail.com', '123admin');

// L6.3 FINAL — le projet ne configure plus Stripe : la route REFUSE toute
// écriture. Seul le secret de VÉRIFICATION subsiste, posé comme le Panel le
// pose (canal étroit L6.3A).
await (await import('./helpers/stripeWebhookSecret.helper.js')).seedStripeVerificationSecret(STRIPE_WH_SECRET);
await IntegratedApi.updateOne({ provider: 'STRIPE' }, { $set: { 'modes.TEST.verified': true } });
{
  // Signataires contractuels requis à la validation (voir docs/CONTRACT_SIGNERS.md).
  // Le signataire développeur est PUBLIÉ par le Panel : l'écrire dans une
  // fiche locale ne prouverait plus rien, puisque le code ne la lit plus.
  await publishDeveloperIdentity({ signer: { firstName: 'Luca', lastName: 'Duhoux', jobTitle: 'Gérant', email: 'dev@studio.fr' } });
  /**
   * L’ENTREPRISE CLIENTE — exigée depuis le chantier « facturation légale ».
   *
   * Ni paiement ni signature ne s’ouvrent pour un projet sans identité
   * juridique de client. La publier ici n’assouplit rien : elle donne au
   * parcours la donnée qu’il exige désormais, exactement comme le fait
   * L.Y Solution en remplissant la fiche « Clients » avant d’encaisser.
   */
  await publishClientCompany();
  const company = await getSingleton(Company);
  company.signer = { firstName: 'Marc', lastName: 'Sbaï', jobTitle: 'Directeur', email: 'client@sbauto.fr' };
  await company.save();
}

/** Contrat ENTIÈREMENT SIGNÉ. launchFee=0 -> non requis (isole l'abonnement). */
async function makeSignedContract({ launchFee = 0, subscription = 49 } = {}) {
  const id = (await api('POST', '/api/contracts', { token: devToken })).json.data._id;
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(await pdf.save())], { type: 'application/pdf' }), 'c.pdf');
  await api('POST', `/api/contracts/${id}/document`, { token: devToken, form });
  await api('PUT', `/api/contracts/${id}/draft`, { token: devToken, body: { launchFee: { enabled: launchFee > 0, amountExcludingTax: launchFee }, subscription: { enabled: subscription > 0, amountExcludingTax: subscription }, taxRate: 20 } });
  await api('PUT', `/api/contracts/${id}/signature-configuration`, { token: devToken, body: { zones: [
    { id: 'z1', name: 'DEV', signerRole: 'DEVELOPER', page: 1, xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.05, type: 'SIGNATURE' },
    { id: 'z2', name: 'CLIENT', signerRole: 'CLIENT', page: 1, xRatio: 0.5, yRatio: 0.8, widthRatio: 0.2, heightRatio: 0.05, type: 'SIGNATURE' },
  ] } });
  await api('POST', `/api/contracts/${id}/validate`, { token: devToken });
  await api('POST', `/api/contracts/${id}/start-dev-signature`, { token: devToken });
  // Le fait de signature arrive par le pont, plus par un webhook local.
  await signContractFully(id);
  return id;
}
const nowSec = () => Math.floor(Date.now() / 1000);
const in30d = () => nowSec() + 30 * 24 * 3600;

// --- Gate (contrôle backend) ------------------------------------------------
section("Conditions d'accès à l'abonnement");
{
  const base = { signatureConfiguration: { locked: true }, yousign: { status: 'DONE' }, pricing: { launchFee: { enabled: false }, subscription: { enabled: true, amountIncludingTax: 5880 } }, stripe: { subscription: {} } };
  check('non signé -> CONTRACT_NOT_FULLY_SIGNED', subscriptionSvc.subscriptionPayableIssues({ ...base, yousign: { status: 'ONGOING' } }).includes('CONTRACT_NOT_FULLY_SIGNED'));
  check('frais dus non payés -> LAUNCH_FEE_NOT_PAID', subscriptionSvc.subscriptionPayableIssues({ ...base, pricing: { launchFee: { enabled: true, amountIncludingTax: 1000 }, subscription: base.pricing.subscription }, stripe: { launchFee: { status: 'PENDING' }, subscription: {} } }).includes('LAUNCH_FEE_NOT_PAID'));
  check('abo non configuré -> SUBSCRIPTION_NOT_CONFIGURED', subscriptionSvc.subscriptionPayableIssues({ ...base, pricing: { launchFee: { enabled: false }, subscription: { enabled: false, amountIncludingTax: 0 } } }).includes('SUBSCRIPTION_NOT_CONFIGURED'));
  check('déjà actif -> SUBSCRIPTION_ALREADY_ACTIVE', subscriptionSvc.subscriptionPayableIssues({ ...base, stripe: { subscription: { status: 'ACTIVE' } } }).includes('SUBSCRIPTION_ALREADY_ACTIVE'));
  check('tout OK -> payable', subscriptionSvc.subscriptionPayableIssues(base).length === 0);
}

// --- Checkout abonnement (Product/Price/metadata/idempotence/double clic) ----
section('Checkout abonnement');
let mainId;
{
  mainId = await makeSignedContract({ launchFee: 0, subscription: 49 });

  const r1 = await api('POST', '/api/my-contract/create-subscription-checkout', { token: adminToken });
  check('checkout -> url', typeof r1.json.data?.url === 'string' && r1.json.data.url.includes('checkout.stripe.stub'));
  /**
   * L6.2D — le client n'est plus créé ici. On vérifie ce que le projet DEMANDE :
   * le verbe, et la référence de contrat. Le reste — autorité du contrat, clé
   * Stripe, lien d'appartenance — est prouvé côté Panel.
   */
  /**
   * ── CE QUI A CHANGÉ AU LOT L6.2E ─────────────────────────────────────────
   *
   * Le projet ne demande plus le client, ni le tarif, ni la session séparément :
   * il demande UN verbe — ouvrir une session d'abonnement — et le Panel compose
   * les trois actes avec sa clé. Le montant, la devise et la périodicité sont
   * lus dans SA projection de contrat ; ils ne franchissent plus le pont.
   *
   * Les assertions sur les paramètres Stripe (montant TTC, `mode`,
   * `line_items[].price`, metadata) vivent désormais dans
   * `Panel/tests/stripe-subscription-cutover-e2e.test.js`, là où le Panel les
   * construit. Ici on vérifie ce que le projet contrôle encore : le verbe,
   * l'identité de l'acte, et ce qu'il ne transmet PAS.
   */
  const demande = panel.invocations
    .filter((i) => i.code === 'billing.checkout.create' && i.input.paymentType === 'SUBSCRIPTION')
    .at(-1);
  check('la session d’abonnement est demandée au Panel', Boolean(demande));
  check('…pour CE contrat', demande.input.contractRef === String(mainId));
  check('…et l’identité de l’acte porte la tentative',
    demande.input.operationId.startsWith(`checkout-sub-${mainId}-v`));

  // Ce que le projet NE transmet plus — chacun était une décision qu'il prenait.
  for (const interdit of ['customerId', 'priceId', 'productId', 'amount', 'currency', 'interval', 'mode', 'environment']) {
    check(`aucun « ${interdit} » transmis`, !(interdit in demande.input));
  }

  /**
   * L6.3C — le pilote local a disparu : compter ses appels n'a plus de sens,
   * et l'affirmation devient plus forte — il n'y a plus rien à appeler.
   */
  check('le projet n’expose plus aucun pilote Stripe', stripeSvc.getStripeProvider === undefined);

  const c1 = await Contract.findById(mainId);
  check('projection status CHECKOUT_CREATED', c1.stripe.subscription.status === 'CHECKOUT_CREATED');
  check('la session du Panel est persistée', Boolean(c1.stripe.subscription.checkoutSessionId));
  /**
   * Le client reste persisté — la facturation locale le relit. En revanche
   * `priceId`/`productId` ne le sont plus : le projet ne possède plus ces
   * ressources, et prétendre les connaître serait un journal qui affirme plus
   * qu'il ne sait.
   */
  check('le client rendu par le Panel est persisté', Boolean(c1.stripe.customerId));

  const sessionsAvant = panel.sessions.size;
  const r2 = await api('POST', '/api/my-contract/create-subscription-checkout', { token: adminToken });
  check('double clic -> même url réutilisée', r2.json.data.reused === true && r2.json.data.url === r1.json.data.url);
  check('aucune session supplémentaire au double clic', panel.sessions.size === sessionsAvant);
}

// --- Webhook : session + subscription active --------------------------------
section('Webhook abonnement actif');
{
  const c = await Contract.findById(mainId);
  const subId = 'sub_main';
  // checkout.session.completed (mode subscription) : ne marque pas actif tout seul
  await stripeWebhook({ id: 'evt_cs_sub', type: 'checkout.session.completed', data: { object: { id: c.stripe.subscription.checkoutSessionId, mode: 'subscription', subscription: subId, customer: 'cus_main', metadata: { contractId: String(mainId), paymentType: 'SUBSCRIPTION' } } } });
  // subscription active confirmée
  await stripeWebhook({ id: 'evt_sub_active', type: 'customer.subscription.updated', data: { object: { id: subId, status: 'active', current_period_start: nowSec(), current_period_end: in30d(), cancel_at_period_end: false, latest_invoice: 'in_1', metadata: { contractId: String(mainId) } } } });
  const c2 = await Contract.findById(mainId);
  check('abonnement ACTIVE', c2.stripe.subscription.status === 'ACTIVE');
  check('subscriptionId + période renseignés', c2.stripe.subscription.subscriptionId === subId && Boolean(c2.stripe.subscription.currentPeriodEnd));
  check('latestInvoiceId renseigné', c2.stripe.subscription.latestInvoiceId === 'in_1');

  const st = (await api('GET', '/api/my-contract/subscription-status', { token: adminToken })).json.data;
  check('subscription-status ACTIVE + montant TTC', st.status === 'ACTIVE' && st.amount.includingTax === 5880 && st.amount.interval === 'MONTH');

  const act = (await api('GET', '/api/my-contract/activation', { token: adminToken })).json.data;
  check('étape ACTIVATION (tout satisfait)', act.activation.step === 'ACTIVATION' && act.activation.canActivate === true);
}

// --- Activation finale explicite --------------------------------------------
section('Activation finale du site');
{
  const beforeSite = (await api('GET', '/api/site-status', { token: devToken })).json.data;
  check('site suspendu AVANT activation (pas d’auto-activation au webhook)', beforeSite.status === 'SUSPENDED');

  const activated = await api('POST', '/api/my-contract/activate', { token: adminToken });
  check('activation -> ACTIVE', activated.json.data.status === 'ACTIVE');
  const site = (await api('GET', '/api/site-status', { token: devToken })).json.data;
  check('site ACTIF après activation', site.status === 'ACTIVE');

  // Double activation : le contrat n'est plus activable (déjà ACTIVE)
  const again = await api('POST', '/api/my-contract/activate', { token: adminToken });
  check('double activation refusée', again.status === 400);
}

// --- Résiliation ADMIN (ENV=TEST : IMMÉDIATE) --------------------------------
// En PROD la résiliation reste « fin de période » — couvert par
// cancellation-mode.test.js. Ici (ENV=TEST) elle est immédiate (LOT recette).
section('Résiliation (immédiate en TEST) et fin effective');
{
  panel.setSubscription('sub_main', { status: 'active', cancelAtPeriodEnd: false });
  const cancelled = await api('POST', '/api/my-contract/cancel', { token: adminToken });
  check('résiliation ENV=TEST -> IMMÉDIATE (ENDED)', cancelled.json.data.status === 'ENDED');
  const ended = await Contract.findById(mainId);
  check('abonnement -> ENDED + endedAt', ended.stripe.subscription.status === 'ENDED' && Boolean(ended.stripe.subscription.endedAt));
  /**
   * L6.2G — la coupure passe par le Panel : c'est lui qui vérifie
   * l'appartenance de l'abonnement puis relit son état avant de muter.
   */
  check('Stripe : annulation immédiate demandée au Panel',
    panel.cancellations.some((c) => c.code === 'billing.subscription.cancel_now' && c.subscriptionId === 'sub_main'));
  // L6.3C — il n'y a plus de pilote local à interroger : l'affirmation devient
  // structurelle plutôt que comptable.
  check('…et le projet n’a plus aucun pilote Stripe',
    stripeSvc.getStripeProvider === undefined);
  const site1 = (await api('GET', '/api/site-status', { token: devToken })).json.data;
  check('site SUSPENDU immédiatement (accès retiré)', site1.status === 'SUSPENDED');

  // Webhook de fin arrivant APRÈS coup (Stripe confirme) : idempotent.
  await stripeWebhook({ id: 'evt_sub_del', type: 'customer.subscription.deleted', data: { object: { id: 'sub_main', status: 'canceled', metadata: { contractId: String(mainId) } } } });
  check('webhook de fin rejoué -> toujours ENDED (idempotent)', (await Contract.findById(mainId)).status === 'ENDED');

  const dup = await stripeWebhook({ id: 'evt_sub_del', type: 'customer.subscription.deleted', data: { object: { id: 'sub_main', metadata: { contractId: String(mainId) } } } });
  check('rejeu fin abo -> duplicate', dup.json.duplicate === true);
}

// --- Matrice des statuts (service) ------------------------------------------
section('Mapping des statuts (webhook -> projection)');
{
  const cases = [
    ['trialing', false, 'TRIALING'],
    ['incomplete', false, 'INCOMPLETE'],
    ['past_due', false, 'PAST_DUE'],
    ['unpaid', false, 'UNPAID'],
    ['active', true, 'CANCEL_AT_PERIOD_END'],
  ];
  for (const [stripeStatus, cape, expected] of cases) {
    const id = await makeSignedContract();
    const c = await Contract.findById(id);
    await subscriptionSvc.settleFromSubscription(c, { id: `sub_${stripeStatus}`, status: stripeStatus, cancel_at_period_end: cape, current_period_end: in30d() }, {});
    check(`${stripeStatus}${cape ? '+cape' : ''} -> ${expected}`, (await Contract.findById(id)).stripe.subscription.status === expected);
  }
}

// --- Invoice events (impayé V1) ---------------------------------------------
section('Factures de cycle (invoice.*)');
{
  const id = await makeSignedContract();
  const c = await Contract.findById(id);
  await subscriptionSvc.settleFromSubscription(c, { id: 'sub_inv', status: 'active', current_period_end: in30d() }, {});
  // invoice.paid -> Payment de cycle + confirmation
  await subscriptionSvc.markInvoicePaid(await Contract.findById(id), { id: 'in_cycle1', amount_paid: 5880, currency: 'eur' }, {});
  check('invoice.paid -> Payment SUBSCRIPTION PAID', (await Payment.countDocuments({ contractId: id, type: 'SUBSCRIPTION', status: 'PAID' })) === 1);
  // invoice.payment_failed -> PAST_DUE, site actif
  await subscriptionSvc.markInvoiceFailed(await Contract.findById(id), { id: 'in_cycle2', currency: 'eur' }, {});
  const failed = await Contract.findById(id);
  check('invoice.payment_failed -> PAST_DUE', failed.stripe.subscription.status === 'PAST_DUE');
  check('impayé : lastError renseigné', Boolean(failed.stripe.subscription.lastError?.message));
  // récupération : invoice.paid ramène ACTIVE
  await subscriptionSvc.markInvoicePaid(await Contract.findById(id), { id: 'in_cycle3', amount_paid: 5880, currency: 'eur' }, {});
  check('paiement de cycle -> abonnement de nouveau ACTIVE', (await Contract.findById(id)).stripe.subscription.status === 'ACTIVE');
  check('idempotence invoice.paid (pas de Payment en double)', (await Payment.countDocuments({ contractId: id, type: 'SUBSCRIPTION', status: 'PAID', externalInvoiceId: 'in_cycle1' })) === 1);
}

// --- Activation : unicité + suspension technique indépendante ----------------
section('Unicité contrat & suspension technique');
{
  // Contrat A activable
  const idA = await makeSignedContract();
  const cA = await Contract.findById(idA);
  await subscriptionSvc.settleFromSubscription(cA, { id: 'sub_A', status: 'active', current_period_end: in30d() }, {});
  await svc.beginActivation(await Contract.findById(idA));
  await svc.activateContract(await Contract.findById(idA), { role: 'ADMIN' });
  await reconcileSiteStatus({});
  check('contrat A ACTIVE', (await Contract.findById(idA)).status === 'ACTIVE');

  // Contrat B : activation refusée (un seul contrat vivant)
  const idB = await makeSignedContract();
  const cB = await Contract.findById(idB);
  await subscriptionSvc.settleFromSubscription(cB, { id: 'sub_B', status: 'active', current_period_end: in30d() }, {});
  await svc.beginActivation(await Contract.findById(idB));
  let conflict = false;
  try { await svc.activateContract(await Contract.findById(idB), { role: 'ADMIN' }); } catch (e) { conflict = e.statusCode === 409; }
  check('activation d’un 2ᵉ contrat -> conflit (unicité)', conflict);

  // Suspension technique : indépendante de l'entitlement contractuel
  await api('POST', '/api/site-status/suspend', { token: devToken, body: { reason: 'Maintenance' } });
  const s1 = (await api('GET', '/api/site-status', { token: devToken })).json.data;
  check('suspension technique -> site suspendu malgré contrat actif', s1.status === 'SUSPENDED' && s1.suspensionSource === 'TECHNICAL');
  await api('POST', '/api/site-status/reactivate', { token: devToken });
  const s2 = (await api('GET', '/api/site-status', { token: devToken })).json.data;
  check('levée technique -> site actif (contrat A honoré)', s2.status === 'ACTIVE');

  // Fin de A -> site suspendu (plus aucun contrat servable)
  await subscriptionSvc.settleFromSubscription(await Contract.findById(idA), { id: 'sub_A', status: 'canceled' }, {});
  const s3 = (await api('GET', '/api/site-status', { token: devToken })).json.data;
  check('fin du contrat A -> site suspendu (aucun contrat servable)', s3.status === 'SUSPENDED');
}

// --- Résiliation DEV + réconciliation + entitlements ------------------------
section('Résiliation DEV, réconciliation, entitlements');
{
  const id = await makeSignedContract();
  const c = await Contract.findById(id);
  await subscriptionSvc.settleFromSubscription(c, { id: 'sub_dev', status: 'active', current_period_end: in30d() }, {});
  await svc.beginActivation(await Contract.findById(id));
  await svc.activateContract(await Contract.findById(id), { role: 'ADMIN' });

  // Résiliation par le DEV — immédiate en ENV=TEST (LOT recette).
  const cancel = await api('POST', `/api/contracts/${id}/cancel`, { token: devToken });
  check('DEV résilie (ENV=TEST) -> ENDED immédiat', cancel.json.data.status === 'ENDED');

  // Réconciliation : c'est le PANEL qui confirme la fin distante -> sync reste ENDED
  panel.setSubscription('sub_dev', { status: 'canceled', cancelAtPeriodEnd: false });
  const sync = await api('POST', `/api/contracts/${id}/sync-subscription`, { token: devToken });
  check('sync-subscription -> contrat ENDED', sync.json.data.contract.status === 'ENDED');

  // Idempotence : re-sync ne change rien
  const sync2 = await api('POST', `/api/contracts/${id}/sync-subscription`, { token: devToken });
  check('re-sync idempotent', sync2.json.data.contract.status === 'ENDED');

  // contrat non actif -> résiliation refusée
  const draft = await makeSignedContract();
  const bad = await api('POST', `/api/contracts/${draft}/cancel`, { token: devToken });
  check('résiliation d’un contrat non actif refusée', bad.status === 400);

  const ent = await verifyEntitlements();
  check('verifyEntitlements ne signale aucune incohérence bloquante', Array.isArray(ent.anomalies));
}

// --- Outils de recette (ENV=TEST) -------------------------------------------
// Le refus symétrique en PROD est couvert par env-mode-independence.test.js.
section('Outils de recette (TEST)');
{
  const testTools = await import('../services/contractTestTools.service.js');
  const { Invoice } = await import('../models/Invoice.model.js');
  const { SiteStatus } = await import('../models/SiteStatus.model.js');

  // 1. « Résilier immédiatement » : un contrat ACTIF se termine comme si
  //    l'échéance venait d'arriver — mêmes statuts, même suspension.
  const id = await makeSignedContract();
  const c = await Contract.findById(id);
  await subscriptionSvc.settleFromSubscription(c, { id: 'sub_now', status: 'active', current_period_end: in30d() }, {});
  await svc.beginActivation(await Contract.findById(id));
  await svc.activateContract(await Contract.findById(id), { role: 'ADMIN' });
  check('contrat actif avant l’outil', (await Contract.findById(id)).status === 'ACTIVE');

  // L6.2G — l'abonnement doit être possédé et lisible côté Panel pour être coupé.
  panel.setSubscription('sub_now', { status: 'active', cancelAtPeriodEnd: false });
  const ended = await api('POST', `/api/contracts/${id}/test/end-now`, { token: devToken });
  check('end-now -> 200', ended.status === 200);
  check('contrat -> ENDED', ended.json.data.status === 'ENDED');
  const fresh = await Contract.findById(id);
  check('abonnement -> ENDED', fresh.stripe.subscription.status === 'ENDED');
  check('date de fin renseignée', Boolean(fresh.stripe.subscription.endedAt));
  check('abonnement coupé chez Stripe, via le Panel',
    panel.cancellations.some((c) => c.code === 'billing.subscription.cancel_now'));

  const st = await api('GET', '/api/site-status', { token: devToken });
  check('site suspendu (comme une fin de période réelle)', st.json.data.status === 'SUSPENDED');
  const tl = await api('GET', `/api/contracts/${id}/timeline`, { token: devToken });
  check('timeline : fin de contrat tracée', tl.json.data.some((e) => e.action === 'CONTRACT_ENDED'));

  // Un contrat non actif ne se « termine » pas.
  const draftId = await makeSignedContract();
  const nope = await api('POST', `/api/contracts/${draftId}/test/end-now`, { token: devToken });
  check('end-now refusé sur un contrat non actif (400)', nope.status === 400);

  // 2. « Réinitialiser la recette » : retour à « aucun contrat », suspension
  //    technique levée (c'est elle qui bloquait le parcours de recette).
  await api('POST', '/api/site-status/suspend', { token: devToken, body: { active: true, reason: 'recette' } }).catch(() => {});
  const summary = await api('POST', '/api/contracts/test/reset-recette', { token: devToken });
  check('reset -> 200', summary.status === 200);
  check('contrats purgés', (await Contract.countDocuments({})) === 0);
  check('paiements purgés', (await Payment.countDocuments({})) === 0);
  check('factures purgées', (await Invoice.countDocuments({})) === 0);
  check('résumé rendu au DEV', typeof summary.json.data.contracts === 'number');

  const site = await SiteStatus.findOne();
  check('suspension technique levée', site?.suspended !== true || site?.suspensionSource !== 'TECHNICAL');
  const st2 = await api('GET', '/api/site-status', { token: devToken });
  check('site sans contrat -> suspendu au titre du CONTRAT (pas technique)', st2.json.data.suspensionSource !== 'TECHNICAL');

  // Idempotent : rejouer la remise à zéro sur une base déjà vide.
  const again = await api('POST', '/api/contracts/test/reset-recette', { token: devToken });
  check('reset idempotent (base déjà vide)', again.status === 200 && again.json.data.contracts === 0);
}

// --- Webhook : contrat inconnu ----------------------------------------------
section('Webhook — cas limites');
{
  const orphan = await stripeWebhook({ id: 'evt_orphan_sub', type: 'customer.subscription.updated', data: { object: { id: 'sub_unknown', status: 'active' } } });
  check('subscription d’un contrat inconnu -> 2xx (ignoré)', orphan.status === 200);
}

/* ══════════════════════════════════════════════════════════════════════════
   RÉSILIATION DEPUIS LE PORTAIL STRIPE — le CONTRAT doit suivre.
   ══════════════════════════════════════════════════════════════════════════ */

section('Portail — le contrat suit la résiliation programmée');
{
  /**
   * ── LE DÉFAUT QUE CETTE SECTION VERROUILLE ────────────────────────────────
   *
   * Un client qui résiliait depuis le portail Stripe voyait bien son ABONNEMENT
   * passer en `CANCEL_AT_PERIOD_END` — la projection le faisait déjà. Mais le
   * CONTRAT restait `ACTIVE`, sans la moindre mention : le Manager affichait
   * « Actif » sur un engagement dont Stripe avait planifié l'arrêt, et personne
   * ne pouvait le savoir avant l'échéance.
   *
   * Le vocabulaire existait pourtant en entier — `CANCEL_AT_PERIOD_END` est un
   * statut de contrat déclaré, la transition est autorisée, et l'interface sait
   * déjà l'afficher. Il ne manquait que le geste. Le service de réconciliation
   * le savait d'ailleurs : il signalait `CANCELLATION_REQUESTED_NOT_REFLECTED`
   * comme une anomalie, sans que rien ne la corrige.
   */
  const finDePeriode = in30d();
  const id = await makeSignedContract();
  let c = await Contract.findById(id);

  await subscriptionSvc.settleFromSubscription(c, {
    id: 'sub_portal', status: 'active', cancel_at_period_end: false,
    current_period_start: nowSec(), current_period_end: finDePeriode,
  }, { observedAt: new Date(1000 * 1000) });
  c = await Contract.findById(id);
  /** Le contrat n'est ACTIVE qu'une fois le site activé — on l'y amène. */
  if (c.status !== 'ACTIVE') { c.status = 'ACTIVE'; await c.save(); }
  check('départ : abonnement ACTIVE, contrat ACTIVE',
    (await Contract.findById(id)).stripe.subscription.status === 'ACTIVE'
    && (await Contract.findById(id)).status === 'ACTIVE');

  /* ── B. LE CLIENT RÉSILIE DEPUIS LE PORTAIL ──────────────────────────── */
  await subscriptionSvc.settleFromSubscription(await Contract.findById(id), {
    id: 'sub_portal', status: 'active', cancel_at_period_end: true,
    current_period_start: nowSec(), current_period_end: finDePeriode,
  }, { observedAt: new Date(2000 * 1000) });

  const programme = await Contract.findById(id);
  check('l’abonnement passe en CANCEL_AT_PERIOD_END',
    programme.stripe.subscription.status === 'CANCEL_AT_PERIOD_END');
  check('LE CONTRAT SUIT — CANCEL_AT_PERIOD_END, plus « Actif » muet',
    programme.status === 'CANCEL_AT_PERIOD_END');
  check('…mais il reste VIVANT : la période est payée, le site est servi',
    ['ACTIVE', 'CANCEL_AT_PERIOD_END'].includes(programme.status));
  check('…et la date d’effet est celle de la fin de période',
    Math.floor(new Date(programme.stripe.subscription.currentPeriodEnd).getTime() / 1000) === finDePeriode);
  check('la demande est tracée au journal du contrat',
    (await ContractAuditLog.countDocuments({ contractId: id, action: 'CANCELLATION_REQUESTED' })) === 1);

  /**
   * L'ANOMALIE QUE LA RÉCONCILIATION SIGNALAIT EST FERMÉE.
   *
   * `CANCELLATION_REQUESTED_NOT_REFLECTED` décrivait exactement cet écart :
   * « `cancelAtPeriodEnd` vrai, contrat ACTIVE ». Elle ne doit plus pouvoir se
   * produire au fil de l'eau.
   */
  check('l’état n’est plus l’anomalie CANCELLATION_REQUESTED_NOT_REFLECTED',
    !(programme.stripe.subscription.cancelAtPeriodEnd && programme.status === 'ACTIVE'));

  /* ── DUPLICATA : une seule mutation logique ──────────────────────────── */
  await subscriptionSvc.settleFromSubscription(await Contract.findById(id), {
    id: 'sub_portal', status: 'active', cancel_at_period_end: true,
    current_period_start: nowSec(), current_period_end: finDePeriode,
  }, { observedAt: new Date(2000 * 1000) });
  check('un DOUBLON d’événement ne produit qu’une seule trace',
    (await ContractAuditLog.countDocuments({ contractId: id, action: 'CANCELLATION_REQUESTED' })) === 1);
  check('…et laisse le contrat où il est',
    (await Contract.findById(id)).status === 'CANCEL_AT_PERIOD_END');

  /* ── C. LE CLIENT SE RAVISE ──────────────────────────────────────────── */
  await subscriptionSvc.settleFromSubscription(await Contract.findById(id), {
    id: 'sub_portal', status: 'active', cancel_at_period_end: false,
    current_period_start: nowSec(), current_period_end: finDePeriode,
  }, { observedAt: new Date(3000 * 1000) });

  const repris = await Contract.findById(id);
  check('l’abonnement redevient ACTIVE', repris.stripe.subscription.status === 'ACTIVE');
  check('LE CONTRAT REDEVIENT ACTIVE — la programmation disparaît',
    repris.status === 'ACTIVE');
  check('…et `cancelAtPeriodEnd` est retombé', repris.stripe.subscription.cancelAtPeriodEnd === false);
  check('l’annulation de la résiliation est tracée, distincte de la demande',
    (await ContractAuditLog.countDocuments({ contractId: id, action: 'CANCELLATION_REVOKED' })) === 1);

  /* ── ORDRE INVERSÉ : un vieil événement ne reprogramme rien ──────────── */
  /**
   * Le cas qui compte vraiment : `updated(cancel=true)` produit AVANT le
   * `updated(cancel=false)` mais livré APRÈS. Sans arbitrage par l'instant de
   * PRODUCTION chez le fournisseur, il reprogrammerait une résiliation que le
   * client vient d'annuler — et le Manager annoncerait une fin que personne n'a
   * demandée.
   */
  await subscriptionSvc.settleFromSubscription(await Contract.findById(id), {
    id: 'sub_portal', status: 'active', cancel_at_period_end: true,
    current_period_start: nowSec(), current_period_end: finDePeriode,
  }, { observedAt: new Date(2500 * 1000) });

  const tardif = await Contract.findById(id);
  check('un ANCIEN événement arrivé tard ne reprogramme PAS la résiliation',
    tardif.status === 'ACTIVE' && tardif.stripe.subscription.cancelAtPeriodEnd === false);
  check('…et n’écrit aucune seconde demande',
    (await ContractAuditLog.countDocuments({ contractId: id, action: 'CANCELLATION_REQUESTED' })) === 1);
}

section('Portail — la fin RÉELLE termine le contrat');
{
  const id = await makeSignedContract();
  let c = await Contract.findById(id);
  await subscriptionSvc.settleFromSubscription(c, {
    id: 'sub_fin', status: 'active', cancel_at_period_end: true, current_period_end: in30d(),
  }, { observedAt: new Date(1000 * 1000) });
  c = await Contract.findById(id);
  if (c.status !== 'CANCEL_AT_PERIOD_END') { c.status = 'CANCEL_AT_PERIOD_END'; await c.save(); }

  /**
   * `customer.subscription.deleted` — le MÊME événement fournisseur, sans
   * chemin spécial « portail ». C'est lui, et lui seul, qui terminalise.
   */
  await subscriptionSvc.settleFromSubscription(await Contract.findById(id), {
    id: 'sub_fin', status: 'canceled', cancel_at_period_end: false, current_period_end: in30d(),
  }, { observedAt: new Date(4000 * 1000) });

  const fini = await Contract.findById(id);
  check('l’abonnement est ENDED', fini.stripe.subscription.status === 'ENDED');
  check('LE CONTRAT est terminal — ENDED', fini.status === 'ENDED');
  check('…et la fin est datée', Boolean(fini.stripe.subscription.endedAt));
  check('le contrat n’est plus un statut vivant',
    !['ACTIVE', 'CANCEL_AT_PERIOD_END'].includes(fini.status));

  /**
   * APRÈS LA FIN, PLUS RIEN NE RÉACTIVE.
   *
   * Un `updated(active)` ancien qui arriverait après le `deleted` ne doit pas
   * ressusciter un contrat terminé : `ENDED` n'a aucune transition sortante, et
   * l'observation est de toute façon périmée.
   */
  await subscriptionSvc.settleFromSubscription(await Contract.findById(id), {
    id: 'sub_fin', status: 'active', cancel_at_period_end: false, current_period_end: in30d(),
  }, { observedAt: new Date(3500 * 1000) });
  check('un ANCIEN « actif » arrivé après la fin ne réactive JAMAIS',
    (await Contract.findById(id)).status === 'ENDED');
}

section('Portail — un impayé n’est pas une résiliation');
{
  /**
   * `past_due`, `unpaid`, `incomplete` décrivent un PAIEMENT en difficulté, pas
   * une volonté de partir. Les transformer en résiliation contractuelle
   * fermerait un site pour une carte expirée — alors que la doctrine des
   * impayés a son propre parcours : incident, grâce, suspension, régularisation.
   */
  for (const statut of ['past_due', 'unpaid', 'incomplete']) {
    const id = await makeSignedContract();
    let c = await Contract.findById(id);
    await subscriptionSvc.settleFromSubscription(c, {
      id: `sub_${statut}_x`, status: 'active', cancel_at_period_end: false, current_period_end: in30d(),
    }, { observedAt: new Date(1000 * 1000) });
    c = await Contract.findById(id);
    if (c.status !== 'ACTIVE') { c.status = 'ACTIVE'; await c.save(); }

    await subscriptionSvc.settleFromSubscription(await Contract.findById(id), {
      id: `sub_${statut}_x`, status: statut, cancel_at_period_end: false, current_period_end: in30d(),
    }, { observedAt: new Date(2000 * 1000) });

    const apres = await Contract.findById(id);
    check(`${statut} ne programme AUCUNE résiliation`, apres.status === 'ACTIVE');
    check(`…et n’écrit aucune demande de résiliation`,
      (await ContractAuditLog.countDocuments({ contractId: id, action: 'CANCELLATION_REQUESTED' })) === 0);
  }
}

await new Promise((r) => server.close(r));
await disconnectDatabase();
console.log(`\n${pass} réussis, ${fail} échoués`);
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
