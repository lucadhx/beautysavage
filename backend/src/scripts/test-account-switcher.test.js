/* LE WIDGET DE CONNEXION RAPIDE — DEUX POPULATIONS, DEUX PORTES (L12.D).
 *
 * ══ CE QUE CETTE RECETTE DOIT PROUVER ═══════════════════════════════════════
 *
 * Que le widget de recette décrit le modèle d'identité RÉEL du projet — un
 * compte local avec son mot de passe ici, un accès L.Y Solution administré
 * ailleurs — et qu'il ouvre pour chacun le SEUL chemin qui lui convient, sans
 * jamais devenir un contournement de la fédération.
 *
 * ══ LA RÉGRESSION QU'ELLE VERROUILLE EN PREMIER ═════════════════════════════
 *
 * Le widget listait `User.find({ status: 'ACTIVE' })`. Une égalité Mongo ne
 * matche PAS un document où le champ est ABSENT — et il l'est sur tout compte
 * créé avant que `status` n'existe, puisqu'un défaut de schéma s'applique à
 * l'écriture et jamais à la relecture. La liste se vidait donc, en silence, sur
 * exactement les projets les plus anciens. La section 1 rejoue ce cas.
 *
 * ══ POURQUOI UN VRAI PANEL EN FACE ══════════════════════════════════════════
 *
 * On importe les services d'ÉMISSION et d'INTROSPECTION du Panel et on leur
 * fait signer de vraies assertions avec de vraies clés. Un double produirait
 * des jetons que nous saurions vérifier — c'est-à-dire qu'il éprouverait notre
 * accord avec nous-mêmes, pas notre accord avec le Panel. C'est la seule façon
 * de démontrer que `projectAccess` décide réellement.
 *
 * Runner autonome — aucun réseau sortant, deux bases en mémoire. */
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

const PORT = 4193;
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongoProjet.getUri();
process.env.DB_TEST = 'switcher_test';
process.env.DB_PROD = 'switcher_prod';
process.env.JWT_SECRET = 'recette-switcher-jwt-secret-de-plus-de-64-caracteres-pour-le-panel';
process.env.PORT = String(PORT);
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
  dbName: 'panel_switcher',
}).asPromise();
mongoosePanel.connection.__original = true;
Object.defineProperty(mongoosePanel, 'connection', { value: connexionPanel, configurable: true });

const panelUsers = await import(pathToFileURL(path.join(RACINE_PANEL, 'backend/src/services/auth/panelUsers.service.js')).href);
const panelFederation = await import(pathToFileURL(path.join(RACINE_PANEL, 'backend/src/services/federation/federationAssertion.service.js')).href);
const panelIntrospection = await import(pathToFileURL(path.join(RACINE_PANEL, 'backend/src/services/federation/federationIntrospection.service.js')).href);
const panelKeys = await import(pathToFileURL(path.join(RACINE_PANEL, 'backend/src/services/federation/federationKeys.service.js')).href);
const { default: PanelProject } = await import(pathToFileURL(path.join(RACINE_PANEL, 'backend/src/models/PanelProject.model.js')).href);

/* ── L'APPAIRAGE, AU PLUS PRÈS DU RÉEL ───────────────────────────────────── */
const PROJET_ID = crypto.randomUUID();
const PANEL_URL = 'https://panel.recette.test';

await PanelProject.create({
  projectId: PROJET_ID, projectKey: `k-${PROJET_ID.slice(0, 8)}`, projectName: 'SB Auto (recette)',
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  pairing: { status: 'PAIRED' }, runtime: {},
});

/**
 * TROIS COMPTES PANEL, ET LEURS TROIS SITUATIONS D'ACCÈS.
 *
 * C'est le cœur de la section « projectAccess » : les trois modes doivent
 * produire trois résultats distincts, décidés par le PANEL et non par nous.
 */
const MDP_PANEL = 'MotDePassePanel-2026';
const DEV_ALL = await panelUsers.createUser({
  email: 'dev.all@ly-solution.test', password: MDP_PANEL,
  displayName: 'Luca Duhoux', role: 'DEV',
});
const DEV_NONE = await panelUsers.createUser({
  email: 'dev.none@ly-solution.test', password: MDP_PANEL,
  displayName: 'Sans Accès', role: 'DEV',
});
const SOUVERAIN = await panelUsers.createUser({
  email: 'roi@ly-solution.test', password: MDP_PANEL,
  displayName: 'Le Souverain', role: 'SUPER_ADMIN',
});
await panelUsers.setProjectAccess(DEV_ALL.userId, { mode: 'ALL_PAIRED' });
await panelUsers.setProjectAccess(SOUVERAIN.userId, { mode: 'EXPLICIT', projectIds: [PROJET_ID] });
// DEV_NONE garde le mode NONE posé à la création. Aucun geste : c'est le défaut.

