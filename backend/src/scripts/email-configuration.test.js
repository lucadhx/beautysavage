/* CONFIGURATION E-MAIL — CE QUI RESTE AU PROJET, ET CE QUI N'EST PLUS À LUI.
 *
 * ══ CE QUE CE FICHIER PROUVAIT AVANT R10.5, ET POURQUOI IL A CHANGÉ DE SUJET ══
 *
 * Il éprouvait un projet qui possédait son expéditeur et envoyait lui-même ses
 * e-mails de test, en appelant Brevo avec une clé locale. Les deux surfaces ont
 * été supprimées :
 *
 *   · l'expéditeur du parc est UNIQUE et détenu par le Panel ;
 *   · l'envoi de test vit dans le Panel, où il emprunte la chaîne réelle.
 *
 * Le fichier ne teste donc plus « est-ce que ça marche comme avant » — il
 * GARDE les invariants nouveaux, c'est-à-dire qu'il échoue si quelqu'un
 * reconstruit ce qui vient d'être retiré. C'est le seul rôle utile qui lui
 * reste, et c'est celui qui rend les compteurs du lot vérifiables plutôt que
 * déclaratifs.
 *
 * ══ CE QUI EST TOUJOURS ÉPROUVÉ, PARCE QUE TOUJOURS VIVANT ═══════════════════
 *
 *   · la dérivation du statut global (elle ne dépend plus que de la clé) ;
 *   · l'issue RÉSOLUE depuis la livraison réelle — un « Fonctionnel » ne peut
 *     toujours pas naître d'une simple acceptation, seul un webhook le donne ;
 *   · l'étanchéité TEST / PROD ;
 *   · la projection Manager, et l'absence de tout expéditeur dedans ;
 *   · la purge du champ local, idempotente et ciblée ;
 *   · les routes survivantes, et le 404 des routes retirées.
 *
 * Fournisseur SIMULÉ : aucun appel réseau réel, aucun e-mail.
 * Runner autonome. */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4141';
process.env.CORS_ORIGINS = 'http://localhost:6061,http://localhost:6062';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

/* ---------------------------------------------------------------------------
 * COMPTE BREVO SIMULÉ — et surtout, COMPTEUR D'APPELS.
 *
 * Le simulateur n'est plus là pour laisser passer un envoi : il est là pour
 * prouver qu'AUCUN ne part. Tout appel vers un hôte Brevo est enregistré, et
 * plusieurs sections vérifient que le compteur ne bouge pas.
 * ------------------------------------------------------------------------- */
const realFetch = globalThis.fetch;
let calls = [];

const KEY_TEST = 'xkeysib-cfg-TEST-000000000000000000000000000aaaa';
const KEY_PROD = 'xkeysib-cfg-PROD-000000000000000000000000000bbbb';
function modeOfKey(key) { return key === KEY_PROD ? 'PROD' : 'TEST'; }

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

globalThis.fetch = async (input, options = {}) => {
  const href = typeof input === 'string' ? input : String(input?.url ?? input);
  if (!/^https?:\/\/[^/]*brevo/.test(href)) return realFetch(input, options);

  const method = options.method || 'GET';
  const key = options.headers?.['api-key'];
  const path = decodeURIComponent(href.replace(/^https?:\/\/[^/]*\/v3/, ''));
  calls.push({ method, path, mode: modeOfKey(key), key });

  if (method === 'GET' && path === '/account') return json(200, { companyName: 'L.Y', email: 'a@b.fr' });
  return json(404, { code: 'not_found', message: path });
};

