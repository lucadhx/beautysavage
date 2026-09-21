/* Tests FACTURATION Stripe : miroir des factures (frais de lancement via
 * invoice_creation + cycles d'abonnement), résolution du contrat, liens hosted/PDF,
 * backfill, contrôle d'accès. Provider Stripe SIMULÉ — AUCUN appel réel. */
import crypto from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { PDFDocument } from 'pdf-lib';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4141';
process.env.CORS_ORIGINS = 'http://localhost:6061';
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
const app = createApp();
const server = app.listen(4141);
const base = 'http://localhost:4141';

const { Contract } = await import('../models/Contract.model.js');
const { Payment } = await import('../models/Payment.model.js');
const { Invoice } = await import('../models/Invoice.model.js');
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
const stripeSvc = await import('../services/stripe/stripe.service.js');
const billingSvc = await import('../services/billing.service.js');

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
const nowSec = () => Math.floor(Date.now() / 1000);

async function makeSignedContract() {
  const id = (await api('POST', '/api/contracts', { token: devToken })).json.data._id;
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(await pdf.save())], { type: 'application/pdf' }), 'c.pdf');
  await api('POST', `/api/contracts/${id}/document`, { token: devToken, form });
  await api('PUT', `/api/contracts/${id}/draft`, { token: devToken, body: { launchFee: { enabled: true, amountExcludingTax: 990 }, subscription: { enabled: true, amountExcludingTax: 49 }, taxRate: 20 } });
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

let contractId;
let customerId;
let subId;

// --- Frais de lancement : facture Stripe via invoice_creation ---------------
section('Facture des frais de lancement (invoice_creation)');
{
  contractId = await makeSignedContract();

  await api('POST', '/api/my-contract/create-launch-checkout', { token: adminToken });
  /**
   * ── L6.2B ─────────────────────────────────────────────────────────────────
   *
   * `invoice_creation` et les metadata de facture ne sont plus construits ici :
   * c'est le Panel qui les demande à Stripe, depuis SA projection de contrat.
   * La preuve que la facture est bien réclamée, et que les metadata portent le
   * bon contrat, vit désormais dans
   * `Panel/tests/stripe-checkout-cutover-e2e.test.js`.
   *
   * Ce qui se vérifie ici est l'AVAL, et il n'a pas bougé : la facture émise par
   * Stripe se rattache au contrat, avec ses montants et ses documents.
   */
  check('l’ouverture est passée par le Panel', panel.lastCheckout() !== null);
  check('le projet n’expose plus aucun pilote Stripe', stripeSvc.getStripeProvider === undefined);

  const payment = await Payment.findOne({ contractId, type: 'LAUNCH_FEE' });
  await stripeWebhook({ id: 'evt_launch_paid', type: 'checkout.session.completed', data: { object: { id: payment.stripe.checkoutSessionId, payment_status: 'paid', payment_intent: 'pi_l', metadata: { contractId: String(contractId), paymentType: 'LAUNCH_FEE', paymentId: String(payment._id) } } } });

  // Stripe émet ensuite la facture du paiement unique
  const finalized = await stripeWebhook({ id: 'evt_inv_launch', type: 'invoice.finalized', data: { object: { id: 'in_launch_1', number: 'INV-L-001', status: 'open', total: 118800, tax: 19800, currency: 'eur', created: nowSec(), customer: 'cus_l', hosted_invoice_url: 'https://pay.stripe/inv_l', invoice_pdf: 'https://pay.stripe/inv_l.pdf', metadata: { contractId: String(contractId), paymentType: 'LAUNCH_FEE' } } } });
  check('invoice.finalized -> 200', finalized.status === 200);
  const invL = await Invoice.findOne({ externalInvoiceId: 'in_launch_1' });
  check('facture frais reflétée + rattachée au contrat', invL && String(invL.contractId) === String(contractId));
  check('type LAUNCH_FEE', invL.type === 'LAUNCH_FEE');
  check('numéro + PDF + hosted présents', invL.number === 'INV-L-001' && invL.invoicePdfUrl.endsWith('.pdf') && Boolean(invL.hostedInvoiceUrl));
  check('montants TTC/HT/TVA', invL.amountIncludingTax === 118800 && invL.amountExcludingTax === 99000 && invL.taxAmount === 19800);
}

