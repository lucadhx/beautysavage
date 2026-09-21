/* Tests END-TO-END des FRAIS DE LANCEMENT (Stripe Checkout, paiement unique).
 * HTTP + webhooks signés + mutateurs de service. Provider Stripe SIMULÉ
 * (STRIPE_PROVIDER=stub) — AUCUN appel réel. Runner autonome. */
import crypto from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { PDFDocument } from 'pdf-lib';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4137';
process.env.CORS_ORIGINS = 'http://localhost:6061,http://localhost:6062';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SIGNATURE_PROVIDER = 'stub';
process.env.STRIPE_PROVIDER = 'stub';

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


/**
 * LE DÉCOR DE SIGNATURE (R10.5C).
 *
 * Cette suite appaire déjà son propre double de Panel, plus bas, pour la
 * facturation. On ne réappaire donc PAS ici — on importe seulement de quoi
 * faire signer un contrat, et le double délègue les verbes de signature au
 * stub de base.
 */
const { signContractFully } = await import('./helpers/signatureFixture.helper.js');
const app = createApp();
const server = app.listen(4137);
const base = 'http://localhost:4137';

const { Contract } = await import('../models/Contract.model.js');
const { Payment } = await import('../models/Payment.model.js');
const { Company } = await import('../models/Company.model.js');
const { publishDeveloperIdentity } = await import('./helpers/developerIdentity.helper.js');
const { publishClientCompany } = await import('./helpers/clientCompany.helper.js');
/**
 * L6.2B — ouvrir un paiement passe par le Panel, et il n'y a pas de repli. Les
 * suites qui éprouvent l'AVAL de ce parcours ont donc besoin d'un Panel qui
 * réponde ; voir l'en-tête du double pour ce qu'il prouve et ce qu'il ne prouve
 * pas.
 */
