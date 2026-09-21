/* Test END-TO-END du cycle de vie contrat (HTTP + webhooks signés + enforcement).
 * Providers simulés (stub). Runner autonome. */
import crypto from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { PDFDocument } from 'pdf-lib';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4133';
process.env.CORS_ORIGINS = 'http://localhost:6061,http://localhost:6062';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SIGNATURE_PROVIDER = 'stub';
process.env.STRIPE_PROVIDER = 'stub';
// La protection contractuelle s'active en base, pas par l'environnement :
// voir la section « Enforcement initial ».

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

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
const server = app.listen(4133);
const base = 'http://localhost:4133';

const STRIPE_WH_SECRET = 'whsec_stripe_test_secret';
const YOUSIGN_WH_SECRET = 'ys_whsec_test_secret';

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

const { Contract } = await import('../models/Contract.model.js');
const { Company } = await import('../models/Company.model.js');
const { publishDeveloperIdentity } = await import('./helpers/developerIdentity.helper.js');
const { publishClientCompany } = await import('./helpers/clientCompany.helper.js');
// L6.2B — le paiement des frais passe par le Panel, sans repli local.
const { pairWithCheckoutPanel } = await import('./helpers/panelCheckoutDouble.helper.js');
await pairWithCheckoutPanel();
/**
 * LE FAIT DE SIGNATURE (R10.5C) — appliqué, plus posté.
 *
 * Yousign n'appelle plus ce projet : il appelle le Panel, qui vérifie,
 * résout l’appartenance, normalise et projette durablement par le pont.
 * Le double de facturation ci-dessus délègue les verbes de signature au
 * stub de base.
 */
const { applySignatureEvent } = await import('../services/signature/signatureEvent.applier.js');
const fait = (event, extra = {}) => applySignatureEvent({
  change: {
    payload: {
      event,
      contractRef: String(extra.contractRef),
      signatureRequestId: extra.signatureRequestId,
      signerId: extra.signerId ?? null,
      providerEvent: extra.providerEvent ?? event,
      occurredAt: new Date().toISOString(),
    },
  },
});
const { getSingleton } = await import('../utils/singleton.js');

const devToken = await login('dev@mail.com', '123dev');
const adminToken = await login('admin@mail.com', '123admin');

// --- Protection contractuelle : aucun contrat -> site suspendu --------------
// La protection est un RÉGLAGE du site, plus une variable d'environnement :
// on l'active explicitement, comme le ferait le Manager ou le Panel.
section('Enforcement initial');
{
  const { setContractProtection } = await import('../services/siteEnforcement.service.js');
  await setContractProtection({ enabled: true });

  const s = await api('GET', '/api/site-status', { token: devToken });
  check('protection contractuelle active', s.json.data.contractProtectionEnabled === true);
  check('site SUSPENDED (protection active, aucun contrat)', s.json.data.status === 'SUSPENDED');
  check('source CONTRACT', s.json.data.suspensionSource === 'CONTRACT');
}

// --- Prérequis intégrations (au POINT D'USAGE, pas à la création) ------------
section('Prérequis intégrations');
{
  // La création d'un BROUILLON ne nécessite PAS Stripe/Yousign (aucun appel externe).
  const draft = await api('POST', '/api/contracts', { token: devToken });
  check('création de brouillon OK SANS intégrations (201)', draft.status === 201);
  await api('DELETE', `/api/contracts/${draft.json.data._id}`, { token: devToken }); // nettoyage

  // Yousign requis AU POINT D'USAGE (signature) : testé plus bas au start-dev-signature.
  // L6.3 FINAL — le projet ne configure plus Stripe : la route REFUSE toute
  // écriture. Seul le secret de VÉRIFICATION subsiste, posé comme le Panel le
  // pose (canal étroit L6.3A).
  await (await import('./helpers/stripeWebhookSecret.helper.js')).seedStripeVerificationSecret(STRIPE_WH_SECRET);
  // Sans réseau : on simule un test de connexion réussi (verified=true) sur TEST.
  const { IntegratedApi } = await import('../models/IntegratedApi.model.js');
  await IntegratedApi.updateOne({ provider: 'STRIPE' }, { $set: { 'modes.TEST.verified': true } });
}