// --- Abonnement : factures de cycle résolues sans metadata ------------------
section('Factures de cycle (abonnement)');
{
  await api('POST', '/api/my-contract/create-subscription-checkout', { token: adminToken });
  const c = await Contract.findById(contractId);
  customerId = c.stripe.customerId;
  subId = 'sub_bill';
  await stripeWebhook({ id: 'evt_sub_active', type: 'customer.subscription.updated', data: { object: { id: subId, status: 'active', current_period_end: nowSec() + 2592000, customer: customerId, metadata: { contractId: String(contractId) } } } });

  // Facture d'abonnement PAYÉE — SANS metadata contractId (résolue par subscription)
  const paid = await stripeWebhook({ id: 'evt_inv_sub_paid', type: 'invoice.paid', data: { object: { id: 'in_sub_1', number: 'INV-S-001', status: 'paid', total: 5880, tax: 980, amount_paid: 5880, currency: 'eur', created: nowSec(), customer: customerId, subscription: subId, hosted_invoice_url: 'https://pay.stripe/inv_s', invoice_pdf: 'https://pay.stripe/inv_s.pdf' } } });
  check('invoice.paid -> 200', paid.status === 200);
  const invS = await Invoice.findOne({ externalInvoiceId: 'in_sub_1' });
  check('facture abo résolue par subscription -> contrat', invS && String(invS.contractId) === String(contractId));
  check('type SUBSCRIPTION', invS.type === 'SUBSCRIPTION');
  check('statut PAID + paidAt', invS.status === 'PAID' && Boolean(invS.paidAt));
  check('paiement de cycle enregistré', (await Payment.countDocuments({ contractId, type: 'SUBSCRIPTION', status: 'PAID', externalInvoiceId: 'in_sub_1' })) === 1);

  // Idempotence : rejeu
  const dup = await stripeWebhook({ id: 'evt_inv_sub_paid', type: 'invoice.paid', data: { object: { id: 'in_sub_1', status: 'paid', total: 5880, subscription: subId } } });
  check('rejeu facture -> duplicate', dup.json.duplicate === true);
  check('pas de doublon de facture', (await Invoice.countDocuments({ externalInvoiceId: 'in_sub_1' })) === 1);

  // Impayé de cycle -> PAST_DUE (facture reflétée)
  await stripeWebhook({ id: 'evt_inv_sub_failed', type: 'invoice.payment_failed', data: { object: { id: 'in_sub_2', number: 'INV-S-002', status: 'open', total: 5880, currency: 'eur', customer: customerId, subscription: subId } } });
  check('impayé de cycle -> abonnement PAST_DUE', (await Contract.findById(contractId)).stripe.subscription.status === 'PAST_DUE');
  check('facture impayée reflétée (OPEN)', (await Invoice.findOne({ externalInvoiceId: 'in_sub_2' }))?.status === 'OPEN');
}

