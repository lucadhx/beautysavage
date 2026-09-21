/* Tests des demandes de contact : validation, anti-abus, persistance,
 * idempotence, événement, notification e-mail, gestion Manager, permissions.
 * Fournisseur Brevo SIMULÉ — aucun e-mail réel n'est envoyé. Runner autonome. */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4143';
process.env.CORS_ORIGINS = 'http://localhost:6061';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }
async function asyncCodeOf(fn) {
  try { await fn(); return null; } catch (e) { return e.code || e.name; }
}

// ---------------------------------------------------------------------------
// Brevo SIMULÉ.
const realFetch = globalThis.fetch;
let brevoCalls = [];
let forcedBrevo = null;
let messageSeq = 0;
const KEY_TEST = 'xkeysib-contact-TEST-000000000000000000000000aaaa';
function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
globalThis.fetch = async (input, options = {}) => {
  const href = typeof input === 'string' ? input : String(input?.url ?? input);
  if (!/^https?:\/\/[^/]*brevo/.test(href)) return realFetch(input, options);
  const path = href.replace(/^https?:\/\/[^/]*\/v3/, '');
  brevoCalls.push({ path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined });
  if (path === '/smtp/email') {
    if (forcedBrevo) { const f = forcedBrevo; forcedBrevo = null; return f; }
    messageSeq += 1;
    return json(201, { messageId: `<contact-${messageSeq}@brevo>` });
  }
  if (path === '/senders') return json(200, { senders: [] });
  return json(200, {});
};

// ---------------------------------------------------------------------------
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

/**
 * UN REFUS DE CAPACITÉ, tel que la passerelle le rend.
 *
 * Le projet ne voit plus jamais un statut HTTP de Brevo : il voit un code
 * `CAPABILITY_*`. Éprouver la robustesse d'une notification, c'est donc forcer
 * un refus à CE niveau — le seul que le projet puisse encore rencontrer.
 */
const refusCapacite = (code, message) => Object.assign(new Error(message), { code });


const { createApp } = await import('../app.js');
const app = createApp();
const server = app.listen(4143);