// --- Parcours DEV : document -> config -> validation -> signature ------------
section('Parcours DEV');
let contractId;
{
  const created = (await api('POST', '/api/contracts', { token: devToken })).json.data;
  contractId = created._id;
  check('nouveau contrat DRAFT', created.status === 'DRAFT');

  // Upload PDF 2 pages
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  pdf.addPage([595, 842]);
  const pdfBytes = Buffer.from(await pdf.save());
  const form = new FormData();
  form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'contrat.pdf');
  const up = await api('POST', `/api/contracts/${contractId}/document`, { token: devToken, form });
  check('PDF uploadé (2 pages)', up.json.data.document.pageCount === 2);

  // Tarification (euros -> centimes)
  const priced = await api('PUT', `/api/contracts/${contractId}/draft`, { token: devToken, body: { launchFee: { enabled: true, amountExcludingTax: 990 }, subscription: { enabled: true, amountExcludingTax: 49 }, taxRate: 20 } });
  check('frais HT 99000 c', priced.json.data.pricing.launchFee.amountExcludingTax === 99000);
  check('frais TTC 118800 c', priced.json.data.pricing.launchFee.amountIncludingTax === 118800);
  check('abo TTC 5880 c', priced.json.data.pricing.subscription.amountIncludingTax === 5880);

  // Zones (1 DEV + 1 CLIENT)
  const zones = [
    { id: 'z1', name: 'DEV', signerRole: 'DEVELOPER', page: 1, xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.05, type: 'SIGNATURE' },
    { id: 'z2', name: 'CLIENT', signerRole: 'CLIENT', page: 2, xRatio: 0.5, yRatio: 0.8, widthRatio: 0.2, heightRatio: 0.05, type: 'SIGNATURE' },
  ];
  const cfg = await api('PUT', `/api/contracts/${contractId}/signature-configuration`, { token: devToken, body: { zones } });
  check('zones enregistrées', cfg.json.data.signatureConfiguration.zones.length === 2);
  check('versionning : version 1', cfg.json.data.signatureConfiguration.version === 1);

  // Sauvegarde intermédiaire d'un seul rôle : AUTORISÉE (contrainte des 2 rôles
  // uniquement à la VALIDATION du contrat). Chaque sauvegarde crée une version.
  const partial = await api('PUT', `/api/contracts/${contractId}/signature-configuration`, { token: devToken, body: { zones: [zones[0]] } });
  check('config partielle (1 rôle) autorisée à la sauvegarde', partial.status === 200);
  check('versionning : version 2 après nouvelle sauvegarde', partial.json.data.signatureConfiguration.version === 2);
  check('historique des versions conservé (2)', partial.json.data.signatureConfiguration.versionCount === 2);

  // Validation refusée tant que les 2 rôles ne sont pas couverts.
  const invalidValidate = await api('POST', `/api/contracts/${contractId}/validate`, { token: devToken });
  check('validation refusée sans zone pour chaque signataire', invalidValidate.status === 400);

  // On rétablit les 2 zones avant de continuer.
  await api('PUT', `/api/contracts/${contractId}/signature-configuration`, { token: devToken, body: { zones } });

  // Signataire requis sur CHAQUE fiche Entreprise (cf. contract-signers.test.js
  // pour le détail du gating et du snapshot).
  const noSigner = await api('POST', `/api/contracts/${contractId}/validate`, { token: devToken });
  check('validation refusée sans signataire configuré', noSigner.status === 400);

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
  /**
   * ── LE SIGNATAIRE CLIENT NE S'ÉCRIT PLUS DANS LA FICHE LOCALE ────────────
   *
   * Ce test posait `Company.signer` — une fiche éditée dans ce Manager — puis
   * vérifiait que le contrat figeait cette adresse. C'était exactement
   * l'autorité que le chantier « entreprise cliente » retire : un client ne
   * choisit pas la personne qui l'engage vis-à-vis de son prestataire.
   *
   * L'identité vient désormais de l'entreprise cliente PUBLIÉE par le Panel.
   * Ce que la suite éprouve, elle, ne change pas : l'instantané est bien FIGÉ
   * à la validation, et il porte l'identité en vigueur à cet instant.
   */
  const { CLIENT_SIGNER } = await import('./helpers/clientCompany.helper.js');
  await publishClientCompany();

  const validated = await api('POST', `/api/contracts/${contractId}/validate`, { token: devToken });
  check('snapshot des signataires figé à la validation',
    validated.json.data.signersSnapshot?.client?.email === CLIENT_SIGNER.email);
  check('validation -> PENDING_DEV_SIGNATURE', validated.json.data.status === 'PENDING_DEV_SIGNATURE');
  check('configuration verrouillée', validated.json.data.signatureConfiguration.locked === true);

  // Modification après verrouillage refusée
  const locked = await api('PUT', `/api/contracts/${contractId}/draft`, { token: devToken, body: { taxRate: 10 } });
  check('modification après verrouillage refusée', locked.status === 400);

  // Lancement de la signature
  const sign = await api('POST', `/api/contracts/${contractId}/start-dev-signature`, { token: devToken });
  check('signature lancée (lien DEV)', Boolean(sign.json.data.signatureLink));
}