// --- Typage des factures (incident RX-01) -----------------------------------
// Les tests ci-dessus n'utilisaient que la forme HÉRITÉE (`subscription` en
// racine) : c'est pourquoi le bug est passé au vert pendant que la sandbox
// stockait deux « Frais de lancement ». On couvre ici les DEUX formes d'API et,
// surtout, le discriminant réel : `billing_reason`.
section('Typage des factures — billing_reason');
{
  const { invoiceType, invoiceSubscriptionId } = billingSvc;

  // 1. billing_reason fait autorité, même SANS metadata ni `subscription`.
  //    C'est exactement le payload qui produisait un faux LAUNCH_FEE.
  for (const reason of ['subscription_create', 'subscription_cycle', 'subscription_update', 'subscription_threshold', 'subscription']) {
    check(`billing_reason=${reason} -> SUBSCRIPTION`, invoiceType({ billing_reason: reason }) === 'SUBSCRIPTION');
  }
  check('billing_reason=manual -> LAUNCH_FEE', invoiceType({ billing_reason: 'manual' }) === 'LAUNCH_FEE');
  check('billing_reason=quote_accept -> LAUNCH_FEE', invoiceType({ billing_reason: 'quote_accept' }) === 'LAUNCH_FEE');

  // 2. Le cas EXACT de l'incident : facture de cycle, aucune metadata, aucun
  //    champ `subscription` en racine (forme basil).
  const basilCycle = {
    id: 'in_basil', billing_reason: 'subscription_create', status: 'paid', total: 9000,
    parent: { subscription_details: { subscription: 'sub_basil' } },
  };
  check('facture basil (sans subscription racine) -> SUBSCRIPTION', invoiceType(basilCycle) === 'SUBSCRIPTION');
  check('id abonnement lu sous parent.subscription_details', invoiceSubscriptionId(basilCycle) === 'sub_basil');

  // 3. Forme héritée (acacia) : toujours supportée.
  check('facture acacia (subscription racine) -> SUBSCRIPTION', invoiceType({ subscription: 'sub_1' }) === 'SUBSCRIPTION');
  check('id abonnement lu en racine', invoiceSubscriptionId({ subscription: 'sub_1' }) === 'sub_1');
  check('abonnement en objet développé', invoiceSubscriptionId({ subscription: { id: 'sub_2' } }) === 'sub_2');
  check('aucun abonnement -> null', invoiceSubscriptionId({ id: 'in_x' }) === null);

  // 4. Metadata explicite : prioritaire (frais de lancement via invoice_creation).
  check('metadata LAUNCH_FEE prioritaire', invoiceType({ metadata: { paymentType: 'LAUNCH_FEE' }, billing_reason: 'subscription_cycle' }) === 'LAUNCH_FEE');
  check('metadata SUBSCRIPTION prioritaire', invoiceType({ metadata: { paymentType: 'SUBSCRIPTION' }, billing_reason: 'manual' }) === 'SUBSCRIPTION');

  // 5. Facture ponctuelle sans rien : frais de lancement (défaut historique).
  check('facture nue -> LAUNCH_FEE', invoiceType({ id: 'in_nu' }) === 'LAUNCH_FEE');

  // 6. Bout en bout : une facture de cycle en forme BASIL doit être typée
  //    SUBSCRIPTION *et* produire son paiement de cycle — c'est la conséquence
  //    grave du bug : `handleInvoiceEvent` cessait d'enregistrer les paiements.
  await stripeWebhook({
    id: 'evt_inv_basil', type: 'invoice.paid',
    data: { object: {
      id: 'in_sub_basil', number: 'INV-S-BASIL', status: 'paid', total: 5880, tax: 980,
      amount_paid: 5880, currency: 'eur', created: nowSec(), customer: customerId,
      billing_reason: 'subscription_cycle',
      parent: { subscription_details: { subscription: subId } },
      hosted_invoice_url: 'https://pay.stripe/inv_b', invoice_pdf: 'https://pay.stripe/inv_b.pdf',
    } },
  });
  const invB = await Invoice.findOne({ externalInvoiceId: 'in_sub_basil' });
  check('facture basil typée SUBSCRIPTION en base', invB?.type === 'SUBSCRIPTION');
  check('facture basil rattachée au contrat', String(invB?.contractId) === String(contractId));
  check('billingReason conservé au snapshot', invB?.snapshot?.billingReason === 'subscription_cycle');
  check(
    'paiement de cycle enregistré (forme basil)',
    (await Payment.countDocuments({ contractId, type: 'SUBSCRIPTION', externalInvoiceId: 'in_sub_basil' })) === 1
  );
}

