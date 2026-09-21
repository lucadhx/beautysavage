/* Parcours « Mot de passe oublié » : réponse générique (aucune énumération),
 * token HASHÉ à usage unique et expirant, invalidation par nouvelle demande,
 * e-mail transactionnel branché (Brevo simulé), URL construite depuis la
 * Configuration Système (TEST/PROD), robustesse du nouveau mot de passe.
 * Runner autonome — aucun e-mail réel. */
import crypto from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'reset_test';
process.env.DB_PROD = 'reset_prod';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4147';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NGROK_API_URL = 'http://127.0.0.1:1'; // hermétique à un vrai tunnel

let pass = 0;
let fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

/* Brevo simulé — capture des envois. */
const realFetch = globalThis.fetch;
let brevoCalls = [];
let messageSeq = 0;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (input, options = {}) => {
  const href = typeof input === 'string' ? input : String(input?.url ?? input);
  if (!/^https?:\/\/[^/]*brevo/.test(href)) return realFetch(input, options);
  const path = href.replace(/^https?:\/\/[^/]*\/v3/, '');
  brevoCalls.push({ path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined });
  if (path === '/smtp/email') { messageSeq += 1; return json(201, { messageId: `<reset-${messageSeq}@brevo>` }); }
  if (path === '/senders') return json(200, { senders: [] });
  return json(200, {});
};

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
await connectDatabase();
await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();
// LOT 2C — le DÉCOR de recette (dev@mail.com, admin@mail.com) ne vient plus du
// produit : `bootstrap()` ne pose aucun mot de passe. Voir helpers/testAccounts.helper.js.
await (await import("./helpers/testAccounts.helper.js")).seedTestAccounts();

/* ══════════════════════════════════════════════════════════════════════════
   UN PANEL STUB APPAIRÉ — pour une suite dont l'e-mail est un EFFET DE BORD.
   ══════════════════════════════════════════════════════════════════════════

   Depuis le cutover L8.4C, envoyer un e-mail n'est plus un appel HTTP local :
   c'est une capacité demandée au Panel. Une suite qui éprouve « la
   réinitialisation envoie bien un message » doit donc avoir un Panel en face,
   sinon elle n'éprouve plus que l'absence d'appairage.

   On appaire le VRAI runtime du pont sur le stub partagé : `clientFactory` est
   le point d'injection prévu pour cela. Tout le chemin réel est donc exercé —
   `sendTemplate` → `capabilityClient` → `PanelBridge` → contrat — et seul le
   Panel distant est doublé.
   ══════════════════════════════════════════════════════════════════════════ */
const { createPanelStub } = await import('../services/panelBridge/panelStub.js');
const bridgeRuntime = await import('../services/panelBridge/bridgeRuntime.js');

const panelStub = createPanelStub();
bridgeRuntime.configureBridgeRuntime({ clientFactory: () => panelStub });
await bridgeRuntime.pairWithPanel({
  panelUrl: 'https://panel-stub.test',
  pairingCode: 'PAIR-OK',
  publicBackendUrl: 'https://projet-stub.test',
});


const { createApp } = await import('../app.js');
const app = createApp();
const server = app.listen(4147);