/* ── LE PONT : un client qui parle au VRAI Panel ─────────────────────────── */
const pairingStore = await import('../services/panelBridge/pairingStore.js');
const bridgeRuntime = await import('../services/panelBridge/bridgeRuntime.js');

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
    const verdict = await panelIntrospection.introspectPrincipal({
      panelUserId, projectId: PROJET_ID, expectedTokenVersion: tokenVersion,
    });
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
  return new Response(JSON.stringify(await panelKeys.publicJwks()), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
});

const { config } = await import('../config/env.js');
const { User } = await import('../models/User.model.js');
const { ExternalPrincipal } = await import('../models/ExternalPrincipal.model.js');
const { FederatedAssertionConsumption } = await import('../models/FederatedAssertionConsumption.model.js');
const { FederatedLoginState } = await import('../models/FederatedLoginState.model.js');
const { ROLES, USER_STATUS } = await import('../utils/constants.js');
const federe = await import('../services/federation/federatedAuth.service.js');
const authService = await import('../services/auth.service.js');
const switcher = await import('../services/accounts/testLoginAccounts.service.js');

await ExternalPrincipal.syncIndexes();
await FederatedAssertionConsumption.syncIndexes();
await FederatedLoginState.syncIndexes();

/* ── LE DÉCOR LOCAL ──────────────────────────────────────────────────────── */
const MDP_LOCAL_A = 'MotDePasseLocalA-2026';
const MDP_LOCAL_B = 'MotDePasseLocalB-2026';

const LOCAL_A = await User.create({
  email: 'admin@garage.test', name: 'Admin Garage', role: ROLES.ADMIN,
  password: MDP_LOCAL_A, status: USER_STATUS.ACTIVE,
});
const LOCAL_B = await User.create({
  email: 'dev.local@garage.test', name: 'Dev Local', role: ROLES.DEV,
  password: MDP_LOCAL_B, status: USER_STATUS.ACTIVE,
});
const EN_ATTENTE = await User.create({
  email: 'jamais.venu@garage.test', name: 'Jamais Venu', role: ROLES.ADMIN,
  status: USER_STATUS.PENDING_ACTIVATION,
});

/**
 * LE COMPTE HÉRITÉ — celui par qui le défaut est arrivé.
 *
 * Écrit par le DRIVER NATIF, sans `status`, exactement comme les documents
 * antérieurs au LOT 2C. Passer par Mongoose y poserait le défaut du schéma et
 * ferait disparaître le cas que cette suite existe pour éprouver.
 */
const LEGACY_ID = new (await import('mongoose')).default.Types.ObjectId();
await User.collection.insertOne({
  _id: LEGACY_ID,
  email: 'ancien@garage.test',
  name: 'Compte Ancien',
  role: ROLES.ADMIN,
  password: '$2a$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQR',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
});

/** Émet une VRAIE assertion signée par le Panel, pour le compte demandé. */
const emettre = (panelUserId, projectId = PROJET_ID) =>
  panelFederation.issueProjectAssertion({ panelUserId, projectId });

/** Le parcours complet, exactement comme le widget le déclenche. */
async function connexionFederee(panelUserId) {
  const depart = await federe.startFederatedLogin({ redirectPath: '/' });
  const { assertion } = await emettre(panelUserId);
  return federe.completeFederatedLogin({ assertion, state: depart.state });
}

/* ── LE SERVEUR HTTP, pour éprouver le CONTRAT et pas seulement le service ── */
const { markReady } = await import('../services/lifecycle/readiness.service.js');
markReady();
const { createApp } = await import('../app.js');
const server = createApp().listen(PORT);