// --- Faits de signature (ordre DEV -> ADMIN) --------------------------------
section('Signatures — faits projetés par le Panel');
{
  const { signatureOf } = await import('../services/signature/signatureRecord.js');
  const c = await Contract.findById(contractId);
  /**
   * ON LIT LE BLOC NEUTRE — le bloc `yousign` n'est plus écrit.
   *
   * Il reste LISIBLE, pour les contrats déjà signés ; il n'est plus REMPLI. Un
   * test qui continue de le lire n'éprouve donc plus le chemin réel : il
   * comparerait des `undefined` et attribuerait une signature à personne.
   */
  const sig = signatureOf(c);
  const devSignerId = sig.devSignerId;
  const adminSignerId = sig.clientSignerId;
  const srId = sig.requestId;
  check('la demande porte le fournisseur qui l’exécute', sig.provider === 'OPENSIGN');

  /**
   * L'ENDPOINT LOCAL A DISPARU — et c'est la première chose à vérifier.
   *
   * Ce bloc éprouvait le rejet d’une signature HMAC invalide. La garde qui
   * compte désormais est plus forte : il n’y a plus de porte du tout, donc
   * plus de signature à contrefaire.
   */
  const ancienne = await fetch(base + '/api/webhooks/signature', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_name: 'signer.done' }),
  });
  check('aucun endpoint webhook de signature local (404)', ancienne.status === 404);

  const w1 = await fait('SIGNATURE_SIGNER_SIGNED', {
    contractRef: contractId, signatureRequestId: srId, signerId: devSignerId, providerEvent: 'signer.done',
  });
  check('fait DEV appliqué', w1.applied === true);
  const afterDev = await Contract.findById(contractId);
  check('devSignedAt renseigné', Boolean(signatureOf(afterDev).devSignedAt));
  check('contrat -> INACTIVE (dispo ADMIN)', afterDev.status === 'INACTIVE');

  /**
   * IDEMPOTENCE — sans journal d’événements.
   *
   * L’ancien verrou reposait sur `event_id` et répondait « duplicate ». Le
   * fait projeté n’en porte pas : c’est L’ÉTAT qui porte la mémoire. Un
   * rejeu n’est pas une progression, donc il n’écrit rien — et surtout il ne
   * repousse pas la date, qui est un fait juridique.
   */
  const dateDev = signatureOf(afterDev).devSignedAt;
  const w1dup = await fait('SIGNATURE_SIGNER_SIGNED', {
    contractRef: contractId, signatureRequestId: srId, signerId: devSignerId, providerEvent: 'signer.done',
  });
  check('rejeu du fait -> non appliqué', w1dup.applied === false);
  const apresRejeu = await Contract.findById(contractId);
  check('…et la date de signature n’a pas bougé',
    String(signatureOf(apresRejeu).devSignedAt) === String(dateDev));

  // Enforcement : toujours suspendu (pas de contrat actif)
  const s = await api('GET', '/api/site-status', { token: devToken });
  check('site encore suspendu (INACTIVE)', s.json.data.status === 'SUSPENDED');

  // ADMIN signe, puis la demande s’achève.
  await fait('SIGNATURE_SIGNER_SIGNED', {
    contractRef: contractId, signatureRequestId: srId, signerId: adminSignerId, providerEvent: 'signer.done',
  });
  await fait('SIGNATURE_COMPLETED', {
    contractRef: contractId, signatureRequestId: srId, providerEvent: 'signature_request.done',
  });
  const signed = await Contract.findById(contractId);
  check('clientSignedAt renseigné', Boolean(signatureOf(signed).clientSignedAt));
  check('statut de la demande DONE', signatureOf(signed).status === 'DONE');
}
// --- Parcours ADMIN : activation --------------------------------------------
section('Parcours ADMIN (activation)');
{
  const mine = await api('GET', '/api/my-contract', { token: adminToken });
  check('ADMIN voit son contrat', mine.json.data?._id === contractId);

  let act = (await api('GET', '/api/my-contract/activation', { token: adminToken })).json.data;
  check('étape LAUNCH_FEE (signé, frais dûs)', act.activation.step === 'LAUNCH_FEE');

  const launch = await api('POST', '/api/my-contract/create-launch-checkout', { token: adminToken });
  check('checkout frais -> url', Boolean(launch.json.data.url));

  // Paiement frais confirmé par webhook
  await stripeWebhook({ id: 'evt_launch', type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', customer: 'cus_1', payment_intent: 'pi_1', metadata: { contractId, paymentType: 'LAUNCH_FEE', environment: 'TEST' } } } });
  act = (await api('GET', '/api/my-contract/activation', { token: adminToken })).json.data;
  check('frais payés -> étape SUBSCRIPTION', act.activation.step === 'SUBSCRIPTION');

  const subCk = await api('POST', '/api/my-contract/create-subscription-checkout', { token: adminToken });
  check('checkout abo -> url', Boolean(subCk.json.data.url));

  await stripeWebhook({ id: 'evt_sub_cs', type: 'checkout.session.completed', data: { object: { id: 'cs_2', payment_status: 'paid', customer: 'cus_1', subscription: 'sub_1', metadata: { contractId, paymentType: 'SUBSCRIPTION', environment: 'TEST' } } } });
  await stripeWebhook({ id: 'evt_sub_upd', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'active', current_period_end: Math.floor(Date.now() / 1000) + 2592000, cancel_at_period_end: false, metadata: { contractId } } } });
  act = (await api('GET', '/api/my-contract/activation', { token: adminToken })).json.data;
  check('abo actif -> étape ACTIVATION', act.activation.step === 'ACTIVATION');
  check('canActivate=true', act.activation.canActivate === true);

  const activated = await api('POST', '/api/my-contract/activate', { token: adminToken });
  check('activation -> ACTIVE', activated.json.data.status === 'ACTIVE');

  const s = await api('GET', '/api/site-status', { token: devToken });
  check('site ACTIF après activation', s.json.data.status === 'ACTIVE');
}