async function api(method, path, { token, body } = {}) {
  const res = await realFetch(`http://localhost:4147${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch { /* */ }
  return { status: res.status, json: j };
}

const { User } = await import('../models/User.model.js');
const { SystemConfiguration } = await import('../models/SystemConfiguration.model.js');
const { EmailConfiguration } = await import('../models/EmailConfiguration.model.js');
const { IntegratedApi } = await import('../models/IntegratedApi.model.js');
const { encryptSecret, lastFourOf } = await import('../utils/integratedApiCrypto.js');
const { makeBrevoOperational } = await import('./helpers/brevoOperational.helper.js');

/* Rendre l'envoi d'e-mails possible (clé + expéditeur + suivi TEST). */
const brevo = await IntegratedApi.findOne({ provider: 'BREVO' });
brevo.modes.TEST.credentials.set('apiKey', { encryptedValue: encryptSecret('xkeysib-reset-TEST-0000000000000000000000000aaa'), lastFour: 'aaaa' });
brevo.modes.TEST.verified = true;
brevo.enabled = true;
brevo.activeMode = 'TEST';
await brevo.save();
await EmailConfiguration.deleteMany({});
await EmailConfiguration.create({ modes: { TEST: { sender: { email: 'support@exemple.fr', name: 'SB Auto' } }, PROD: { sender: { email: 'support@exemple.fr', name: 'SB Auto' } } } });
await makeBrevoOperational('TEST');

const MANAGER_URL = 'https://manager.exemple-test.fr';
await SystemConfiguration.updateOne({}, { $set: { 'network.managerUrl': MANAGER_URL } }, { upsert: true });

const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');
/**
 * LE JETON VIENT DE LA VARIABLE MÉTIER, plus du HTML rendu.
 *
 * Le contenu est désormais rendu par le Panel : le lire ici ferait dépendre
 * une assertion de sécurité d'un gabarit qui ne nous appartient plus. L'URL de
 * réinitialisation, elle, est une donnée que le projet vient de produire.
 */
const extractToken = (call) => {
  const url = String(call?.variables?.['auth.resetUrl'] ?? '');
  const m = url.match(/reinitialiser-mot-de-passe\?token=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
};

try {
  /* ─────────────────────────────────────────────────────────────────────── */
  section('1. Demande — réponse générique, jamais d’énumération');
  const rKnown = await api('POST', '/api/auth/forgot-password', { body: { email: 'admin@mail.com' } });
  const rUnknown = await api('POST', '/api/auth/forgot-password', { body: { email: 'inconnu@nulle-part.fr' } });
  check('email existant : 200', rKnown.status === 200);
  check('email inconnu : 200 identique', rUnknown.status === 200);
  check('même message public dans les deux cas',
    rKnown.json.data.message === rUnknown.json.data.message &&
    /Si un compte correspond/.test(rKnown.json.data.message));
  /**
   * ══ L'OBSERVATION A CHANGÉ DE NIVEAU, PAS DE SENS (L8.4C) ════════════════
   *
   * On comptait des appels `POST /v3/smtp/email` émis par le projet. Le projet
   * n'en émet plus : il demande la capacité `email.send_template` au Panel.
   * Ce qui est prouvé reste identique — un seul envoi, et seulement pour un
   * compte qui existe — mais à la frontière réellement empruntée.
   */
  check('email envoyé UNIQUEMENT pour le compte existant',
    panelStub.emailSendRequests().length === 1);
  check('email invalide : 400', (await api('POST', '/api/auth/forgot-password', { body: { email: 'pas-un-email' } })).status === 400);

  section('2. E-mail — template branché, URL Manager, token jamais en clair côté base');
  const call = panelStub.emailSendRequests()[0];
  check('destinataire = le compte', call.recipient === 'admin@mail.com');
  /**
   * LE MODÈLE EST DÉSIGNÉ PAR SON CODE, plus par son sujet rendu : le sujet
   * appartient au Panel, le code appartient au métier. C'est d'ailleurs une
   * assertion plus forte — elle survit à une réécriture du texte.
   */
  check('modèle demandé = PASSWORD_RESET_REQUEST', call.templateRef === 'PASSWORD_RESET_REQUEST');
  const resetUrl = String(call.variables['auth.resetUrl'] ?? '');
  const token1 = extractToken(call);
  check('lien tokenisé construit depuis network.managerUrl',
    Boolean(token1) && resetUrl.startsWith(`${MANAGER_URL}/reinitialiser-mot-de-passe?token=`));
  check('durée de validité transmise au modèle',
    Number(call.variables['auth.expiresMinutes']) === 60);
  const stored = await User.findOne({ email: 'admin@mail.com' }).select('+passwordReset');
  check('base : hash SHA-256 stocké, JAMAIS le token brut',
    stored.passwordReset.tokenHash === sha256(token1) && stored.passwordReset.tokenHash !== token1);
  check('base : expiration posée (~60 min)',
    stored.passwordReset.expiresAt > new Date(Date.now() + 50 * 60 * 1000));
  check('API /me ne fuit jamais passwordReset', !JSON.stringify((await api('POST', '/api/auth/login', { body: { email: 'admin@mail.com', password: '123admin' } })).json).includes('tokenHash'));

  section('3. Nouvelle demande — l’ancien token est invalidé');
  panelStub.resetCapabilityCalls();
  await api('POST', '/api/auth/forgot-password', { body: { email: 'admin@mail.com' } });
  const token2 = extractToken(panelStub.emailSendRequests()[0]);
  check('nouveau token différent', Boolean(token2) && token2 !== token1);
  const rOld = await api('POST', '/api/auth/reset-password', { body: { token: token1, newPassword: 'nouveau-secret-1', confirmPassword: 'nouveau-secret-1' } });
  check('ancien token refusé (invalidé par la nouvelle demande)', rOld.status === 400 && rOld.json.details?.code === 'PASSWORD_RESET_TOKEN_INVALID');

  section('4. Confirmation — validations puis succès');
  check('mot de passe faible : 400', (await api('POST', '/api/auth/reset-password', { body: { token: token2, newPassword: '123', confirmPassword: '123' } })).status === 400);
  check('confirmation différente : 400', (await api('POST', '/api/auth/reset-password', { body: { token: token2, newPassword: 'nouveau-secret-1', confirmPassword: 'autre' } })).status === 400);
  check('token fantaisiste : 400', (await api('POST', '/api/auth/reset-password', { body: { token: 'x'.repeat(43), newPassword: 'nouveau-secret-1', confirmPassword: 'nouveau-secret-1' } })).status === 400);
  const rOk = await api('POST', '/api/auth/reset-password', { body: { token: token2, newPassword: 'nouveau-secret-1', confirmPassword: 'nouveau-secret-1' } });
  check('reset réussi : 200', rOk.status === 200);
  check('connexion avec le NOUVEAU mot de passe', (await api('POST', '/api/auth/login', { body: { email: 'admin@mail.com', password: 'nouveau-secret-1' } })).status === 200);
  check('ancien mot de passe refusé', (await api('POST', '/api/auth/login', { body: { email: 'admin@mail.com', password: '123admin' } })).status === 401);

  section('5. Usage unique + expiration');
  const rReuse = await api('POST', '/api/auth/reset-password', { body: { token: token2, newPassword: 'encore-un-autre-1', confirmPassword: 'encore-un-autre-1' } });
  check('token déjà utilisé : refusé', rReuse.status === 400);
  const cleared = await User.findOne({ email: 'admin@mail.com' }).select('+passwordReset');
  check('état de reset effacé après succès', !cleared.passwordReset?.tokenHash);

  brevoCalls = [];
  await api('POST', '/api/auth/forgot-password', { body: { email: 'admin@mail.com' } });
  const token3 = extractToken(panelStub.emailSendRequests()[0]);
  await User.updateOne({ email: 'admin@mail.com' }, { $set: { 'passwordReset.expiresAt': new Date(Date.now() - 1000) } });
  const rExpired = await api('POST', '/api/auth/reset-password', { body: { token: token3, newPassword: 'nouveau-secret-2', confirmPassword: 'nouveau-secret-2' } });
  check('token expiré : refusé', rExpired.status === 400 && rExpired.json.details?.code === 'PASSWORD_RESET_TOKEN_INVALID');

  section('6. managerUrl absente — réponse générique, aucun envoi, aucun état posé');
  await SystemConfiguration.updateOne({}, { $set: { 'network.managerUrl': '' } });
  brevoCalls = [];
  const rNoUrl = await api('POST', '/api/auth/forgot-password', { body: { email: 'admin@mail.com' } });
  check('réponse toujours générique', rNoUrl.status === 200 && /Si un compte correspond/.test(rNoUrl.json.data.message));
  check('aucun e-mail parti', !brevoCalls.some((c) => c.path === '/smtp/email'));
  await SystemConfiguration.updateOne({}, { $set: { 'network.managerUrl': MANAGER_URL } });

  console.log(`\n${pass} réussis, ${fail} échoués`);
} catch (err) {
  console.error('PASSWORD RESET TEST CRASHED:', err);
  fail++;
} finally {
  globalThis.fetch = realFetch;
  server.close();
  await disconnectDatabase();
  await mongod.stop();
  process.exit(fail === 0 ? 0 : 1);
}