const { pairWithCheckoutPanel } = await import('./helpers/panelCheckoutDouble.helper.js');
const panel = await pairWithCheckoutPanel();
const { IntegratedApi } = await import('../models/IntegratedApi.model.js');
const { getSingleton } = await import('../utils/singleton.js');
const paymentSvc = await import('../services/payment.service.js');
const stripeSvc = await import('../services/stripe/stripe.service.js');
const { reconcileLaunchFeePayment } = paymentSvc;

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
  const r = await api('POST', '/api/auth/login', { body: { email, password } });
  return r.json?.data?.token;
}
async function stripeWebhook(event) {
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', STRIPE_WH_SECRET).update(`${t}.${raw}`).digest('hex');
  const res = await fetch(base + '/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${t},v1=${v1}` },
    body: raw,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const devToken = await login('dev@mail.com', '123dev');
const adminToken = await login('admin@mail.com', '123admin');

// Intégrations TEST configurées + vérifiées (sans réseau).
// L6.3 FINAL — le projet ne configure plus Stripe : la route REFUSE toute
// écriture. Seul le secret de VÉRIFICATION subsiste, posé comme le Panel le
// pose (canal étroit L6.3A).
await (await import('./helpers/stripeWebhookSecret.helper.js')).seedStripeVerificationSecret(STRIPE_WH_SECRET);
await IntegratedApi.updateOne({ provider: 'STRIPE' }, { $set: { 'modes.TEST.verified': true } });

// Email client (requis à la validation).
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

/** Crée un contrat ENTIÈREMENT SIGNÉ avec des frais de lancement (990 € HT). */
async function makeSignedContract({ launchFee = 990 } = {}) {
  const created = (await api('POST', '/api/contracts', { token: devToken })).json.data;
  const id = created._id;
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  const pdfBytes = Buffer.from(await pdf.save());
  const form = new FormData();
  form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'contrat.pdf');
  await api('POST', `/api/contracts/${id}/document`, { token: devToken, form });
  await api('PUT', `/api/contracts/${id}/draft`, { token: devToken, body: { launchFee: { enabled: launchFee > 0, amountExcludingTax: launchFee }, subscription: { enabled: true, amountExcludingTax: 49 }, taxRate: 20 } });
  const zones = [
    { id: 'z1', name: 'DEV', signerRole: 'DEVELOPER', page: 1, xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.05, type: 'SIGNATURE' },
    { id: 'z2', name: 'CLIENT', signerRole: 'CLIENT', page: 1, xRatio: 0.5, yRatio: 0.8, widthRatio: 0.2, heightRatio: 0.05, type: 'SIGNATURE' },
  ];
  await api('PUT', `/api/contracts/${id}/signature-configuration`, { token: devToken, body: { zones } });
  await api('POST', `/api/contracts/${id}/validate`, { token: devToken });
  await api('POST', `/api/contracts/${id}/start-dev-signature`, { token: devToken });
  // Le fait de signature arrive désormais par le pont, pas par un webhook local.
  await signContractFully(id);
  return id;
}

// --- Conditions d'accès (gate backend) --------------------------------------
section('Conditions de paiement (gate backend)');
{
  const notValidated = { signatureConfiguration: { locked: false }, yousign: {}, pricing: { launchFee: { enabled: true, amountIncludingTax: 118800 } }, stripe: { launchFee: {} } };
  check('non validé -> CONTRACT_NOT_VALIDATED', paymentSvc.launchFeePayableIssues(notValidated).includes('CONTRACT_NOT_VALIDATED'));

  const notSigned = { signatureConfiguration: { locked: true }, yousign: { status: 'ONGOING' }, pricing: { launchFee: { enabled: true, amountIncludingTax: 118800 } }, stripe: { launchFee: {} } };
  check('non signé -> CONTRACT_NOT_FULLY_SIGNED', paymentSvc.launchFeePayableIssues(notSigned).includes('CONTRACT_NOT_FULLY_SIGNED'));

  const noFee = { signatureConfiguration: { locked: true }, yousign: { status: 'DONE' }, pricing: { launchFee: { enabled: false, amountIncludingTax: 0 } }, stripe: { launchFee: {} } };
  check('frais non configurés -> LAUNCH_FEE_NOT_CONFIGURED', paymentSvc.launchFeePayableIssues(noFee).includes('LAUNCH_FEE_NOT_CONFIGURED'));

  const paid = { signatureConfiguration: { locked: true }, yousign: { status: 'DONE' }, pricing: { launchFee: { enabled: true, amountIncludingTax: 118800 } }, stripe: { launchFee: { status: 'PAID' } } };
  check('déjà payé -> LAUNCH_FEE_ALREADY_PAID', paymentSvc.launchFeePayableIssues(paid).includes('LAUNCH_FEE_ALREADY_PAID'));

  const okContract = { signatureConfiguration: { locked: true }, yousign: { status: 'DONE' }, pricing: { launchFee: { enabled: true, amountIncludingTax: 118800 } }, stripe: { launchFee: { status: 'PENDING' } } };
  check('tout satisfait -> payable (aucun manquant)', paymentSvc.launchFeePayableIssues(okContract).length === 0);
}

// --- Checkout (création, montant, metadata, idempotence, double clic) --------
section('Checkout frais de lancement');
let contractId;
{
  contractId = await makeSignedContract();

  // ADMIN : statut initial = à payer (PENDING projeté)
  let status = (await api('GET', '/api/my-contract/launch-fee-status', { token: adminToken })).json.data;
  check('launch-fee-status: requis', status.required === true);
  check('launch-fee-status: montant TTC 118800', status.amount.includingTax === 118800);
  check('launch-fee-status: pas encore payé', status.status !== 'PAID');


  const r1 = await api('POST', '/api/my-contract/create-launch-checkout', { token: adminToken });
  check('checkout -> url Stripe', typeof r1.json.data.url === 'string' && r1.json.data.url.includes('checkout.stripe.stub'));

  /**
   * ── CE QUI A CHANGÉ AU LOT L6.2B ──────────────────────────────────────────
   *
   * Cette section inspectait les paramètres passés au SDK Stripe : mode,
   * montant TTC, metadata. Le projet ne les construit plus — il ne connaît plus
   * le montant de son propre contrat au moment de facturer, et c'est le point
   * du lot. Ces assertions vivent désormais côté Panel
   * (`Panel/tests/stripe-checkout-cutover-e2e.test.js`), là où le montant est
   * lu dans la projection.
   *
   * Ce qui se vérifie ICI est ce que le projet contrôle encore : l'IDENTITÉ de
   * l'acte, la référence de contrat, et les URL de retour. La clé d'idempotence
   * n'a pas disparu — elle est devenue l'`operationId` de la capacité, avec la
   * même valeur, stable par tentative.
   */
  const demande = panel.lastCheckout();
  check('l’ouverture est passée par la capacité du Panel', demande !== null);
  check('le projet n’expose plus aucun pilote Stripe', stripeSvc.getStripeProvider === undefined);
  check('contractRef = le contrat du projet', demande.input.contractRef === String(contractId));
  check('paymentType LAUNCH_FEE', demande.input.paymentType === 'LAUNCH_FEE');
  check('operationId stable (attempt 1)', demande.input.operationId === `launch-${contractId}-v1-a1-TEST`);
  check('corrélation vers le journal local', Boolean(demande.input.correlation?.paymentRef));
  check('aucun montant transmis au Panel',
    !('amount' in demande.input) && !('currency' in demande.input));
  check('aucun monde transmis au Panel',
    !('mode' in demande.input) && !('environment' in demande.input));
  check('success_url = managerUrl réseau + session_id', demande.input.successUrl.includes('/contrat/retour-paiement') && demande.input.successUrl.includes('{CHECKOUT_SESSION_ID}'));

  const payments1 = await Payment.countDocuments({ contractId, type: 'LAUNCH_FEE' });
  check('un Payment créé (PENDING)', payments1 === 1);

  // Double clic -> réutilisation de la MÊME session (aucun 2ᵉ Payment)
  const r2 = await api('POST', '/api/my-contract/create-launch-checkout', { token: adminToken });
  check('double clic -> même url réutilisée', r2.json.data.url === r1.json.data.url && r2.json.data.reused === true);
  check('…et une seule session ouverte chez le Panel', panel.sessions.size === 1);
  const payments2 = await Payment.countDocuments({ contractId, type: 'LAUNCH_FEE' });
  check('aucun Payment supplémentaire (double clic)', payments2 === 1);
}

// --- Webhook : paiement confirmé (carte classique) --------------------------
section('Webhook — paiement confirmé');
{
  const payment = await Payment.findOne({ contractId, type: 'LAUNCH_FEE' });
  const sessionId = payment.stripe.checkoutSessionId;

  // Signature invalide -> 400
  const bad = await fetch(base + '/api/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' }, body: JSON.stringify({ id: 'evt_bad', type: 'checkout.session.completed' }) });
  check('signature invalide -> 400', bad.status === 400);

  const evt = { id: 'evt_paid_1', type: 'checkout.session.completed', data: { object: { id: sessionId, object: 'checkout.session', payment_status: 'paid', status: 'complete', customer: 'cus_launch', payment_intent: 'pi_launch_1', metadata: { contractId: String(contractId), paymentType: 'LAUNCH_FEE', paymentId: String(payment._id) } } } };
  const w = await stripeWebhook(evt);
  check('webhook payé -> 200', w.status === 200 && w.json.received === true);

  const afterPay = await Payment.findById(payment._id);
  check('Payment PAID', afterPay.status === 'PAID');
  check('Payment paidAt renseigné', Boolean(afterPay.paidAt));
  check('Payment paymentIntentId enregistré', afterPay.stripe.paymentIntentId === 'pi_launch_1');

  const c = await Contract.findById(contractId);
  check('projection contrat launchFee PAID', c.stripe.launchFee.status === 'PAID');
  check('projection paymentId renseigné', String(c.stripe.launchFee.paymentId) === String(payment._id));
  check('contrat NON activé (pas ACTIVE)', c.status !== 'ACTIVE');

  // Idempotence : rejeu du même event
  const dup = await stripeWebhook(evt);
  check('rejeu même event -> duplicate', dup.json.duplicate === true);

  // Statut ADMIN
  const status = (await api('GET', '/api/my-contract/launch-fee-status', { token: adminToken })).json.data;
  check('ADMIN voit PAID', status.status === 'PAID' && Boolean(status.paidAt));

  // Détail DEV
  const devPayments = (await api('GET', `/api/contracts/${contractId}/payments`, { token: devToken })).json.data;
  check('DEV voit le paiement PAID', Array.isArray(devPayments) && devPayments[0].status === 'PAID');
  check('DEV : identifiants Stripe raccourcis', typeof devPayments[0].paymentIntentId === 'string');

  // Timeline
  const tl = (await api('GET', `/api/contracts/${contractId}/timeline`, { token: devToken })).json.data;
  const actions = tl.map((e) => e.action);
  check('timeline: CHECKOUT_CREATED', actions.includes('CHECKOUT_CREATED'));
  check('timeline: PAYMENT_SUCCEEDED', actions.includes('PAYMENT_SUCCEEDED'));

  // Paiement unique : nouveau checkout refusé (LAUNCH_FEE_ALREADY_PAID)
  const again = await api('POST', '/api/my-contract/create-launch-checkout', { token: adminToken });
  check('re-paiement refusé -> 400 LAUNCH_FEE_NOT_PAYABLE', again.status === 400 && again.json.code === 'LAUNCH_FEE_NOT_PAYABLE');
  check('détail: LAUNCH_FEE_ALREADY_PAID', again.json.details?.missing?.includes('LAUNCH_FEE_ALREADY_PAID'));
}