// --- Résiliation (ENV=TEST : IMMÉDIATE) + rejeu webhook ----------------------
// En PROD la résiliation reste « fin de période » — couvert par
// cancellation-mode.test.js. Ici (ENV=TEST) elle est immédiate (LOT recette).
section('Résiliation (immédiate en TEST) et fin de contrat');
{
  const cancelled = await api('POST', '/api/my-contract/cancel', { token: adminToken });
  check('résiliation ENV=TEST -> IMMÉDIATE (ENDED)', cancelled.json.data.status === 'ENDED');

  const s1 = await api('GET', '/api/site-status', { token: devToken });
  check('site SUSPENDU immédiatement (accès retiré)', s1.json.data.status === 'SUSPENDED');

  // Webhook de fin arrivant APRÈS coup (Stripe confirme) : idempotent.
  await stripeWebhook({ id: 'evt_sub_del', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled', metadata: { contractId } } } });
  const ended = await Contract.findById(contractId);
  check('contrat -> ENDED', ended.status === 'ENDED');
  const s2 = await api('GET', '/api/site-status', { token: devToken });
  check('site toujours SUSPENDU après le webhook (idempotent)', s2.json.data.status === 'SUSPENDED');

  // Idempotence : rejeu de l'event de fin
  const dup = await stripeWebhook({ id: 'evt_sub_del', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', metadata: { contractId } } } });
  check('rejeu fin abo -> duplicate', dup.json.duplicate === true);
}

// --- Facturation ------------------------------------------------------------
section('Facturation');
{
  const mine = await api('GET', '/api/my-invoices', { token: adminToken });
  check('ADMIN voit ses paiements', Array.isArray(mine.json.data) && mine.json.data[0].payments.length >= 1);
  const devView = await api('GET', '/api/invoices', { token: devToken });
  check('DEV voit la vue globale', Array.isArray(devView.json.data));
  const adminGlobal = await api('GET', '/api/invoices', { token: adminToken });
  check('ADMIN refusé sur la vue globale DEV (403)', adminGlobal.status === 403);
}

await new Promise((r) => server.close(r));
await disconnectDatabase();
console.log(`\n${pass} réussis, ${fail} échoués`);
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
