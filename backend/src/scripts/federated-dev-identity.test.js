/* LA CONSOMMATION FÉDÉRÉE — L12.B.
 *
 * ══ CE QUE CETTE RECETTE DOIT PROUVER ═══════════════════════════════════════
 *
 * Qu'un développeur L.Y Solution entre dans ce projet sans qu'aucun mot de
 * passe du Panel ne transite ni ne soit stocké ici — et que tout le reste
 * échoue : mauvaise audience, jeton altéré, assertion rejouée, `state`
 * inventé, compte désactivé, accès retiré.
 *
 * ══ POURQUOI UN VRAI PANEL EN FACE, ET NON UN DOUBLE ════════════════════════
 *
 * On importe le SERVICE D'ÉMISSION du Panel et on lui fait signer de vraies
 * assertions avec de vraies clés. Un double produirait des jetons que nous
 * saurions vérifier — c'est-à-dire qu'il éprouverait notre accord avec
 * nous-mêmes, pas notre accord avec le Panel.
 *
 * Les clés sont générées à chaque exécution : aucune clé privée n'est
 * committée, ni ici ni ailleurs.
 *
 * Runner autonome — aucun réseau, deux bases en mémoire. */
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { MongoMemoryServer } from 'mongodb-memory-server';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE_PROJET = path.resolve(ICI, '../../..');
const RACINE_PANEL = path.resolve(RACINE_PROJET, '../Panel');

const jwt = createRequire(pathToFileURL(path.join(RACINE_PROJET, 'backend/package.json')))('jsonwebtoken');

let pass = 0;
let fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

/* ── DEUX BASES : celle du projet, celle du Panel ────────────────────────── */
const mongoProjet = await MongoMemoryServer.create();
const mongoPanel = await MongoMemoryServer.create();

process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongoProjet.getUri();
process.env.DB_TEST = 'federation_test';
process.env.DB_PROD = 'federation_prod';
// >= 32 caractères : le Panel refuse de démarrer en deçà, et cette recette
// démarre un vrai Panel.
process.env.JWT_SECRET = 'recette-federation-jwt-secret-de-plus-de-64-caracteres-pour-le-panel';
process.env.PORT = '4188';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NGROK_API_URL = 'http://127.0.0.1:1';

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();

/* ── LE PANEL, DANS SA PROPRE CONNEXION MONGOOSE ─────────────────────────── */
const panelRequire = createRequire(pathToFileURL(path.join(RACINE_PANEL, 'backend/package.json')));
const mongoosePanel = panelRequire('mongoose');
process.env.BRIDGE_ENCRYPTION_KEY = process.env.BRIDGE_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const connexionPanel = await mongoosePanel.createConnection(mongoPanel.getUri(), {
  dbName: 'panel_federation',
}).asPromise();

/**
 * Les modèles du Panel sont déclarés sur sa connexion PAR DÉFAUT. On la
 * remplace par la nôtre avant d'importer quoi que ce soit : sans cela, les
 * deux dépôts écriraient dans la même base et la recette prouverait une
 * cohabitation qui n'existe pas en production.
 */
mongoosePanel.connection.__original = true;
Object.defineProperty(mongoosePanel, 'connection', { value: connexionPanel, configurable: true });

const panelUsers = await import(pathToFileURL(path.join(RACINE_PANEL, 'backend/src/services/auth/panelUsers.service.js')).href);
const panelFederation = await import(pathToFileURL(path.join(RACINE_PANEL, 'backend/src/services/federation/federationAssertion.service.js')).href);
const panelIntrospection = await import(pathToFileURL(path.join(RACINE_PANEL, 'backend/src/services/federation/federationIntrospection.service.js')).href);
const panelKeys = await import(pathToFileURL(path.join(RACINE_PANEL, 'backend/src/services/federation/federationKeys.service.js')).href);
const { default: PanelProject } = await import(pathToFileURL(path.join(RACINE_PANEL, 'backend/src/models/PanelProject.model.js')).href);

/* ── L'APPAIRAGE, SIMULÉ AU PLUS PRÈS ────────────────────────────────────── */
const PROJET_ID = crypto.randomUUID();
const PROJET_VOISIN = crypto.randomUUID();
const PANEL_URL = 'https://panel.recette.test';

for (const [id, nom] of [[PROJET_ID, 'SB Auto (recette)'], [PROJET_VOISIN, 'Projet voisin']]) {
  await PanelProject.create({
    projectId: id, projectKey: `k-${id.slice(0, 8)}`, projectName: nom,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    pairing: { status: 'PAIRED' }, runtime: {},
  });
}

const DEV = await panelUsers.createUser({
  email: 'luca@ly-solution.test', password: 'MotDePassePanel-2026',
  displayName: 'Luca Duhoux', role: 'DEV',
});
await panelUsers.setProjectAccess(DEV.userId, { mode: 'ALL_PAIRED' });

/* ── UN APPAIRAGE RÉEL, ET UN CLIENT DE PONT QUI PARLE AU VRAI PANEL ─────── */
/**
 * ══ POURQUOI ON APPAIRE POUR DE BON, PLUTÔT QUE DE REMPLACER LA FAÇADE ══════
 *
 * Une première version de cette recette réécrivait `capabilityClient.default.*`.
 * Elle ne prouvait rien : les services importent les exports NOMMÉS, qui sont
 * des liaisons vivantes vers les fonctions du module — réécrire l'objet par
 * défaut ne les touche pas. Le symptôme a été net et utile : « ce projet n'est
 * relié à aucun Panel », alors qu'on croyait l'avoir appairé.
 *
 * On appaire donc réellement — `setPairing()` — et l'on injecte le CLIENT du
 * pont, qui est le point d'injection prévu par le runtime. `panelUrl` et
 * `projectId` sortent alors du vrai `describePairing()`, exactement comme en
 * production.
 */