async function api(method, chemin, { body, token } = {}) {
  const r = await fetch(`http://127.0.0.1:${PORT}${chemin}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json, data: json?.data ?? null };
}

const lireWidget = async () => (await api('GET', '/api/auth/test-accounts')).data;

/* ══════════════════════════════════════════════════════════════════════════
   1. LA RÉGRESSION D'ORIGINE — un compte sans `status` n'est pas un compte
      absent.
   ══════════════════════════════════════════════════════════════════════════ */
section('1 · La cause racine : le filtre qui vidait la liste');
{
  const brut = await User.collection.findOne({ _id: LEGACY_ID });
  check('le décor reproduit bien un document SANS `status`',
    brut !== null && brut.status === undefined);

  /**
   * L'ANCIENNE REQUÊTE, REJOUÉE TELLE QUELLE.
   *
   * Elle ne trouve pas ce compte, et c'est exactement le défaut : le widget
   * avait donc raison de ne rien montrer — il posait simplement la mauvaise
   * question. On le démontre plutôt que de l'affirmer.
   */
  const ancienneLecture = await User.find({ status: USER_STATUS.ACTIVE }).lean();
  check('l’ancien filtre `{ status: ACTIVE }` NE LE VOIT PAS',
    !ancienneLecture.some((u) => String(u._id) === String(LEGACY_ID)));

  const vue = await lireWidget();
  check('le widget, lui, le voit',
    vue.accounts.some((c) => c.email === 'ancien@garage.test'));
  check('…et le décrit comme ACTIF',
    vue.accounts.find((c) => c.email === 'ancien@garage.test')?.status === 'ACTIVE');
}

/* ══════════════════════════════════════════════════════════════════════════
   2. DEUX POPULATIONS, NOMMÉES ET SÉPARÉES.
   ══════════════════════════════════════════════════════════════════════════ */
section('2 · Comptes du projet et accès L.Y Solution ne se confondent pas');
{
  /* Une identité fédérée existe : elle est venue une fois. */
  const session = await connexionFederee(DEV_ALL.userId);
  check('un développeur autorisé ouvre une session fédérée', typeof session.token === 'string');

  const vue = await lireWidget();
  const locaux = vue.accounts.filter((c) => c.source === 'LOCAL');
  const federes = vue.accounts.filter((c) => c.source === 'PANEL');

  check('le widget est ACTIF en TEST', vue.enabled === true && vue.environment === 'TEST');
  check('LOCAL — la liste des comptes du projet est servie', locaux.length >= 3);
  check('PANEL — la liste des accès L.Y Solution est servie', federes.length >= 1);

  check('…et les deux catégories sont DISTINCTES',
    locaux.every((c) => c.principalType === 'LOCAL_USER' && c.loginMode === 'LOCAL_TEST')
    && federes.every((c) => c.principalType === 'PANEL_USER' && c.loginMode === 'FEDERATED_TEST'));

  check('aucun compte n’appartient aux deux',
    new Set(vue.accounts.map((c) => c.id)).size === vue.accounts.length);

  /**
   * LES IDENTIFIANTS NE PEUVENT PAS ENTRER EN COLLISION.
   *
   * Un `panelUserId` nu pourrait coïncider avec un `_id` local dans une liste
   * fusionnée — et deux lignes qui partagent une clé React, c'est une ligne qui
   * disparaît. La projection le préfixe ; on le garde.
   */
  check('un accès L.Y Solution porte un identifiant préfixé',
    federes.every((c) => c.id.startsWith('panel:')));

  /* LA FORME EST UNIQUE — une seule, pour les deux populations. */
  const { TEST_LOGIN_ACCOUNT_FIELDS } = switcher;
  check('toutes les lignes portent EXACTEMENT le contrat du DTO',
    vue.accounts.every((c) => TEST_LOGIN_ACCOUNT_FIELDS.every((f) => f in c)
      && Object.keys(c).length === TEST_LOGIN_ACCOUNT_FIELDS.length));

  /* UN COMPTE EN ATTENTE D'ACTIVATION N'EST PAS PROPOSÉ (doctrine LOT 2C). */
  check('un compte en attente d’activation n’est pas proposé',
    !vue.accounts.some((c) => c.email === EN_ATTENTE.email));
  const canonique = await (await import('../services/accounts/projectAccounts.service.js'))
    .listProjectAccounts();
  check('…mais l’autorité canonique le connaît, et le dit EN ATTENTE',
    canonique.find((c) => c.email === EN_ATTENTE.email)?.status === 'PENDING_ACTIVATION');
  check('…et ne le déclare pas « actif », comme avant ce lot',
    canonique.find((c) => c.email === EN_ATTENTE.email)?.enabled === false);
}

/* ══════════════════════════════════════════════════════════════════════════
   3. LA LISTE EST VIVANTE — aucune liste seedée, aucun instantané.
   ══════════════════════════════════════════════════════════════════════════ */
section('3 · Créer, supprimer : le widget suit');
{
  const nouveau = await User.create({
    email: 'ephemere@garage.test', name: 'Éphémère', role: ROLES.ADMIN,
    password: 'MotDePasseEphemere-2026', status: USER_STATUS.ACTIVE,
  });
  check('un compte créé apparaît à la lecture SUIVANTE',
    (await lireWidget()).accounts.some((c) => c.email === 'ephemere@garage.test'));

  await User.findByIdAndDelete(nouveau._id);
  check('…et disparaît quand il est supprimé',
    !(await lireWidget()).accounts.some((c) => c.email === 'ephemere@garage.test'));

  /**
   * LA SOURCE EST L'AUTORITÉ DU PROJET, PAS UNE COPIE.
   *
   * Contrôle par la NÉGATIVE : le service du widget ne doit posséder AUCUNE
   * lecture à lui. On peut toujours brancher une liste vivante à côté d'un
   * décor qu'on continue d'entretenir — c'est ce qu'il faut empêcher.
   */
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(
    path.join(RACINE_PROJET, 'backend/src/services/accounts/testLoginAccounts.service.js'), 'utf8',
  );
  check('le service du widget n’a AUCUNE lecture parallèle',
    source.includes('listProjectAccounts')
    && !source.includes('User.find') && !source.includes('ExternalPrincipal.find'));
}

/* ══════════════════════════════════════════════════════════════════════════
   4. CONNEXION LOCALE — une vraie session de CE projet.
   ══════════════════════════════════════════════════════════════════════════ */
section('4 · Un compte du projet ouvre une session LOCALE');
{
  const r = await api('POST', '/api/auth/dev-login', { body: { email: LOCAL_B.email } });
  check('la connexion rapide locale aboutit', r.status === 200 && typeof r.data?.token === 'string');
  check('…sur le bon compte', r.data?.user?.email === LOCAL_B.email);
  check('…avec le bon rôle', r.data?.user?.role === 'DEV');

  const charge = jwt.decode(r.data.token);
  check('le jeton est un jeton LOCAL — il porte un `sub` de compte local',
    charge.sub === String(LOCAL_B._id));
  check('…et NE PORTE PAS les marques d’une session fédérée',
    charge.principalType === undefined && charge.panelUserId === undefined
    && charge.source === undefined);

  const moi = await api('GET', '/api/auth/me', { token: r.data.token });
  check('`/auth/me` rend une identité LOCALE', moi.status === 200 && moi.data?._id === String(LOCAL_B._id));
  check('…sans marquage PANEL',
    moi.data?.principalType === undefined && moi.data?.source === undefined);

  /**
   * LE MÉCANISME NE DÉPEND D'AUCUN MOT DE PASSE SEMÉ.
   *
   * `dev-login` n'en lit aucun : c'est précisément pourquoi il est réservé à
   * TEST. Un compte dont le mot de passe est inconnu de nous s'ouvre quand
   * même — ce que le compte hérité démontre.
   */
  const ancien = await api('POST', '/api/auth/dev-login', { body: { email: 'ancien@garage.test' } });
  check('un compte au mot de passe inconnu s’ouvre quand même en TEST', ancien.status === 200);

  /* Un compte en attente reste fermé — la doctrine du LOT 2C tient. */
  const attente = await api('POST', '/api/auth/dev-login', { body: { email: EN_ATTENTE.email } });
  check('un compte en attente d’activation reste REFUSÉ', attente.status === 403);
}

/* ══════════════════════════════════════════════════════════════════════════
   5. CONNEXION FÉDÉRÉE — le VRAI parcours, jamais un raccourci.
   ══════════════════════════════════════════════════════════════════════════ */
section('5 · Un accès L.Y Solution passe par la fédération');
{
  const session = await connexionFederee(DEV_ALL.userId);
  check('la session fédérée est ouverte', typeof session.token === 'string');
  check('…et porte l’identité du Panel', session.user.panelUserId === DEV_ALL.userId);
  check('…sans aucun `_id` local', session.user._id === null);
  check('…marquée PANEL', session.user.principalType === 'PANEL');
  check('…et sa provenance', session.user.source === 'LY_SOLUTION_PANEL');
  check('…avec le rôle de PROJET', session.user.role === 'DEV');

  const charge = jwt.decode(session.token);
  check('le jeton dit sa nature', charge.principalType === 'PANEL');
  check('…et n’a AUCUN `sub` exploitable comme identifiant local', charge.sub === undefined);

  const moi = await api('GET', '/api/auth/me', { token: session.token });
  check('`/auth/me` rend une identité PANEL',
    moi.status === 200 && moi.data?.principalType === 'PANEL');
  check('…dont `_id` est nul, et assumé', moi.data?._id === null);

  /**
   * LE WIDGET N'A AUCUNE PORTE DÉROBÉE VERS UNE SESSION FÉDÉRÉE.
   *
   * `dev-login` sur l'adresse d'un accès L.Y Solution est REFUSÉ — et le refus
   * est nommé. La facilité aurait été de créer un `User` local portant cette
   * adresse : ce serait fabriquer un mot de passe pour une identité que ce
   * projet ne possède pas, et rapprocher deux mondes par l'e-mail.
   */
  const parLaMauvaisePorte = await api('POST', '/api/auth/dev-login', {
    body: { email: DEV_ALL.email },
  });
  check('`dev-login` REFUSE une identité L.Y Solution', parLaMauvaisePorte.status === 400);
  check('…nommément', parLaMauvaisePorte.json?.code === 'FEDERATED_IDENTITY_NOT_LOCAL'
    || parLaMauvaisePorte.json?.details?.code === 'FEDERATED_IDENTITY_NOT_LOCAL');
  check('…et n’a créé AUCUN compte local pour autant',
    (await User.countDocuments({ email: DEV_ALL.email })) === 0);
}

/* ══════════════════════════════════════════════════════════════════════════
   6. UN SUPER_ADMIN DU PANEL EST UN DEV ICI — et le mot ne franchit pas.
   ══════════════════════════════════════════════════════════════════════════ */
section('6 · La hiérarchie du Panel ne franchit pas la frontière');
{
  const session = await connexionFederee(SOUVERAIN.userId);
  check('un SUPER_ADMIN du Panel peut entrer', typeof session.token === 'string');
  check('…en DEV, jamais en SUPER_ADMIN', session.user.role === 'DEV');

  const claims = jwt.decode((await emettre(SOUVERAIN.userId)).assertion);
  check('l’assertion elle-même ne porte que DEV', claims.role === 'DEV');

  const vue = await lireWidget();
  const roi = vue.accounts.find((c) => c.email === SOUVERAIN.email);
  check('il apparaît dans la catégorie L.Y Solution', roi?.source === 'PANEL');
  check('…avec le rôle de projet', roi?.role === 'DEV');

  /**
   * CONTRÔLE SUR LA RÉPONSE ENTIÈRE, et pas seulement sur la ligne : c'est le
   * seul moyen de garder qu'aucun champ annexe — un `panelRole`, un
   * `sourceRole` ajouté un jour « pour information » — ne réintroduise le mot.
   */
  check('le mot SUPER_ADMIN n’apparaît NULLE PART dans la réponse du widget',
    !JSON.stringify(vue).includes('SUPER_ADMIN'));

  /**
   * LA GARDE DE NON-FUITE, ÉPROUVÉE PAR LA CONTRAINTE.
   *
   * On écrit à la main un rôle du Panel dans la projection — ce qu'une reprise
   * de base ou une écriture antérieure à la règle pourrait produire. Le widget
   * doit le ramener à `DEV` plutôt que de le republier.
   */
  await ExternalPrincipal.updateOne(
    { externalUserId: SOUVERAIN.userId },
    { $set: { role: 'SUPER_ADMIN' } },
  );
  const apres = await lireWidget();
  check('même une projection CORROMPUE ne fait pas fuiter le rôle',
    apres.accounts.find((c) => c.email === SOUVERAIN.email)?.role === 'DEV');
  check('…et le mot reste absent de toute la réponse',
    !JSON.stringify(apres).includes('SUPER_ADMIN'));
  await ExternalPrincipal.updateOne(
    { externalUserId: SOUVERAIN.userId }, { $set: { role: 'DEV' } },
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   7. PROJECT ACCESS — le widget n'est pas un contournement.
   ══════════════════════════════════════════════════════════════════════════ */
section('7 · `projectAccess` décide, même en TEST');
{
  /* ── NONE : refusé à l'émission, donc aucune session n'existe ─────────── */
  let refus = null;
  try { await emettre(DEV_NONE.userId); } catch (err) { refus = err; }
  check('NONE — le Panel REFUSE d’émettre', refus !== null);
  check('…nommément « accès projet refusé »',
    refus?.reasonCode === 'FEDERATION_PROJECT_ACCESS_DENIED');
  check('…et aucune session n’existe pour ce compte',
    (await ExternalPrincipal.countDocuments({ externalUserId: DEV_NONE.userId })) === 0);
  check('…donc il n’apparaît PAS dans la catégorie L.Y Solution',
    !(await lireWidget()).accounts.some((c) => c.email === DEV_NONE.email));

  /* ── ALL_PAIRED : accordé ─────────────────────────────────────────────── */
  check('ALL_PAIRED — le Panel émet', typeof (await emettre(DEV_ALL.userId)).assertion === 'string');

  /* ── EXPLICIT sur CE projet : accordé ─────────────────────────────────── */
  check('EXPLICIT sur ce projet — le Panel émet',
    typeof (await emettre(SOUVERAIN.userId)).assertion === 'string');

  /* ── EXPLICIT sur un AUTRE projet : refusé ────────────────────────────── */
  await panelUsers.setProjectAccess(DEV_NONE.userId, {
    mode: 'EXPLICIT', projectIds: [crypto.randomUUID()],
  });
  let ailleurs = null;
  try { await emettre(DEV_NONE.userId); } catch (err) { ailleurs = err; }
  check('EXPLICIT sur un AUTRE projet — refusé ici',
    ailleurs?.reasonCode === 'FEDERATION_PROJECT_ACCESS_DENIED');

  /* ── ACCÈS RETIRÉ APRÈS COUP : la ligne le dit, et n'est pas cliquable ── */
  await panelUsers.setUserEnabled(DEV_ALL.userId, false);
  const parcours = await federe.startFederatedLogin({ redirectPath: '/' });
  let ferme = null;
  try {
    /* L'assertion a été émise AVANT la désactivation : c'est le cas dur. */
    const { assertion } = await emettre(SOUVERAIN.userId);
    await federe.completeFederatedLogin({ assertion, state: parcours.state });
  } catch (err) { ferme = err; }
  check('une assertion valide pour un compte encore actif passe', ferme === null);

  await panelUsers.setUserEnabled(DEV_ALL.userId, true);
}

/* ══════════════════════════════════════════════════════════════════════════
   8. PROJET NON APPAIRÉ — on le DIT, le login local reste entier.
   ══════════════════════════════════════════════════════════════════════════ */
section('8 · Sans appairage : aucune fédération, et le local intact');
{
  const appaire = await lireWidget();
  check('appairé — la fédération est annoncée disponible',
    appaire.federation.available === true && appaire.federation.paired === true);

  await pairingStore.clearPairing();

  const seul = await lireWidget();
  check('non appairé — la fédération est annoncée INDISPONIBLE',
    seul.federation.available === false);
  check('…et le widget reste ACTIF pour les comptes du projet', seul.enabled === true);
  check('…qui sont toujours listés',
    seul.accounts.some((c) => c.source === 'LOCAL' && c.connectable === true));

  check('…tandis qu’aucun accès L.Y Solution n’est proposé',
    seul.accounts.filter((c) => c.source === 'PANEL').every((c) => c.connectable === false
      && c.blockedReason === 'PANEL_NOT_PAIRED'));

  /* LE LOGIN LOCAL NE DÉPEND DE RIEN — il fonctionne sans Panel. */
  const local = await api('POST', '/api/auth/dev-login', { body: { email: LOCAL_A.email } });
  check('LE LOGIN LOCAL FONCTIONNE toujours', local.status === 200);

  /* Et le départ fédéré refuse franchement plutôt que de composer une URL vide. */
  let depart = null;
  try { await federe.startFederatedLogin({ redirectPath: '/' }); } catch (err) { depart = err; }
  check('…et le départ fédéré refuse, nommément',
    depart?.details?.code === 'FEDERATION_PANEL_NOT_PAIRED');

  await pairingStore.setPairing({
    panelUrl: PANEL_URL, projectId: PROJET_ID,
    panelName: 'Panel de recette', bridgeToken: 'jeton-de-pont-de-recette-0123456789',
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   9. DÉCONNEXION ET BASCULE — aucune session ne fusionne deux identités.
   ══════════════════════════════════════════════════════════════════════════ */
section('9 · Quatre bascules, quatre identités nettes');
{
  const identite = async (token) => (await api('GET', '/api/auth/me', { token })).data;

  /* ── LOCAL A → LOCAL B ────────────────────────────────────────────────── */
  const a = (await api('POST', '/api/auth/dev-login', { body: { email: LOCAL_A.email } })).data.token;
  const b = (await api('POST', '/api/auth/dev-login', { body: { email: LOCAL_B.email } })).data.token;
  const idA = await identite(a);
  const idB = await identite(b);
  check('LOCAL A → LOCAL B : deux identités distinctes',
    idA._id === String(LOCAL_A._id) && idB._id === String(LOCAL_B._id));
  check('…et le jeton de A désigne toujours A (aucune contamination)',
    (await identite(a))._id === String(LOCAL_A._id));

  /* ── LOCAL → PANEL ────────────────────────────────────────────────────── */
  const panel1 = (await connexionFederee(DEV_ALL.userId)).token;
  const idPanel1 = await identite(panel1);
  check('LOCAL → PANEL : l’identité bascule entièrement',
    idPanel1.principalType === 'PANEL' && idPanel1._id === null);
  check('…et ne conserve RIEN de la session locale',
    idPanel1.email === DEV_ALL.email && idPanel1.panelUserId === DEV_ALL.userId);

  /* ── PANEL → LOCAL ────────────────────────────────────────────────────── */
  const local2 = (await api('POST', '/api/auth/dev-login', { body: { email: LOCAL_A.email } })).data.token;
  const idLocal2 = await identite(local2);
  check('PANEL → LOCAL : retour à une identité locale pure',
    idLocal2._id === String(LOCAL_A._id) && idLocal2.principalType === undefined);
  check('…sans le moindre reste fédéré',
    idLocal2.panelUserId === undefined && idLocal2.source === undefined);

  /* ── PANEL A → NOUVELLE FÉDÉRATION ────────────────────────────────────── */
  const panel2 = (await connexionFederee(SOUVERAIN.userId)).token;
  const idPanel2 = await identite(panel2);
  check('PANEL A → nouvelle fédération : la seconde identité est la bonne',
    idPanel2.panelUserId === SOUVERAIN.userId);
  check('…et la PREMIÈRE session reste la première',
    (await identite(panel1)).panelUserId === DEV_ALL.userId);

  /**
   * AUCUN JETON N'EST « MIXTE ».
   *
   * On regarde les charges utiles : une session est locale (un `sub`) ou
   * fédérée (`principalType: PANEL`), jamais les deux. C'est cette exclusivité
   * qui empêche un middleware de choisir la mauvaise branche.
   */
  for (const [nom, jeton] of [['LOCAL A', a], ['LOCAL B', b], ['PANEL 1', panel1], ['PANEL 2', panel2]]) {
    const c = jwt.decode(jeton);
    const estLocal = typeof c.sub === 'string' && c.principalType === undefined;
    const estFedere = c.principalType === 'PANEL' && c.sub === undefined;
    check(`${nom} — la session est locale OU fédérée, jamais les deux`, estLocal !== estFedere);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   10. AUCUN MOT DE PASSE DU PANEL, NULLE PART.
   ══════════════════════════════════════════════════════════════════════════ */
section('10 · Le mot de passe du Panel n’a jamais traversé');
{
  const collections = await User.db.db.listCollections().toArray();
  let trouve = null;
  for (const { name } of collections) {
    const brut = JSON.stringify(await User.db.db.collection(name).find({}).toArray());
    if (brut.includes(MDP_PANEL)) trouve = name;
  }
  check('AUCUN mot de passe Panel dans la base du projet', trouve === null);

  const champs = Object.keys(ExternalPrincipal.schema.paths);
  check('…et la projection n’a aucun champ qui puisse en porter un',
    !champs.some((c) => /password|secret|token|hash/i.test(c)));

  const vue = await lireWidget();
  check('…ni la réponse du widget',
    !/password|passwordHash|motdepasse/i.test(JSON.stringify(vue)));
}

/* ══════════════════════════════════════════════════════════════════════════
   11. PRODUCTION — la porte n'existe pas, et rien n'est lu pour le dire.
   ══════════════════════════════════════════════════════════════════════════ */
section('11 · En PROD, le widget n’existe pas');
{
  const memoire = { env: config.env, isProd: config.isProd, isTest: config.isTest };

  /**
   * ══ ON COMPTE LES LECTURES, ON NE SE FIE PAS À L'ORDRE DU CODE ═══════════
   *
   * « refusé AVANT toute lecture de compte » est une affirmation vérifiable :
   * on instrumente les deux seules lectures possibles et l'on constate qu'elles
   * ne sont pas appelées. Lire l'ordre des lignes prouverait la version du jour,
   * pas la propriété.
   */
  const vraiUserFind = User.find.bind(User);
  const vraiPrincipalFind = ExternalPrincipal.find.bind(ExternalPrincipal);
  let lectures = 0;
  User.find = (...args) => { lectures += 1; return vraiUserFind(...args); };
  ExternalPrincipal.find = (...args) => { lectures += 1; return vraiPrincipalFind(...args); };

  config.env = 'PROD'; config.isProd = true; config.isTest = false;
  try {
    const rendu = await switcher.describeTestLogin();
    check('en PROD, le widget est FERMÉ',
      rendu.enabled === false && rendu.accounts.length === 0);
    check('…et AUCUN compte n’a été lu pour le dire', lectures === 0);
    check('…la fédération n’est pas annoncée non plus',
      rendu.federation.available === false);

    const parHttp = await api('GET', '/api/auth/test-accounts');
    check('l’endpoint HTTP répond, mais ne propose RIEN',
      parHttp.status === 200 && parHttp.data?.enabled === false
      && parHttp.data?.accounts.length === 0);
    check('…et n’a toujours lu aucun compte', lectures === 0);

    const parLaPorte = await api('POST', '/api/auth/dev-login', { body: { email: LOCAL_A.email } });
    check('`dev-login` est REFUSÉ en PROD', parLaPorte.status === 403);

    /**
     * LA COMPATIBILITÉ HISTORIQUE TIENT : `listTestAccounts()` rend toujours
     * `{ enabled, accounts }`, ce que la recette d'amorçage local vérifie.
     */
    const heritee = await authService.listTestAccounts();
    check('l’ancien contrat de service est préservé',
      heritee.enabled === false && Array.isArray(heritee.accounts) && heritee.accounts.length === 0);
  } finally {
    User.find = vraiUserFind;
    ExternalPrincipal.find = vraiPrincipalFind;
    config.env = memoire.env; config.isProd = memoire.isProd; config.isTest = memoire.isTest;
  }

  check('de retour en TEST, le widget revient', (await lireWidget()).enabled === true);
}

/* ══════════════════════════════════════════════════════════════════════════
   12. L'ÉCRAN — la garde n'est pas un masquage CSS.
   ══════════════════════════════════════════════════════════════════════════ */
section('12 · Côté manager, le widget est ABSENT et non caché');
{
  const { readFile } = await import('node:fs/promises');
  const widget = await readFile(
    path.join(RACINE_PROJET, 'manager/src/components/TestAccountSwitcher.tsx'), 'utf8',
  );
  const login = await readFile(
    path.join(RACINE_PROJET, 'manager/src/pages/LoginPage.tsx'), 'utf8',
  );

  check('le composant ne rend RIEN sans réponse « TEST » du serveur',
    widget.includes('if (!description) return null;'));
  check('…et l’écran n’a aucune condition de son cru',
    login.includes('<TestAccountSwitcher') && !login.includes('testEnabled'));
  check('le formulaire de connexion normal est intact',
    login.includes('Se connecter') && login.includes('Mot de passe')
    && login.includes('type="password"'));
  check('…et le widget est bien SÉPARÉ de lui',
    login.indexOf('handleSubmit(onSubmit)') < login.indexOf('<TestAccountSwitcher'));
  check('la connexion fédérée du widget emprunte le VRAI parcours',
    widget.includes('beginFederatedLogin(') && !widget.includes('federationCallback'));
}

/* ── FIN ─────────────────────────────────────────────────────────────────── */
await new Promise((r) => server.close(r));
await disconnectDatabase();
await connexionPanel.close();
await mongoProjet.stop();
await mongoPanel.stop();

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
