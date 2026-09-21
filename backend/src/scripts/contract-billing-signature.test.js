/* NOUVEAUX comportements contrats : abonnement MENSUEL/ANNUEL (annuel facturé
 * en UNE fois, équivalent mensuel INFORMATIF, jamais de remise automatique) et
 * SIGNATURE FACULTATIVE (NOT_REQUIRED : zéro Yousign, guideline sans étape,
 * paiement direct, résiliation annuelle en fin de période). Providers SIMULÉS. */
import crypto from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { PDFDocument } from 'pdf-lib';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'bs_test';
process.env.DB_PROD = 'bs_prod';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4151';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SIGNATURE_PROVIDER = 'stub';
process.env.STRIPE_PROVIDER = 'stub';

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

const STRIPE_WH_SECRET = 'whsec_stripe_test_secret';

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
const server = app.listen(4151);
const base = 'http://localhost:4151';

const { Contract } = await import('../models/Contract.model.js');
const { Company } = await import('../models/Company.model.js');
const { publishDeveloperIdentity } = await import('./helpers/developerIdentity.helper.js');
const { publishClientCompany, clearClientCompanyFixture } = await import('./helpers/clientCompany.helper.js');
// L6.2B — le paiement des frais passe par le Panel, sans repli local.
const { pairWithCheckoutPanel } = await import('./helpers/panelCheckoutDouble.helper.js');
const panel = await pairWithCheckoutPanel();
const { IntegratedApi } = await import('../models/IntegratedApi.model.js');
const { getSingleton } = await import('../utils/singleton.js');
const { monthlyEquivalentCents } = await import('../utils/money.js');
const subscriptionSvc = await import('../services/subscription.service.js');
const sm = await import('../services/contractStateMachine.js');
const stripeSvcL63C = await import('../services/stripe/stripe.service.js');

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
const login = async (e, p) => (await api('POST', '/api/auth/login', { body: { email: e, password: p } })).json?.data?.token;
async function stripeWebhook(event) {
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', STRIPE_WH_SECRET).update(`${t}.${raw}`).digest('hex');
  return fetch(base + '/api/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${t},v1=${v1}` }, body: raw });
}

const devToken = await login('dev@mail.com', '123dev');
const adminToken = await login('admin@mail.com', '123admin');
// L6.3 FINAL — le projet ne configure plus Stripe : la route REFUSE toute
// écriture. Seul le secret de VÉRIFICATION subsiste, posé comme le Panel le
// pose (canal étroit L6.3A).
await (await import('./helpers/stripeWebhookSecret.helper.js')).seedStripeVerificationSecret(STRIPE_WH_SECRET);
await IntegratedApi.updateOne({ provider: 'STRIPE' }, { $set: { 'modes.TEST.verified': true } });
{
  // Le signataire développeur est PUBLIÉ par le Panel : l'écrire dans une
  // fiche locale ne prouverait plus rien, puisque le code ne la lit plus.
  await publishDeveloperIdentity({ signer: { firstName: 'Luca', lastName: 'D', jobTitle: 'Gérant', email: 'dev@studio.fr' } });
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
  company.signer = { firstName: 'Marc', lastName: 'S', jobTitle: 'Directeur', email: 'client@sbauto.fr' };
  await company.save();
}

/** Contrat SANS signature requise, prêt au paiement (annuel ou mensuel). */
async function makeUnsignedContract({ launchFee = 390, subscription = 768, interval = 'YEAR' } = {}) {
  const id = (await api('POST', '/api/contracts', { token: devToken })).json.data._id;
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(await pdf.save())], { type: 'application/pdf' }), 'signed.pdf');
  await api('POST', `/api/contracts/${id}/document`, { token: devToken, form });
  const draft = await api('PUT', `/api/contracts/${id}/draft`, {
    token: devToken,
    body: {
      signatureRequirement: 'NOT_REQUIRED',
      launchFee: { enabled: launchFee > 0, amountExcludingTax: launchFee },
      subscription: { enabled: subscription > 0, amountExcludingTax: subscription, interval },
      taxRate: 20,
    },
  });
  return { id, draft };
}