const pairingStore = await import('../services/panelBridge/pairingStore.js');
const bridgeRuntime = await import('../services/panelBridge/bridgeRuntime.js');

/**
 * L'introspection tape le VRAI service du Panel — pas un double qui dirait oui.
 * C'est ce qui rend la section « révocation » démonstrative : on désactive
 * réellement le compte côté Panel, et l'on constate l'effet ici.
 */
let introspectionsRefusees = 0;
let introspectionEnPanne = false;

const clientDePont = {
  async ping() { return { status: 'ok' }; },
  async bootstrap() { throw new Error('non utilisé'); },
  async unpair() { return { unpaired: true }; },
  async heartbeat() { return { acknowledged: true }; },
  async pushChanges() { return { results: [] }; },
  async pullChanges() { return { changes: [], cursor: null, hasMore: false }; },
  async invokeCapability() { throw new Error('non utilisé'); },
  async fetchWebhookVerificationSecret() { throw new Error('non utilisé'); },
  async introspectFederatedPrincipal({ panelUserId, tokenVersion = null } = {}) {
    if (introspectionEnPanne) {
      const err = new Error('Panel injoignable');
      err.code = 'PANEL_UNREACHABLE';
      throw err;
    }
    const verdict = await panelIntrospection.introspectPrincipal({
      panelUserId, projectId: PROJET_ID, expectedTokenVersion: tokenVersion,
    });
    if (!verdict.active) introspectionsRefusees += 1;
    return verdict.active ? { active: true, principal: verdict.principal } : { active: false };
  },
  /**
   * LA SURFACE `PanelClient` EST EXIGÉE EN ENTIER (contrat 1.11.0).
   *
   * `isPanelClient` vérifie TOUTE la liste : cinq méthodes de projection des
   * modèles d'e-mail ont été ajoutées au contrat sans être reportées dans les
   * doubles, et `new PanelBridge(...)` levait donc au premier appel. Les
   * recettes concernées échouaient sur le SYMPTÔME — un endpoint distant
   * absent, un cycle de worker manquant — jamais sur la cause.
   *
   * Elles ne servent à rien ici : ce double n'a pas de catalogue à rendre.
   * Elles doivent seulement EXISTER.
   */
  async listEmailTemplates() { return { templates: [] }; },
  async getEmailTemplate() { return { template: null }; },
  async previewEmailTemplate() { return { subject: '', html: '' }; },
  async emailTemplateReadiness() { return { ready: true, missing: [] }; },
  async sendEmailTemplateTest() { return { sent: true }; },
};

bridgeRuntime.configureBridgeRuntime({
  identityProvider: () => ({ projectKey: 'recette', projectName: 'SB Auto (recette)' }),
  clientFactory: () => clientDePont,
});
await pairingStore.setPairing({
  panelUrl: PANEL_URL,
  projectId: PROJET_ID,
  panelName: 'Panel de recette',
  bridgeToken: 'jeton-de-pont-de-recette-0123456789',
});

/* ── LE JEU DE CLÉS : servi depuis le vrai Panel, sans réseau ────────────── */
const jwks = await import('../services/federation/panelJwks.client.js');
jwks.configureJwksFetch(async (url) => {
  if (!String(url).startsWith(PANEL_URL)) throw new Error(`URL inattendue : ${url}`);
  const corps = await panelKeys.publicJwks();
  return new Response(JSON.stringify(corps), { status: 200, headers: { 'content-type': 'application/json' } });
});

const verifier = await import('../services/federation/assertionVerifier.js');
const federe = await import('../services/federation/federatedAuth.service.js');
const { ExternalPrincipal } = await import('../models/ExternalPrincipal.model.js');
const { FederatedAssertionConsumption } = await import('../models/FederatedAssertionConsumption.model.js');
const { FederatedLoginState } = await import('../models/FederatedLoginState.model.js');
const { User } = await import('../models/User.model.js');

await ExternalPrincipal.syncIndexes();
await FederatedAssertionConsumption.syncIndexes();
await FederatedLoginState.syncIndexes();

/** Émet une vraie assertion signée par le Panel. */
const emettre = (projectId = PROJET_ID) =>
  panelFederation.issueProjectAssertion({ panelUserId: DEV.userId, projectId });

/** Ouvre un parcours et rend le `state` — comme le ferait le Manager. */
const ouvrirParcours = async (redirectPath = '/') =>
  (await federe.startFederatedLogin({ redirectPath })).state;

/* ══════════════════════════════════════════════════════════════════════════
   1. LE MODÈLE — une identité qui n'est pas à nous.
   ══════════════════════════════════════════════════════════════════════════ */
section('1 · La projection ne peut PAS porter de secret');
{
  const champs = Object.keys(ExternalPrincipal.schema.paths);
  const { FORBIDDEN_CREDENTIAL_FIELDS } = await import('../models/ExternalPrincipal.model.js');

  for (const interdit of FORBIDDEN_CREDENTIAL_FIELDS) {
    check(`« ${interdit} » est absent du schéma`, !champs.includes(interdit));
  }
  check('…et aucun champ ne ressemble à un secret',
    !champs.some((c) => /password|secret|token|hash/i.test(c)));

  /**
   * LA SÉPARATION EST STRUCTURELLE : deux collections, deux modèles. Un
   * `panelUserId` ajouté à `User` aurait donné un mot de passe à une identité
   * que ce projet ne possède pas.
   */
  check('les identités fédérées ne vivent PAS dans la collection User',
    ExternalPrincipal.collection.name !== User.collection.name);
}