// --- Événements sans contrat / rôle / provider non prêt ----------------------
section('Webhook — cas limites');
{
  const orphan = await stripeWebhook({ id: 'evt_orphan', type: 'checkout.session.completed', data: { object: { id: 'cs_orphan', payment_status: 'paid', metadata: {} } } });
  check('event sans contrat rattachable -> 2xx', orphan.status === 200);

  const noToken = await api('POST', '/api/my-contract/create-launch-checkout', {});
  check('sans authentification -> 401', noToken.status === 401);
}

// --- Paiement asynchrone (processing -> succeeded / failed) ------------------
section('Paiement asynchrone (service)');
{
  const id = await makeSignedContract();
  const contract = await Contract.findById(id);
  const { payment } = await paymentSvc.createOrReuseLaunchCheckout(contract, { successUrl: 'https://m/s', cancelUrl: 'https://m/c' }, { role: 'ADMIN' });

  // checkout.session.completed non payé -> PROCESSING
  await paymentSvc.settleFromSession(contract, payment, { id: payment.stripe.checkoutSessionId, status: 'complete', payment_status: 'unpaid', payment_intent: 'pi_async_1' });
  check('session complète non payée -> PROCESSING', (await Payment.findById(payment._id)).status === 'PROCESSING');
  check('projection contrat PROCESSING', (await Contract.findById(id)).stripe.launchFee.status === 'PROCESSING');

  // async_payment_succeeded -> PAID
  await paymentSvc.settleFromSession(contract, await Payment.findById(payment._id), { id: payment.stripe.checkoutSessionId, status: 'complete', payment_status: 'paid', payment_intent: 'pi_async_1' });
  check('async_payment_succeeded -> PAID', (await Payment.findById(payment._id)).status === 'PAID');
}
{
  const id = await makeSignedContract();
  const contract = await Contract.findById(id);
  const { payment } = await paymentSvc.createOrReuseLaunchCheckout(contract, { successUrl: 'https://m/s', cancelUrl: 'https://m/c' }, { role: 'ADMIN' });
  await paymentSvc.markProcessing(contract, payment, { paymentIntentId: 'pi_fail_1' });
  await paymentSvc.markFailed(contract, await Payment.findById(payment._id), { reason: 'card_declined' });
  const p = await Payment.findById(payment._id);
  check('async_payment_failed -> FAILED', p.status === 'FAILED');
  check('FAILED: lastError sûr', p.lastError === 'card_declined');
  check('projection contrat FAILED', (await Contract.findById(id)).stripe.launchFee.status === 'FAILED');
}