/** Un envoi transactionnel a-t-il été tenté ? Doit rester FAUX partout ici. */
function attemptedSend() {
  return calls.some((c) => c.path === '/smtp/email');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('Statut global — la dérivation ne connaît plus d’expéditeur');
const { deriveStatus } = await import('../services/emailConfiguration.service.js');
{
  const S = (o) => deriveStatus({ hasApiKey: true, testStatus: 'NOT_TESTED', ...o });

  check('sans clé -> NON CONFIGURÉ', S({ hasApiKey: false }) === 'NOT_CONFIGURED');
  check('avec clé, jamais testé -> NON TESTÉ', S({}) === 'NOT_TESTED');
  check('livré -> FONCTIONNEL', S({ testStatus: 'DELIVERED' }) === 'FUNCTIONAL');
  check('accepté -> ACCEPTÉ (et surtout PAS fonctionnel)',
    S({ testStatus: 'ACCEPTED' }) === 'ACCEPTED');
  check('rejeté -> ERREUR', S({ testStatus: 'REJECTED' }) === 'ERROR');
  check('échec immédiat -> ERREUR', S({ testStatus: 'FAILED' }) === 'ERROR');

  /**
   * LE GARDE-FOU : la signature ne doit plus RIEN attendre d'un expéditeur.
   *
   * Un `hasName`/`hasEmail` réintroduit rendrait ce projet éternellement « non
   * configuré » — plus personne n'écrit ces champs, donc la condition ne
   * pourrait jamais redevenir vraie, et l'écran signalerait un défaut que rien
   * ne peut réparer.
   */
  check('NO_LOCAL_FROM — un nom/adresse passés ne changent RIEN',
    deriveStatus({ hasApiKey: true, testStatus: 'NOT_TESTED', hasName: false, hasEmail: false })
      === 'NOT_TESTED');
  check('…la source ne mentionne plus hasName/hasEmail dans sa garde',
    !/!hasName\s*\|\|\s*!hasEmail/.test(deriveStatus.toString()));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('Amorçage — l’expéditeur local n’est jamais recréé');
const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();
const { bootstrap, purgeLocalSenderIdentity } = await import('../config/bootstrap.js');
await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();
// LOT 2C — le DÉCOR de recette (dev@mail.com, admin@mail.com) ne vient plus du
// produit : `bootstrap()` ne pose aucun mot de passe. Voir helpers/testAccounts.helper.js.
await (await import("./helpers/testAccounts.helper.js")).seedTestAccounts();

const { EmailConfiguration } = await import('../models/EmailConfiguration.model.js');
const { EmailDelivery } = await import('../models/EmailDelivery.model.js');
const { IntegratedApi } = await import('../models/IntegratedApi.model.js');
const { encryptSecret, lastFourOf } = await import('../utils/integratedApiCrypto.js');
const svc = await import('../services/emailConfiguration.service.js');

function cred(v) { return { encryptedValue: encryptSecret(v), lastFour: lastFourOf(v) }; }

async function setKeys({ test = KEY_TEST, prod = KEY_PROD, active = 'TEST' } = {}) {
  const brevo = await IntegratedApi.findOne({ provider: 'BREVO' });
  brevo.modes.TEST.credentials.delete('apiKey');
  brevo.modes.PROD.credentials.delete('apiKey');
  if (test) brevo.modes.TEST.credentials.set('apiKey', cred(test));
  if (prod) brevo.modes.PROD.credentials.set('apiKey', cred(prod));
  brevo.activeMode = active;
  brevo.enabled = true;
  brevo.recomputeAll();
  await brevo.save();
}

const { makeBrevoOperational } = await import('./helpers/brevoOperational.helper.js');

async function reset() {
  await EmailConfiguration.deleteMany({});
  await EmailDelivery.deleteMany({});
  await setKeys();
  await makeBrevoOperational('TEST');
  await makeBrevoOperational('PROD');
  calls = [];
}

{
  await reset();
  const cfg = await svc.getEmailConfiguration();
  check('le singleton est créé', Boolean(cfg));
  check('NO_LOCAL_FROM — le mode ne porte AUCUN expéditeur',
    cfg.modes.TEST.sender === undefined);
  check('…le schéma ne déclare plus ce chemin',
    !Object.keys(EmailConfiguration.schema.paths).some((p) => /sender/.test(p)));

  /**
   * LA MIGRATION LEGACY NE DOIT PLUS RESSUSCITER LE CHAMP.
   *
   * Elle existait pour reprendre un `sender` de l'ancienne forme partagée vers
   * les deux modes. Si elle continuait à l'écrire, la surface supprimée
   * réapparaîtrait sur les bases les plus anciennes — exactement là où personne
   * ne regarde.
   */
  await EmailConfiguration.collection.insertOne({
    sender: { email: 'legacy@ancien.fr', name: 'Ancien' },
    domain: { name: 'ancien.fr' },
  });
  const { migrateEmailConfigurationToSimpleModel } = await import('../config/bootstrap.js');
  await migrateEmailConfigurationToSimpleModel();

  const migres = await EmailConfiguration.collection.find({}).toArray();
  check('la migration retire l’ancien bloc racine',
    migres.every((d) => d.sender === undefined && d.domain === undefined));
  check('NO_LOCAL_FROM — …et n’en recrée aucun par mode',
    migres.every((d) => !d.modes?.TEST?.sender && !d.modes?.PROD?.sender));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('Purge du champ local — ciblée, et idempotente');
{
  await reset();
  await svc.getEmailConfiguration();

  // On REPOSE le champ à la main : c'est l'état d'une base antérieure au lot.
  await EmailConfiguration.collection.updateMany({}, {
    $set: {
      'modes.TEST.sender': { email: 'ancien@site.fr', name: 'Ancien' },
      'modes.PROD.sender': { email: 'ancien@site.fr', name: 'Ancien' },
    },
  });

  const dry = await purgeLocalSenderIdentity({ dryRun: true });
  check('DRY_RUN — la purge annonce ce qu’elle ferait', dry.candidates === 2);
  check('…sans rien modifier', dry.purged === 0);
  const apresDry = await EmailConfiguration.collection.findOne({});
  check('…le champ est toujours là après le dry-run',
    Boolean(apresDry.modes.TEST.sender));

  const apply1 = await purgeLocalSenderIdentity();
  check('APPLY — le champ est retiré', apply1.purged === 2);

  const doc = await EmailConfiguration.collection.findOne({});
  check('…des DEUX mondes',
    doc.modes.TEST.sender === undefined && doc.modes.PROD.sender === undefined);
  /**
   * `$unset` CIBLÉ : l'état de test vit dans le même sous-document et n'a rien
   * à voir avec l'expéditeur. Un `$set` du document entier l'aurait écrasé.
   */
  check('…sans toucher à l’état de test voisin', Boolean(doc.modes.TEST.test));

  const apply2 = await purgeLocalSenderIdentity();
  check('IDEMPOTENT — un second passage ne modifie RIEN', apply2.purged === 0);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('Aucune surface locale d’expéditeur ni d’envoi ne subsiste');
{
  const service = await import('../services/emailConfiguration.service.js');

  for (const parti of ['updateSender', 'sendTestEmail', 'getActiveSender', 'senderOf']) {
    check(`NO_LOCAL_SURFACE — « ${parti} » n’est plus exporté`,
      service[parti] === undefined);
  }

  /**
   * Le driver Brevo existe encore — il sert le webhook et la lecture de compte.
   * Ce qui doit avoir disparu, c'est tout APPELANT métier de l'envoi.
   */
  const { readFileSync } = await import('node:fs');
  const url = await import('node:url');
  const dir = url.fileURLToPath(new URL('..', import.meta.url));

  const source = readFileSync(`${dir}services/emailConfiguration.service.js`, 'utf8');
  check('NO_LOCAL_BREVO_SEND — le service n’importe plus le driver d’envoi',
    !/sendTransactionalEmail/.test(source));
  check('…ni ne construit de corps d’e-mail', !/htmlContent/.test(source));

  const routes = readFileSync(`${dir}routes/emailConfiguration.routes.js`, 'utf8');
  check('NO_LOCAL_TEST_SEND — aucune route d’envoi de test',
    !/router\.post\(\s*'\/test-send'/.test(routes));
  check('NO_LOCAL_FROM — aucune route d’expéditeur',
    !/router\.put\(\s*'\/sender'/.test(routes));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('L’issue reste DÉRIVÉE de la livraison, jamais de l’acceptation');
{
  await reset();
  const cfg = await svc.getEmailConfiguration();
  const state = cfg.modes.TEST;

  /**
   * On fabrique l'état qu'un envoi aurait laissé, SANS envoyer : c'est
   * précisément ce que le projet ne fait plus. La règle éprouvée, elle, est
   * intacte — « accepté » n'est pas « livré », et seul un webhook tranche.
   */
  await EmailDelivery.create({
    deliveryId: 'd-outcome-1',
    templateId: 'EMAIL_CONFIG_TEST',
    templateVersion: 0,
    provider: 'BREVO',
    providerMode: 'TEST',
    sender: { name: 'Plateforme', emailMasked: 's***@ly.fr' },
    recipientKey: 'k1',
    recipientEmailMasked: 'd***@x.fr',
    subjectSnapshot: 'Test',
    status: 'SENT',
    providerMessageId: 'msg-outcome-1@brevo',
    attempts: 1,
    sentAt: new Date(),
  });
  state.test.status = 'ACCEPTED';
  state.test.deliveryId = 'd-outcome-1';
  await cfg.save();

  const accepte = await svc.resolveTestOutcome(state);
  check('livraison SENT -> reste ACCEPTÉ', accepte.status === 'ACCEPTED');
  check('…et ne prétend PAS avoir été livré', accepte.deliveredAt === null);

  await EmailDelivery.updateOne(
    { deliveryId: 'd-outcome-1' },
    { $set: { status: 'DELIVERED', deliveredAt: new Date(), lastEventType: 'delivered' } },
  );
  const livre = await svc.resolveTestOutcome(state);
  check('WEBHOOK_IS_THE_PROOF — livraison DELIVERED -> LIVRÉ', livre.status === 'DELIVERED');
  check('…avec sa date', Boolean(livre.deliveredAt));

  await EmailDelivery.updateOne(
    { deliveryId: 'd-outcome-1' },
    { $set: { status: 'HARD_BOUNCED', lastEventType: 'hard_bounce' } },
  );
  const rebond = await svc.resolveTestOutcome(state);
  check('livraison rebondie -> REJETÉ', rebond.status === 'REJECTED');

  check('AUCUN envoi n’a eu lieu dans toute la section', !attemptedSend());
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('Projection Manager — sans expéditeur, et sans secret');
{
  await reset();
  const cfg = await svc.getEmailConfiguration();
  const vue = await svc.serializeEmailConfiguration(cfg, 'TEST');

  check('l’environnement servi est exposé', vue.environment === 'TEST');
  check('la PRÉSENCE de la clé est exposée', vue.modes.TEST.apiKeyConfigured === true);
  check('NO_SECRET — la clé elle-même ne fuit pas', !JSON.stringify(vue).includes('xkeysib'));
  check('NO_LOCAL_FROM — la projection ne porte AUCUN expéditeur',
    vue.modes.TEST.sender === undefined && !/"sender"/.test(JSON.stringify(vue)));
  check('l’état de test reste exposé', typeof vue.modes.TEST.test.status === 'string');
  check('aucun vocabulaire OTP/domaine',
    !/verificationStatus|otp|dkim|dmarc|dnsRecords/i.test(JSON.stringify(vue)));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('Isolation TEST / PROD');
{
  await reset();
  const cfg = await svc.getEmailConfiguration();

  cfg.modes.TEST.test.status = 'DELIVERED';
  cfg.modes.PROD.test.status = 'NOT_TESTED';
  await cfg.save();

  const relu = await svc.getEmailConfiguration();
  check('les deux mondes gardent leur état propre',
    relu.modes.TEST.test.status === 'DELIVERED' && relu.modes.PROD.test.status === 'NOT_TESTED');

  const vueTest = await svc.serializeEmailConfiguration(relu, 'TEST');
  const vueProd = await svc.serializeEmailConfiguration(relu, 'PROD');
  check('la projection suit l’environnement demandé',
    vueTest.environment === 'TEST' && vueProd.environment === 'PROD');
  check('…et les états ne se mélangent pas',
    vueTest.modes.TEST.test.status !== vueTest.modes.PROD.test.status);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('HTTP — les routes retirées répondent 404, les autres vivent');
const { createApp } = await import('../app.js');
const server = createApp().listen(process.env.PORT);
const BASE = `http://127.0.0.1:${process.env.PORT}`;

async function api(method, path, { token, body } = {}) {
  const res = await realFetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  return { status: res.status, json: payload };
}
async function login(email, password) {
  const r = await api('POST', '/api/auth/login', { body: { email, password } });
  return r.json?.data?.token;
}

const devToken = await login('dev@mail.com', '123dev');
const adminToken = await login('admin@mail.com', '123admin');

{
  await reset();
  check('GET sans token -> 401', (await api('GET', '/api/email-configuration')).status === 401);
  check('GET en ADMIN -> 403', (await api('GET', '/api/email-configuration', { token: adminToken })).status === 403);

  const r = await api('GET', '/api/email-configuration', { token: devToken });
  check('GET en DEV -> 200', r.status === 200);
  check('GET : environnement de l’instance exposé', r.json.data.environment === 'TEST');
  check('GET : présence de la clé exposée', r.json.data.modes.TEST.apiKeyConfigured === true);
  check('GET : la clé elle-même ne fuit pas', !JSON.stringify(r.json).includes('xkeysib'));
  check('NO_LOCAL_FROM — GET n’expose aucun expéditeur',
    !/"sender"/.test(JSON.stringify(r.json)));
}

{
  calls = [];
  /**
   * LES DEUX ROUTES RETIRÉES.
   *
   * On vérifie un 404 — pas un 400, pas un 403. Un 400 signifierait que la
   * route existe encore et discute la charge utile ; un 403, qu'elle existe et
   * garde un droit. Seul un 404 dit qu'elle n'est plus là.
   */
  const put = await api('PUT', '/api/email-configuration/sender', {
    token: devToken, body: { email: 'x@y.fr', name: 'X' },
  });
  check('NO_LOCAL_FROM — PUT /sender -> 404', put.status === 404);

  const post = await api('POST', '/api/email-configuration/test-send', {
    token: devToken, body: { recipient: 'x@y.fr' },
  });
  check('NO_LOCAL_TEST_SEND — POST /test-send -> 404', post.status === 404);

  check('NO_LOCAL_BREVO_SEND — aucun envoi n’a été tenté', !attemptedSend());
}

{
  // Les routes SURVIVANTES restent servies : on ne casse pas ce qui reste utile.
  const status = await api('GET', '/api/email-configuration/test-status', { token: devToken });
  check('GET /test-status vit toujours', status.status === 200);

  const restore = await api('POST', '/api/email-configuration/restore', { token: devToken });
  check('POST /restore vit toujours', restore.status === 200);
}

/* ------------------------------------------------------------------------- */
server.close();
await disconnectDatabase();
await mongod.stop();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