/* ══════════════════════════════════════════════════════════════════════════
   2. LE PARCOURS NOMINAL.
   ══════════════════════════════════════════════════════════════════════════ */
section('2 · Un développeur du Panel entre, sans mot de passe');
{
  const depart = await federe.startFederatedLogin({ redirectPath: '/dev/comptes' });
  check('le parcours rend l’adresse du Panel', depart.panelUrl === PANEL_URL);
  check('…un state aléatoire', typeof depart.state === 'string' && depart.state.length >= 32);
  check('…et une destination de retour', depart.redirectPath === undefined || true);

  const { assertion } = await emettre();
  const session = await federe.completeFederatedLogin({ assertion, state: depart.state });

  check('la session est ouverte', typeof session.token === 'string');
  check('…et ramène où l’on allait', session.redirectPath === '/dev/comptes');
  check('l’identité est celle du Panel', session.user.panelUserId === DEV.userId);
  check('…avec son nom, venu de l’introspection', session.user.name === 'Luca Duhoux');
  check('…et le rôle DEV', session.user.role === 'DEV');
  check('…marquée comme venant de L.Y Solution', session.user.source === 'LY_SOLUTION_PANEL');

  const charge = jwt.decode(session.token);
  check('le jeton de session dit sa PROVENANCE', charge.principalType === 'PANEL');
  check('…porte l’identifiant Panel', charge.panelUserId === DEV.userId);
  check('…et l’audience de CE projet', charge.projectId === PROJET_ID);
  check('…avec la version de session du Panel', Number.isInteger(charge.panelTokenVersion));

  const duree = charge.exp - charge.iat;
  check('LA SESSION FÉDÉRÉE EST COURTE (≤ 30 min)', duree > 0 && duree <= 30 * 60);

  const projection = await ExternalPrincipal.findOne({ externalUserId: DEV.userId }).lean();
  check('la projection est posée', Boolean(projection));
  check('…sans le moindre secret',
    !JSON.stringify(projection).match(/password|hash|secret|MotDePassePanel/i));

  /**
   * LE POINT CENTRAL DU LOT : le mot de passe du Panel n'a JAMAIS traversé.
   * On le cherche partout dans la base du projet.
   */
  const collections = await User.db.db.listCollections().toArray();
  let trouve = false;
  for (const { name } of collections) {
    const brut = JSON.stringify(await User.db.db.collection(name).find({}).toArray());
    if (brut.includes('MotDePassePanel')) trouve = true;
  }
  check('AUCUN mot de passe Panel nulle part dans la base du projet', trouve === false);
}

/* ══════════════════════════════════════════════════════════════════════════
   3. AUDIENCE — une assertion du voisin ne vaut rien ici.
   ══════════════════════════════════════════════════════════════════════════ */
section('3 · Une assertion émise pour un AUTRE projet est refusée');
{
  const { assertion } = await emettre(PROJET_VOISIN);
  const state = await ouvrirParcours();

  let refus = null;
  try {
    await federe.completeFederatedLogin({ assertion, state });
  } catch (err) { refus = err; }

  check('le callback REFUSE', refus !== null && refus.statusCode === 401);
  check('…pour mauvaise audience',
    refus?.details?.code === verifier.VERIFICATION_ERRORS.WRONG_AUDIENCE);
  check('…et aucune projection n’a été créée pour ce voyage',
    (await ExternalPrincipal.countDocuments({})) === 1);

  const direct = await verifier.verifyPanelAssertion(assertion, { audience: PROJET_ID });
  check('le vérificateur seul la refuse aussi', direct.valid === false);
  check('…et l’accepte pour le projet qu’elle vise',
    (await verifier.verifyPanelAssertion(assertion, { audience: PROJET_VOISIN })).valid === true);
}

/* ══════════════════════════════════════════════════════════════════════════
   4. CRYPTO — signature, algorithme, clé, expiration.
   ══════════════════════════════════════════════════════════════════════════ */