// --- PaymentIntent + remboursement + expiration -----------------------------
section('PaymentIntent, remboursement, expiration (service)');
{
  const id = await makeSignedContract();
  const contract = await Contract.findById(id);
  const { payment } = await paymentSvc.createOrReuseLaunchCheckout(contract, { successUrl: 'https://m/s', cancelUrl: 'https://m/c' }, { role: 'ADMIN' });

  await paymentSvc.settleFromPaymentIntent(contract, payment, { id: 'pi_ok', status: 'succeeded', customer: 'cus_pi' });
  check('payment_intent.succeeded -> PAID', (await Payment.findById(payment._id)).status === 'PAID');

  // Remboursement
  await paymentSvc.markRefunded(contract, await Payment.findById(payment._id));
  check('charge.refunded -> REFUNDED', (await Payment.findById(payment._id)).status === 'REFUNDED');
  check('projection contrat REFUNDED', (await Contract.findById(id)).stripe.launchFee.status === 'REFUNDED');
}
{
  const id = await makeSignedContract();
  const contract = await Contract.findById(id);
  const { payment } = await paymentSvc.createOrReuseLaunchCheckout(contract, { successUrl: 'https://m/s', cancelUrl: 'https://m/c' }, { role: 'ADMIN' });
  await paymentSvc.markExpired(contract, payment);
  check('session expirée -> EXPIRED', (await Payment.findById(payment._id)).status === 'EXPIRED');
  // Après expiration, une NOUVELLE tentative est possible (attempt 2)
  const fresh = await Contract.findById(id);
  const r = await paymentSvc.createOrReuseLaunchCheckout(fresh, { successUrl: 'https://m/s', cancelUrl: 'https://m/c' }, { role: 'ADMIN' });
  check('nouvelle tentative après expiration (attempt 2)', r.payment.attempt === 2 && r.reused === false);
}