async function api(method, path, { token, body, headers = {} } = {}) {
  const res = await realFetch(`http://localhost:4143${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch { /* */ }
  return { status: res.status, json: j };
}
async function login(email, password) {
  return (await api('POST', '/api/auth/login', { body: { email, password } })).json?.data?.token;
}

const { ContactSubmission } = await import('../models/ContactSubmission.model.js');
const { DomainEvent } = await import('../models/DomainEvent.model.js');
const { EventActionExecution } = await import('../models/EventActionExecution.model.js');
const { EmailDelivery } = await import('../models/EmailDelivery.model.js');
const { EmailConfiguration } = await import('../models/EmailConfiguration.model.js');
const { Company } = await import('../models/Company.model.js');
const { IntegratedApi } = await import('../models/IntegratedApi.model.js');
const { SystemConfiguration } = await import('../models/SystemConfiguration.model.js');
const { User } = await import('../models/User.model.js');
const { encryptSecret, lastFourOf } = await import('../utils/integratedApiCrypto.js');
const { EMAIL_TEST_STATUS } = await import('../utils/emailConstants.js');
const { EXECUTION_STATUS, EVENT_DISPATCH_STATUS } = await import('../utils/domainEventConstants.js');
const { DELIVERY_STATUS } = await import('../utils/emailTemplateConstants.js');
const { CONTACT_STATUS, CONTACT_REASON } = await import('../utils/contactConstants.js');
const abuse = await import('../services/contact/contactAbuse.js');
const { _resetGlobalRate } = abuse;

function cred(v) { return { encryptedValue: encryptSecret(v), lastFour: lastFourOf(v) }; }

/** Brevo + expéditeur + URL Manager : état PRÊT À NOTIFIER. */
async function makeEmailReady() {
  const brevo = await IntegratedApi.findOne({ provider: 'BREVO' });
  brevo.modes.TEST.credentials.set('apiKey', cred(KEY_TEST));
  brevo.modes.TEST.verified = true;
  brevo.activeMode = 'TEST';
  brevo.enabled = true;
  await brevo.save();

  await EmailConfiguration.deleteMany({});
  await EmailConfiguration.create({
    modes: {
      TEST: {
        sender: { email: 'support@exemple.fr', name: 'SB Auto' },
        test: { status: EMAIL_TEST_STATUS.DELIVERED, lastTestedAt: new Date() },
      },
    },
  });
  await SystemConfiguration.updateOne({}, { $set: { 'network.managerUrl': 'https://manager.exemple.fr' } }, { upsert: true });
}

const { makeBrevoOperational } = await import('./helpers/brevoOperational.helper.js');

async function resetAll() {
  // La notification admin part par Brevo : sans suivi opérationnel, elle serait
  // refusée avant même l'appel fournisseur.
  await makeBrevoOperational('TEST');
  await makeBrevoOperational('PROD');
  await ContactSubmission.deleteMany({});
  await DomainEvent.deleteMany({ type: 'contact.submitted' });
  await EventActionExecution.deleteMany({});
  await EmailDelivery.deleteMany({});
  // Destinataires métier remis à vide : chaque section part du fallback support,
  // et configure explicitement une liste quand elle en teste une.
  await Company.updateOne({}, { $set: { contactNotificationRecipients: [] } });
  brevoCalls = [];
  panelStub.resetCapabilityCalls();
  forcedBrevo = null;
  _resetGlobalRate();
}

/**
 * LA DEMANDE TYPE — celle du plan de site : « Entreprise, activité, projet,
 * coordonnées ». `companyName` est OBLIGATOIRE côté serveur ; l'omettre ici
 * ferait échouer toutes les sections en 400, pour une raison qui n'est celle
 * d'aucune d'elles.
 */
const VALID = () => ({
  name: 'Jean Dupont',
  companyName: 'Atelier Dupont',
  activity: 'Ébénisterie',
  email: 'jean.dupont@exemple.fr',
  phone: '06 12 34 56 78',
  reason: CONTACT_REASON.NEW_PRESENCE,
  message: 'Nous voulons une présence à la hauteur de notre atelier.',
  pageUrl: 'https://exemple.fr/presenter-un-projet',
});
const post = (body) => api('POST', '/api/public/contact', { body });
/** Le code métier remonte dans les `issues` zod du middleware d'erreur. */
const issueCodes = (r) => JSON.stringify(r.json?.details || r.json || {});

await makeEmailReady();

// ═══════════════════════════════════════════════════════════════════════════
section('Validation publique');
await resetAll();
{
  const r = await post(VALID());
  check('demande valide -> 201', r.status === 201);
  check('réponse : submissionId', typeof r.json.data.submissionId === 'string');
  // La sortie est VOLONTAIREMENT minimale : rien sur l'infrastructure.
  check('réponse : AUCUN autre champ', Object.keys(r.json.data).length === 1);
  check('réponse : aucun état e-mail', !issueCodes(r).includes('email'));
}

await resetAll();
{
  check('nom vide -> 400', (await post({ ...VALID(), name: '' })).status === 400);
  check('nom vide -> code CONTACT_NAME_REQUIRED',
    issueCodes(await post({ ...VALID(), name: '   ' })).includes('CONTACT_NAME_REQUIRED'));
  check('nom trop long -> CONTACT_NAME_TOO_LONG',
    issueCodes(await post({ ...VALID(), name: 'x'.repeat(121) })).includes('CONTACT_NAME_TOO_LONG'));

  check('email invalide -> CONTACT_EMAIL_INVALID',
    issueCodes(await post({ ...VALID(), email: 'pas-une-adresse' })).includes('CONTACT_EMAIL_INVALID'));
  check('email vide -> CONTACT_EMAIL_INVALID',
    issueCodes(await post({ ...VALID(), email: '' })).includes('CONTACT_EMAIL_INVALID'));

  check('motif inconnu -> CONTACT_REASON_INVALID',
    issueCodes(await post({ ...VALID(), reason: 'INVENTED' })).includes('CONTACT_REASON_INVALID'));
  check('motif absent -> CONTACT_REASON_INVALID',
    issueCodes(await post({ ...VALID(), reason: undefined })).includes('CONTACT_REASON_INVALID'));

  check('message vide -> CONTACT_MESSAGE_REQUIRED',
    issueCodes(await post({ ...VALID(), message: '   ' })).includes('CONTACT_MESSAGE_REQUIRED'));
  check('message trop long -> CONTACT_MESSAGE_TOO_LONG',
    issueCodes(await post({ ...VALID(), message: 'x'.repeat(4001) })).includes('CONTACT_MESSAGE_TOO_LONG'));
  // Borne AVANT nettoyage : sinon un mégaoctet d'espaces passerait.
  check('message d’espaces géant -> refusé (borne avant nettoyage)',
    (await post({ ...VALID(), message: ' '.repeat(9000) })).status === 400);

  check('pageUrl javascript: -> 400',
    (await post({ ...VALID(), pageUrl: 'javascript:alert(1)' })).status === 400);
  check('pageUrl ftp: -> 400', (await post({ ...VALID(), pageUrl: 'ftp://x.fr' })).status === 400);
  check('pageUrl https -> accepté', (await post({ ...VALID(), pageUrl: 'https://exemple.fr/a' })).status === 201);
  check('pageUrl absente -> accepté', (await post({ ...VALID(), pageUrl: undefined })).status === 201);

  // `.strict()` : sur une route publique, un champ inconnu doit se heurter à un mur.
  check('champ inconnu -> 400 (strict)', (await post({ ...VALID(), status: 'RESOLVED' })).status === 400);
  check('submissionId imposé -> 400', (await post({ ...VALID(), submissionId: 'x' })).status === 400);
  check('companyId imposé -> 400', (await post({ ...VALID(), companyId: 'x' })).status === 400);
  check('clientSubmissionId non-UUID -> 400',
    (await post({ ...VALID(), clientSubmissionId: 'pas-un-uuid' })).status === 400);
}

await resetAll();
{
  // Normalisation.
  await post({ ...VALID(), name: '  Jean   Dupont  ', email: '  JEAN@EXEMPLE.FR  ', phone: '06.12.34.56.78' });
  const doc = await ContactSubmission.findOne().lean();
  check('nom : espaces normalisés', doc.contact.name === 'Jean Dupont');
  check('email : minuscules + trim', doc.contact.email === 'jean@exemple.fr');
  check('téléphone : normalisé', doc.contact.phone === '0612345678');

  await resetAll();
  await post({ ...VALID(), phone: undefined });
  check('téléphone absent -> chaîne vide', (await ContactSubmission.findOne().lean()).contact.phone === '');

  await resetAll();
  await post({ ...VALID(), message: 'Ligne 1\n\n\n\n\nLigne 2   avec   espaces' });
  const m = (await ContactSubmission.findOne().lean()).message;
  check('message : retours à la ligne CONSERVÉS', m.includes('\n'));
  check('message : lignes vides en excès réduites', !m.includes('\n\n\n'));
  check('message : espaces horizontaux normalisés', m.includes('avec espaces'));
}

await resetAll();
{
  // Le message est stocké en TEXTE : aucune interprétation, aucun nettoyage HTML.
  // C'est le renderer qui échappe à l'affichage (type TEXT).
  await post({ ...VALID(), message: '<script>alert(1)</script> Bonjour' });
  const doc = await ContactSubmission.findOne().lean();
  check('message : HTML stocké tel quel (texte brut, échappé au rendu)',
    doc.message.includes('<script>alert(1)</script>'));
}

// ═══════════════════════════════════════════════════════════════════════════
section('Anti-abus — module pur');
{
  const { isHoneypotFilled, isTooFast, countUrls, looksAutomated, assessSubmission, MIN_FILL_TIME_MS } = abuse;

  check('honeypot vide -> non rempli', !isHoneypotFilled(''));
  check('honeypot absent -> non rempli', !isHoneypotFilled(undefined));
  check('honeypot rempli -> détecté', isHoneypotFilled('http://spam.ru'));
  // Volontairement PAS détecté : un espace parasite ne doit pas coûter un client.
  check('honeypot d’espaces seuls -> NON détecté (côté prudent)', !isHoneypotFilled('   '));
  check('honeypot avec une vraie valeur -> détecté', isHoneypotFilled(' http://spam.ru '));

  const now = 1_000_000;
  check('soumission instantanée -> trop rapide', isTooFast(now - 100, now));
  check('soumission après le délai -> acceptée', !isTooFast(now - MIN_FILL_TIME_MS - 1, now));
  // Absent/illisible => on ACCEPTE : refuser perdrait de vrais visiteurs pour
  // gêner un robot qui peut de toute façon envoyer une date crédible.
  check('horodatage absent -> accepté', !isTooFast(undefined, now));
  check('horodatage illisible -> accepté', !isTooFast('pas-une-date', now));
  check('horloge client en avance -> accepté', !isTooFast(now + 5000, now));
  check('onglet ouvert depuis 2 jours -> accepté', !isTooFast(now - 2 * 24 * 3600 * 1000, now));
  check('horodatage ISO accepté', isTooFast(new Date(now - 100).toISOString(), now));

  check('compte les URL http', countUrls('voir https://a.fr et http://b.fr') === 2);
  check('compte les URL www', countUrls('www.a.fr www.b.fr') === 2);
  check('aucune URL -> 0', countUrls('bonjour') === 0);
  check('2 liens -> humain', !looksAutomated('a https://1.fr b https://2.fr'));
  check('4 liens -> encore humain (seuil haut exprès)',
    !looksAutomated('https://1.fr https://2.fr https://3.fr https://4.fr'));
  check('5 liens -> automatisé',
    looksAutomated('https://1.fr https://2.fr https://3.fr https://4.fr https://5.fr'));

  _resetGlobalRate();
  check('verdict : soumission normale acceptée',
    assessSubmission({ message: 'bonjour', now }).accept === true);

  // ── UN SIGNAL ISOLÉ N'EST PLUS UN REJET (autofill du honeypot) ────────────
  _resetGlobalRate();
  const hpOnly = assessSubmission({ website: 'x', message: 'a', now });
  check('honeypot SEUL -> ACCEPTÉ (autofill, pas un robot)', hpOnly.accept === true);
  check('honeypot SEUL -> signal tracé', hpOnly.signals.includes('HONEYPOT'));
  _resetGlobalRate();
  const fastOnly = assessSubmission({ formStartedAt: now - 10, message: 'a', now });
  check('trop rapide SEUL -> ACCEPTÉ', fastOnly.accept === true);
  check('trop rapide SEUL -> signal tracé', fastOnly.signals.includes('TOO_FAST'));

  // ── DEUX SIGNAUX QUI CONCORDENT = ROBOT ───────────────────────────────────
  _resetGlobalRate();
  const hpFast = assessSubmission({ website: 'x', formStartedAt: now - 10, message: 'a', now });
  check('honeypot + trop rapide -> REJET', hpFast.accept === false);
  check('rejet multi-signaux : les deux signaux tracés',
    hpFast.signals.includes('HONEYPOT') && hpFast.signals.includes('TOO_FAST'));
  _resetGlobalRate();
  const hpUrls = assessSubmission({ website: 'x', message: 'https://1.fr https://2.fr https://3.fr https://4.fr https://5.fr', now });
  check('honeypot + trop d’URL -> REJET', hpUrls.accept === false);

  // Un REJET multi-signaux n'entame PAS le quota global : il retourne avant de
  // consommer un jeton, pour qu'une vague de spam ne prive pas les vrais visiteurs.
  _resetGlobalRate();
  for (let i = 0; i < 40; i += 1) assessSubmission({ website: 'x', formStartedAt: now - 10, message: 'a', now });
  check('rejets multi-signaux : le quota global n’est pas consommé',
    assessSubmission({ message: 'bonjour', now }).accept === true);

  // Le débit global reste un garde INFRA : il bloque seul.
  _resetGlobalRate();
  let last = null;
  for (let i = 0; i < 40; i += 1) last = assessSubmission({ message: 'bonjour', now });
  check('débit global : la limite finit par bloquer', last.reason === 'GLOBAL_RATE');
  _resetGlobalRate();
  check('débit global : réinitialisation', assessSubmission({ message: 'a', now }).accept === true);
}

section('Anti-abus — autofill du honeypot : la demande SURVIT');
await resetAll();
{
  // Le cas exact du bug : un navigateur remplit le champ caché. Un SEUL signal.
  const r = await post({ ...VALID(), hpCheck: 'http://autofill.example' });
  check('autofill honeypot : réponse 201', r.status === 201);
  check('autofill honeypot : demande CRÉÉE (plus jamais perdue)',
    (await ContactSubmission.countDocuments()) === 1);
  const doc = await ContactSubmission.findOne({ submissionId: r.json.data.submissionId }).lean();
  check('autofill honeypot : l’identifiant correspond à une VRAIE demande', Boolean(doc));
  check('autofill honeypot : statut NON LU', doc.status === CONTACT_STATUS.NEW && doc.firstViewedAt == null);
  check('autofill honeypot : signal tracé (DEV)', doc.antiAbuseSignals.includes('HONEYPOT'));
  check('autofill honeypot : événement émis (notification tentée)',
    (await DomainEvent.countDocuments({ type: 'contact.submitted' })) === 1);
}

await resetAll();
{
  // Un signal isolé « trop rapide » : accepté aussi.
  const r = await post({ ...VALID(), formStartedAt: new Date().toISOString() });
  check('soumission rapide seule : demande créée', r.status === 201 && (await ContactSubmission.countDocuments()) === 1);

  await resetAll();
  const ok2 = await post({ ...VALID(), formStartedAt: new Date(Date.now() - 5000).toISOString() });
  check('soumission après 5 s : demande créée', ok2.status === 201 && (await ContactSubmission.countDocuments()) === 1);
}

await resetAll();
{
  // SPAM multi-signaux (honeypot + excès de liens) : rejet neutre, rien créé.
  const spam = 'https://1.fr https://2.fr https://3.fr https://4.fr https://5.fr https://6.fr';
  const r = await post({ ...VALID(), hpCheck: 'http://spam.ru', message: spam });
  check('spam multi-signaux : réponse neutre 201', r.status === 201);
  check('spam multi-signaux : AUCUNE demande', (await ContactSubmission.countDocuments()) === 0);
  check('spam multi-signaux : AUCUN e-mail', panelStub.emailSendRequests().length === 0);
}

// ═══════════════════════════════════════════════════════════════════════════
section('Persistance');
await resetAll();
{
  await post(VALID());
  const doc = await ContactSubmission.findOne().lean();
  check('submissionId : UUID', /^[0-9a-f-]{36}$/.test(doc.submissionId));
  check('statut initial NEW', doc.status === CONTACT_STATUS.NEW);
  check('source PUBLIC_WEBSITE', doc.source === 'PUBLIC_WEBSITE');
  check('submittedAt renseigné', doc.submittedAt instanceof Date);
  check('firstViewedAt vide', doc.firstViewedAt === null);
  check('resolvedAt vide', doc.resolvedAt === null);
  check('companyId rattaché', doc.companyId !== null);
  check('motif : CODE stocké, pas le libellé', doc.reason === 'NEW_PRESENCE');
  /* Les deux champs du plan de site sont persistés, et détourés. */
  check('entreprise persistée', doc.companyName === 'Atelier Dupont');
  check('activité persistée', doc.activity === 'Ébénisterie');

  // Ce qui NE DOIT PAS être collecté.
  const raw = JSON.stringify(doc);
  check('aucune IP stockée', !/\bip\b/i.test(Object.keys(doc).join(',')));
  check('aucun cookie', !raw.includes('cookie'));
  check('aucun en-tête brut', !raw.includes('user-agent'));
  check('metadataSafe : famille de navigateur seulement',
    Object.keys(doc.metadataSafe).every((k) => ['userAgentFamily', 'locale'].includes(k)));

  await resetAll();
  await api('POST', '/api/public/contact', {
    body: VALID(),
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0.6478.127 Safari/537.36' },
  });
  const withUa = await ContactSubmission.findOne().lean();
  check('User-Agent : seule la FAMILLE est stockée', withUa.metadataSafe.userAgentFamily === 'Chrome');
  check('User-Agent : la chaîne complète n’est PAS stockée',
    !JSON.stringify(withUa).includes('AppleWebKit'));
}

// ═══════════════════════════════════════════════════════════════════════════
section('Idempotence');
await resetAll();
{
  const clientId = '11111111-2222-4333-8444-555555555555';
  const body = { ...VALID(), clientSubmissionId: clientId };

  const r1 = await post(body);
  const r2 = await post(body);
  check('rejeu : même submissionId', r1.json.data.submissionId === r2.json.data.submissionId);
  check('rejeu : une seule demande', (await ContactSubmission.countDocuments()) === 1);
  check('rejeu : un seul événement', (await DomainEvent.countDocuments({ type: 'contact.submitted' })) === 1);
  /**
   * L'ENVOI S'OBSERVE À LA FRONTIÈRE DU PANEL (L8.4C).
   *
   * Le projet n'émet plus d'appel Brevo : il demande la capacité. Ce que le
   * test prouve ne bouge pas — un rejeu de la même soumission ne déclenche pas
   * un second message — mais il le prouve là où l'envoi a réellement lieu.
   */
  const envois = panelStub.emailSendRequests().length;
  check('rejeu : aucun second e-mail', envois === 1);
  check('rejeu : et AUCUN appel Brevo local, jamais',
    brevoCalls.filter((c) => c.path === '/smtp/email').length === 0);

  // Concurrence : deux clics simultanés.
  await resetAll();
  const clientId2 = '99999999-2222-4333-8444-555555555555';
  const both = await Promise.all([
    post({ ...VALID(), clientSubmissionId: clientId2 }),
    post({ ...VALID(), clientSubmissionId: clientId2 }),
  ]);
  check('concurrence : les deux répondent 201', both.every((r) => r.status === 201));
  check('concurrence : une seule demande en base', (await ContactSubmission.countDocuments()) === 1);
  check('concurrence : même submissionId renvoyé',
    both[0].json.data.submissionId === both[1].json.data.submissionId);
  check('concurrence : un seul événement',
    (await DomainEvent.countDocuments({ type: 'contact.submitted' })) === 1);

  // Sans clé, chaque envoi est une demande distincte (c'est le comportement voulu).
  await resetAll();
  await post(VALID());
  await post(VALID());
  check('sans clé client : deux demandes distinctes', (await ContactSubmission.countDocuments()) === 2);
}

// ═══════════════════════════════════════════════════════════════════════════
section('Événement contact.submitted');
await resetAll();
{
  await post(VALID());
  const event = await DomainEvent.findOne({ type: 'contact.submitted' }).lean();
  const doc = await ContactSubmission.findOne().lean();

  check('événement émis', Boolean(event));
  check('entityType = ContactSubmission', event.entityType === 'ContactSubmission');
  check('entityId = submissionId', event.entityId === doc.submissionId);
  check('clé d’idempotence basée sur le submissionId',
    event.idempotencyKey === `contact-submitted:${doc.submissionId}`);
  check('clé d’idempotence SANS donnée personnelle',
    !event.idempotencyKey.includes('jean') && !event.idempotencyKey.includes('@'));

  // Confidentialité du payload — le point central.
  const payload = event.payloadSafe;
  check('payload : e-mail MASQUÉ', payload.contactEmailMasked === 'j***@exemple.fr');
  check('payload : adresse complète ABSENTE', !JSON.stringify(payload).includes('jean.dupont@exemple.fr'));
  check('payload : MESSAGE ABSENT', !JSON.stringify(payload).includes('devis pour une révision'));
  check('payload : aucune clé « message »', !('message' in payload));
  check('payload : aucun téléphone', !JSON.stringify(payload).includes('0612345678'));
  check('payload : submissionId présent', payload.submissionId === doc.submissionId);
  check('payload : contactName présent', payload.contactName === 'Jean Dupont');
  check('payload : reason présent', payload.reason === 'NEW_PRESENCE');
  check('payload : source présent', payload.source === 'PUBLIC_WEBSITE');
  check('payload : submittedAt ISO', typeof payload.submittedAt === 'string');
}

await resetAll();
{
  // L'INVARIANT CENTRAL : la demande survit à un échec d'émission.
  const events = await import('../services/events/domainEvent.service.js');
  const { DomainEvent: DE } = await import('../models/DomainEvent.model.js');
  const originalCreate = DE.create;
  DE.create = async () => { throw new Error('journal indisponible'); };

  const r = await post(VALID());
  DE.create = originalCreate;

  check('émission en échec : le visiteur reçoit quand même 201', r.status === 201);
  check('émission en échec : la demande EST enregistrée', (await ContactSubmission.countDocuments()) === 1);
  check('émission en échec : aucun événement (fenêtre de perte assumée)',
    (await DomainEvent.countDocuments({ type: 'contact.submitted' })) === 0);
  check('émission en échec : la demande reste consultable',
    (await ContactSubmission.findOne({ submissionId: r.json.data.submissionId })) !== null);
  void events;
}

// ═══════════════════════════════════════════════════════════════════════════
section('Notification e-mail — action activée');
await resetAll();
await makeEmailReady();
{
  const { actionsForEvent } = await import('../utils/domainEventActionRegistry.js');
  const actions = actionsForEvent('contact.submitted');
  check('action déclarée', actions.length === 1);
  check('action ACTIVÉE', actions[0].enabled === true);
  check('action : template CONTACT_ADMIN_NOTIFICATION', actions[0].templateId === 'CONTACT_ADMIN_NOTIFICATION');
  check('action : destinataires CONTACT_NOTIFICATION_RECIPIENTS',
    actions[0].recipientResolver === 'CONTACT_NOTIFICATION_RECIPIENTS');
  check('action : reply-to = l’e-mail du visiteur', actions[0].replyToVariable === 'contact.email');
}

await resetAll();
{
  // Aucun destinataire métier configuré → FALLBACK sur les comptes ADMIN
  // (admin@mail.com, seedé) — JAMAIS les comptes DEV, JAMAIS l'adresse support
  // (c'est un expéditeur : s'auto-notifier masquait l'absence de destinataire).
  await Company.updateOne({}, { $set: { contactNotificationRecipients: [] } });
  await post(VALID());
  const execs = await EventActionExecution.find({ actionId: 'notify-admins-contact-submitted' }).lean();
  check('fallback ADMIN : une exécution', execs.length === 1);
  check('fallback ADMIN : exécution réussie', execs[0].status === EXECUTION_STATUS.SUCCEEDED);

  /**
   * ══ CE QUI S'OBSERVE ICI A CHANGÉ DE NATURE (L8.4C) ══════════════════════
   *
   * Ces assertions lisaient le HTML rendu. Ce HTML n'est plus produit par le
   * projet : il est rendu par le Panel, à partir des VARIABLES MÉTIER que le
   * projet transmet. Continuer à l'inspecter ici reviendrait à éprouver un
   * gabarit qui ne nous appartient plus.
   *
   * Ce qui appartient encore au projet — et qui est le vrai sujet de cette
   * suite — c'est la RÉSOLUTION : quel destinataire, quel modèle, quelles
   * données. Chaque assertion garde donc son intention, portée sur la donnée
   * plutôt que sur son rendu ; le rendu, lui, est éprouvé côté Panel.
   */
  const envoyes = panelStub.emailSendRequests();
  const call = envoyes.at(-1);
  check('fallback ADMIN : destinataire = compte ADMIN', call.recipient === 'admin@mail.com');
  check('fallback ADMIN : le compte DEV est EXCLU',
    !envoyes.some((c) => c.recipient === 'dev@mail.com'));
  check('fallback ADMIN : l’adresse support n’est PAS destinataire',
    call.recipient !== 'support@exemple.fr');
  check('e-mail : modèle demandé = CONTACT_ADMIN_NOTIFICATION',
    call.templateRef === 'CONTACT_ADMIN_NOTIFICATION');
  check('e-mail : le nom du contact est transmis au modèle',
    call.variables['contact.name'] === 'Jean Dupont');
  check('e-mail : le message est transmis intégralement',
    String(call.variables['contact.message']).includes('à la hauteur de notre atelier'));
  /**
   * L'ENTREPRISE ET L'ACTIVITÉ SONT TRANSMISES — depuis le 27/08/2026.
   *
   * Ces deux assertions ont vécu retournées. Le contrat de
   * « CONTACT_ADMIN_NOTIFICATION » ne déclarait pas ces clés, et le Panel
   * REFUSE l'envoi entier dès qu'une clé inconnue figure dans l'entrée
   * (CAPABILITY_INPUT_INVALID — UNKNOWN_VARIABLE) : les servir faisait partir
   * chaque notification en DEAD_LETTER, demande enregistrée et personne de
   * prévenu. Elles affirmaient donc l'ABSENCE, en attendant la plateforme.
   *
   * Le Panel déployé au commit `d59f792` déclare les onze variables. On
   * affirme de nouveau la présence — et l'ordre reste la leçon : le contrat
   * se déploie avant l'émetteur, jamais l'inverse.
   */
  check('e-mail : l’entreprise du contact est transmise',
    call.variables['contact.company'] === 'Atelier Dupont');
  check('e-mail : son activité aussi',
    call.variables['contact.activity'] === 'Ébénisterie');
  /**
   * …ET UNE ACTIVITÉ VIDE N'EST PAS UNE ACTIVITÉ VIDE : la clé disparaît.
   *
   * `activity` vaut `''` par défaut au modèle, et c'est le cas de la plupart
   * des demandes réelles. La servir vide laisserait au gabarit une ligne
   * « Activité : » suivie de rien, que le lecteur prendrait pour un bug
   * d'affichage. Une variable facultative absente n'est ni vide ni nulle :
   * elle est absente, et le `{{#if}}` du gabarit efface la ligne entière.
   */
  {
    const { resolveContactAdminNotification } =
      await import('../services/email/contactVariableResolver.js');
    const doc = await ContactSubmission.findOne();
    doc.activity = '';
    await doc.save();
    const vides = await resolveContactAdminNotification({
      event: { entityId: doc.submissionId },
    });
    check('e-mail : une activité vide n’est PAS servie',
      !('contact.activity' in vides));
    check('e-mail : …mais l’entreprise l’est toujours',
      vides['contact.company'] === 'Atelier Dupont');
    doc.activity = 'Ébénisterie';
    await doc.save();
  }
  check('e-mail : motif traduit en LIBELLÉ (pas le code)',
    call.variables['contact.reason'] === 'Créer une présence digitale'
    && call.variables['contact.reason'] !== 'NEW_PRESENCE');
  check('e-mail : lien Manager construit depuis la config réseau',
    String(call.variables['manager.contactSubmissionUrl'])
      .startsWith('https://manager.exemple.fr/demandes-contact/'));
  // REPLY-TO = le visiteur : répondre à la notification écrit au demandeur.
  check('reply-to : adresse du visiteur', call.replyTo === 'jean.dupont@exemple.fr');
  check('reply-to ≠ destinataire de la notification', call.replyTo !== call.recipient);
  /**
   * La DATE part en instant exact, pas en texte déjà mis en forme : le format
   * lisible dépend de la langue du modèle, donc du Panel. Le projet doit
   * transmettre une donnée non ambiguë — c'est cela qui est vérifié.
   */
  check('e-mail : l’instant est transmis sans mise en forme prématurée',
    !Number.isNaN(Date.parse(String(call.variables['contact.submittedAt']))));
  check('e-mail : AUCUN appel Brevo local n’a eu lieu',
    !brevoCalls.some((c) => c.path === '/smtp/email'));
}

await resetAll();
{
  // Téléphone absent -> valeur sobre, pas un blanc.
  await post({ ...VALID(), phone: undefined });
  // La valeur de repli est une décision MÉTIER du projet (résolveur de
  // variables), pas une affaire de rendu : elle s'observe donc toujours ici.
  const call = panelStub.emailSendRequests().at(-1);
  check('téléphone absent : « Non renseigné » transmis au modèle',
    call.variables['contact.phone'] === 'Non renseigné');
}

await resetAll();
{
  // XSS : le message d'un visiteur est échappé par le renderer.
  await post({ ...VALID(), message: '<script>alert(1)</script> et <img src=x onerror=alert(1)>' });
  /**
   * ══ L'ÉCHAPPEMENT A CHANGÉ DE RESPONSABLE, PAS D'EXIGENCE ════════════════
   *
   * C'est le RENDU qui échappe, et le rendu est au Panel : c'est là que
   * l'assertion « &lt;script&gt; » a désormais du sens. Ici, l'exigence est
   * l'autre moitié du contrat, et elle est tout aussi sévère — le projet
   * transmet une DONNÉE, telle que le visiteur l'a écrite, sans jamais la
   * pré-rendre ni fabriquer de HTML. Un projet qui enverrait du HTML
   * priverait le Panel de toute possibilité d'échapper quoi que ce soit.
   */
  const call = panelStub.emailSendRequests().at(-1);
  const msg = String(call.variables['contact.message']);
  check('XSS visiteur : la donnée brute est transmise telle quelle',
    msg.includes('<script>alert(1)</script>'));
  check('XSS visiteur : le projet ne fabrique AUCUN HTML',
    !Object.keys(call.variables).some((k) => /html|content|body/i.test(k)));
  check('XSS visiteur : rien n’est pré-échappé (l’échappement appartient au rendu)',
    !msg.includes('&lt;script&gt;'));

  await resetAll();
  // Injection de gabarit : une valeur contenant {{...}} n'est pas réinterprétée.
  await post({ ...VALID(), message: '{{contact.email}} {{manager.contactSubmissionUrl}}' });
  const call2 = panelStub.emailSendRequests().at(-1);
  check('injection de gabarit : le placeholder reste une VALEUR, jamais un gabarit',
    String(call2.variables['contact.message']).includes('{{contact.email}}'));
}

await resetAll();
{
  // PLUSIEURS destinataires métier : une exécution (donc un e-mail INDIVIDUEL)
  // par adresse. Les destinataires ne se voient jamais entre eux — confidentialité
  // par construction (§12).
  await Company.updateOne({}, {
    $set: { contactNotificationRecipients: ['contact@commerce.fr', 'gerant@commerce.fr', 'accueil@commerce.fr'] },
  });

  await post(VALID());
  const execs = await EventActionExecution.find({ actionId: 'notify-admins-contact-submitted' }).lean();
  check('3 destinataires : 3 exécutions', execs.length === 3);
  check('3 destinataires : toutes réussies', execs.every((x) => x.status === EXECUTION_STATUS.SUCCEEDED));
  check('3 destinataires : clés distinctes', new Set(execs.map((x) => x.recipientKey)).size === 3);
  const sends = panelStub.emailSendRequests();
  check('3 destinataires : 3 envois individuels', sends.length === 3);
  const recipients = sends.map((c) => c.recipient);
  check('3 destinataires : chacun exactement une fois', new Set(recipients).size === 3);
  // Un envoi = UNE adresse : la confidentialité tient par construction, la
  // capacité ne sait même pas exprimer une liste de destinataires.
  check('3 destinataires : un seul destinataire par e-mail (aucune adresse exposée à une autre)',
    sends.every((c) => typeof c.recipient === 'string' && c.recipient.includes('@')));
  check('3 destinataires : ceux configurés, pas les comptes ADMIN',
    new Set(recipients).size === 3 && !recipients.includes('admin@mail.com'));
}

await resetAll();
{
  // AUCUN destinataire (liste vide ET aucun compte ADMIN — les ADMIN passent
  // temporairement DEV, ce qui prouve au passage que les DEV sont exclus) :
  // la demande SURVIT, la notification échoue proprement (DEAD_LETTER).
  await Company.updateOne({}, { $set: { contactNotificationRecipients: [] } });
  await User.updateMany({ role: 'ADMIN' }, { $set: { role: 'DEV' } });
  const r = await post(VALID());
  check('aucun destinataire : demande enregistrée', r.status === 201 && (await ContactSubmission.countDocuments()) === 1);
  const execs = await EventActionExecution.find({ actionId: 'notify-admins-contact-submitted' }).lean();
  check('aucun destinataire : exécution DEAD_LETTER', execs[0]?.status === EXECUTION_STATUS.DEAD_LETTER);
  check('aucun destinataire : code EMAIL_RECIPIENTS_NOT_FOUND',
    execs[0]?.lastErrorSafe?.code === 'EMAIL_RECIPIENTS_NOT_FOUND');
  check('aucun destinataire : AUCUN e-mail parti', panelStub.emailSendRequests().length === 0);
  await User.updateOne({ email: 'admin@mail.com' }, { $set: { role: 'ADMIN' } });
  await makeEmailReady();
}

await resetAll();
{
  // Adresses dupliquées : la déduplication est insensible à la casse.
  await User.deleteMany({ email: { $in: ['admin2@exemple.fr', 'admin3@exemple.fr'] } });
  const { normalizeRecipients } = await import('../services/email/emailRecipientResolvers.js');
  const dedup = normalizeRecipients([
    { email: 'A@Exemple.FR' }, { email: 'a@exemple.fr' }, { email: ' a@exemple.fr ' },
  ]);
  check('déduplication : casse et espaces -> 1 destinataire', dedup.length === 1);
  check('déduplication : adresses invalides écartées',
    normalizeRecipients([{ email: 'ok@x.fr' }, { email: 'nope' }, { email: '' }]).length === 1);
}

// ═══════════════════════════════════════════════════════════════════════════
section('Destinataires de notification — endpoint métier');
await resetAll();
{
  const adminTok = await login('admin@mail.com', '123admin');
  const devTok = await login('dev@mail.com', '123dev');

  check('GET sans token -> 401', (await api('GET', '/api/company/contact-notification-recipients')).status === 401);

  // Enregistrement + normalisation (trim, minuscules) + déduplication.
  const put = await api('PUT', '/api/company/contact-notification-recipients', {
    token: adminTok, body: { recipients: ['  Contact@Commerce.FR ', 'contact@commerce.fr', 'gerant@commerce.fr'] },
  });
  check('PUT ADMIN -> 200', put.status === 200);
  check('PUT : normalisé + dédupliqué', JSON.stringify(put.json.data.recipients) === JSON.stringify(['contact@commerce.fr', 'gerant@commerce.fr']));

  const get = await api('GET', '/api/company/contact-notification-recipients', { token: devTok });
  check('GET (DEV) -> 200 + liste', get.status === 200 && get.json.data.recipients.length === 2);

  // DEV est un sur-ensemble d'ADMIN (cf. authorize) : il peut éditer aussi.
  check('PUT DEV -> 200 (DEV superset)',
    (await api('PUT', '/api/company/contact-notification-recipients', { token: devTok, body: { recipients: [] } })).status === 200);
  // Sans token, en revanche, aucun accès en écriture.
  check('PUT sans token -> 401',
    (await api('PUT', '/api/company/contact-notification-recipients', { body: { recipients: [] } })).status === 401);
  // Adresse invalide rejetée.
  check('PUT : adresse invalide -> 400',
    (await api('PUT', '/api/company/contact-notification-recipients', { token: adminTok, body: { recipients: ['pas-un-email'] } })).status === 400);
  // Plus de 5 adresses rejeté.
  check('PUT : > 5 adresses -> 400',
    (await api('PUT', '/api/company/contact-notification-recipients', {
      token: adminTok, body: { recipients: ['a@x.fr', 'b@x.fr', 'c@x.fr', 'd@x.fr', 'e@x.fr', 'f@x.fr'] },
    })).status === 400);
  // Champ parasite rejeté (strict).
  check('PUT : champ parasite -> 400',
    (await api('PUT', '/api/company/contact-notification-recipients', { token: adminTok, body: { recipients: [], extra: 1 } })).status === 400);
  // Liste vide acceptée (= fallback ADMIN assumé) + résolution EFFECTIVE exposée.
  const emptied = await api('PUT', '/api/company/contact-notification-recipients', { token: adminTok, body: { recipients: [] } });
  check('PUT : liste vide acceptée', emptied.status === 200);
  check('PUT : fallback ADMIN annoncé (source)', emptied.json.data.effective?.source === 'ADMIN_FALLBACK');
  check('PUT : fallback ADMIN annoncé (adresses)',
    JSON.stringify(emptied.json.data.effective?.emails) === JSON.stringify(['admin@mail.com']));
  const cfg = await api('PUT', '/api/company/contact-notification-recipients', { token: adminTok, body: { recipients: ['contact@commerce.fr'] } });
  check('PUT : liste configurée -> source CONFIGURED',
    cfg.json.data.effective?.source === 'CONFIGURED' && JSON.stringify(cfg.json.data.effective?.emails) === JSON.stringify(['contact@commerce.fr']));
  await api('PUT', '/api/company/contact-notification-recipients', { token: adminTok, body: { recipients: [] } });
}

await resetAll();
{
  // AUCUN destinataire (liste vide ET aucun compte ADMIN valide) : ÉCHEC
  // explicite, jamais un « tout va bien ».
  await User.updateMany({ role: 'ADMIN' }, { $set: { role: 'DEV' } });

  const r = await post(VALID());
  check('aucun destinataire : la demande est QUAND MÊME enregistrée', r.status === 201);
  check('aucun destinataire : demande en base', (await ContactSubmission.countDocuments()) === 1);

  const execs = await EventActionExecution.find({ actionId: 'notify-admins-contact-submitted' }).lean();
  check('aucun destinataire : une exécution tracée (pas un trou)', execs.length === 1);
  check('aucun destinataire : DEAD_LETTER (pas SKIPPED)', execs[0].status === EXECUTION_STATUS.DEAD_LETTER);
  check('aucun destinataire : code EMAIL_RECIPIENTS_NOT_FOUND',
    execs[0].lastErrorSafe.code === 'EMAIL_RECIPIENTS_NOT_FOUND');
  check('aucun destinataire : NON retryable',
    execs[0].lastErrorSafe.retryable === false);
  check('aucun destinataire : une seule tentative', execs[0].attempts === 1);
  check('aucun destinataire : AUCUN appel Brevo', !brevoCalls.some((c) => c.path === '/smtp/email'));

  const event = await DomainEvent.findOne({ type: 'contact.submitted' }).lean();
  check('aucun destinataire : événement en ÉCHEC (visible)', event.dispatchStatus === EVENT_DISPATCH_STATUS.FAILED);
  check('aucun destinataire : l’événement ne prétend PAS avoir dispatché',
    event.dispatchStatus !== EVENT_DISPATCH_STATUS.DISPATCHED);

  await User.updateOne({ email: 'admin@mail.com' }, { $set: { role: 'ADMIN' } });
  await makeEmailReady();
}

await resetAll();
{
  // Destinataire CONFIGURÉ mais expéditeur absent : la résolution du destinataire
  // réussit, puis la readiness d'envoi bloque sur SENDER_NOT_CONFIGURED. La
  // demande survit dans tous les cas.
  await Company.updateOne({}, { $set: { contactNotificationRecipients: ['contact@commerce.fr'] } });
  /**
   * ══ L'EXPÉDITEUR N'EST PLUS UNE DONNÉE LOCALE (L8.4C) ═════════════════════
   *
   * Vider `modes.TEST.sender.email` ne bloque plus rien : l'identité
   * d'expédition appartient au Panel, qui la résout au moment d'exécuter la
   * capacité. Un expéditeur manquant se manifeste donc là où il vit désormais —
   * en REFUS de capacité, non rejouable, puisque rien ne sera envoyé tant que
   * l'identité n'est pas déclarée.
   *
   * L'invariant éprouvé, lui, n'a pas bougé d'un pouce : la demande du visiteur
   * SURVIT, et la notification échoue franchement plutôt que de faire semblant.
   */
  panelStub.forceNextCapability(
    refusCapacite('CAPABILITY_SENDER_NOT_CONFIGURED', 'aucune identité d’expédition déclarée'),
  );
  const r = await post(VALID());
  check('expéditeur absent : demande enregistrée quand même', r.status === 201);
  check('expéditeur absent : réponse identique (rien ne fuit)',
    Object.keys(r.json.data).length === 1);
  check('expéditeur absent : AUCUN appel Brevo',
    !brevoCalls.some((c) => c.path === '/smtp/email'));

  const execs = await EventActionExecution.find({ actionId: 'notify-admins-contact-submitted' }).lean();
  check('expéditeur absent : exécution DEAD_LETTER', execs[0].status === EXECUTION_STATUS.DEAD_LETTER);
  check('expéditeur absent : le code du refus nomme l’expéditeur',
    /SENDER_NOT_CONFIGURED/.test(execs[0].lastErrorSafe?.code || ''));
  await makeEmailReady();
}

await resetAll();
{
  /**
   * Refus REJOUABLE : rien n'est parti, donc réessayer est sûr. C'est la
   * distinction qui compte — et elle se joue maintenant sur le code de
   * capacité, plus sur un statut HTTP que le projet ne voit plus.
   */
  panelStub.forceNextCapability(
    refusCapacite('CAPABILITY_PROVIDER_UNAVAILABLE', 'fournisseur momentanément indisponible'),
  );
  const r = await post(VALID());
  check('Brevo 429 : demande enregistrée', r.status === 201);
  const execs = await EventActionExecution.find({ actionId: 'notify-admins-contact-submitted' }).lean();
  check('Brevo 429 : exécution FAILED (retry prévu)', execs[0].status === EXECUTION_STATUS.FAILED);
  check('Brevo 429 : retryable', execs[0].lastErrorSafe.retryable === true);
  const event = await DomainEvent.findOne({ type: 'contact.submitted' }).lean();
  check('Brevo 429 : événement DISPATCHING (ne conclut pas)',
    event.dispatchStatus === EVENT_DISPATCH_STATUS.DISPATCHING);
}

await resetAll();
{
  // URL Manager absente : le resolver échoue là où la cause est nommable.
  await SystemConfiguration.updateOne({}, { $set: { 'network.managerUrl': '' } });
  const r = await post(VALID());
  check('URL Manager absente : demande enregistrée', r.status === 201);
  const execs = await EventActionExecution.find({ actionId: 'notify-admins-contact-submitted' }).lean();
  check('URL Manager absente : DEAD_LETTER', execs[0].status === EXECUTION_STATUS.DEAD_LETTER);
  check('URL Manager absente : message explicite',
    /URL du Manager/i.test(execs[0].lastErrorSafe.message));
  await makeEmailReady();
}

// ═══════════════════════════════════════════════════════════════════════════
section('Manager — liste, détail, gestion');
await resetAll();
await makeEmailReady();
let adminToken;
let devToken;
{
  adminToken = await login('admin@mail.com', '123admin');
  devToken = await login('dev@mail.com', '123dev');

  for (const [i, reason] of ['NEW_PRESENCE', 'REDESIGN', 'EVOLUTION', 'OTHER'].entries()) {
    await post({ ...VALID(), name: `Contact ${i}`, email: `c${i}@exemple.fr`, reason });
  }

  const list = await api('GET', '/api/admin/contact-submissions', { token: adminToken });
  check('liste : 200 en ADMIN', list.status === 200);
  check('liste : 4 demandes (non résolues par défaut)', list.json.data.items.length === 4);
  check('liste : toutes NON LUES à l\'arrivée', list.json.data.items.every((i) => i.state === 'UNREAD' && i.readAt === null));
  check('liste : compteur de non-lues', list.json.data.unreadCount === 4);
  check('liste : PAS de statut de workflow exposé', !('status' in list.json.data.items[0]) && !('assignedToUserId' in list.json.data.items[0]));
  check('liste : le message COMPLET n’est pas servi', !('message' in list.json.data.items[0]));
  check('liste : un extrait suffit', typeof list.json.data.items[0].messagePreview === 'string');
  check('liste : état de notification joint', list.json.data.items[0].notification.status === 'SENT');
  check('liste : DEV aussi autorisé',
    (await api('GET', '/api/admin/contact-submissions', { token: devToken })).status === 200);

  // Endpoint compteur dédié (badge sidebar) — léger, sans charger la liste.
  const uc = await api('GET', '/api/admin/contact-submissions/unread-count', { token: adminToken });
  check('unread-count : 200 + count = 4', uc.status === 200 && uc.json.data.count === 4);
}

{
  // Filtres.
  const byReason = await api('GET', '/api/admin/contact-submissions?reason=REDESIGN', { token: adminToken });
  check('filtre motif : 1 résultat', byReason.json.data.items.length === 1);
  check('filtre motif : le bon', byReason.json.data.items[0].reason === 'REDESIGN');

  const resolvedList = await api('GET', '/api/admin/contact-submissions?resolved=true', { token: adminToken });
  check('filtre resolved=true : aucun résolu pour l\'instant', resolvedList.json.data.items.length === 0);
  const unreadList = await api('GET', '/api/admin/contact-submissions?unread=true', { token: adminToken });
  check('filtre unread=true : les 4 non lues', unreadList.json.data.items.length === 4);

  const search = await api('GET', '/api/admin/contact-submissions?search=Contact%202', { token: adminToken });
  check('recherche par nom', search.json.data.items.length === 1);
  const searchEmail = await api('GET', '/api/admin/contact-submissions?search=c3@exemple.fr', { token: adminToken });
  check('recherche par e-mail', searchEmail.json.data.items.length === 1);
  const searchRx = await api('GET', '/api/admin/contact-submissions?search=.*', { token: adminToken });
  check('recherche « .* » : échappée, ne ramène pas tout', searchRx.json.data.items.length === 0);
  const searchParen = await api('GET', '/api/admin/contact-submissions?search=a(', { token: adminToken });
  check('recherche « a( » : ne plante pas', searchParen.status === 200);

  check('filtre inconnu -> 400 (strict)',
    (await api('GET', '/api/admin/contact-submissions?nope=1', { token: adminToken })).status === 400);
  check('ancien filtre status rejeté (strict)',
    (await api('GET', '/api/admin/contact-submissions?status=RESOLVED', { token: adminToken })).status === 400);
  check('limit > 100 -> 400',
    (await api('GET', '/api/admin/contact-submissions?limit=500', { token: adminToken })).status === 400);
}

{
  // Pagination par curseur COMPOSITE (tri non-lues d'abord puis date desc).
  const p1 = await api('GET', '/api/admin/contact-submissions?limit=2', { token: adminToken });
  check('pagination : 2 éléments', p1.json.data.items.length === 2);
  check('pagination : hasMore', p1.json.data.hasMore === true);
  check('pagination : curseur fourni', typeof p1.json.data.nextCursor === 'string');

  const p2 = await api('GET', `/api/admin/contact-submissions?limit=2&cursor=${encodeURIComponent(p1.json.data.nextCursor)}`, { token: adminToken });
  check('pagination : page 2 différente',
    p2.json.data.items[0].submissionId !== p1.json.data.items[0].submissionId);
  check('pagination : fin atteinte', p2.json.data.hasMore === false);
  const ids = [...p1.json.data.items, ...p2.json.data.items].map((i) => i.submissionId);
  check('pagination : aucun doublon entre pages', new Set(ids).size === 4);
}

let target;
{
  // Détail = LECTURE automatique + compteur décrémenté.
  const list = await api('GET', '/api/admin/contact-submissions', { token: adminToken });
  target = list.json.data.items[0].submissionId;
  check('avant ouverture : non lue', list.json.data.items[0].readAt === null);

  const detail = await api('GET', `/api/admin/contact-submissions/${target}`, { token: adminToken });
  check('détail : 200', detail.status === 200);
  check('détail : message COMPLET', detail.json.data.message.length > 10);
  check('détail : PAS de transitions de workflow', !('allowedTransitions' in detail.json.data));
  check('détail : notification détaillée', detail.json.data.notification.status === 'SENT');
  check('détail : destinataire masqué', detail.json.data.notification.recipients[0].recipientEmailMasked.includes('***'));
  check('détail : aucun DELIVERED (aucun webhook)', detail.json.data.notification.recipients.every((r) => r.deliveryStatus !== 'DELIVERED'));

  const after = await api('GET', `/api/admin/contact-submissions/${target}`, { token: adminToken });
  check('après ouverture : lue (readAt posé)', after.json.data.readAt !== null && after.json.data.state === 'READ');
  const first = after.json.data.readAt;
  const again = await api('GET', `/api/admin/contact-submissions/${target}`, { token: adminToken });
  check('readAt : posé UNE fois, jamais réécrit (idempotent)', again.json.data.readAt === first);
  check('compteur non-lues décrémenté', (await api('GET', '/api/admin/contact-submissions/unread-count', { token: adminToken })).json.data.count === 3);

  check('détail inconnu -> 404',
    (await api('GET', '/api/admin/contact-submissions/inexistant', { token: adminToken })).status === 404);
}

{
  // Cycle de vie : read / resolve / reopen — idempotents, actions dédiées.
  const other = (await api('GET', '/api/admin/contact-submissions?unread=true', { token: adminToken })).json.data.items[0].submissionId;
  const read1 = await api('PATCH', `/api/admin/contact-submissions/${other}/read`, { token: adminToken });
  check('read : 200 + état READ', read1.status === 200 && read1.json.data.state === 'READ' && read1.json.data.readAt !== null);
  const read2 = await api('PATCH', `/api/admin/contact-submissions/${other}/read`, { token: adminToken });
  check('read : idempotent (readAt inchangé)', read2.json.data.readAt === read1.json.data.readAt);

  const resolved = await api('PATCH', `/api/admin/contact-submissions/${target}/resolve`, { token: adminToken });
  check('resolve : 200 + état RESOLVED + resolvedAt', resolved.status === 200 && resolved.json.data.state === 'RESOLVED' && resolved.json.data.resolvedAt !== null);
  const resolved2 = await api('PATCH', `/api/admin/contact-submissions/${target}/resolve`, { token: adminToken });
  check('resolve : idempotent', resolved2.json.data.resolvedAt === resolved.json.data.resolvedAt);

  const mainList = await api('GET', '/api/admin/contact-submissions', { token: adminToken });
  check('résolue : RETIRÉE de la liste principale', !mainList.json.data.items.some((i) => i.submissionId === target));
  const resolvedTab = await api('GET', '/api/admin/contact-submissions?resolved=true', { token: adminToken });
  check('résolue : consultable dans « Résolues »', resolvedTab.json.data.items.some((i) => i.submissionId === target));

  const reopened = await api('PATCH', `/api/admin/contact-submissions/${target}/reopen`, { token: adminToken });
  check('reopen : 200 + resolvedAt effacé', reopened.status === 200 && reopened.json.data.resolvedAt === null);
  const backMain = await api('GET', '/api/admin/contact-submissions', { token: adminToken });
  check('rouverte : de retour dans la liste principale', backMain.json.data.items.some((i) => i.submissionId === target));

  // Aucune route d'attribution ni de statut arbitraire (contrat simplifié).
  check('PATCH /status supprimé -> 404', (await api('PATCH', `/api/admin/contact-submissions/${target}/status`, { token: adminToken, body: { status: 'RESOLVED' } })).status === 404);
  check('PATCH /assignment supprimé -> 404', (await api('PATCH', `/api/admin/contact-submissions/${target}/assignment`, { token: adminToken, body: { userId: null } })).status === 404);
}

// ═══════════════════════════════════════════════════════════════════════════
section('Permissions');
{
  check('public : POST sans auth -> 201', (await post(VALID())).status === 201);
  check('public : AUCUNE lecture publique',
    (await api('GET', '/api/public/contact')).status === 404);

  check('anonyme : liste -> 401', (await api('GET', '/api/admin/contact-submissions')).status === 401);
  check('anonyme : détail -> 401', (await api('GET', `/api/admin/contact-submissions/${target}`)).status === 401);
  check('anonyme : patch statut -> 401',
    (await api('PATCH', `/api/admin/contact-submissions/${target}/status`, { body: { status: 'RESOLVED' } })).status === 401);

  check('ADMIN : liste autorisée',
    (await api('GET', '/api/admin/contact-submissions', { token: adminToken })).status === 200);
  check('DEV : liste autorisée',
    (await api('GET', '/api/admin/contact-submissions', { token: devToken })).status === 200);
  check('DEV : détail autorisé',
    (await api('GET', `/api/admin/contact-submissions/${target}`, { token: devToken })).status === 200);

  // Aucune création ni suppression depuis le back-office.
  check('aucune route de création (POST liste)',
    (await api('POST', '/api/admin/contact-submissions', { token: adminToken, body: {} })).status === 404);
  check('aucune route de suppression',
    [404, 405].includes((await api('DELETE', `/api/admin/contact-submissions/${target}`, { token: adminToken })).status));
}

// ═══════════════════════════════════════════════════════════════════════════
// RECETTE : persistance indépendante de Brevo + observabilité DEV.
// Reproduit le scénario réel (« succès vitrine mais rien en base ») et prouve
// qu'il est désormais OBSERVABLE, et que sans expéditeur la demande existe.
// ═══════════════════════════════════════════════════════════════════════════
const { _resetContactDiagnostics } = await import('../services/contact/contactDiagnostics.js');
await User.create({ email: 'devrecette@exemple.fr', password: 'devpass1', role: 'DEV', name: 'Dev Recette' });
const devRecetteTok = await login('devrecette@exemple.fr', 'devpass1');
const CID = '11111111-1111-4111-8111-111111111111';

section('Diagnostics DEV — décision anti-abus observable');
await resetAll();
_resetContactDiagnostics();
{
  // Autofill du honeypot (UN signal) : ACCEPTÉE, tracée ACCEPTED avec le signal.
  const auto = await post({ ...VALID(), hpCheck: 'http://autofill.example' });
  check('autofill : réponse 201', auto.status === 201 && !!auto.json?.data?.submissionId);
  check('autofill : demande CRÉÉE (jamais perdue)', (await ContactSubmission.countDocuments()) === 1);
  const dAuto = await api('GET', '/api/dev/contact-diagnostics', { token: devRecetteTok });
  check('diagnostic DEV : autofill = ACCEPTED, signal HONEYPOT tracé',
    dAuto.json?.data?.decisions?.[0]?.decision === 'ACCEPTED'
    && (dAuto.json.data.decisions[0].reason || '').includes('HONEYPOT'));

  // SPAM multi-signaux : réponse SUCCÈS neutre, MAIS rien créé — et OBSERVABLE.
  await resetAll();
  _resetContactDiagnostics();
  const spam = 'https://1.fr https://2.fr https://3.fr https://4.fr https://5.fr https://6.fr';
  const rej = await post({ ...VALID(), hpCheck: 'http://spam.ru', message: spam });
  check('spam multi-signaux : réponse succès neutre (201)', rej.status === 201 && !!rej.json?.data?.submissionId);
  check('spam multi-signaux : AUCUNE demande créée', (await ContactSubmission.countDocuments()) === 0);
  const d1 = await api('GET', '/api/dev/contact-diagnostics', { token: devRecetteTok });
  check('diagnostic DEV : dernier = REJECTED_AS_SPAM',
    d1.json?.data?.decisions?.[0]?.decision === 'REJECTED_AS_SPAM');
  check('diagnostic DEV : e-mail masqué', /\*\*\*@/.test(d1.json.data.decisions[0].emailMasked || ''));
  check('diagnostic DEV : jamais le message complet', !JSON.stringify(d1.json.data).includes(VALID().message));
  check('diagnostic DEV : endpoint DEV-only', (await api('GET', '/api/dev/contact-diagnostics')).status === 401);

  // Acceptée : diagnostic ACCEPTED + demande VISIBLE dans le Manager.
  const ok1 = await post({ ...VALID() });
  const sid = ok1.json.data.submissionId;
  const d2 = await api('GET', '/api/dev/contact-diagnostics', { token: devRecetteTok });
  check('diagnostic DEV : ACCEPTED en tête', d2.json.data.decisions[0].decision === 'ACCEPTED' && d2.json.data.decisions[0].submissionId === sid);
  const list = await api('GET', '/api/admin/contact-submissions', { token: devRecetteTok });
  check('acceptée : visible dans le Manager (sans filtre)', list.json.data.items.some((i) => i.submissionId === sid));

  // Doublon clientSubmissionId : une seule demande, diagnostic DUPLICATE.
  const dup1 = await post({ ...VALID(), clientSubmissionId: CID });
  const dup2 = await post({ ...VALID(), clientSubmissionId: CID });
  check('doublon : même submissionId', dup1.json.data.submissionId === dup2.json.data.submissionId);
  check('doublon : une seule demande', (await ContactSubmission.countDocuments({ clientSubmissionId: CID })) === 1);
  const d3 = await api('GET', '/api/dev/contact-diagnostics', { token: devRecetteTok });
  check('diagnostic DEV : DUPLICATE en tête', d3.json.data.decisions[0].decision === 'DUPLICATE');
}

section('Recette : demande SANS expéditeur Brevo (persistance garantie)');
await resetAll();
_resetContactDiagnostics();
{
  // AUCUN expéditeur configuré. Un DESTINATAIRE existe (le blocage vise bien
  // l'expéditeur, pas l'absence de destinataire) : la résolution du destinataire
  // réussit, la readiness d'envoi bloque ensuite sur l'expéditeur.
  await EmailConfiguration.deleteMany({});
  await Company.updateOne({}, { $set: { contactNotificationRecipients: ['contact@commerce.fr'] } });
  // Même bascule qu'au-dessus : l'expéditeur manquant est un refus du Panel.
  panelStub.forceNextCapability(
    refusCapacite('CAPABILITY_SENDER_NOT_CONFIGURED', 'aucune identité d’expédition déclarée'),
  );

  const r = await post({ ...VALID(), email: 'client.recette@exemple.fr' });
  check('sans expéditeur : succès renvoyé au visiteur', r.status === 201 && !!r.json.data.submissionId);
  const sid = r.json.data.submissionId;
  check('sans expéditeur : demande PERSISTÉE en base', (await ContactSubmission.countDocuments({ submissionId: sid })) === 1);
  const list = await api('GET', '/api/admin/contact-submissions', { token: devRecetteTok });
  check('sans expéditeur : VISIBLE dans le Manager', list.json.data.items.some((i) => i.submissionId === sid));

  const ev = await DomainEvent.findOne({ type: 'contact.submitted', entityId: sid });
  check('sans expéditeur : événement contact.submitted émis', !!ev);
  const execs = await EventActionExecution.find({ eventId: ev.eventId, actionId: 'notify-admins-contact-submitted' });
  check('sans expéditeur : au moins une exécution de notification', execs.length >= 1);
  check('sans expéditeur : échec terminal (DEAD_LETTER), pas un faux succès', execs.every((x) => x.status === EXECUTION_STATUS.DEAD_LETTER));
  check('sans expéditeur : code d\'erreur explicite (expéditeur/config)',
    execs.some((x) => /SENDER_NOT_CONFIGURED|PROVIDER_NOT_CONFIGURED/.test(x.lastErrorSafe?.code || '')));
  check('sans expéditeur : AUCUNE fausse livraison SENT', (await EmailDelivery.countDocuments({ status: DELIVERY_STATUS.SENT })) === 0);
}

section('Recette : Brevo répond 500 (demande conservée, échec observable)');
await resetAll();
await makeEmailReady();
await User.create({ email: 'admin500@exemple.fr', password: 'x123456', role: 'ADMIN', name: 'Admin 500' });
{
  // Panne du fournisseur, vue depuis la passerelle : rien n'est parti.
  panelStub.forceNextCapability(
    refusCapacite('CAPABILITY_PROVIDER_UNAVAILABLE', 'le fournisseur est en panne'),
  );
  const r = await post({ ...VALID(), email: 'client.500@exemple.fr' });
  check('Brevo 500 : succès renvoyé au visiteur', r.status === 201 && !!r.json.data.submissionId);
  const sid = r.json.data.submissionId;
  check('Brevo 500 : demande PERSISTÉE', (await ContactSubmission.countDocuments({ submissionId: sid })) === 1);
  const list = await api('GET', '/api/admin/contact-submissions', { token: devRecetteTok });
  check('Brevo 500 : VISIBLE dans le Manager', list.json.data.items.some((i) => i.submissionId === sid));
  const ev = await DomainEvent.findOne({ type: 'contact.submitted', entityId: sid });
  const execs = await EventActionExecution.find({ eventId: ev.eventId, actionId: 'notify-admins-contact-submitted' });
  // Le 500 forcé frappe le PREMIER envoi ; avec plusieurs admins les suivants
  // passent. L'invariant vérifié : au moins un échec fournisseur OBSERVABLE, et la
  // demande n'a pas été perdue.
  check('Brevo 500 : au moins un échec fournisseur observable', execs.some((x) => x.status !== EXECUTION_STATUS.SUCCEEDED && (x.lastErrorSafe?.code || '')));
}

// ---------------------------------------------------------------------------
server.close();
globalThis.fetch = realFetch;
await disconnectDatabase();
await mongod.stop();

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