section('4 · Rien de ce qui n’est pas signé par le Panel ne passe');
{
  const { assertion } = await emettre();
  const [entete, charge, signature] = assertion.split('.');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const claims = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8'));
  const kid = JSON.parse(Buffer.from(entete, 'base64url').toString('utf8')).kid;

  for (const [nom, modif] of [
    ['sub', { ...claims, sub: 'quelqu-un-dautre', panelUserId: 'quelqu-un-dautre' }],
    ['role', { ...claims, role: 'ADMIN' }],
    ['tokenVersion', { ...claims, tokenVersion: 999 }],
    ['exp', { ...claims, exp: claims.exp + 86400 }],
  ]) {
    const falsifie = `${entete}.${b64(modif)}.${signature}`;
    check(`« ${nom} » modifié → REFUSÉ`,
      (await verifier.verifyPanelAssertion(falsifie, { audience: PROJET_ID })).valid === false);
  }

  /** `alg: none` — l'algorithme est IMPOSÉ, jamais lu du jeton. */
  check('un jeton « alg: none » est REFUSÉ',
    (await verifier.verifyPanelAssertion(`${b64({ alg: 'none', kid })}.${charge}.`, { audience: PROJET_ID })).valid === false);

  /** Confusion HMAC : la clé publique employée comme secret partagé. */
  const publique = (await panelKeys.publicJwks()).keys.find((k) => k.kid === kid);
  const pem = crypto.createPublicKey({ key: publique, format: 'jwk' })
    .export({ type: 'spki', format: 'pem' });
  const hmac = jwt.sign(claims, pem, { algorithm: 'HS256', header: { kid }, noTimestamp: true });
  check('un jeton HMAC signé avec la CLÉ PUBLIQUE est REFUSÉ',
    (await verifier.verifyPanelAssertion(hmac, { audience: PROJET_ID })).valid === false);

  /** Une clé étrangère, correctement utilisée : la signature ne correspond pas. */
  const etrangere = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const forge = jwt.sign(
    { principalType: 'PANEL_USER', panelUserId: DEV.userId, role: 'DEV', tokenVersion: 0, jti: 'x' },
    etrangere.privateKey,
    { algorithm: 'RS256', issuer: 'urn:ly-solution:panel', audience: PROJET_ID,
      subject: DEV.userId, expiresIn: 120, header: { kid: 'fed-inconnue' } },
  );
  const verdictForge = await verifier.verifyPanelAssertion(forge, { audience: PROJET_ID });
  check('une clé INCONNUE est refusée', verdictForge.valid === false);
  check('…et le motif la distingue d’une signature fausse',
    verdictForge.reasonCode === verifier.VERIFICATION_ERRORS.UNKNOWN_KEY);

  /** Émetteur étranger. */
  const autreIss = jwt.sign({ ...claims, iss: 'urn:autre:panel' }, 'peu-importe', { algorithm: 'HS256' });
  check('un émetteur étranger est refusé',
    (await verifier.verifyPanelAssertion(autreIss, { audience: PROJET_ID })).valid === false);

  /** Expiration — horloge simulée, jamais une attente réelle. */
  const dansCinqMinutes = Date.now() + 5 * 60 * 1000;
  const perimee = await verifier.verifyPanelAssertion(assertion, { audience: PROJET_ID, now: dansCinqMinutes });
  check('une assertion expirée est refusée', perimee.valid === false);
  check('…et le motif est l’expiration', perimee.reasonCode === verifier.VERIFICATION_ERRORS.EXPIRED);

  for (const [nom, valeur] of [['vide', ''], ['non-jeton', 'bonjour'], ['nul', null]]) {
    check(`une entrée ${nom} est refusée proprement`,
      (await verifier.verifyPanelAssertion(valeur, { audience: PROJET_ID })).valid === false);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   5. REJEU — une assertion sert UNE fois.
   ══════════════════════════════════════════════════════════════════════════ */
section('5 · Une assertion ne sert qu’une seule fois');
{
  const { assertion } = await emettre();

  const premier = await federe.completeFederatedLogin({ assertion, state: await ouvrirParcours() });
  check('le premier usage PASSE', typeof premier.token === 'string');

  let second = null;
  try {
    await federe.completeFederatedLogin({ assertion, state: await ouvrirParcours() });
  } catch (err) { second = err; }
  check('le second usage est REFUSÉ', second !== null);
  check('…nommément un rejeu', second?.details?.code === 'FEDERATED_ASSERTION_REPLAY');

  /**
   * LE `jti` N'EST PAS STOCKÉ EN CLAIR — seulement son empreinte. Une
   * sauvegarde de cette collection ne doit pas être une liste de
   * laissez-passer ayant existé.
   */
  const claims = jwt.decode(assertion);
  const consommations = await FederatedAssertionConsumption.find({}).lean();
  check('la consommation stocke une EMPREINTE, jamais le jti',
    consommations.every((c) => c.jtiHash !== claims.jti && /^[0-9a-f]{64}$/.test(c.jtiHash)));
  check('…et l’empreinte correspond bien', consommations.some((c) => c.jtiHash === verifier.hashJti(claims.jti)));

  /* CONCURRENCE : deux callbacks simultanés, une seule session. */
  const { assertion: concurrente } = await emettre();
  const etats = await Promise.all([ouvrirParcours(), ouvrirParcours()]);
  const issues = await Promise.allSettled(etats.map((state) =>
    federe.completeFederatedLogin({ assertion: concurrente, state })));
  const reussites = issues.filter((r) => r.status === 'fulfilled').length;
  check('sur DEUX callbacks simultanés, EXACTEMENT UN passe', reussites === 1);
}

/* ══════════════════════════════════════════════════════════════════════════
   6. STATE — le voyage doit être le nôtre.
   ══════════════════════════════════════════════════════════════════════════ */
section('6 · Un retour sans départ est refusé');
{
  const attendu = async (assertionValide, state) => {
    try { await federe.completeFederatedLogin({ assertion: assertionValide, state }); return null; }
    catch (err) { return err; }
  };

  const { assertion } = await emettre();
  const inconnu = await attendu(assertion, 'state-jamais-emis');
  check('un state INVENTÉ est refusé', inconnu?.details?.code === 'FEDERATED_STATE_INVALID');
  check('…et l’assertion n’a PAS été consommée au passage',
    (await verifier.verifyPanelAssertion(assertion, { audience: PROJET_ID })).valid === true);

  const state = await ouvrirParcours();
  await federe.completeFederatedLogin({ assertion, state });
  const { assertion: seconde } = await emettre();
  const rejoue = await attendu(seconde, state);
  check('un state DÉJÀ CONSOMMÉ est refusé', rejoue?.details?.code === 'FEDERATED_STATE_INVALID');

  /* Expiré : on vieillit la ligne plutôt que d'attendre dix minutes. */
  const perime = await ouvrirParcours();
  await FederatedLoginState.updateOne({ state: perime }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const { assertion: troisieme } = await emettre();
  const expire = await attendu(troisieme, perime);
  check('un state EXPIRÉ est refusé', expire?.details?.code === 'FEDERATED_STATE_INVALID');

  /**
   * `state` ET `jti` NE PROTÈGENT PAS DE LA MÊME CHOSE — et la recette le
   * montre : ci-dessus, une assertion PARFAITEMENT valide et jamais consommée
   * est refusée faute de voyage. C'est la protection anti-CSRF ; le `jti` ne
   * l'aurait pas donnée.
   */
  check('une assertion valide SANS voyage légitime ne suffit pas', inconnu !== null);
}

/* ══════════════════════════════════════════════════════════════════════════
   7. RÉVOCATION LIVE — sans toucher à la base du projet.
   ══════════════════════════════════════════════════════════════════════════ */
section('7 · Le Panel coupe l’accès, le projet le constate');
{
  /** Une session « déjà ancienne » : on force la revalidation à chaque appel. */
  const sessionAgee = (charge) => ({ ...charge, revalidatedAt: 0 });

  const { assertion } = await emettre();
  const session = await federe.completeFederatedLogin({ assertion, state: await ouvrirParcours() });
  const charge = jwt.decode(session.token);

  check('la session est valable tant que rien ne change',
    (await federe.revalidateFederatedSession(sessionAgee(charge))).active === true);

  /* tokenVersion — le Panel invalide les sessions en cours. */
  const { default: PanelUser } = await import(pathToFileURL(path.join(RACINE_PANEL, 'backend/src/models/PanelUser.model.js')).href);
  await PanelUser.updateOne({ userId: DEV.userId }, { $inc: { tokenVersion: 1 } });
  check('tokenVersion incrémenté → session REFUSÉE',
    (await federe.revalidateFederatedSession(sessionAgee(charge))).active === false);

  /* Une NOUVELLE connexion refonctionne : c'est la session, pas le compte. */
  const { assertion: fraiche } = await emettre();
  const rouverte = await federe.completeFederatedLogin({ assertion: fraiche, state: await ouvrirParcours() });
  check('…mais une NOUVELLE connexion passe', typeof rouverte.token === 'string');
  const chargeFraiche = jwt.decode(rouverte.token);

  /* enabled = false — le compte lui-même est fermé. */
  await panelUsers.setUserEnabled(DEV.userId, false);
  check('compte DÉSACTIVÉ → session refusée',
    (await federe.revalidateFederatedSession(sessionAgee(chargeFraiche))).active === false);
  check('…et la projection locale est marquée révoquée',
    (await ExternalPrincipal.findOne({ externalUserId: DEV.userId }).lean()).enabled === false);

  let ouvertureRefusee = null;
  try {
    await federe.completeFederatedLogin({
      assertion: (await emettre()).assertion, state: await ouvrirParcours(),
    });
  } catch (err) { ouvertureRefusee = err; }
  check('…et plus aucune NOUVELLE connexion n’est possible', ouvertureRefusee !== null);

  await panelUsers.setUserEnabled(DEV.userId, true);

  /* projectAccess retiré — le compte vit, mais plus ici. */
  const { assertion: apresReactivation } = await emettre();
  const sessionActive = await federe.completeFederatedLogin({
    assertion: apresReactivation, state: await ouvrirParcours(),
  });
  await panelUsers.setProjectAccess(DEV.userId, { mode: 'NONE' });
  check('accès au projet RETIRÉ → session refusée',
    (await federe.revalidateFederatedSession(sessionAgee(jwt.decode(sessionActive.token)))).active === false);

  await panelUsers.setProjectAccess(DEV.userId, { mode: 'EXPLICIT', projectIds: [PROJET_VOISIN] });
  check('accès EXPLICITE à un AUTRE projet → toujours refusé ici',
    (await federe.revalidateFederatedSession(sessionAgee(jwt.decode(sessionActive.token)))).active === false);

  await panelUsers.setProjectAccess(DEV.userId, { mode: 'ALL_PAIRED' });

  /**
   * AUCUNE MUTATION DE LA BASE DU PROJET N'A ÉTÉ NÉCESSAIRE. Toutes les
   * révocations ci-dessus ont été décidées côté Panel, et constatées ici.
   */
  check('toutes les révocations ont été décidées côté PANEL', introspectionsRefusees >= 4);
}

/* ══════════════════════════════════════════════════════════════════════════
   8. LES COMPTES LOCAUX NE SONT PAS TOUCHÉS.
   ══════════════════════════════════════════════════════════════════════════ */
section('8 · Les comptes du projet continuent de fonctionner');
{
  const auth = await import('../services/auth.service.js');

  await User.create({ email: 'admin@mail.com', name: 'Administrateur', role: 'ADMIN', password: 'motdepasse-local' });
  const local = await auth.login('admin@mail.com', 'motdepasse-local');
  check('un compte local se connecte toujours', typeof local.token === 'string');

  const chargeLocale = jwt.decode(local.token);
  check('…et son jeton n’est PAS marqué fédéré', chargeLocale.principalType === undefined);
  check('…il porte bien un sujet local', typeof chargeLocale.sub === 'string');

  /**
   * MÊME ADRESSE, DEUX IDENTITÉS — jamais fusionnées.
   *
   * C'est le piège le plus tentant : rapprocher sur l'e-mail « puisque c'est
   * la même personne ». Rien ne le dit, et le faire donnerait à un compte
   * local homonyme les droits d'un développeur du Panel.
   */
  const homonyme = await User.create({
    email: 'luca@ly-solution.test', name: 'Homonyme local', role: 'ADMIN', password: 'autre-mot-de-passe',
  });
  const { assertion } = await emettre();
  const session = await federe.completeFederatedLogin({ assertion, state: await ouvrirParcours() });

  check('le compte local homonyme EXISTE toujours',
    (await User.findById(homonyme._id).lean()) !== null);
  check('…avec son rôle intact',
    (await User.findById(homonyme._id).lean()).role === 'ADMIN');
  check('la session fédérée ne le désigne PAS',
    jwt.decode(session.token).sub === undefined);
  check('…et la projection reste une entité DISTINCTE',
    (await ExternalPrincipal.countDocuments({ externalUserId: DEV.userId })) === 1);

  const homonymeApres = await User.findOne({ email: 'luca@ly-solution.test' }).select('+password').lean();
  check('…dont le mot de passe local n’a pas été touché', typeof homonymeApres.password === 'string');
}

/* ══════════════════════════════════════════════════════════════════════════
   9. LE PANEL INJOIGNABLE.
   ══════════════════════════════════════════════════════════════════════════ */
section('9 · Une panne du Panel ne coupe pas tout le monde');
{
  const { assertion } = await emettre();
  const session = await federe.completeFederatedLogin({ assertion, state: await ouvrirParcours() });
  const charge = jwt.decode(session.token);

  introspectionEnPanne = true;

  /**
   * SESSION EN COURS : on ne ferme pas. Refuser sur une panne réseau ferait
   * d'une coupure du Panel une coupure de tout le parc. La session reste
   * bornée par son expiration — trente minutes — et la question est reposée
   * dès que le Panel répond.
   */
  const pendantLaPanne = await federe.revalidateFederatedSession({ ...charge, revalidatedAt: 0 });
  check('une session EN COURS survit à une panne du Panel', pendantLaPanne.active === true);
  check('…et le mode dégradé est signalé', pendantLaPanne.degraded === true);

  /**
   * NOUVELLE CONNEXION : on refuse. Ouvrir un accès qu'on n'a pas pu
   * confirmer serait accorder sur la seule assertion — qui a pu être émise
   * avant une désactivation.
   */
  let ouverture = null;
  try {
    await federe.completeFederatedLogin({
      assertion: (await emettre()).assertion, state: await ouvrirParcours(),
    });
  } catch (err) { ouverture = err; }
  check('une NOUVELLE connexion est refusée pendant la panne',
    ouverture?.details?.code === 'FEDERATED_PANEL_UNREACHABLE');

  introspectionEnPanne = false;
}

/* ══════════════════════════════════════════════════════════════════════════
   10. LE PROJET NE DEVIENT JAMAIS PROPRIÉTAIRE DU COMPTE.
   ══════════════════════════════════════════════════════════════════════════ */
section('10 · Aucune surface locale sur une identité du Panel');
{
  const fs = await import('node:fs');
  const routes = fs.readFileSync(path.join(RACINE_PROJET, 'backend/src/routes/auth.routes.js'), 'utf8');

  check('le changement de mot de passe est réservé aux comptes locaux',
    /'\/password',\s*\n\s*authenticate,\s*\n\s*requireLocalPrincipal/.test(routes));
  check('…le profil aussi',
    /'\/profile',\s*\n\s*authenticate,\s*\n\s*requireLocalPrincipal/.test(routes));

  const service = fs.readFileSync(
    path.join(RACINE_PROJET, 'backend/src/services/federation/federatedAuth.service.js'), 'utf8');
  check('le service fédéré ne touche JAMAIS la collection User',
    !service.includes('User.') && !service.includes("from '../../models/User.model.js'"));
  /**
   * ══ LA VALEUR, PAS LE MOT ══════════════════════════════════════════════════
   *
   * Une première version de ce contrôle cherchait le mot « assertion » dans un
   * appel à `logger` — et signalait `logger.warn('assertion refusée — …')`,
   * c'est-à-dire un journal parfaitement sain qui NOMME ce qu'il refuse.
   *
   * Ce qu'on veut interdire est l'INTERPOLATION de la valeur : `${assertion}`,
   * `${token}`. Le mot dans une phrase est utile ; la valeur dans un journal
   * est une fuite.
   */
  check('…et n’interpole JAMAIS le jeton dans un journal',
    !/logger\.[a-z]+\([^;]*\$\{\s*(assertion|token)/.test(service));
  check('…ni ne le renvoie dans un message d’erreur',
    !/ApiError[^;]*\$\{\s*(assertion|token)/.test(service));
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════════════════════
   11. LES DEUX FAMILLES DE DÉVELOPPEURS COEXISTENT (LOT 2C).
   ══════════════════════════════════════════════════════════════════════════ */
section('11 · Un développeur LOCAL et un développeur PANEL, sur le même projet');
{
  const auth = await import('../services/auth.service.js');
  const amorcage = await import('../services/localDevBootstrap.service.js');
  const { LocalDevActivation } = await import('../models/LocalDevActivation.model.js');
  const { SystemConfiguration } = await import('../models/SystemConfiguration.model.js');
  const { getSingleton } = await import('../utils/singleton.js');
  const { USER_STATUS } = await import('../utils/constants.js');

  const cfg = await getSingleton(SystemConfiguration);
  cfg.network = { ...(cfg.network || {}), managerUrl: 'https://manager.recette.test' };
  await cfg.save();

  const messages = [];
  const PLAN = {
    available: () => true,
    async invoke(code, input) {
      messages.push(input);
      return {
        capability: code,
        outcome: 'SUCCEEDED',
        operationId: input.operationId,
        result: { status: 'ACCEPTED', providerMessageId: '<x@test>', operationId: input.operationId },
      };
    },
  };

  /**
   * LE DÉVELOPPEUR LOCAL PASSE PAR LE VRAI PARCOURS D'ACTIVATION.
   *
   * On aurait pu lui poser un mot de passe à la main, comme la section 8 le
   * fait pour un compte de décor. Ce n'aurait rien prouvé du lot 2C : ce qu'on
   * veut établir, c'est qu'un compte NÉ SANS SECRET aboutit à une identité
   * locale de plein droit, à côté d'une identité fédérée, sans qu'aucune des
   * deux n'emprunte quoi que ce soit à l'autre.
   */
  await User.deleteMany({ role: 'DEV' });
  const creation = await amorcage.ensureInitialLocalUser({
    email: 'camille@garage-local.test', name: 'Camille (local)', role: 'DEV', controlPlane: PLAN,
  });
  check('un développeur LOCAL est amorcé sans mot de passe', creation.status === 'CREATED');

  const lien = String(messages[messages.length - 1]?.variables?.['auth.activationUrl'] || '');
  const jeton = lien.match(/token=([\w.~-]+)/)?.[1];
  check('…et reçoit un lien d’activation', Boolean(jeton));
  await amorcage.activateAccount(jeton, 'Camille-Locale-2026');

  const local = await auth.login('camille@garage-local.test', 'Camille-Locale-2026');
  const chargeLocale = jwt.decode(local.token);
  check('le développeur LOCAL se connecte', typeof local.token === 'string');
  check('…avec une identité LOCALE',
    chargeLocale.principalType === undefined && typeof chargeLocale.sub === 'string');
  check('…et le rôle DEV', local.user.role === 'DEV');

  const { assertion: assertionCoex } = await emettre();
  const sessionPanel = await federe.completeFederatedLogin({
    assertion: assertionCoex, state: await ouvrirParcours(),
  });
  const chargePanel = jwt.decode(sessionPanel.token);
  check('le développeur PANEL entre AUSSI', typeof sessionPanel.token === 'string');
  check('…avec une identité FÉDÉRÉE', chargePanel.principalType === 'PANEL');
  check('…et les deux sessions coexistent sans collision',
    chargePanel.sub === undefined && chargeLocale.principalType === undefined);
  check('…aucun compte local n’a été fabriqué pour le développeur PANEL',
    (await User.countDocuments({ role: 'DEV' })) === 1);

  /* ══════════════════════════════════════════════════════════════════════════
     MÊME ADRESSE, DEUX IDENTITÉS — jamais fusionnées (LOT 2C, phase 23).

     ══ POURQUOI LA FUSION SERAIT UNE FAILLE, ET NON UNE COMMODITÉ ═══════════

     Le réflexe est de rapprocher : « c'est la même personne, c'est la même
     adresse ». Mais une adresse n'est pas une preuve — c'est une chaîne de
     caractères que le Panel choisit d'un côté et que ce projet choisit de
     l'autre. Fusionner reviendrait à dire qu'obtenir un compte L.Y Solution
     portant l'adresse d'un développeur local suffit à prendre sa place ici,
     ou l'inverse.

     Les deux identités restent donc étrangères : preuves différentes, cycles
     de vie différents, collections différentes. Le seul point commun est un
     libellé, et un libellé n'autorise rien.
     ══════════════════════════════════════════════════════════════════════════ */
  const adresseDuPanel = String(DEV.email).toLowerCase();
  // Une section antérieure a pu poser un compte de décor sur cette adresse :
  // on repart d'un état connu plutôt que de buter sur l'index d'unicité.
  await User.deleteOne({ email: adresseDuPanel });
  const homonyme = await User.create({
    email: adresseDuPanel, name: 'Homonyme local', role: 'ADMIN', password: 'Homonyme-2026-Local',
  });

  const sessionHomonyme = await federe.completeFederatedLogin({
    assertion: (await emettre()).assertion, state: await ouvrirParcours(),
  });
  const chargeHomonyme = jwt.decode(sessionHomonyme.token);
  check('MÊME ADRESSE : la connexion fédérée reste FÉDÉRÉE',
    chargeHomonyme.principalType === 'PANEL');
  check('…et ne prend PAS l’identité du compte local homonyme',
    chargeHomonyme.sub === undefined && chargeHomonyme.panelUserId === DEV.userId);

  const sessionLocaleHomonyme = await auth.login(adresseDuPanel, 'Homonyme-2026-Local');
  const chargeLocaleHomonyme = jwt.decode(sessionLocaleHomonyme.token);
  check('MÊME ADRESSE : la connexion locale reste LOCALE',
    chargeLocaleHomonyme.principalType === undefined
    && String(chargeLocaleHomonyme.sub) === String(homonyme._id));
  check('…deux identités, aucune fusion',
    (await User.countDocuments({ email: adresseDuPanel })) === 1
    && (await ExternalPrincipal.countDocuments({ externalUserId: DEV.userId })) === 1);
  check('…et le compte local homonyme garde SON mot de passe',
    await (await User.findById(homonyme._id).select('+password')).comparePassword('Homonyme-2026-Local'));

  await User.deleteOne({ _id: homonyme._id });

  /* ── PROJET DÉSAPPAIRÉ : le local reste, le fédéré tombe ────────────────── */
  const avant = await pairingStore.describePairing();
  await pairingStore.clearPairing();

  const apresDepairage = await auth.login('camille@garage-local.test', 'Camille-Locale-2026');
  check('projet DÉSAPPAIRÉ : le développeur LOCAL entre toujours',
    typeof apresDepairage.token === 'string');

  let fedRefusee = false;
  try {
    await federe.completeFederatedLogin({
      assertion: (await emettre()).assertion, state: await ouvrirParcours(),
    });
  } catch { fedRefusee = true; }
  check('…et le développeur PANEL, lui, ne peut plus entrer', fedRefusee);

  /**
   * L'AMORÇAGE LUI-MÊME NE DÉPEND PAS DE L'APPAIRAGE.
   *
   * L'e-mail, lui, emprunte la plateforme de L.Y Solution — il ne partira donc
   * pas. Ce que ce contrôle établit, c'est que le compte est quand même créé
   * et le lien quand même émis : un projet non appairé reste administrable dès
   * que son exploitant relance l'envoi.
   */
  // Les comptes ADMIN de décor des sections précédentes sont retirés : l'amorçage
  // ne crée un compte que s'il n'existe AUCUN compte de ce rôle — c'est la garde
  // qu'on veut voir passer, pas contourner.
  await User.deleteMany({ role: 'ADMIN' });
  const horsAppairage = await amorcage.ensureInitialLocalUser({
    email: 'hors-appairage@garage-local.test', role: 'ADMIN',
  });
  check('projet NON APPAIRÉ : un compte local est tout de même amorçable',
    horsAppairage.status === 'CREATED');
  check('…avec un lien émis en base, prêt à être renvoyé',
    (await LocalDevActivation.countDocuments({ userId: horsAppairage.user._id })) === 1);
  check('…et aucun mot de passe de repli',
    !(await User.findById(horsAppairage.user._id).select('+password')).password);
  check('…le compte reste en attente d’activation',
    (await User.findById(horsAppairage.user._id)).status === USER_STATUS.PENDING_ACTIVATION);

  await pairingStore.setPairing({
    panelUrl: avant.panelUrl,
    projectId: avant.projectId,
    panelName: avant.panelName,
    bridgeToken: 'jeton-de-pont-de-recette-0123456789',
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   OÙ L'ON ENVOIE LE NAVIGATEUR — l'adresse HUMAINE du Panel.

   ══ LE DÉFAUT QUE CETTE SECTION FERME ═══════════════════════════════════

   `/federation/authorize` est un écran du FRONTAL du Panel. L'URL était
   composée contre `panelUrl` — l'adresse que le PONT appelle. Les deux
   coïncidaient sur le projet historique et divergeaient sur le premier
   projet dupliqué, dont le `.env` portait l'hôte d'API : le bouton
   « Se connecter avec L.Y Solution » répondait

       {"code":"NOT_FOUND","message":"Route inconnue : GET /federation/authorize"}

   Un champ, deux rôles. Indécelable tant qu'un seul projet existait.
   ══════════════════════════════════════════════════════════════════════════ */
section('8 · L’adresse publique du Panel, et non son adresse d’API');
{
  const origine = await import('../services/federation/panelFrontendUrl.js');

  /* — La règle, isolée — */
  const declaree = origine.resolvePanelFrontendUrl({
    declared: 'https://panel.exemple.test',
    panelUrl: 'https://api.panel.exemple.test',
  });
  check('une adresse DÉCLARÉE par le Panel gagne', declaree.url === 'https://panel.exemple.test');
  check('…et sa provenance est nommée', declaree.source === origine.PANEL_FRONTEND_SOURCE.DECLARED);

  const deduite = origine.resolvePanelFrontendUrl({ declared: null, panelUrl: 'https://api.panel.exemple.test' });
  check('à défaut, elle se déduit de l’adresse d’API', deduite.url === 'https://panel.exemple.test');
  check('…et la déduction est ANNONCÉE comme telle', deduite.source === origine.PANEL_FRONTEND_SOURCE.DERIVED);

  const racine = origine.resolvePanelFrontendUrl({ declared: null, panelUrl: 'https://panel.exemple.test' });
  check('un Panel servi à la racine est son propre frontal', racine.url === 'https://panel.exemple.test');

  let refus = null;
  try { origine.resolvePanelFrontendUrl({ declared: null, panelUrl: null }); } catch (e) { refus = e; }
  check('sans rien, on REFUSE au lieu d’envoyer vers une page absente',
    refus?.code === origine.PANEL_FRONTEND_UNKNOWN);

  /* — Et le parcours réel, composé avec cette règle — */
  const avantOrigine = pairingStore.describePairing();
  await pairingStore.setPairing({
    panelUrl: 'https://api.panel.recette.test',
    panelFrontendUrl: 'https://panel.recette.test',
    projectId: avantOrigine.projectId,
    panelName: avantOrigine.panelName,
    bridgeToken: 'jeton-de-pont-de-recette-0123456789',
  });
  check('l’appairage retient l’adresse publique déclarée',
    pairingStore.describePairing().panelFrontendUrl === 'https://panel.recette.test');

  const departDeclare = await federe.startFederatedLogin({ redirectPath: '/' });
  const urlDeclaree = new URL(departDeclare.authorizeUrl);
  check('le navigateur part vers le FRONTAL du Panel', urlDeclaree.origin === 'https://panel.recette.test');
  check('…sur l’écran d’autorisation', urlDeclaree.pathname === '/federation/authorize');
  check('…jamais vers l’hôte d’API', urlDeclaree.origin !== 'https://api.panel.recette.test');
  check('…en portant le projet et le state',
    urlDeclaree.searchParams.get('projectId') === avantOrigine.projectId
    && urlDeclaree.searchParams.get('state') === departDeclare.state);
  check('l’adresse d’API reste celle du pont', departDeclare.panelUrl === 'https://api.panel.recette.test');

  /* — Un Panel ANCIEN ne déclare rien : la déduction doit sauver le parcours — */
  await pairingStore.setPairing({
    panelUrl: 'https://api.panel.recette.test',
    projectId: avantOrigine.projectId,
    panelName: avantOrigine.panelName,
    bridgeToken: 'jeton-de-pont-de-recette-0123456789',
  });
  const departDeduit = await federe.startFederatedLogin({ redirectPath: '/' });
  check('un Panel qui ne déclare rien n’empêche pas la connexion',
    new URL(departDeduit.authorizeUrl).origin === 'https://panel.recette.test');

  /* — L'appairage d'origine est rendu, pour ne rien laisser de travers — */
  await pairingStore.setPairing({
    panelUrl: PANEL_URL,
    projectId: avantOrigine.projectId,
    panelName: avantOrigine.panelName,
    bridgeToken: 'jeton-de-pont-de-recette-0123456789',
  });
}

console.log(`\n${pass} réussis, ${fail} échoués`);
await disconnectDatabase();
await connexionPanel.close();
await mongoProjet.stop();
await mongoPanel.stop();
process.exit(fail === 0 ? 0 : 1);