// --- Résolution par client uniquement ---------------------------------------
section('Résolution par client');
{
  const byCustomer = await stripeWebhook({ id: 'evt_inv_cust', type: 'invoice.finalized', data: { object: { id: 'in_cust_1', number: 'INV-C-001', status: 'open', total: 5880, currency: 'eur', created: nowSec(), customer: customerId, invoice_pdf: 'https://pay.stripe/inv_c.pdf' } } });
  check('invoice sans metadata/subscription résolue par client', byCustomer.status === 200 && String((await Invoice.findOne({ externalInvoiceId: 'in_cust_1' })).contractId) === String(contractId));
}

// --- Contrôle d'accès + historique ------------------------------------------
section('Historique & contrôle d’accès');
{
  const mine = await api('GET', '/api/my-invoices', { token: adminToken });
  const group = (mine.json.data || []).find((g) => String(g.contractId) === String(contractId));
  check('ADMIN voit son historique (paiements + factures)', group && group.payments.length >= 1 && group.invoices.length >= 3);
  const anInv = group.invoices.find((i) => i.invoicePdfUrl);
  check('facture expose lien PDF + hosted', Boolean(anInv?.invoicePdfUrl) && group.invoices.some((i) => i.hostedInvoiceUrl));

  const devView = await api('GET', '/api/invoices', { token: devToken });
  check('DEV voit la vue globale', Array.isArray(devView.json.data));
  const adminGlobal = await api('GET', '/api/invoices', { token: adminToken });
  check('ADMIN refusé sur la vue globale DEV (403)', adminGlobal.status === 403);

  const oneId = (await Invoice.findOne({ externalInvoiceId: 'in_sub_1' }))._id;
  const detail = await api('GET', `/api/invoices/${oneId}`, { token: devToken });
  check('détail facture (DEV)', detail.json.data?.number === 'INV-S-001' && detail.json.data.invoicePdfUrl.endsWith('.pdf'));
}

// --- Backfill / sync ---------------------------------------------------------
section('Backfill (sync-invoices)');
{
  /**
   * L6.3B — LA FACTURE SE DÉCLARE SUR LE CONTRAT, PLUS SUR LE CLIENT.
   *
   * Le backfill listait les factures du `customerId` que le projet portait en
   * fiche. Il demande désormais celles de son CONTRAT, et c'est le Panel qui
   * remonte au client. Le double suit la même clé — accepter encore un
   * `customerId` ici laisserait écrire des suites sur l'ancien monde.
   */
  panel.setInvoices(contractId, [{
    invoiceId: 'in_backfill_1', number: 'INV-B-001', status: 'paid',
    total: 5880, tax: 980, currency: 'eur', createdAt: nowSec(),
    customerId, subscriptionId: subId,
    hostedInvoiceUrl: 'https://pay.stripe/inv_b',
    invoicePdfUrl: 'https://pay.stripe/inv_b.pdf',
  }]);
  const sync = await api('POST', `/api/contracts/${contractId}/sync-invoices`, { token: devToken });
  check('sync-invoices -> 200 + rapport', sync.status === 200 && sync.json.data.result.count >= 1);
  check('facture backfillée présente', Boolean(await Invoice.findOne({ externalInvoiceId: 'in_backfill_1' })));
  // Idempotence : re-sync ne duplique pas
  await api('POST', `/api/contracts/${contractId}/sync-invoices`, { token: devToken });
  check('re-sync idempotent (pas de doublon)', (await Invoice.countDocuments({ externalInvoiceId: 'in_backfill_1' })) === 1);
}

// --- Facture d'un contrat inconnu -------------------------------------------
section('Cas limite');
{
  const orphan = await stripeWebhook({ id: 'evt_inv_orphan', type: 'invoice.finalized', data: { object: { id: 'in_orphan', status: 'open', total: 1000, currency: 'eur', customer: 'cus_unknown' } } });
  check('facture sans contrat rattachable -> 2xx (miroir sans contractId)', orphan.status === 200 && (await Invoice.findOne({ externalInvoiceId: 'in_orphan' }))?.contractId == null);
}

await new Promise((r) => server.close(r));
await disconnectDatabase();
console.log(`\n${pass} réussis, ${fail} échoués`);
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
