/**
 * L'AMORÇAGE SÉCURISÉ DU PREMIER DÉVELOPPEUR LOCAL — LOT 2C.
 *
 * ══ CE QUE CETTE SUITE GARDE ════════════════════════════════════════════════
 *
 * Elle éprouvait le contraire : « le seed crée un compte DEV avec le mot de
 * passe fourni, et `123dev` à défaut ». Ce contrat était le défaut lui-même —
 * un secret universel, écrit en clair dans chaque `.env` dupliqué.
 *
 * Elle garde désormais quatre propriétés, et aucune ne se relit dans le code
 * sans effort :
 *
 *   · AUCUN mot de passe n'est jamais posé par le produit — le compte naît
 *     sans, et son titulaire choisit le sien ;
 *   · un compte sans mot de passe ne peut entrer par AUCUNE porte, y compris
 *     la connexion rapide de TEST, qui est la plus facile à oublier ;
 *   · le lien d'activation est à usage UNIQUE et expire — les deux sont
 *     vérifiés sur le vrai chemin HTTP, pas sur le service ;
 *   · sans adresse explicite, RIEN n'est créé. C'est le remplacement direct de
 *     `dev@mail.com`, et c'est un refus, pas un repli.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'seed_dev_test';
process.env.DB_PROD = 'seed_dev_prod';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4149';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NGROK_API_URL = 'http://127.0.0.1:1'; // hermétique à un vrai tunnel

// « Saisi dans l'assistant de duplication » — une IDENTITÉ, aucun secret.
process.env.FIRST_DEV_EMAIL = 'dev@dupont.fr';
process.env.FIRST_DEV_NAME = 'Camille Dupont';
delete process.env.SEED_DEV_EMAIL;
delete process.env.SEED_DEV_PASSWORD;

let pass = 0;
let fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { seedDefaultUsers, bootstrap } = await import('../config/bootstrap.js');
const { User } = await import('../models/User.model.js');
const { LocalDevActivation } = await import('../models/LocalDevActivation.model.js');
const { SystemConfiguration } = await import('../models/SystemConfiguration.model.js');
const { getSingleton } = await import('../utils/singleton.js');
const { ROLES, USER_STATUS } = await import('../utils/constants.js');
const bootstrapSvc = await import('../services/localDevBootstrap.service.js');
const { DomainEvent } = await import('../models/DomainEvent.model.js');

await connectDatabase();

/**
 * LE FAUX PLAN DE CONTRÔLE — même seam que `email-delivery.test.js`.
 *
 * Il n'existe pas pour rendre l'envoi facile : il existe pour que « le lien
 * part et il est unique » soit éprouvable sans monter un Panel appairé. Ce
 * qu'on capture ici, c'est le CONTENU du message — donc l'URL, donc le token.
 */
const envois = [];
const PLAN_OK = {
  available: () => true,
  async invoke(code, input) {
    envois.push({ code, input });
    return {
      capability: code,
      outcome: 'SUCCEEDED',
      operationId: input.operationId,
      result: { status: 'ACCEPTED', providerMessageId: `<a-${envois.length}@test>`, operationId: input.operationId },
    };
  },
};
const PLAN_INDISPONIBLE = {
  available: () => false,
  async invoke() { throw new Error('plan de contrôle indisponible'); },
};

/** Le token brut ne vit QUE dans l'URL du message — comme en exploitation. */
function dernierToken() {
  const dernier = envois[envois.length - 1];
  const url = dernier?.input?.variables?.['auth.activationUrl']
    ?? JSON.stringify(dernier?.input ?? {}).match(/token=([\w-]+)/)?.[1];
  const m = String(url).match(/token=([\w.~-]+)/);
  return m ? m[1] : String(url || '');
}

let server = null;
const base = 'http://localhost:4149';
async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

