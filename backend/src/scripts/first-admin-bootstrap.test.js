/**
 * LE PREMIER ADMINISTRATEUR LOCAL — créé par la duplication (hotfix LOT 2C).
 *
 * ══ CE QUE CETTE SUITE ÉTABLIT ══════════════════════════════════════════════
 *
 * Le lot 2C avait retiré l'amorçage automatique de l'ADMIN, parce que son mot
 * de passe était universel. Le retirer entièrement était une erreur d'arbitrage
 * : le client se retrouvait sans compte à la livraison. La doctrine finale
 * n'est pas « pas d'ADMIN » mais « pas d'ADMIN UNIVERSEL ».
 *
 * Quatre propriétés font la différence entre les deux, et aucune ne se relit
 * dans le code sans effort :
 *
 *   · le mot de passe vient de CETTE duplication, saisi par l'exploitant, et
 *     les secrets historiques du parc sont refusés par une liste noire ;
 *   · il n'est écrit NULLE PART ailleurs qu'en hash dans la base cible — ni
 *     dans un `.env`, ni dans un journal, ni dans le rapport de duplication ;
 *   · le compte est ACTIF immédiatement : la connexion réelle le prouve, par
 *     HTTP, avec les identifiants saisis ;
 *   · un redémarrage, un redéploiement ou une duplication rejouée ne
 *     RÉINITIALISENT jamais ce mot de passe. Le seed ne doit pas devenir un
 *     mécanisme de réinitialisation — ce serait une porte dérobée officielle.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
const URI = mongod.getUri();

process.env.ENV = 'TEST';
process.env.MONGODB_URI = URI;
process.env.DB_TEST = 'copie_test';
process.env.DB_PROD = 'copie_prod';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4194';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NGROK_API_URL = 'http://127.0.0.1:1';
// L'amorçage du premier DÉVELOPPEUR reste ce qu'il est : une identité, sans secret.
process.env.FIRST_DEV_EMAIL = 'dev@copie.test';
process.env.FIRST_DEV_NAME = 'Développeuse';
delete process.env.FIRST_ADMIN_EMAIL;

const ADMIN = Object.freeze({
  email: 'contact@copie.test',
  password: 'Copie-Admin-2026',
});

let pass = 0;
let fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

const { createFirstAdmin, validateDuplicationInput } = await import('../duplication-engine/duplication.js');
const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { User } = await import('../models/User.model.js');
const { USER_STATUS } = await import('../utils/constants.js');

let server = null;
const base = 'http://localhost:4194';
async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

try {
  /* ══════════════════════════════════════════════════════════════════════════
     1. LA CRÉATION — directe dans la base cible, jamais par un fichier.
     ══════════════════════════════════════════════════════════════════════════ */
  section('1 · Le compte est écrit dans la base de la copie');
  const cree = await createFirstAdmin(URI, 'copie_test', ADMIN);
  check('le premier administrateur est créé', cree.created === true);

  await connectDatabase();
  const admin = await User.findOne({ email: ADMIN.email }).select('+password');
  check('…il existe bien dans la base', admin !== null);
  check('…avec le rôle ADMIN', admin.role === 'ADMIN');
  check('…et il est ACTIF immédiatement', admin.status === USER_STATUS.ACTIVE);
  check('…il n’attend AUCUNE activation', admin.status !== USER_STATUS.PENDING_ACTIVATION);
  check('…son mot de passe est HACHÉ', /^\$2[aby]\$/.test(admin.password));
  check('…jamais en clair', admin.password !== ADMIN.password);
  check('…et il n’est pas marqué pour rotation', admin.mustResetPassword === false);

  /**
   * LE DOCUMENT EST LU PAR LE MODÈLE MONGOOSE, PAS SEULEMENT PAR LE DRIVER.
   *
   * Le moteur écrit avec le driver natif (pour ne pas déclencher les hooks de
   * synchronisation du projet SOURCE). Ce contrôle prouve que la forme écrite
   * est bien celle que le schéma attend — sans lui, une clé oubliée ne se
   * verrait qu'au premier login, en production.
   */
  check('le document satisfait le schéma du modèle', (await admin.validate().then(() => true).catch(() => false)));
  check('…et son mot de passe se vérifie', await admin.comparePassword(ADMIN.password));

  /* ══════════════════════════════════════════════════════════════════════════
     2. LA CONNEXION RÉELLE — par HTTP, avec les identifiants saisis.
     ══════════════════════════════════════════════════════════════════════════ */
  section('2 · L’administrateur se connecte réellement');
  const { createApp } = await import('../app.js');
  server = createApp().listen(4194);
  await (await import('./helpers/serviceReady.helper.js')).markTestServiceReady();

  const connexion = await api('POST', '/api/auth/login', { email: ADMIN.email, password: ADMIN.password });
  check('connexion acceptée', connexion.status === 200);
  check('…avec le rôle ADMIN', connexion.json?.data?.user?.role === 'ADMIN');
  check('…et un jeton de session', Boolean(connexion.json?.data?.token));
  check('…la réponse ne contient AUCUN mot de passe',
    !JSON.stringify(connexion.json).includes(ADMIN.password)
    && !/\$2[aby]\$/.test(JSON.stringify(connexion.json)));

  const mauvais = await api('POST', '/api/auth/login', { email: ADMIN.email, password: 'pas-le-bon' });
  check('un mauvais mot de passe reste refusé', mauvais.status === 401);

  /* ══════════════════════════════════════════════════════════════════════════
     3. LE REDÉMARRAGE NE RÉINITIALISE RIEN.

     ══ POURQUOI C'EST LE CONTRÔLE LE PLUS IMPORTANT DE CETTE SUITE ══════════

     Un seed qui réécrit un mot de passe à chaque démarrage est une porte
     dérobée officielle : quiconque peut redéployer peut reprendre le compte.
     Le défaut serait invisible — tout fonctionne, sauf que le mot de passe du
     client redevient celui de la fiche de livraison à chaque redémarrage.
     ══════════════════════════════════════════════════════════════════════════ */
  section('3 · Un redémarrage ne réinitialise jamais le mot de passe');
  const hashAvant = admin.password;

  const { bootstrap } = await import('../config/bootstrap.js');
  await bootstrap();

  const apresBootstrap = await User.findOne({ email: ADMIN.email }).select('+password');
  check('le hash est INCHANGÉ après un bootstrap complet', apresBootstrap.password === hashAvant);
  check('…et la connexion fonctionne toujours',
    (await api('POST', '/api/auth/login', { email: ADMIN.email, password: ADMIN.password })).status === 200);
  check('…un seul compte ADMIN', (await User.countDocuments({ role: 'ADMIN' })) === 1);

  /**
   * LE CLIENT CHANGE SON MOT DE PASSE, PUIS ON REDÉMARRE.
   * C'est le scénario réel : le seed ne doit pas ramener le mot de passe de
   * livraison par-dessus celui que le client a choisi.
   */
  apresBootstrap.password = 'Choisi-Par-Le-Client-2026';
  await apresBootstrap.save();
  await bootstrap();
  const apresChangement = await User.findOne({ email: ADMIN.email }).select('+password');
  check('après changement par le client, le bootstrap ne restaure PAS l’ancien',
    await apresChangement.comparePassword('Choisi-Par-Le-Client-2026'));
  check('…et l’ancien mot de passe de livraison ne fonctionne plus',
    (await api('POST', '/api/auth/login', { email: ADMIN.email, password: ADMIN.password })).status === 401);

  /* ══════════════════════════════════════════════════════════════════════════
     4. UNE DUPLICATION REJOUÉE N'ÉCRASE RIEN.
     ══════════════════════════════════════════════════════════════════════════ */
  section('4 · Rejouer la création n’écrase aucun accès');
  const rejeu = await createFirstAdmin(URI, 'copie_test', {
    email: 'autre-admin@copie.test', password: 'Un-Autre-Secret-2026',
  });
  check('un second administrateur n’est PAS créé', rejeu.created === false);
  check('…et la raison est nommée', rejeu.reason === 'ADMIN_ALREADY_PRESENT');
  check('…il n’y a toujours qu’un ADMIN', (await User.countDocuments({ role: 'ADMIN' })) === 1);

  const memeAdresse = await createFirstAdmin(URI, 'copie_test', {
    email: ADMIN.email, password: 'Encore-Un-Autre-2026',
  });
  check('rejouer avec la MÊME adresse n’écrase pas le mot de passe', memeAdresse.created === false);
  check('…le mot de passe choisi par le client survit',
    await (await User.findOne({ email: ADMIN.email }).select('+password')).comparePassword('Choisi-Par-Le-Client-2026'));

  /* ══════════════════════════════════════════════════════════════════════════
     5. LES TROIS IDENTITÉS COEXISTENT.
     ══════════════════════════════════════════════════════════════════════════ */
  section('5 · ADMIN local, DEV local et DEV fédéré ne se marchent pas dessus');
  const dev = await User.findOne({ role: 'DEV' });
  check('le premier DÉVELOPPEUR local existe aussi', dev !== null);
  check('…et lui attend son activation', dev.status === USER_STATUS.PENDING_ACTIVATION);
  check('…sans aucun mot de passe',
    !(await User.findById(dev._id).select('+password')).password);
  check('…tandis que l’ADMIN, lui, est actif',
    (await User.findOne({ role: 'ADMIN' })).status === USER_STATUS.ACTIVE);
  check('…deux mécanismes distincts, deux comptes distincts',
    String(dev._id) !== String(admin._id));

  const devSansMotDePasse = await api('POST', '/api/auth/login', {
    email: 'dev@copie.test', password: 'Choisi-Par-Le-Client-2026',
  });
  check('le mot de passe de l’ADMIN n’ouvre pas le compte du DEV', devSansMotDePasse.status === 401);

  /* ══════════════════════════════════════════════════════════════════════════
     6. LE SECRET NE SORT NULLE PART.
     ══════════════════════════════════════════════════════════════════════════ */
  section('6 · Le mot de passe ne quitte jamais la mémoire du moteur');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  const moteur = fs.readFileSync(path.join(racine, 'duplication-engine', 'duplication.js'), 'utf8');
  const sansCommentaires = moteur.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  check('le moteur ne journalise JAMAIS le mot de passe administrateur',
    !/onLog\([^)]*adminPassword/.test(sansCommentaires));
  check('…ne l’écrit dans AUCUNE variable d’environnement',
    !/ADMIN_PASSWORD['"`]?\s*[\]:]/.test(sansCommentaires) && !/ENV_KEYS\.[a-zA-Z]*[Pp]assword/.test(sansCommentaires));
  check('…et ne le place pas dans le rapport',
    !/adminAccount[\s\S]{0,200}adminPassword/.test(sansCommentaires));

  /**
   * LE RAPPORT NOMME LE COMPTE SANS L'EXPOSER.
   * Il est relu à l'écran, recopié dans un ticket : le compte doit s'y
   * reconnaître, sans que le document devienne un annuaire d'accès.
   */
  const profil = { adminEmail: ADMIN.email, adminPassword: ADMIN.password, adminPasswordConfirmation: ADMIN.password };
  const entree = validateDuplicationInput({
    projectName: 'Copie', dbTest: 'a', dbProd: 'b', devEmail: 'dev@copie.test',
    githubRepositoryUrl: 'https://github.com/x/y.git', ...profil,
  });
  check('la validation conserve le secret pour le moteur', entree.adminPassword === ADMIN.password);
  check('…mais l’entrée validée ne contient aucune confirmation résiduelle',
    entree.adminPasswordConfirmation === undefined);

  console.log(`\n${pass} réussis, ${fail} échoués`);
} catch (err) {
  console.error('FIRST ADMIN TEST CRASHED:', err);
  fail++;
} finally {
  if (server) server.close();
  await disconnectDatabase().catch(() => {});
  await mongod.stop();
  process.exit(fail === 0 ? 0 : 1);
}