// --- Cohérence de mode + non-rétrogradation ---------------------------------
section('Cohérence de mode & terminal');
{
  const id = await makeSignedContract();
  const contract = await Contract.findById(id);
  const { payment } = await paymentSvc.createOrReuseLaunchCheckout(contract, { successUrl: 'https://m/s', cancelUrl: 'https://m/c' }, { role: 'ADMIN' });
  await paymentSvc.markPaid(contract, payment, { paymentIntentId: 'pi_final' });
  // Un paiement terminal (PAID) ne redevient jamais FAILED
  const res = await paymentSvc.markFailed(contract, await Payment.findById(payment._id), { reason: 'late_failure' });
  check('paiement PAID non rétrogradé par un échec tardif', res.changed === false && (await Payment.findById(payment._id)).status === 'PAID');

  // Mode mismatch : un Payment PROD n'est pas modifié par un événement TEST
  const id2 = await makeSignedContract();
  const c2 = await Contract.findById(id2);
  const { payment: p2 } = await paymentSvc.createOrReuseLaunchCheckout(c2, { successUrl: 'https://m/s', cancelUrl: 'https://m/c' }, { role: 'ADMIN' });
  p2.providerMode = 'PROD';
  await p2.save();
  const evt = { id: 'evt_mode_mismatch', type: 'checkout.session.completed', data: { object: { id: p2.stripe.checkoutSessionId, payment_status: 'paid', payment_intent: 'pi_prod', metadata: { contractId: String(id2), paymentType: 'LAUNCH_FEE', paymentId: String(p2._id) } } } };
  await stripeWebhook(evt);
  check('event TEST ne modifie pas un Payment PROD', (await Payment.findById(p2._id)).status !== 'PAID');
}