try {
  /* ─────────────────────────────────────────────────────────────────────── */
  section('1. Équivalent mensuel — INFORMATIF, arrondi explicite, sans remise');
  check('76800 / 12 = 6400 centimes', monthlyEquivalentCents(76800, 'YEAR') === 6400);
  check('mensuel : équivalent = montant de la période', monthlyEquivalentCents(8000, 'MONTH') === 8000);
  check('annuel indivisible : arrondi au centime (100000/12 -> 8333)', monthlyEquivalentCents(100000, 'YEAR') === 8333);
  check('aucune remise automatique (le calcul ne divise QUE par 12)', monthlyEquivalentCents(12000, 'YEAR') === 1000);

  section('2. Contrat ANNUEL sans signature — configuration et sérialisation');
  const { id, draft } = await makeUnsignedContract();
  check('draft accepté (interval + signatureRequirement)', draft.status === 200);
  check('sérialisation : interval YEAR', draft.json.data.pricing.subscription.interval === 'YEAR');
  check('sérialisation : montants annuels intacts (76800 TTC facturés en une fois)',
    draft.json.data.pricing.subscription.amountExcludingTax === 76800 &&
    draft.json.data.pricing.subscription.amountIncludingTax === 92160);
  check('sérialisation : signatureRequirement exposé', draft.json.data.signatureRequirement === 'NOT_REQUIRED' && draft.json.data.signatureApplicable === false);

  section('3. Validation SANS signature — DRAFT -> INACTIVE, zéro Yousign');
  const val = await api('POST', `/api/contracts/${id}/validate`, { token: devToken });
  check('validation sans zones ni signataires : 200', val.status === 200);
  check('statut INACTIVE direct (paiement accessible)', val.json.data.status === 'INACTIVE');
  check('document verrouillé', val.json.data.signatureConfigurationLocked === true || (await Contract.findById(id)).signatureConfiguration.locked === true);
  const c1 = await Contract.findById(id);
  check('aucune procédure Yousign créée', !c1.yousign.signatureRequestId);
  check('start-dev-signature refusé (SIGNATURE_NOT_REQUIRED)',
    (await api('POST', `/api/contracts/${id}/start-dev-signature`, { token: devToken })).json.details?.code === 'SIGNATURE_NOT_REQUIRED');
  check('étape dérivée = LAUNCH_FEE (jamais SIGNATURE)', sm.deriveActivationStep(c1) === 'LAUNCH_FEE');

  section('4. Paiement annuel — frais uniques + Price interval=year, total en UNE fois');

  /**
   * ── NO CLIENT COMPANY → NO PAYMENT ────────────────────────────────────
   *
   * ══ POURQUOI CE CONTRÔLE VIT ICI ════════════════════════════════════
   *
   * Parce que le refus ne peut se prouver QUE sur un contrat qui existe et
   * qui est payable : sur un projet sans contrat, la route répond 404 bien
   * avant d’avoir regardé l’entreprise cliente, et l’on croirait avoir
   * éprouvé une garde qu’on n’a jamais atteinte.
   *
   * Le refus est BACKEND et autoritatif. Le message ne renvoie jamais à un
   * réglage de ce Manager : l’identité juridique du client est ce qui figure
   * sur ses factures, et son autorité est le Panel.
   */
  await clearClientCompanyFixture();
  const sansEntreprise = await api('POST', '/api/my-contract/create-launch-checkout', { token: adminToken });
  /**
   * 409, ET NON 400 : la requête est bien formée, c’est l’ÉTAT du dossier qui
   * interdit l’action. Un 400 enverrait le client chercher une faute dans sa
   * requête ; un 409 désigne la situation, donc le bon interlocuteur.
   */
  check('sans entreprise cliente → paiement REFUSÉ en 409', sansEntreprise.status === 409);
  check('…avec un code exploitable',
    sansEntreprise.json?.details?.code === 'CLIENT_COMPANY_NOT_READY');
  check('…et un message qui désigne le prestataire, pas un écran local',
    /L\.Y Solution/.test(sansEntreprise.json?.message ?? '')
    && !/configurez/i.test(sansEntreprise.json?.message ?? ''));

  const signatureSansEntreprise = await api('POST', '/api/my-contract/start-signature', { token: adminToken });
  check('sans entreprise cliente → signature REFUSÉE en 409', signatureSansEntreprise.status === 409);
  check('…avec le même code', signatureSansEntreprise.json?.details?.code === 'CLIENT_COMPANY_NOT_READY');

  /** La fiche revient : le parcours doit redevenir possible SANS redéploiement. */
  await publishClientCompany();

  const feeCheckout = await api('POST', '/api/my-contract/create-launch-checkout', { token: adminToken });
  check('entreprise rattachée → le paiement redevient possible', feeCheckout.status === 200);
  check('checkout frais accessible SANS signature', feeCheckout.status === 200 && Boolean(feeCheckout.json.data.url));
  const c2 = await Contract.findById(id);
  await stripeWebhook({ id: 'evt_fee_1', type: 'checkout.session.completed', data: { object: { id: c2.stripe.launchFee.checkoutSessionId, mode: 'payment', payment_status: 'paid', payment_intent: 'pi_1', metadata: { contractId: String(id), paymentType: 'LAUNCH_FEE', providerMode: 'TEST' } } } });
  const subCheckout = await api('POST', '/api/my-contract/create-subscription-checkout', { token: adminToken });
  check('checkout abonnement accessible', subCheckout.status === 200 && Boolean(subCheckout.json.data.url));
  /**
   * L6.2E — le tarif n'est plus construit ici. Le Panel le dérive de SA
   * projection de contrat, qui porte la périodicité et le montant TTC ; la
   * preuve que `interval=year` et le montant ANNUEL TOTAL sont bien retenus vit
   * désormais dans `Panel/tests/stripe-subscription-cutover-e2e.test.js`.
   *
   * Ce qui se vérifie ICI reste ce que le projet contrôle : le parcours annuel
   * aboutit, sans qu'aucun tarif ne parte de son côté.
   */
  /**
   * L6.3C — LE PILOTE LOCAL N'EXISTE PLUS.
   *
   * Ces contrôles comptaient les appels d'un double pour prouver qu'aucun
   * n'avait lieu. Ils sont remplacés par la seule affirmation qui vaille
   * désormais : le projet n'a plus de quoi appeler Stripe du tout.
   */
  check('le projet n’expose plus aucun pilote Stripe',
    stripeSvcL63C.getStripeProvider === undefined);


  section('5. Statut — équivalent mensuel informatif exposé');
  const c3 = await Contract.findById(id);
  const st = subscriptionSvc.getSubscriptionStatus(c3);
  check('interval réel exposé', st.amount.interval === 'YEAR');
  check('équivalent mensuel HT = 6400', st.amount.monthlyEquivalentExcludingTax === 6400);
  check('équivalent mensuel TTC = 7680', st.amount.monthlyEquivalentIncludingTax === 7680);
  check('le montant contractuel reste ANNUEL (jamais divisé)', st.amount.excludingTax === 76800);

  // ENV=TEST : la résiliation est IMMÉDIATE (LOT recette). Le comportement
  // PROD « fin de période, jamais immédiate » est couvert par
  // cancellation-mode.test.js (bascule config PROD + stub Stripe).
  section('6. Résiliation annuelle — immédiate en ENV=TEST');
  const c4 = await Contract.findById(id);
  c4.stripe.subscription.subscriptionId = 'sub_annual_1';
  c4.stripe.subscription.status = 'ACTIVE';
  c4.stripe.subscription.currentPeriodEnd = new Date(Date.now() + 300 * 24 * 3600 * 1000);
  c4.status = 'ACTIVE';
  await c4.save();
  // L6.2G — l'abonnement doit être possédé et lisible côté Panel pour être coupé.
  panel.setSubscription('sub_annual_1', { status: 'active', cancelAtPeriodEnd: false });
  const cancel = await api('POST', `/api/contracts/${id}/cancel`, { token: devToken });
  check('résiliation demandée : 200', cancel.status === 200);
  const c5 = await Contract.findById(id);
  // L6.2G — la doctrine ne change pas : immédiate en TEST. Seule la porte change.
  check('annulation IMMÉDIATE demandée au Panel (jamais cancel_at_period_end en TEST)',
    panel.cancellations.some((c) => c.code === 'billing.subscription.cancel_now' && c.subscriptionId === 'sub_annual_1')
    && !panel.cancellations.some((c) => c.code === 'billing.subscription.cancel_at_period_end'));
  check('statut ENDED (fin immédiate en TEST)', c5.status === 'ENDED');
  check('date de fin visible', Boolean(c5.stripe.subscription.currentPeriodEnd));

  section('7. Garde-fous de cohérence');
  const { id: id2 } = await makeUnsignedContract({ interval: 'MONTH', subscription: 80 });
  const c6 = await Contract.findById(id2);
  check('mensuel : interval MONTH persisté', c6.pricing.subscription.interval === 'MONTH');
  check('mensuel : équivalent = montant mensuel', subscriptionSvc.getSubscriptionStatus(c6).amount.monthlyEquivalentExcludingTax === 8000);
  // REQUIRED -> NOT_REQUIRED refusé si procédure Yousign active.
  const c7 = await Contract.findById(id2);
  c7.yousign.signatureRequestId = 'sr_orphan';
  c7.signatureRequirement = 'REQUIRED';
  await c7.save();
  const refuse = await api('PUT', `/api/contracts/${id2}/draft`, { token: devToken, body: { signatureRequirement: 'NOT_REQUIRED' } });
  check('bascule refusée si signature request active (jamais d’orphelin)',
    refuse.status === 400 && refuse.json.details?.code === 'SIGNATURE_REQUEST_ACTIVE');
  // interval invalide refusé par zod.
  const badInterval = await api('PUT', `/api/contracts/${id2}/draft`, { token: devToken, body: { subscription: { enabled: true, amountExcludingTax: 10, interval: 'WEEK' } } });
  check('périodicité inconnue refusée', badInterval.status === 400);
  // Ancien contrat sans champ -> REQUIRED (comportement historique).
  await Contract.collection.insertOne({ reference: 'LEGACY-1', status: 'DRAFT', environment: 'TEST', pricing: {}, signatureConfiguration: {}, yousign: {}, stripe: {}, document: {} });
  const legacy = await Contract.findOne({ reference: 'LEGACY-1' });
  check('contrat antérieur : signature REQUISE par défaut', sm.signatureRequired(legacy) === true);

  console.log(`\n${pass} réussis, ${fail} échoués`);
} catch (err) {
  console.error('BILLING/SIGNATURE TEST CRASHED:', err);
  fail++;
} finally {
  server.close();
  await disconnectDatabase();
  await mongod.stop();
  process.exit(fail === 0 ? 0 : 1);
}