try {
  /* ══════════════════════════════════════════════════════════════════════════
     1. LE PRODUIT NE POSE PLUS AUCUN MOT DE PASSE.
     ══════════════════════════════════════════════════════════════════════════ */
  section('1 · Un compte naît SANS mot de passe');
  const cfg = await getSingleton(SystemConfiguration);
  cfg.network = { ...(cfg.network || {}), managerUrl: 'https://manager.dupont.fr' };
  await cfg.save();

  const cree = await bootstrapSvc.ensureInitialLocalUser({
    email: process.env.FIRST_DEV_EMAIL,
    name: process.env.FIRST_DEV_NAME,
    role: ROLES.DEV,
    controlPlane: PLAN_OK,
  });
  check('le premier développeur local est créé', cree.status === 'CREATED');

  const dev = await User.findOne({ role: ROLES.DEV }).select('+password');
  check('…avec l’adresse explicitement fournie', dev?.email === 'dev@dupont.fr');
  check('…et son nom', dev?.name === 'Camille Dupont');
  check('…EN ATTENTE D’ACTIVATION', dev?.status === USER_STATUS.PENDING_ACTIVATION);
  check('…et SANS AUCUN mot de passe en base', !dev?.password);
  check('…pas même un hash aléatoire inatteignable', dev?.password === undefined || dev?.password === null);

  check('un lien d’activation a été émis', (await LocalDevActivation.countDocuments()) === 1);
  const activation = await LocalDevActivation.findOne();
  check('…stocké HACHÉ, jamais en clair', /^[a-f0-9]{64}$/.test(activation.tokenHash));
  check('…avec une expiration', activation.expiresAt > new Date());
  check('…et l’e-mail est parti', activation.emailStatus === 'SENT' && cree.emailSent === true);

  const tokenBrut = dernierToken();
  check('le token BRUT n’existe que dans l’URL du message', tokenBrut.length > 20);
  check('…et n’est NULLE PART en base', (await LocalDevActivation.countDocuments({ tokenHash: tokenBrut })) === 0);

  /* ══════════════════════════════════════════════════════════════════════════
     2. AUCUNE PORTE NE S'OUVRE AVANT L'ACTIVATION.
     ══════════════════════════════════════════════════════════════════════════ */
  section('2 · Aucun accès avant activation');
  const { createApp } = await import('../app.js');
  /**
   * LE SERVICE EST DÉCLARÉ PRÊT — une suite qui démarre a fini de démarrer.
   *
   * Le backend distingue « vivant » et « prêt » : il ouvre son port
   * immédiatement et refuse les routes métier en `503 SERVICE_STARTING` tant
   * que l'amorçage n'est pas terminé. Cette suite a déjà fait, à la main et
   * dans l'ordre, tout ce que l'amorçage fait. Sans cette ligne, chaque appel
   * recevrait un 503 et l'on lirait un défaut d'activation là où il n'y a
   * qu'un service qui s'estime encore en train de naître.
   */
  const { markReady } = await import('../services/lifecycle/readiness.service.js');
  markReady();
  server = createApp().listen(4149);

  const avant = await api('POST', '/api/auth/login', { email: 'dev@dupont.fr', password: 'nimporte-quoi' });
  check('connexion refusée avant activation', avant.status === 401);
  check('…avec un message GÉNÉRIQUE (aucune énumération)',
    /incorrect/i.test(avant.json?.message || '') && !/activ/i.test(avant.json?.message || ''));

  const rapide = await api('POST', '/api/auth/dev-login', { email: 'dev@dupont.fr' });
  check('la connexion rapide de TEST le refuse AUSSI', rapide.status === 403);

  const listeTest = await api('GET', '/api/auth/test-accounts');
  check('…et ne le propose même pas',
    !(listeTest.json?.data?.accounts || []).some((c) => c.email === 'dev@dupont.fr'));

  const oubli = await api('POST', '/api/auth/forgot-password', { email: 'dev@dupont.fr' });
  check('« mot de passe oublié » ne crée PAS un second chemin', oubli.status === 200);
  check('…et n’émet aucun lien de réinitialisation',
    !(await User.findOne({ email: 'dev@dupont.fr' }).select('+passwordReset'))?.passwordReset?.tokenHash);

  /* ══════════════════════════════════════════════════════════════════════════
     3. LE LIEN — usage unique, expiration, politique de mot de passe.
     ══════════════════════════════════════════════════════════════════════════ */
  section('3 · Le lien s’use, expire, et impose la politique');
  const etat = await api('GET', `/api/auth/activation?token=${encodeURIComponent(tokenBrut)}`);
  check('le lien est reconnu valide', etat.json?.data?.valid === true);
  check('…et ne divulgue PAS l’adresse', !JSON.stringify(etat.json).includes('dev@dupont.fr'));

  check('un lien inconnu est refusé',
    (await api('GET', '/api/auth/activation?token=' + 'x'.repeat(43))).json?.data?.valid === false);

  const courtDeTrop = await api('POST', '/api/auth/activate-account', {
    token: tokenBrut, newPassword: '12345', confirmPassword: '12345',
  });
  check('un mot de passe trop court est refusé', courtDeTrop.status === 400);

  const discordant = await api('POST', '/api/auth/activate-account', {
    token: tokenBrut, newPassword: 'Dupont-2026', confirmPassword: 'Dupont-2027',
  });
  check('deux saisies différentes sont refusées', discordant.status === 400);

  const ok = await api('POST', '/api/auth/activate-account', {
    token: tokenBrut, newPassword: 'Dupont-2026', confirmPassword: 'Dupont-2026',
  });
  check('le mot de passe choisi est ACCEPTÉ', ok.status === 200);

  const rejeu = await api('POST', '/api/auth/activate-account', {
    token: tokenBrut, newPassword: 'Autre-Mot-2026', confirmPassword: 'Autre-Mot-2026',
  });
  check('le MÊME lien ne resert PAS', rejeu.status === 400);
  check('…et le dit par un code stable', rejeu.json?.code === 'LOCAL_DEV_ACTIVATION_INVALID');

  /* L'EXPIRATION, éprouvée en vieillissant le document — pas en attendant. */
  const bis = await User.create({
    email: 'perime@dupont.fr', name: 'Périmé', role: ROLES.ADMIN, status: USER_STATUS.PENDING_ACTIVATION,
  });
  const { rawToken: tokenPerime, activation: actPerimee } = await bootstrapSvc.issueActivation(bis);
  await LocalDevActivation.updateOne({ _id: actPerimee._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const perime = await api('POST', '/api/auth/activate-account', {
    token: tokenPerime, newPassword: 'Perime-2026', confirmPassword: 'Perime-2026',
  });
  check('un lien EXPIRÉ est refusé', perime.status === 400 && perime.json?.code === 'LOCAL_DEV_ACTIVATION_INVALID');

  /* ══════════════════════════════════════════════════════════════════════════
     4. APRÈS ACTIVATION — un compte local ordinaire, autonome.
     ══════════════════════════════════════════════════════════════════════════ */
  section('4 · Après activation, un compte local de plein droit');
  const connexion = await api('POST', '/api/auth/login', { email: 'dev@dupont.fr', password: 'Dupont-2026' });
  check('la connexion locale fonctionne', connexion.status === 200);
  check('…avec le rôle DEV', connexion.json?.data?.user?.role === ROLES.DEV);
  check('…et un jeton local', Boolean(connexion.json?.data?.token));

  const apres = await User.findOne({ email: 'dev@dupont.fr' }).select('+password');
  check('le compte est ACTIF', apres.status === USER_STATUS.ACTIVE);
  check('…son mot de passe est HACHÉ', apres.password && apres.password !== 'Dupont-2026');

  /**
   * AUCUNE DÉPENDANCE AU PANEL. Le plan de contrôle a servi à porter UN
   * e-mail ; la connexion, elle, n'a rien demandé à personne. C'est la
   * propriété que le lot exige : projet non appairé, Panel éteint, appairage
   * révoqué — le développeur local entre quand même.
   */
  const sansPlan = await api('POST', '/api/auth/login', { email: 'dev@dupont.fr', password: 'Dupont-2026' });
  check('…et ne dépend d’AUCUN Panel', sansPlan.status === 200);

  /* ══════════════════════════════════════════════════════════════════════════
     5. SANS ADRESSE EXPLICITE — on ne crée RIEN.
     ══════════════════════════════════════════════════════════════════════════ */
  section('5 · Fail-closed : pas d’adresse, pas de compte');
  await User.deleteMany({});
  await LocalDevActivation.deleteMany({});
  delete process.env.FIRST_DEV_EMAIL;
  delete process.env.FIRST_DEV_NAME;

  const rien = await seedDefaultUsers();
  check('aucun compte n’est créé sans FIRST_DEV_EMAIL', rien.length === 0);
  check('…et surtout AUCUN dev@mail.com', (await User.countDocuments({ email: 'dev@mail.com' })) === 0);
  check('…ni admin@mail.com', (await User.countDocuments({ email: 'admin@mail.com' })) === 0);
  check('…la base reste vide', (await User.countDocuments()) === 0);

  const invalide = await bootstrapSvc.ensureInitialLocalUser({ email: 'pas-un-email', role: ROLES.DEV });
  check('une adresse invalide bloque aussi', invalide.status === 'FIRST_DEV_REQUIRED');
  check('…sans rien créer', (await User.countDocuments()) === 0);

  /* ══════════════════════════════════════════════════════════════════════════
     6. IDEMPOTENCE ET NON-ÉCRASEMENT — les gardes d'origine, conservées.
     ══════════════════════════════════════════════════════════════════════════ */
  section('6 · Idempotent, et jamais destructeur');
  process.env.FIRST_DEV_EMAIL = 'premier@dupont.fr';
  await bootstrapSvc.ensureInitialLocalUser({ email: 'premier@dupont.fr', role: ROLES.DEV, controlPlane: PLAN_OK });
  const premier = await User.findOne({ role: ROLES.DEV });
  await bootstrapSvc.activateAccount(dernierToken(), 'Premier-2026');

  const second = await bootstrapSvc.ensureInitialLocalUser({ email: 'second@dupont.fr', role: ROLES.DEV, controlPlane: PLAN_OK });
  check('un second développeur n’est PAS créé automatiquement', second.status === 'ALREADY_PRESENT');
  check('…il n’y a toujours qu’un compte DEV', (await User.countDocuments({ role: ROLES.DEV })) === 1);
  const inchange = await User.findById(premier._id).select('+password');
  check('…et le premier n’est pas altéré',
    inchange.email === 'premier@dupont.fr' && inchange.status === USER_STATUS.ACTIVE);
  check('…son mot de passe est intact', await inchange.comparePassword('Premier-2026'));

  await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();
  check('un bootstrap complet ne crée aucun doublon', (await User.countDocuments({ role: ROLES.DEV })) === 1);

  /* ══════════════════════════════════════════════════════════════════════════
     7. PLATEFORME D'ENVOI INDISPONIBLE — surtout PAS de mot de passe de repli.
     ══════════════════════════════════════════════════════════════════════════ */
  section('7 · L’e-mail ne part pas : le compte attend, il ne s’ouvre pas');
  await User.deleteMany({});
  await LocalDevActivation.deleteMany({});

  const horsLigne = await bootstrapSvc.ensureInitialLocalUser({
    email: 'hors-ligne@dupont.fr', name: 'Hors ligne', role: ROLES.DEV, controlPlane: PLAN_INDISPONIBLE,
  });
  check('le compte est tout de même créé', horsLigne.status === 'CREATED');
  check('…mais l’envoi est signalé en ÉCHEC', horsLigne.emailSent === false);
  const enPanne = await User.findOne({ email: 'hors-ligne@dupont.fr' }).select('+password');
  check('…le compte reste SANS mot de passe', !enPanne.password);
  check('…et en attente d’activation', enPanne.status === USER_STATUS.PENDING_ACTIVATION);
  const actEnPanne = await LocalDevActivation.findOne({ userId: enPanne._id });
  check('l’état d’envoi est ENREGISTRÉ, pas seulement journalisé', actEnPanne.emailStatus === 'ERROR');
  check('…avec une raison lisible et sans secret',
    actEnPanne.emailErrorSafe.length > 0 && !/token|password/i.test(actEnPanne.emailErrorSafe));

  const etatAmorcage = await bootstrapSvc.describeBootstrapStatus();
  check('l’exploitant peut voir qu’un lien reste à renvoyer',
    etatAmorcage.pendingAccounts.some((c) => c.email === 'hors-ligne@dupont.fr' && c.activationEmailStatus === 'ERROR'));

  /* L'URL du manager absente est l'autre panne — même conclusion. */
  const cfg2 = await getSingleton(SystemConfiguration);
  cfg2.network = { ...(cfg2.network || {}), managerUrl: '' };
  await cfg2.save();
  await User.deleteMany({ email: 'sans-url@dupont.fr' });
  const sansUrl = await bootstrapSvc.ensureInitialLocalUser({
    email: 'sans-url@dupont.fr', role: ROLES.ADMIN, controlPlane: PLAN_OK,
  });
  check('sans URL de manager, aucun lien ne part', sansUrl.emailSent === false);
  check('…et aucun mot de passe de repli n’est inventé',
    !(await User.findOne({ email: 'sans-url@dupont.fr' }).select('+password'))?.password);
  cfg2.network = { ...(cfg2.network || {}), managerUrl: 'https://manager.dupont.fr' };
  await cfg2.save();

  /* ══════════════════════════════════════════════════════════════════════════
     8. RENVOI — un nouveau lien tue l'ancien.
     ══════════════════════════════════════════════════════════════════════════ */
  section('8 · Le renvoi invalide le lien précédent');
  await User.deleteMany({});
  await LocalDevActivation.deleteMany({});
  await bootstrapSvc.ensureInitialLocalUser({ email: 'renvoi@dupont.fr', role: ROLES.DEV, controlPlane: PLAN_OK });
  const ancienToken = dernierToken();

  /* Un renvoi IMMÉDIAT ne doit rien émettre : sinon ce formulaire public
     deviendrait un moyen commode d'inonder la boîte d'un tiers. */
  await bootstrapSvc.resendActivation('renvoi@dupont.fr', { controlPlane: PLAN_OK });
  check('un renvoi immédiat est ignoré (délai d’attente)', dernierToken() === ancienToken);

  /**
   * Le délai d'attente est contourné en VIEILLISSANT la demande — jamais en
   * l'assouplissant : c'est la garde qu'on veut conserver, pas contourner.
   *
   * Par le DRIVER NATIF : Mongoose rend `createdAt` immuable, et un `$set`
   * passant par le modèle serait silencieusement ignoré — le test aurait alors
   * éprouvé le délai d'attente en croyant éprouver le renvoi.
   */
  await LocalDevActivation.collection.updateMany(
    {}, { $set: { createdAt: new Date(Date.now() - 10 * 60 * 1000) } }
  );
  await bootstrapSvc.resendActivation('renvoi@dupont.fr', { controlPlane: PLAN_OK });
  const nouveauToken = dernierToken();
  check('un nouveau lien est émis', nouveauToken !== ancienToken);

  const ancienMort = await api('POST', '/api/auth/activate-account', {
    token: ancienToken, newPassword: 'Renvoi-2026', confirmPassword: 'Renvoi-2026',
  });
  check('l’ANCIEN lien est mort', ancienMort.status === 400);
  const nouveauVivant = await api('POST', '/api/auth/activate-account', {
    token: nouveauToken, newPassword: 'Renvoi-2026', confirmPassword: 'Renvoi-2026',
  });
  check('le NOUVEAU fonctionne', nouveauVivant.status === 200);

  const inconnu = await api('POST', '/api/auth/activation/resend', { email: 'personne@dupont.fr' });
  check('un renvoi pour une adresse inconnue répond pareil', inconnu.status === 200);
  check('…sans révéler quoi que ce soit',
    /Si un compte/i.test(inconnu.json?.data?.message || ''));

  /* ══════════════════════════════════════════════════════════════════════════
     8bis. LA CONNEXION SANS PREUVE N'EXISTE PAS EN PRODUCTION.
     ══════════════════════════════════════════════════════════════════════════ */
  section('8bis · `dev-login` est inatteignable hors TEST');
  {
    /**
     * C'est la SEULE porte du projet qui ouvre une session sans mot de passe.
     * Le lot 2C l'a auditée plutôt que supprimée : elle rend la recette locale
     * praticable, et sa garde n'est pas un réglage de confort mais
     * l'environnement lui-même.
     *
     * On bascule donc `config` en PROD — le vrai objet lu par le service — et
     * l'on constate le refus. Sans ce contrôle, « PROD → impossible » ne
     * serait qu'une intention écrite en commentaire.
     */
    const { config } = await import('../config/env.js');
    const memoire = { env: config.env, isProd: config.isProd, isTest: config.isTest };
    config.env = 'PROD'; config.isProd = true; config.isTest = false;
    try {
      const { devLogin, listTestAccounts } = await import('../services/auth.service.js');
      let refuse = false;
      try { await devLogin('renvoi@dupont.fr'); } catch { refuse = true; }
      check('en PROD, `dev-login` REFUSE toute connexion', refuse);
      const liste = await listTestAccounts();
      check('…et la liste des comptes de recette est vide',
        liste.enabled === false && liste.accounts.length === 0);
    } finally {
      config.env = memoire.env; config.isProd = memoire.isProd; config.isTest = memoire.isTest;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     9. OBSERVABILITÉ — les faits sont tracés, les secrets jamais.
     ══════════════════════════════════════════════════════════════════════════ */
  section('9 · Journalisé sans secret');
  const evenements = await DomainEvent.find({ type: /^localdev\./ }).lean();
  const types = new Set(evenements.map((e) => e.type));
  check('LOCAL_DEV_CREATED est tracé', types.has('localdev.created'));
  check('LOCAL_DEV_ACTIVATION_SENT est tracé', types.has('localdev.activation.sent'));
  check('LOCAL_DEV_ACTIVATED est tracé', types.has('localdev.activated'));
  check('LOCAL_DEV_ACTIVATION_FAILED est tracé', types.has('localdev.activation.failed'));

  const serialise = JSON.stringify(evenements);
  check('aucun mot de passe dans les traces', !/Dupont-2026|Renvoi-2026|Premier-2026/.test(serialise));
  check('aucun token d’activation dans les traces', !serialise.includes(nouveauToken));
  check('aucun hash de mot de passe dans les traces', !/\$2[aby]\$/.test(serialise));
  check('les adresses sont MASQUÉES', !serialise.includes('renvoi@dupont.fr'));

  /* ══════════════════════════════════════════════════════════════════════════
     10. LE CLIQUET — aucun secret universel ne peut revenir dans le PRODUIT.

     ══ POURQUOI UN SCAN, ET POURQUOI IL DISTINGUE TROIS CHOSES ═══════════════

     Interdire la chaîne `123dev` partout serait simple et faux : elle doit
     rester lisible dans une liste noire (pour reconnaître un compte hérité) et
     dans un décor de test (pour éprouver le métier sur une base jetable). Ce
     qui doit être impossible, c'est qu'elle serve à ÉCRIRE un mot de passe.

     Le scan trace donc la frontière là où elle a un sens : dans `src/` hors
     `scripts/` — le code réellement livré et exécuté par chaque projet du parc
     — aucune de ces valeurs ne doit apparaître autrement que dans un
     commentaire. Un commentaire ne s'authentifie pas.
     ══════════════════════════════════════════════════════════════════════════ */
  section('10 · Aucun secret universel ne peut revenir dans le produit');
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const racineSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

    const fichiers = [];
    (function parcourir(dir) {
      for (const entree of fs.readdirSync(dir, { withFileTypes: true })) {
        const complet = path.join(dir, entree.name);
        if (entree.isDirectory()) {
          // `scripts/` est le harnais de recette : décors et listes noires y vivent.
          if (entree.name === 'scripts' || entree.name === 'node_modules') continue;
          parcourir(complet);
        } else if (/\.(js|mjs)$/.test(entree.name)) {
          fichiers.push(complet);
        }
      }
    }(racineSrc));

    /** Une ligne de commentaire ne fabrique aucun identifiant. */
    const estCommentaire = (ligne) => /^\s*(\/\/|\/\*|\*)/.test(ligne);

    /**
     * ══ LA LISTE NOIRE EST EXEMPTÉE, ET SA PRÉSENCE EST EXIGÉE ═══════════════
     *
     * `utils/universalSecrets.js` CONTIENT `123dev` et `123admin` : c'est sa
     * raison d'être — il les REFUSE, il ne les utilise pas. Un scan qui le
     * signalerait punirait la défense au lieu du défaut, et le premier réflexe
     * serait d'affaiblir le scan.
     *
     * L'exemption est donc NOMMÉE, et assortie de son contraire : le fichier
     * doit exister et contenir les deux valeurs. Sans quoi il suffirait de
     * vider la liste noire pour rendre le scan vert — en rouvrant exactement
     * la porte qu'il garde.
     */
    const LISTE_NOIRE = path.join(racineSrc, 'utils', 'universalSecrets.js');

    const coupables = [];
    for (const fichier of fichiers) {
      if (fichier === LISTE_NOIRE) continue;
      const lignes = fs.readFileSync(fichier, 'utf8').split(/\r?\n/);
      lignes.forEach((ligne, i) => {
        if (estCommentaire(ligne)) return;
        if (/123dev|123admin/.test(ligne)) {
          coupables.push(`${path.relative(racineSrc, fichier)}:${i + 1}`);
        }
      });
    }
    check('aucun secret universel actif dans le code livré', coupables.length === 0);

    const listeNoire = fs.existsSync(LISTE_NOIRE) ? fs.readFileSync(LISTE_NOIRE, 'utf8') : '';
    check('…et la liste noire des secrets diffusés EXISTE',
      listeNoire.includes('123dev') && listeNoire.includes('123admin'));
    check('…elle est bien un REFUS, jamais une écriture',
      /isUniversalSecret/.test(listeNoire) && !/password\s*=/.test(listeNoire));
    if (coupables.length) coupables.forEach((c) => console.error('      →', c));

    /** Et aucun mot de passe ne se lit plus depuis l'environnement. */
    const lecturesEnv = [];
    for (const fichier of fichiers) {
      const lignes = fs.readFileSync(fichier, 'utf8').split(/\r?\n/);
      lignes.forEach((ligne, i) => {
        if (estCommentaire(ligne)) return;
        /**
         * LE NOM DOIT SE TERMINER PAR `PASSWORD`, ET LA NUANCE COMPTE.
         *
         * `PASSWORD_RESET_TTL_MINUTES` est une DURÉE. Un contrôle qui la
         * signalerait apprendrait à son lecteur à ignorer ses propres alertes
         * — et c'est ainsi qu'on finit par ne plus voir la vraie.
         */
        if (/process\.env\.[A-Z_]*PASSWORD(?![A-Z_])/.test(ligne)) {
          lecturesEnv.push(`${path.relative(racineSrc, fichier)}:${i + 1}`);
        }
      });
    }
    check('aucun mot de passe n’est lu depuis l’environnement', lecturesEnv.length === 0);
    if (lecturesEnv.length) lecturesEnv.forEach((c) => console.error('      →', c));

    /**
     * LE MOTEUR DE DUPLICATION N'ÉCRIT AUCUN MOT DE PASSE.
     *
     * C'est le contrôle le plus important du lot : c'est par lui que le secret
     * universel se propageait, projet après projet.
     */
    const moteur = fs.readFileSync(path.join(racineSrc, 'duplication-engine', 'duplication.js'), 'utf8');
    check('le moteur de duplication n’accepte plus de mot de passe',
      !/devPassword\s*[,:}]/.test(moteur.split('\n').filter((l) => !estCommentaire(l)).join('\n'))
      || /FIRST_DEV_PASSWORD_REFUSED/.test(moteur));
    check('…et n’écrit aucune variable de mot de passe',
      !/ENV_KEYS\.(seedDevPassword|firstDevPassword)/.test(moteur));

    /**
     * LA CONNEXION RAPIDE RESTE INATTEIGNABLE EN PRODUCTION.
     *
     * `/dev-login` ouvre une session SANS preuve. C'est acceptable en recette
     * — et seulement là. La garde n'est pas un réglage de confort : elle est la
     * PREMIÈRE instruction de la fonction, avant toute lecture de compte, de
     * sorte qu'aucun chemin ne puisse la contourner par un retour anticipé.
     */
    const service = fs.readFileSync(path.join(racineSrc, 'services', 'auth.service.js'), 'utf8');
    const corpsDevLogin = service.slice(
      service.indexOf('export async function devLogin'),
      service.indexOf('export async function updateProfile'),
    );
    check('la connexion rapide est refusée hors TEST',
      /if\s*\(!config\.isTest\)\s*throw/.test(corpsDevLogin));
    check('…et la garde est la PREMIÈRE instruction',
      corpsDevLogin.indexOf('config.isTest') < corpsDevLogin.indexOf('User.findOne'));
    check('…elle refuse aussi un compte en attente d’activation',
      /isPendingActivation\(\)/.test(corpsDevLogin));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     LA DETTE D'ACTIVATION — l'événement métier et la condition technique.

     ══ CE QUE CETTE SECTION EXISTE POUR EMPÊCHER ════════════════════════════

     Sur le premier projet dupliqué : le compte est créé au premier démarrage
     (événement métier), l'envoi échoue parce que le courriel passe par le
     Panel et que le projet n'est pas encore appairé (condition technique), et
     PLUS RIEN ensuite. Le jeton a expiré, l'appairage est arrivé, le projet a
     été déployé — et le lien n'est parti que parce qu'un humain a pensé à
     cliquer sur « renvoyer ».

     La reprise doit donc être durable, idempotente, observable, sans double
     envoi, sans perte au redémarrage — et sans jamais envoyer « au cas où ».
     ══════════════════════════════════════════════════════════════════════════ */
  section('12 · Un lien d’activation qui n’a pas pu partir est une dette');
  await User.deleteMany({});
  await LocalDevActivation.deleteMany({});

  /* — Le fournisseur est absent : le compte naît, le lien ne part pas — */
  const dette = await bootstrapSvc.ensureInitialLocalUser({
    email: 'dette@dupont.fr', name: 'Dette', role: ROLES.DEV, controlPlane: PLAN_INDISPONIBLE,
  });
  check('le compte est créé malgré le fournisseur absent', dette.status === 'CREATED');
  check('…et l’envoi a bien échoué', dette.emailSent === false);

  const du = await bootstrapSvc.pendingActivationDelivery();
  check('une obligation d’envoi est DUE', du.due === true);
  check('…et elle nomme le compte concerné', du.accounts.length === 1);

  /* — Un redémarrage seul n'envoie RIEN : le fournisseur manque toujours — */
  const auRedemarrage = await bootstrapSvc.deliverPendingActivations({
    controlPlane: PLAN_INDISPONIBLE,
    // Au-delà du délai de garde : ce n'est pas lui qui doit retenir l'envoi ici.
    now: Date.now() + bootstrapSvc.RESEND_COOLDOWN_MS + 1000,
  });
  check('un redémarrage sans fournisseur ne résout pas la dette', auRedemarrage.done === false);
  check('…et aucun lien n’est parti', auRedemarrage.sent === 0);
  const toujoursDu = await bootstrapSvc.pendingActivationDelivery();
  check('…l’obligation reste due', toujoursDu.due === true);

  /* — Le fournisseur arrive (appairage) : la dette est soldée, une fois — */
  const solde = await bootstrapSvc.deliverPendingActivations({
    controlPlane: PLAN_OK,
    now: Date.now() + bootstrapSvc.RESEND_COOLDOWN_MS + 1000,
  });
  check('le fournisseur disponible solde la dette', solde.done === true);
  check('…et exactement UN lien part', solde.sent === 1);

  const compteDette = await User.findOne({ email: 'dette@dupont.fr' });
  const activations = await LocalDevActivation.find({ userId: compteDette._id }).sort({ createdAt: 1 });
  check('la reprise est tracée comme telle', activations.at(-1).reason === 'RECOVERY');
  check('…et son envoi est enregistré', activations.at(-1).emailStatus === 'SENT');
  const vivantes = activations.filter((a) => !a.consumedAt);
  check('UN SEUL lien reste valide — le précédent est invalidé', vivantes.length === 1);

  /* — Rejouer la reprise n'envoie pas un second courriel — */
  const repriseRejouee = await bootstrapSvc.deliverPendingActivations({
    controlPlane: PLAN_OK,
    now: Date.now() + bootstrapSvc.RESEND_COOLDOWN_MS * 10,
  });
  check('rejouer la reprise ne renvoie RIEN', repriseRejouee.sent === 0);
  check('…et se déclare terminée', repriseRejouee.done === true && repriseRejouee.reason === 'ALREADY_SENT');
  const apresRejeu = await LocalDevActivation.countDocuments({ userId: compteDette._id });
  check('…sans créer de second lien', apresRejeu === activations.length);
  const plusDue = await bootstrapSvc.pendingActivationDelivery();
  check('l’obligation n’est plus due', plusDue.due === false);

  /* — Le délai de garde protège d'une rafale — */
  await User.deleteMany({});
  await LocalDevActivation.deleteMany({});
  await bootstrapSvc.ensureInitialLocalUser({
    email: 'rafale@dupont.fr', role: ROLES.DEV, controlPlane: PLAN_INDISPONIBLE,
  });
  const tropTot = await bootstrapSvc.deliverPendingActivations({ controlPlane: PLAN_OK });
  check('une reprise immédiate est retenue par le délai de garde', tropTot.sent === 0);
  check('…et le dit', /garde/i.test(tropTot.detail ?? ''));

  /* — Un compte déjà activé n'a plus aucune dette — */
  await User.deleteMany({});
  await LocalDevActivation.deleteMany({});
  const aucune = await bootstrapSvc.deliverPendingActivations({ controlPlane: PLAN_OK });
  check('sans compte en attente, il n’y a rien à faire', aucune.done === true && aucune.reason === 'NO_PENDING_ACCOUNT');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (err) {
  console.error('LOCAL DEV BOOTSTRAP TEST CRASHED:', err);
  fail++;
} finally {
  if (server) server.close();
  await disconnectDatabase().catch(() => {});
  await mongod.stop();
  process.exit(fail === 0 ? 0 : 1);
}