// --- Réconciliation (sync) --------------------------------------------------
section('Réconciliation paiement (filet de sécurité)');
{
  const id = await makeSignedContract();
  const contract = await Contract.findById(id);
  // L6.3C — plus de pilote à injecter : le Panel est la seule porte.
  const { payment } = await paymentSvc.createOrReuseLaunchCheckout(contract, { successUrl: 'https://m/s', cancelUrl: 'https://m/c' }, { role: 'ADMIN' });
  /**
   * Le webhook n'arrive jamais : on simule un paiement réussi côté Stripe, puis
   * on synchronise.
   *
   * L6.2C — la session est désormais lue PAR LE PANEL, donc c'est l'état connu
   * du Panel qu'il faut faire évoluer, pas celui du pilote local. Ce détail est
   * exactement ce que le lot déplace : le projet n'est plus le témoin de l'état
   * de ses propres sessions.
   */
  panel.setSessionState(payment.stripe.checkoutSessionId, {
    status: 'complete',
    paymentStatus: 'paid',
    paymentIntentId: 'pi_sync_1',
  });

  const fresh = await Contract.findById(id);
  const r1 = await reconcileLaunchFeePayment(fresh, { actor: { role: 'DEV' } });
  check('sync corrige -> PAID', (await Payment.findById(payment._id)).status === 'PAID' && r1.changes.length > 0);

  // Idempotence : re-sync ne change plus rien (paiement terminal non retraité)
  const r2 = await reconcileLaunchFeePayment(await Contract.findById(id), { actor: { role: 'DEV' } });
  check('re-sync idempotent (aucun changement)', r2.changes.length === 0);

  // Endpoint DEV sync-payment (idempotent)
  const ep = await api('POST', `/api/contracts/${id}/sync-payment`, { token: devToken });
  check('POST /sync-payment -> 200', ep.status === 200 && Array.isArray(ep.json.data.payments));
}

// --- Outils de synchronisation : réconciliation SEULEMENT -------------------
// Ces boutons (Manager DEV > « Diagnostic et synchronisation ») interrogent
// Stripe pour réaligner l'état local. Ils ne doivent JAMAIS créer quoi que ce
// soit — l'UI l'affirme à l'utilisateur, ce test l'impose au code.
section('Synchronisation : aucune création');
{
  // On ne compte que ce que CETTE section déclenche : les invocations
  // antérieures appartiennent aux parcours déjà éprouvés plus haut.
  const avant = panel.invocations.length;
  const sp = await api('POST', `/api/contracts/${contractId}/sync-payment`, { token: devToken });
  check('sync-payment -> 200', sp.status === 200);
  check('sync-payment renvoie un résultat', Array.isArray(sp.json.data?.result?.changes));
  check('sync-payment renvoie le contrat à jour', Boolean(sp.json.data?.contract?._id));

  const ss = await api('POST', `/api/contracts/${contractId}/sync-subscription`, { token: devToken });
  check('sync-subscription -> 200', ss.status === 200);
  check('sync-subscription renvoie un résultat', Array.isArray(ss.json.data?.result?.changes));

  const sc = await api('POST', `/api/contracts/${contractId}/sync`, { token: devToken });
  check('sync (contrat) -> 200', sc.status === 200);

  /**
   * L6.3C — « aucune création Stripe » se prouvait en comptant les appels d'un
   * pilote local. Ce pilote n'existe plus : l'affirmation devient absolue, et
   * elle porte désormais sur ce que le PANEL a reçu.
   */
  check('le projet n’expose plus aucun pilote Stripe', stripeSvc.getStripeProvider === undefined);
  const demandes = panel.invocations.slice(avant).map((i) => i.code);
  check('aucune création n’a été demandée par la synchronisation',
    !demandes.includes('billing.checkout.create'));
  check('…seulement des lectures et des garanties',
    demandes.every((c) => /retrieve|list|ensure|cancel/.test(c)));

  // Aucun paiement supplémentaire ne doit apparaître dans le journal.
  const before = await Payment.countDocuments({ contractId });
  await api('POST', `/api/contracts/${contractId}/sync-payment`, { token: devToken });
  check('aucun paiement créé par la synchronisation', (await Payment.countDocuments({ contractId })) === before);

  // Idempotence : re-synchroniser ne change rien de plus.
  const again = await api('POST', `/api/contracts/${contractId}/sync-payment`, { token: devToken });
  check('synchronisation répétable sans effet de bord', again.status === 200);
}

await new Promise((r) => server.close(r));
await disconnectDatabase();
console.log(`\n${pass} réussis, ${fail} échoués`);
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
