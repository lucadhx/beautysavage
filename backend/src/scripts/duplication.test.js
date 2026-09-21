/* Tests du moteur de duplication. Fonctions pures + Mongo réel (memory-server)
 * + copie de dossier réelle sur des fixtures temporaires. Aucun npm global. */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  validateDuplicationInput,
  rewriteEnv,
  quoteEnvValue,
  sanitizeFolderName,
  assertSafeDuplicationDestination,
  testMongoConnection,
  ensureDatabase,
  initializeDatabase,
  initializeDuplicatedProjectDatabases,
  maskMongoUri,
  DatabaseInitializationError,
  copyProject,
  COPY_EMPTY_ONLY,
  deriveProjectIdentity,
  rewriteProjectProfile,
  duplicateProject,
  discoverNodeProjects,
  NODE_PROJECT_DISCOVERY_DENYLIST,
  NodeProjectInitializationError,
  COPY_DENYLIST,
} from '../duplication-engine/duplication.js';
import { ValidationError } from '../deployment-engine/errors.js';
import { validateGithubRepositoryUrl, normalizeGithubRepositoryUrl } from '../utils/githubRepositoryUrl.js';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}
async function threws(fn, Type) {
  try {
    await fn();
    return false;
  } catch (e) {
    return Type ? e instanceof Type : true;
  }
}

/**
 * Comme `threws`, mais REND l'erreur. Un blocage typé ne se vérifie pas par
 * « ça a levé » : c'est le code porté (`details.blocker`) qui distingue
 * « adresse manquante » de « mot de passe refusé », et l'appelant en a besoin
 * pour savoir quoi corriger.
 */
/** Un premier administrateur VALIDE — le décor commun des contrôles ci-dessous. */
const ADMIN_VALIDE = Object.freeze({
  adminEmail: 'contact@dupont.fr',
  adminPassword: 'Dupont-Admin-2026',
  adminPasswordConfirmation: 'Dupont-Admin-2026',
});

async function threwsWith(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

function installBinPath(projectDir, binName) {
  return path.join(projectDir, 'node_modules', '.bin', process.platform === 'win32' ? `${binName}.cmd` : binName);
}

function createExecMock({ failProject = null, delayProject = {} } = {}) {
  const calls = [];
  const exec = async (command, args, { cwd, env } = {}) => {
    calls.push({ command, args, cwd, env });
    const rel = cwd ? path.basename(cwd) : '';
    const isInstall = args?.[0] === 'ci' || args?.[0] === 'install';
    if (isInstall && rel === failProject) {
      return { code: 1, stdout: '', stderr: `${rel} install failed` };
    }
    if (isInstall) {
      const waitMs = Number(delayProject[rel] || 0);
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      await fs.mkdir(path.join(cwd, 'node_modules', '.bin'), { recursive: true });
      if (rel === 'manager' || rel === 'vitrine') {
        await fs.writeFile(installBinPath(cwd, 'vite'), 'echo vite');
        await fs.mkdir(path.join(cwd, 'node_modules', 'vite'), { recursive: true });
        await fs.writeFile(path.join(cwd, 'node_modules', 'vite', 'package.json'), '{"name":"vite","version":"5.0.0"}');
      }
      return { code: 0, stdout: 'install ok', stderr: '' };
    }
    if (args?.[0] === 'run' && args?.[1] === 'seed') {
      return { code: 0, stdout: 'seed ok', stderr: '' };
    }
    return { code: 0, stdout: 'ok', stderr: '' };
  };
  return { exec, calls };
}

const mongod = await MongoMemoryServer.create();
const uri = mongod.getUri();
let tmpRoot;

try {
  /* ---------------------- 1. Validation des entrées ---------------------- */
  const REPO = 'https://github.com/dupont/garage-neuf.git';
  const valid = validateDuplicationInput({
    projectName: 'Garage Dupont',
    folderName: 'Garage Dupont!!',
    dbTest: 'dupont_test',
    dbProd: 'dupont_prod',
    devEmail: 'dev@dupont.fr',
    devName: 'Camille Dupont',
    adminEmail: 'contact@dupont.fr',
    adminPassword: 'Dupont-Admin-2026',
    adminPasswordConfirmation: 'Dupont-Admin-2026',
    githubRepositoryUrl: 'https://github.com/dupont/garage-neuf',
  });
  check('validation : folderName nettoyé', valid.folderName === 'Garage-Dupont');
  check('validation : URL GitHub normalisée (.git ajouté)', valid.githubRepositoryUrl === REPO);
  check('validation : URL GitHub OBLIGATOIRE', await threws(() => validateDuplicationInput({ projectName: 'X', dbTest: 't', dbProd: 'p', devEmail: 'a@b.c', ...ADMIN_VALIDE }), ValidationError));
  check('validation : refuse DB TEST == DB PROD', await threws(() => validateDuplicationInput({ projectName: 'X', dbTest: 'same', dbProd: 'same', devEmail: 'a@b.c', ...ADMIN_VALIDE }), ValidationError));
  check('validation : refuse email invalide', await threws(() => validateDuplicationInput({ projectName: 'X', dbTest: 't', dbProd: 'p', devEmail: 'nope', ...ADMIN_VALIDE }), ValidationError));
  /**
   * LOT 2C — L'ASSISTANT N'ACCEPTE PLUS DE MOT DE PASSE, ET LE DIT.
   *
   * Le contrôle portait sur sa longueur. Il porte désormais sur son EXISTENCE :
   * un client resté sur l'ancienne forme doit apprendre que son mot de passe
   * n'a pas été appliqué, plutôt que de le croire posé pendant que le compte
   * s'ouvre par un tout autre chemin.
   */
  const refusMdp = await threwsWith(() => validateDuplicationInput({ projectName: 'X', dbTest: 't', dbProd: 'p', devEmail: 'a@b.c', devPassword: 'secret1', ...ADMIN_VALIDE, githubRepositoryUrl: REPO }));
  check('validation : REFUSE tout mot de passe', refusMdp?.details?.blocker === 'FIRST_DEV_PASSWORD_REFUSED');
  const refusSansEmail = await threwsWith(() => validateDuplicationInput({ projectName: 'X', dbTest: 't', dbProd: 'p', ...ADMIN_VALIDE, githubRepositoryUrl: REPO }));
  check('validation : BLOCAGE TYPÉ sans adresse du premier développeur', refusSansEmail?.details?.blocker === 'FIRST_DEV_REQUIRED');
  check('validation : l’adresse est normalisée en minuscules',
    validateDuplicationInput({ projectName: 'X', dbTest: 't', dbProd: 'p', devEmail: 'DEV@Dupont.FR', ...ADMIN_VALIDE, githubRepositoryUrl: REPO }).devEmail === 'dev@dupont.fr');

  /* ══════════════════════════════════════════════════════════════════════════
     LE PREMIER ADMINISTRATEUR — identité ET secret, tous deux exigés.

     Il est traité autrement que le développeur, et volontairement : c'est le
     compte que l'exploitant remet au client à la livraison, souvent de vive
     voix. Un lien d'activation envoyé à une boîte pas encore relevée
     produirait un projet livré sans accès.
     ══════════════════════════════════════════════════════════════════════════ */
  const base = { projectName: 'X', dbTest: 't', dbProd: 'p', devEmail: 'dev@b.c', githubRepositoryUrl: REPO };
  const blocage = async (patch) => (await threwsWith(() => validateDuplicationInput({ ...base, ...ADMIN_VALIDE, ...patch })))?.details?.blocker;

  check('admin : adresse absente → FIRST_ADMIN_REQUIRED',
    (await blocage({ adminEmail: undefined })) === 'FIRST_ADMIN_REQUIRED');
  check('admin : adresse invalide → FIRST_ADMIN_REQUIRED',
    (await blocage({ adminEmail: 'pas-une-adresse' })) === 'FIRST_ADMIN_REQUIRED');
  check('admin : mot de passe absent → FIRST_ADMIN_REQUIRED',
    (await blocage({ adminPassword: undefined, adminPasswordConfirmation: undefined })) === 'FIRST_ADMIN_REQUIRED');
  check('admin : confirmation discordante → FIRST_ADMIN_PASSWORD_INVALID',
    (await blocage({ adminPasswordConfirmation: 'autre-chose' })) === 'FIRST_ADMIN_PASSWORD_INVALID');
  check('admin : mot de passe trop court → FIRST_ADMIN_PASSWORD_INVALID',
    (await blocage({ adminPassword: '12345', adminPasswordConfirmation: '12345' })) === 'FIRST_ADMIN_PASSWORD_INVALID');

  /**
   * LA GARDE QUI EMPÊCHE LE DÉFAUT DE REVENIR À LA MAIN.
   * Rien n'empêcherait un exploitant pressé de retaper le secret historique —
   * et le parc retrouverait son mot de passe universel, cette fois invisible à
   * toute recherche dans le code.
   */
  check('admin : « 123admin » est REFUSÉ',
    (await blocage({ adminPassword: '123admin', adminPasswordConfirmation: '123admin' })) === 'FIRST_ADMIN_PASSWORD_INVALID');
  check('admin : « 123dev » est REFUSÉ aussi',
    (await blocage({ adminPassword: '123dev', adminPasswordConfirmation: '123dev' })) === 'FIRST_ADMIN_PASSWORD_INVALID');
  check('admin : la casse ne contourne pas la liste noire',
    (await blocage({ adminPassword: '123Admin ', adminPasswordConfirmation: '123Admin ' })) === 'FIRST_ADMIN_PASSWORD_INVALID');
  check('admin : un mot de passe déduit de l’adresse est REFUSÉ',
    (await blocage({ adminEmail: 'contact@dupont.fr', adminPassword: 'contact', adminPasswordConfirmation: 'contact' })) === 'FIRST_ADMIN_PASSWORD_INVALID');

  const adminOk = validateDuplicationInput({ ...base, ...ADMIN_VALIDE });
  check('admin : une saisie propre est acceptée', adminOk.adminEmail === 'contact@dupont.fr');
  check('admin : l’adresse est normalisée en minuscules',
    validateDuplicationInput({ ...base, ...ADMIN_VALIDE, adminEmail: 'Contact@Dupont.FR' }).adminEmail === 'contact@dupont.fr');
  check('validation : refuse nom de base invalide', await threws(() => validateDuplicationInput({ projectName: 'X', dbTest: 'bad name!', dbProd: 'p', devEmail: 'a@b.c', ...ADMIN_VALIDE }), ValidationError));

  check('sanitizeFolderName : caractères sûrs', sanitizeFolderName('  Mon Projet (2026) ') === 'Mon-Projet-2026');

  /* ---------------------- 1bis. Validateur d'URL GitHub ---------------------- */
  check('github-url : forme canonique conservée', normalizeGithubRepositoryUrl('https://github.com/org/repo.git') === 'https://github.com/org/repo.git');
  check('github-url : slash final + www normalisés', normalizeGithubRepositoryUrl('https://www.github.com/org/repo/') === 'https://github.com/org/repo.git');
  check('github-url : espaces supprimés', normalizeGithubRepositoryUrl('  https://github.com/org/repo  ') === 'https://github.com/org/repo.git');
  check('github-url : refuse sans dépôt', !validateGithubRepositoryUrl('https://github.com/owner').valid);
  check('github-url : refuse racine', !validateGithubRepositoryUrl('https://github.com/').valid);
  check('github-url : refuse credentials/token', !validateGithubRepositoryUrl('https://token@github.com/owner/repo').valid);
  check('github-url : refuse hors GitHub', !validateGithubRepositoryUrl('https://gitlab.com/owner/repo').valid);
  check('github-url : refuse ssh/scp', !validateGithubRepositoryUrl('git@autre-hebergeur.com:owner/repo.git').valid);
  check('github-url : refuse file://', !validateGithubRepositoryUrl('file:///tmp/repo').valid);
  check('github-url : refuse chemin trop profond', !validateGithubRepositoryUrl('https://github.com/a/b/c').valid);
  check('github-url : le message ne réfléchit jamais un token', !String(validateGithubRepositoryUrl('https://secret-token@github.com/o/r').error).includes('secret-token'));

  /* ---------------------- 2. Réécriture .env (pure) ---------------------- */
  const srcEnv = ['ENV=TEST', 'MONGODB_URI=mongodb://127.0.0.1:27017', 'DB_TEST=old_test', 'DB_PROD=old_prod', 'JWT_SECRET=keepme'].join('\n');
  const out = rewriteEnv(srcEnv, { dbTest: 'new_test', dbProd: 'new_prod', projectName: 'Nouveau' });
  check('rewriteEnv : DB_TEST remplacé', /(^|\n)DB_TEST=new_test(\n|$)/.test(out));
  check('rewriteEnv : DB_PROD remplacé', /(^|\n)DB_PROD=new_prod(\n|$)/.test(out));
  // SÉCURITÉ (Phase 2D) : une copie ne doit JAMAIS hériter des secrets de sa
  // source. Le comportement historique (« JWT_SECRET préservé ») était un
  // défaut : la compromission d'un projet compromettait tous ses dupliqués.
  check('rewriteEnv : JWT_SECRET de la source JAMAIS recopié', !out.includes('JWT_SECRET=keepme'));
  check('rewriteEnv : JWT_SECRET régénéré (128 hex = 64 octets)',
    /^JWT_SECRET=[0-9a-f]{128}$/m.test(out));
  check('rewriteEnv : clé de chiffrement régénérée (64 hex = 32 octets)',
    /^INTEGRATED_API_ENCRYPTION_KEY=[0-9a-f]{64}$/m.test(out));
  check('rewriteEnv : deux copies reçoivent des secrets DIFFÉRENTS',
    rewriteEnv(srcEnv, { dbTest: 'a', dbProd: 'b' }) !== rewriteEnv(srcEnv, { dbTest: 'a', dbProd: 'b' }));
  check('rewriteEnv : secrets injectables (déterminisme pour les tests)',
    rewriteEnv(srcEnv, { dbTest: 'a', dbProd: 'b', secrets: { JWT_SECRET: 'fixe' } }).includes('JWT_SECRET=fixe'));
  check('rewriteEnv : MONGODB_URI préservé', out.includes('MONGODB_URI=mongodb://127.0.0.1:27017'));
  check('rewriteEnv : ENV préservé', /(^|\n)ENV=TEST(\n|$)/.test(out));
  check('rewriteEnv : PROJECT_NAME ajouté', out.includes('PROJECT_NAME=Nouveau'));
  const out2 = rewriteEnv('FOO=bar', { dbTest: 't', dbProd: 'p' });
  check('rewriteEnv : ajoute DB_* si absents', out2.includes('DB_TEST=t') && out2.includes('DB_PROD=p') && out2.includes('FOO=bar'));
  // URL GitHub : remplacée si héritée du template SOURCE (jamais recopiée), sans doublon.
  const out3 = rewriteEnv('PROJECT_GITHUB_REPOSITORY_URL=https://github.com/source/ancien.git\nENV=TEST', {
    dbTest: 't', dbProd: 'p', githubRepositoryUrl: 'https://github.com/cible/nouveau.git',
  });
  check('rewriteEnv : URL cible remplace l’URL source', out3.includes('PROJECT_GITHUB_REPOSITORY_URL=https://github.com/cible/nouveau.git') && !out3.includes('source/ancien'));
  check('rewriteEnv : une seule occurrence de la clé', out3.split('PROJECT_GITHUB_REPOSITORY_URL=').length === 2);
  const out4 = rewriteEnv('ENV=TEST', { dbTest: 't', dbProd: 'p', githubRepositoryUrl: 'https://github.com/cible/nouveau.git' });
  check('rewriteEnv : URL ajoutée si absente', out4.includes('PROJECT_GITHUB_REPOSITORY_URL=https://github.com/cible/nouveau.git'));
  /**
   * ══ L'IDENTITÉ EST ÉCRITE, LES SECRETS HÉRITÉS SONT EFFACÉS (LOT 2C) ═══════
   *
   * La source utilisée ici porte VOLONTAIREMENT les deux variables héritées.
   * C'est le cas réel : toute installation antérieure au lot les possède, et
   * une copie qui les emporterait ressusciterait le mot de passe partagé —
   * en clair, sur le disque du nouveau projet.
   */
  const outSeed = rewriteEnv('ENV=TEST\nSEED_DEV_EMAIL=dev@source.fr\nSEED_DEV_PASSWORD=ancien\nSEED_ADMIN_PASSWORD=vieux', {
    dbTest: 't', dbProd: 'p', firstDevEmail: 'dev@dupont.fr', firstDevName: 'Camille Dupont',
  });
  check('rewriteEnv : FIRST_DEV_EMAIL écrit', /(^|\n)FIRST_DEV_EMAIL=dev@dupont\.fr(\n|$)/.test(outSeed));
  check('rewriteEnv : le nom est écrit et cité si besoin', outSeed.includes('FIRST_DEV_NAME="Camille Dupont"'));
  check('rewriteEnv : SEED_DEV_PASSWORD hérité SUPPRIMÉ', !outSeed.includes('SEED_DEV_PASSWORD'));
  check('rewriteEnv : SEED_ADMIN_PASSWORD hérité SUPPRIMÉ', !outSeed.includes('SEED_ADMIN_PASSWORD'));
  check('rewriteEnv : aucun mot de passe hérité ne survit', !outSeed.includes('ancien') && !outSeed.includes('vieux'));
  check('rewriteEnv : SEED_DEV_EMAIL (sans secret) reste tolérée', outSeed.includes('SEED_DEV_EMAIL=dev@source.fr'));
  const outSeedAdd = rewriteEnv('ENV=TEST', { dbTest: 't', dbProd: 'p', firstDevEmail: 'a@b.fr' });
  check('rewriteEnv : FIRST_DEV_EMAIL ajoutée si absente', outSeedAdd.includes('FIRST_DEV_EMAIL=a@b.fr'));
  check('rewriteEnv : aucun mot de passe n’est jamais écrit',
    !/PASSWORD=/.test(outSeedAdd) && !/PASSWORD=/.test(outSeed));
  check('quoteEnvValue : valeur simple non citée', quoteEnvValue('secret1') === 'secret1');
  check('quoteEnvValue : valeur avec espace citée', quoteEnvValue('a b') === '"a b"');

  /* ---------------------- 3. Mongo : connexion & création de base ---------------------- */
  const conn = await testMongoConnection(uri);
  check('testMongoConnection : ok', conn.ok === true && Array.isArray(conn.databases));

  const c1 = await ensureDatabase(uri, 'garage_test', 's1');
  check('ensureDatabase : crée la base absente', c1.created === true);
  const after = await testMongoConnection(uri);
  check('ensureDatabase : base présente après création', after.databases.includes('garage_test'));
  const c2 = await ensureDatabase(uri, 'garage_test', 's2');
  check('ensureDatabase : idempotent (déjà créée)', c2.created === false);

  /* ------------- 3bis. Initialisation CANONIQUE (index + singleton) ------------- */
  const fakeModels = {
    User: {
      collection: { collectionName: 'users' },
      schema: { indexes: () => [[{ email: 1 }, { unique: true }]] },
    },
  };
  const init1 = await initializeDatabase(uri, 'canon_db', { models: fakeModels });
  check('initializeDatabase : base créée', init1.created === true);
  check('initializeDatabase : index Mongoose posés', init1.indexesEnsured === 1 && init1.collectionsInitialized === 1);
  const init2 = await initializeDatabase(uri, 'canon_db', { models: fakeModels });
  check('initializeDatabase : relance idempotente', init2.created === false && init2.indexesEnsured === 1);
  {
    const { MongoClient } = await import('mongodb');
    const cli = new MongoClient(uri);
    await cli.connect();
    const cols = (await cli.db('canon_db').listCollections().toArray()).map((c) => c.name);
    const sys = await cli.db('canon_db').collection('systemconfigurations').findOne({});
    await cli.close();
    check('initializeDatabase : collection réelle avec index (users)', cols.includes('users'));
    check('initializeDatabase : singleton SystemConfiguration canonique', Boolean(sys?.network?.backendUrl));
    check('initializeDatabase : AUCUN marqueur artificiel', !cols.includes('_deployment_marker'));
  }
  check('initializeDatabase : nom de base invalide -> code dédié',
    await threws(() => initializeDatabase(uri, 'bad name!'), DatabaseInitializationError));
  try { await initializeDatabase(uri, 'bad name!'); } catch (e) { check('initializeDatabase : code MONGO_DATABASE_NAME_INVALID', e.code === 'MONGO_DATABASE_NAME_INVALID'); }
  try {
    await initializeDatabase('mongodb://user:secretpass@127.0.0.1:1/x?serverSelectionTimeoutMS=300', 'okname');
    check('initializeDatabase : URI morte aurait dû lever', false);
  } catch (e) {
    check('initializeDatabase : URI morte -> MONGO_CONNECTION_FAILED', e.code === 'MONGO_CONNECTION_FAILED');
    check('initializeDatabase : URI masquée dans le message (jamais le mot de passe)', !String(e.message).includes('secretpass') && String(e.message).includes('//***@'));
  }
  const both = await initializeDuplicatedProjectDatabases({ mongoUri: uri, testDatabaseName: 'pair_test', productionDatabaseName: 'pair_prod', models: fakeModels });
  check('initializeDuplicatedProjectDatabases : les deux bases initialisées', both.test.created === true && both.prod.created === true);
  check('maskMongoUri : credentials masqués', maskMongoUri('mongodb+srv://u:p@host/db') === 'mongodb+srv://***@host/db');

  /* ---------------------- 4. Copie de dossier (denylist) ---------------------- */
  check('COPY_DENYLIST : exclut node_modules et .git', COPY_DENYLIST.has('node_modules') && COPY_DENYLIST.has('.git'));

  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dup test space '));
  const src = path.join(tmpRoot, 'source');
  // Fixture minimale d'un « projet ».
  await fs.mkdir(path.join(src, 'backend'), { recursive: true });
  await fs.mkdir(path.join(src, 'node_modules', 'junk'), { recursive: true });
  await fs.mkdir(path.join(src, '.git'), { recursive: true });
  await fs.mkdir(path.join(src, 'dist', 'ignored-app'), { recursive: true });
  await fs.mkdir(path.join(src, 'build', 'ignored-app'), { recursive: true });
  await fs.mkdir(path.join(src, 'manager'), { recursive: true });
  await fs.mkdir(path.join(src, 'vitrine'), { recursive: true });
  await fs.writeFile(path.join(src, 'package.json'), JSON.stringify({
    name: 'fixture-root',
    private: true,
    scripts: {
      dev: 'node scripts/dev-canonical.mjs',
      backend: 'npm run dev --prefix backend',
      manager: 'npm run dev --prefix manager',
      vitrine: 'npm run dev --prefix vitrine',
    },
  }, null, 2));
  await fs.writeFile(path.join(src, 'backend', 'package.json'), JSON.stringify({
    name: 'fixture-backend',
    private: true,
    scripts: {
      dev: 'node --watch src/server.js',
      seed: 'node src/scripts/seed.js',
    },
    dependencies: { express: '^4.0.0' },
  }, null, 2));
  await fs.writeFile(path.join(src, 'backend', 'package-lock.json'), '{"name":"fixture-backend","lockfileVersion":3}');
  await fs.writeFile(path.join(src, 'backend', '.env.example'), 'ENV=TEST\nDB_TEST=x\nDB_PROD=y\nPROJECT_GITHUB_REPOSITORY_URL=https://github.com/source/original.git\n');
  await fs.writeFile(path.join(src, 'manager', 'package.json'), JSON.stringify({
    name: 'fixture-manager',
    private: true,
    scripts: {
      dev: 'vite',
      build: 'vite build',
    },
    devDependencies: { vite: '^5.0.0' },
  }, null, 2));
  await fs.writeFile(path.join(src, 'manager', 'package-lock.json'), '{"name":"fixture-manager","lockfileVersion":3}');
  await fs.writeFile(path.join(src, 'vitrine', 'package.json'), JSON.stringify({
    name: 'fixture-vitrine',
    private: true,
    scripts: {
      dev: 'vite',
      build: 'vite build',
    },
    devDependencies: { vite: '^5.0.0' },
  }, null, 2));
  await fs.writeFile(path.join(src, 'vitrine', 'package-lock.json'), '{"name":"fixture-vitrine","lockfileVersion":3}');
  /**
   * LE PROFIL DE PROJET — la copie doit repartir avec SON identité technique.
   *
   * Sans ce fichier, la duplication REFUSE, et c'est voulu : un projet sans
   * profil n'est pas déployable, et une copie qui hériterait du slug de sa
   * source déposerait ses sauvegardes et ses processus sous le nom d'un autre.
   */
  await fs.mkdir(path.join(src, 'backend', 'src', 'deployment-engine', 'config'), { recursive: true });
  await fs.writeFile(
    path.join(src, 'backend', 'src', 'deployment-engine', 'config', 'project.profile.js'),
    "export const PROJECT_SLUG = 'sourceslug';\nexport const PROJECT_ID = 'sourceid';\nexport const AUTRE = 1;\n",
  );
  await fs.writeFile(path.join(src, 'README.md'), '# projet');
  await fs.writeFile(path.join(src, 'node_modules', 'junk', 'big.js'), 'nope');
  await fs.writeFile(path.join(src, '.git', 'HEAD'), 'ref: refs/heads/main');
  await fs.writeFile(path.join(src, 'dist', 'ignored-app', 'package.json'), '{"name":"ignored-dist"}');
  await fs.writeFile(path.join(src, 'build', 'ignored-app', 'package.json'), '{"name":"ignored-build"}');

  const dest = path.join(tmpRoot, 'copie');
  const copyRes = await copyProject(src, dest);
  check('copyProject : README copié', await exists(path.join(dest, 'README.md')));
  check('copyProject : .env.example copié', await exists(path.join(dest, 'backend', '.env.example')));
  check('copyProject : node_modules exclu', !(await exists(path.join(dest, 'node_modules'))));
  check('copyProject : .git exclu', !(await exists(path.join(dest, '.git'))));
  check('copyProject : compte de fichiers > 0', copyRes.files >= 2);

  /* ---------------------- 4bis. Découverte des projets Node ---------------------- */
  const discovered = await discoverNodeProjects(src);
  check('NODE_PROJECT_DISCOVERY_DENYLIST : build/cache/deps ignorés',
    NODE_PROJECT_DISCOVERY_DENYLIST.has('build') && NODE_PROJECT_DISCOVERY_DENYLIST.has('node_modules'));
  check('discoverNodeProjects : détecte tous les vrais package.json',
    discovered.map((p) => p.relativePath).join('|') === '.|backend|manager|vitrine');
  check('discoverNodeProjects : backend installé localement via lockfile',
    discovered.find((p) => p.relativePath === 'backend')?.installNeeded === true);
  check('discoverNodeProjects : manager détecte vite comme binaire local requis',
    discovered.find((p) => p.relativePath === 'manager')?.validation?.localBinary === 'vite');
  check('discoverNodeProjects : racine sans dépendances non installée',
    discovered.find((p) => p.relativePath === '.')?.installNeeded === false);

  /* ---------------------- 5. duplicateProject de bout en bout ---------------------- */
  const dupInput = {
    projectName: 'Garage Neuf',
    folderName: 'garage-neuf',
    dbTest: 'neuf_test',
    dbProd: 'neuf_prod',
    devEmail: 'dev@neuf.fr',
    devName: 'Développeuse Neuf',
    adminEmail: 'contact@neuf.fr',
    adminPassword: 'Neuf-Admin-2026',
    adminPasswordConfirmation: 'Neuf-Admin-2026',
    githubRepositoryUrl: 'https://github.com/dupont/garage-neuf',
  };
  const phasesMain = [];
  const logsMain = [];
  const { exec: execOk, calls: execCalls } = createExecMock();
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const dup = await duplicateProject(dupInput, {
    sourceRoot: src,
    destParent: tmpRoot,
    mongoUri: uri,
    stamp: 'stamp1',
    exec: execOk,
    onPhase: (e) => phasesMain.push(e),
    onLog: (m) => logsMain.push(String(m)),
  });
  process.env.NODE_ENV = previousNodeEnv;
  check('duplicateProject : état created', dup.state === 'created');
  check('duplicateProject : DB TEST créée', dup.dbTest.name === 'neuf_test' && dup.dbTest.created === true);
  check('duplicateProject : DB PROD créée', dup.dbProd.name === 'neuf_prod' && dup.dbProd.created === true);
  check('duplicateProject : dossier créé', await exists(dup.path));
  const dupEnv = await fs.readFile(path.join(dup.path, 'backend', '.env'), 'utf8');
  check('duplicateProject : .env réécrit (DB_TEST)', dupEnv.includes('DB_TEST=neuf_test'));
  check('duplicateProject : .env réécrit (DB_PROD)', dupEnv.includes('DB_PROD=neuf_prod'));
  check('duplicateProject : URL GitHub CIBLE écrite (normalisée)', dupEnv.includes(`PROJECT_GITHUB_REPOSITORY_URL=${REPO}`));
  check('duplicateProject : une seule occurrence de la clé', dupEnv.split('PROJECT_GITHUB_REPOSITORY_URL=').length === 2);
  check('duplicateProject : URL dans le rapport', dup.githubRepositoryUrl === REPO && dup.envCheck.githubRepositoryUrl === 'present-unique-normalized');
  check('duplicateProject : aucun .env.tmp résiduel', !(await exists(path.join(dup.path, 'backend', '.env.tmp'))));
  // Compte DEV de l'assistant : écrit dans le .env de la copie, vérifié, rapporté.
  check('duplicateProject : FIRST_DEV_EMAIL écrit', dupEnv.split(/\r?\n/).filter((l) => l === 'FIRST_DEV_EMAIL=dev@neuf.fr').length === 1);
  check('duplicateProject : AUCUN mot de passe d’amorçage dans le .env',
    !dupEnv.split(/\r?\n/).some((l) => /^(SEED|FIRST)_[A-Z_]*PASSWORD=/.test(l)));
  check('duplicateProject : le rapport annonce un compte EN ATTENTE',
    dup.devAccount.email === 'dev@neuf.fr' && dup.devAccount.status === 'PENDING_ACTIVATION');
  check('duplicateProject : envCheck confirme l’absence de secret hérité',
    dup.envCheck.firstDevEmail === 'present-unique' && dup.envCheck.legacySeedPasswords === 'absent');

  /* ══════════════════════════════════════════════════════════════════════════
     LE PREMIER ADMINISTRATEUR — écrit dans la BASE, jamais dans un fichier.
     ══════════════════════════════════════════════════════════════════════════ */
  const clientVerif = new (await import('mongodb')).MongoClient(uri);
  await clientVerif.connect();
  const adminCree = await clientVerif.db('neuf_test').collection('users').findOne({ role: 'ADMIN' });
  check('duplicateProject : l’administrateur existe dans la base TEST de la copie', adminCree !== null);
  check('…avec l’adresse saisie', adminCree.email === 'contact@neuf.fr');
  check('…et le statut ACTIVE (aucune activation à attendre)', adminCree.status === 'ACTIVE');
  check('…son mot de passe est HACHÉ', /^\$2[aby]\$/.test(adminCree.password));
  check('…jamais en clair', adminCree.password !== 'Neuf-Admin-2026');
  /**
   * LA BASE PROD RESTE VIERGE. Un projet neuf démarre en TEST ; sa PROD est
   * peuplée par la promotion contrôlée, qui recopie les comptes. Deux comptes
   * de même adresse dont l'un n'est jamais relu finiraient par diverger.
   */
  check('…et la base PROD ne reçoit AUCUN compte',
    (await clientVerif.db('neuf_prod').collection('users').countDocuments()) === 0);
  await clientVerif.close();

  check('duplicateProject : le rapport nomme l’administrateur SANS l’exposer',
    dup.adminAccount.role === 'ADMIN' && dup.adminAccount.status === 'ACTIVE'
    && dup.adminAccount.email.includes('***') && !dup.adminAccount.email.includes('contact@neuf.fr'));
  check('duplicateProject : le mot de passe administrateur n’est NULLE PART dans le rapport',
    !JSON.stringify(dup).includes('Neuf-Admin-2026'));
  check('duplicateProject : ni dans les journaux',
    !logsMain.join('\n').includes('Neuf-Admin-2026'));
  check('duplicateProject : ni dans le .env de la copie', !dupEnv.includes('Neuf-Admin-2026'));
  check('duplicateProject : aucune variable ADMIN_PASSWORD dans le .env',
    !/ADMIN_PASSWORD=/.test(dupEnv));
  check('duplicateProject : la phase FIRST_ADMIN est annoncée',
    phasesMain.some((p) => p.phase === 'first_admin' && p.status === 'ok'));
  check('…et elle précède la copie des fichiers',
    phasesMain.findIndex((p) => p.phase === 'first_admin')
      < phasesMain.findIndex((p) => p.phase === 'copy'));
  /* ══════════════════════════════════════════════════════════════════════════
     L'ÉTAPE EST BLOQUANTE : sans administrateur, pas de duplication.

     La base `neuf_test` porte désormais un ADMIN. Une seconde duplication qui
     la viserait écraserait un accès existant — ou, pire, livrerait un projet
     dont l'exploitant croirait connaître le mot de passe administrateur alors
     qu'il appartient au projet précédent. Elle doit ÉCHOUER, tôt, et le dire.
     ══════════════════════════════════════════════════════════════════════════ */
  const phasesRejeu = [];
  const rejeuAdmin = await duplicateProject(
    { ...dupInput, folderName: 'garage-neuf-bis', adminEmail: 'autre@neuf.fr' },
    {
      sourceRoot: src,
      destParent: tmpRoot,
      mongoUri: uri,
      stamp: 'stamp-bis',
      exec: createExecMock().exec,
      onPhase: (e) => phasesRejeu.push(e),
      onLog: () => {},
    }
  ).then(() => null).catch((e) => e);
  check('duplication BLOQUÉE si un administrateur existe déjà dans la base cible',
    rejeuAdmin?.details?.blocker === 'FIRST_ADMIN_ALREADY_PRESENT');
  check('…la phase first_admin est marquée en ERREUR',
    phasesRejeu.some((p) => p.phase === 'first_admin' && p.status === 'error'));
  check('…et l’échec survient AVANT la copie des fichiers',
    !phasesRejeu.some((p) => p.phase === 'copy'));

  check('duplicateProject : n’appelle jamais npm run seed',
    execCalls.every((c) => !(c.args?.[0] === 'run' && c.args?.[1] === 'seed')));
  check('duplicateProject : liste tous les sous-projets Node dupliqués',
    dup.nodeProjects.map((p) => p.path).join('|') === '.|backend|manager|vitrine');
  check('duplicateProject : installe backend + manager + vitrine, jamais la racine',
    execCalls.filter((c) => c.args[0] === 'ci').map((c) => path.basename(c.cwd)).join('|') === 'backend|manager|vitrine');
  check('duplicateProject : npm ci inclut bien les devDependencies',
    execCalls.filter((c) => c.args[0] === 'ci').every((c) => c.args.includes('--include=dev')));
  check('duplicateProject : NODE_ENV=production neutralisé pour l’installation',
    execCalls.filter((c) => c.args[0] === 'ci').every((c) => c.env?.NODE_ENV === undefined && c.env?.npm_config_production === 'false'));
  check('duplicateProject : validation backend prouve node_modules',
    await exists(path.join(dup.path, 'backend', 'node_modules')));
  check('duplicateProject : validation recrée vite.cmd côté manager',
    await exists(installBinPath(path.join(dup.path, 'manager'), 'vite')));
  check('duplicateProject : validation prouve aussi le package vite local côté vitrine',
    await exists(path.join(dup.path, 'vitrine', 'node_modules', 'vite', 'package.json')));
  check('duplicateProject : logs structurés dependencies/validation présents',
    logsMain.some((m) => m.includes('"step":"dependencies"') && m.includes('"project":"manager"'))
    && logsMain.some((m) => m.includes('"step":"validation"') && m.includes('"project":"manager"')));

  // Émission des phases (alimente la progression EN DIRECT côté UI).
  const phases = [];
  const { exec: execPhases } = createExecMock();
  await duplicateProject(
    { ...dupInput, folderName: 'garage-phases', dbTest: 'ph_test', dbProd: 'ph_prod' },
    { sourceRoot: src, destParent: tmpRoot, mongoUri: uri, stamp: 'ph', exec: execPhases, onPhase: (e) => phases.push(e) }
  );
  const okPhases = phases.filter((p) => p.status === 'ok').map((p) => p.phase);
  check('duplicateProject : phases émises dans l’ordre',
    ['mongo', 'databases', 'copy', 'config', 'discover', 'dependencies', 'validate', 'done'].every((id) => okPhases.includes(id)));
  check('duplicateProject : phase mongo avant copy', okPhases.indexOf('mongo') < okPhases.indexOf('copy'));
  check('duplicateProject : phase discover avant dependencies', okPhases.indexOf('discover') < okPhases.indexOf('dependencies'));
  /**
   * LA DÉTECTION REND SES CIBLES, ELLE NE SE DÉDOUBLE PAS.
   *
   * Le moteur émettait un `discover` PAR sous-projet — ce qui racontait
   * l'inverse de ce qui se passe : on aurait « détecté le backend » avant de
   * savoir qu'il existait. La détection a lieu une fois ; les cibles trouvées
   * sont un détail de son résultat, et ce sont ELLES qui portent ensuite des
   * instances d'installation et de validation.
   */
  const detection = phases.find((p) => p.phase === 'discover' && p.status === 'ok');
  check('duplicateProject : la détection rend ses cibles',
    ['backend', 'manager', 'vitrine'].every((t) => detection.targets.includes(t)));
  check('duplicateProject : …et n’émet qu’UNE phase de détection',
    phases.filter((p) => p.phase === 'discover' && p.status === 'ok').length === 1);
  check('duplicateProject : chaque cible a son instance d’installation',
    ['backend', 'manager', 'vitrine'].every((t) =>
      phases.some((p) => p.phase === 'dependencies' && p.target === t && p.status === 'ok')));
  check('duplicateProject : et son instance de validation',
    ['backend', 'manager', 'vitrine'].every((t) =>
      phases.some((p) => p.phase === 'validate' && p.target === t && p.status === 'ok')));
  check('duplicateProject : la racine, sans dépendance, est PASSÉE et non réussie',
    phases.some((p) => p.phase === 'dependencies' && p.target === '.' && p.status === 'skipped'));

  /* ══════════════════════════════════════════════════════════════════════════
     AUCUN ÉVÉNEMENT NE PORTE DE LIBELLÉ NI D'ORDRE.

     Les transporter ferait du fil une SECONDE source de vérité — celle qui
     gagnerait, puisqu'elle arrive en dernier. Le flux transporte des faits ;
     la présentation se résout à l'arrivée, depuis le registre.
     ══════════════════════════════════════════════════════════════════════════ */
  check('aucun événement ne transporte de libellé', phases.every((p) => p.label === undefined));
  check('aucun événement ne transporte d’ordre', phases.every((p) => p.order === undefined));

  const registrePhases = await import('../duplication-engine/config/duplication.phases.js');
  const { isKnownPhase, PHASE_STATUS_VALUES } = registrePhases;
  check('toute phase émise appartient au REGISTRE', phases.every((p) => isKnownPhase(p.phase)));
  check('tout statut émis appartient au vocabulaire fermé',
    phases.every((p) => PHASE_STATUS_VALUES.includes(p.status)));
  check('le mot « failed » a disparu du fil', !phases.some((p) => p.status === 'failed'));

  /* ── LA CHECKLIST DU RAPPORT DÉRIVE DU REGISTRE ─────────────────────────── */
  check('le rapport porte une checklist', Array.isArray(dup.checklist) && dup.checklist.length > 0);
  check('…dont chaque entrée porte le libellé CANONIQUE',
    dup.checklist.every((e) => typeof e.label === 'string' && e.label.length > 0));
  check('…et son état réel', dup.checklist.every((e) => PHASE_STATUS_VALUES.includes(e.status)));
  check('…toutes les phases obligatoires y ont abouti',
    dup.checklist.filter((e) => e.status !== 'ok' && e.status !== 'skipped').length === 0);
  const ordreChecklist = dup.checklist.map((e) => e.id);
  check('…dans l’ordre CANONIQUE',
    ordreChecklist.join('|') === [...ordreChecklist].sort((a, b) => {
      const { phaseDefinition } = registrePhases;
      return phaseDefinition(a).order - phaseDefinition(b).order;
    }).join('|'));
  check('duplicateProject : cwd Windows avec espaces transmis intact',
    execCalls.filter((c) => c.args[0] === 'ci').every((c) => c.cwd.includes('dup test space')));

  // Refus si la cible existe déjà.
  check('duplicateProject : refuse un dossier cible existant',
    await threws(() => duplicateProject(dupInput, { sourceRoot: src, destParent: tmpRoot, mongoUri: uri, stamp: 's', exec: execOk }), ValidationError));
  check('assertSafeDuplicationDestination : refuse source == destination',
    await threws(() => assertSafeDuplicationDestination(src, tmpRoot, src), ValidationError));
  check('assertSafeDuplicationDestination : refuse destination dans la source',
    await threws(() => assertSafeDuplicationDestination(src, src, path.join(src, 'copy')), ValidationError));
  check('assertSafeDuplicationDestination : refuse destination contenant la source',
    await threws(() => assertSafeDuplicationDestination(src, tmpRoot, tmpRoot), ValidationError));

  /* ---- 5bis. Échec explicite si une installation requise casse ---- */
  const { exec: execFailBackend } = createExecMock({ failProject: 'backend' });
  let installBackendError = null;
  try {
    await duplicateProject(
      { ...dupInput, folderName: 'garage-backend-fail', dbTest: 'backend_fail_test', dbProd: 'backend_fail_prod' },
      { sourceRoot: src, destParent: tmpRoot, mongoUri: uri, stamp: 'backend-fail', exec: execFailBackend }
    );
  } catch (err) {
    installBackendError = err;
  }
  check('duplicateProject : erreur explicite si npm du backend échoue',
    installBackendError instanceof NodeProjectInitializationError
    && installBackendError.code === 'DUPLICATION_DEPENDENCIES_INSTALL_FAILED'
    && installBackendError.details?.project === 'backend');

  const { exec: execFail } = createExecMock({ failProject: 'manager' });
  let installError = null;
  try {
    await duplicateProject(
      { ...dupInput, folderName: 'garage-fail', dbTest: 'fail_test', dbProd: 'fail_prod' },
      { sourceRoot: src, destParent: tmpRoot, mongoUri: uri, stamp: 'fail', exec: execFail }
    );
  } catch (err) {
    installError = err;
  }
  check('duplicateProject : erreur explicite si npm du manager échoue',
    installError instanceof NodeProjectInitializationError && installError.code === 'DUPLICATION_DEPENDENCIES_INSTALL_FAILED');
  check('duplicateProject : manager FAILED stoppe avant vitrine',
    !await exists(path.join(tmpRoot, 'garage-fail', 'vitrine', 'node_modules')));

  const { exec: execFailVitrine } = createExecMock({ failProject: 'vitrine' });
  let installVitrineError = null;
  try {
    await duplicateProject(
      { ...dupInput, folderName: 'garage-vitrine-fail', dbTest: 'vitrine_fail_test', dbProd: 'vitrine_fail_prod' },
      { sourceRoot: src, destParent: tmpRoot, mongoUri: uri, stamp: 'vitrine-fail', exec: execFailVitrine }
    );
  } catch (err) {
    installVitrineError = err;
  }
  check('duplicateProject : erreur explicite si npm de la vitrine échoue',
    installVitrineError instanceof NodeProjectInitializationError
    && installVitrineError.code === 'DUPLICATION_DEPENDENCIES_INSTALL_FAILED'
    && installVitrineError.details?.project === 'vitrine');

  /* ---- 5ter. Une vitrine lente ne doit jamais être abandonnée ---- */
  const { exec: execSlow, calls: slowCalls } = createExecMock({ delayProject: { vitrine: 250 } });
  const slowStart = Date.now();
  const dupSlow = await duplicateProject(
    { ...dupInput, folderName: 'garage-slow', dbTest: 'slow_test', dbProd: 'slow_prod' },
    { sourceRoot: src, destParent: tmpRoot, mongoUri: uri, stamp: 'slow', exec: execSlow }
  );
  const slowDuration = Date.now() - slowStart;
  check('duplicateProject : une vitrine lente est attendue jusqu’au bout',
    slowDuration >= 250 && await exists(installBinPath(path.join(dupSlow.path, 'vitrine'), 'vite')));
  check('duplicateProject : la dernière installation reste bien vitrine',
    slowCalls.filter((c) => c.args[0] === 'ci').at(-1)?.cwd.endsWith(path.join('garage-slow', 'vitrine')));

  /* ---- 5quater. Lockfile manquant -> fallback déterministe npm install ---- */
  const srcNoLock = path.join(tmpRoot, 'source-no-lock');
  await copyProject(src, srcNoLock);
  await fs.rm(path.join(srcNoLock, 'vitrine', 'package-lock.json'));
  const discoveredNoLock = await discoverNodeProjects(srcNoLock);
  check('discoverNodeProjects : vitrine sans lockfile reste installable',
    discoveredNoLock.find((p) => p.relativePath === 'vitrine')?.lockfile === null
    && discoveredNoLock.find((p) => p.relativePath === 'vitrine')?.installNeeded === true);
  const { exec: execNoLock, calls: noLockCalls } = createExecMock();
  await duplicateProject(
    { ...dupInput, folderName: 'garage-no-lock', dbTest: 'nolock_test', dbProd: 'nolock_prod' },
    { sourceRoot: srcNoLock, destParent: tmpRoot, mongoUri: uri, stamp: 'nolock', exec: execNoLock }
  );
  check('duplicateProject : vitrine sans lockfile utilise npm install',
    noLockCalls.some((c) => path.basename(c.cwd) === 'vitrine' && c.args[0] === 'install'));

  /* ---- 5sexies. L'IDENTITÉ TECHNIQUE N'EST JAMAIS HÉRITÉE ---- */
  /**
   * ══ LE DÉFAUT QUE CE BLOC FERME ═══════════════════════════════════════════
   *
   * `project.profile.js` porte le slug (préfixe PM2, staging, sauvegardes) et
   * l'identifiant publié par `/api/version`. La duplication réécrivait le
   * `.env` et OUBLIAIT ce fichier : dix projets clients auraient tous annoncé
   * `sbauto06`, et déposé leurs sauvegardes dans le même `/var/backups/sbauto`.
   *
   * Rien n'aurait cassé — c'est le pire des cas : chaque copie aurait menti sur
   * son identité, en silence, dès le premier clone.
   */
  check('deriveProjectIdentity : un nom lisible donne un slug utilisable',
    deriveProjectIdentity('Garage Dupont & Fils').slug === 'garage-dupont-fils');
  check('…les accents sont réduits, jamais laissés dans un nom de processus',
    deriveProjectIdentity('Carrosserie Générale').slug === 'carrosserie-generale');
  check('…un slug ne commence jamais par un chiffre',
    deriveProjectIdentity('2000 Autos').slug.startsWith('p-'));
  check('…deux noms différents donnent deux identités différentes',
    deriveProjectIdentity('Garage A').slug !== deriveProjectIdentity('Garage B').slug);
  check('…un nom inexploitable est REFUSÉ, jamais remplacé par un défaut',
    (() => { try { deriveProjectIdentity('---'); return false; } catch { return true; } })());

  const profilSource = "export const PROJECT_SLUG = 'sbauto';" + String.fromCharCode(10)
    + "export const PROJECT_ID = 'sbauto06';" + String.fromCharCode(10)
    + 'export const BACKUP_ROOT = `/var/backups/${PROJECT_SLUG}`;';
  const profilCible = rewriteProjectProfile(profilSource, { slug: 'garage-neuf', projectId: 'garage-neuf' });
  check('rewriteProjectProfile : le slug de la source a disparu',
    !profilCible.includes("'sbauto'") && !profilCible.includes("'sbauto06'"));
  check('…remplacé par celui de la copie',
    profilCible.includes("export const PROJECT_SLUG = 'garage-neuf'")
    && profilCible.includes("export const PROJECT_ID = 'garage-neuf'"));
  check('…et le reste du profil est intact',
    profilCible.includes('export const BACKUP_ROOT = `/var/backups/${PROJECT_SLUG}`;'));
  check('un profil illisible fait ÉCHOUER la duplication, jamais passer en silence',
    (() => {
      try { rewriteProjectProfile('const rien = 1;', { slug: 'x', projectId: 'x' }); return false; }
      catch { return true; }
    })());

  /** Et sur une duplication RÉELLE, de bout en bout. */
  const srcId = path.join(tmpRoot, 'source-identite');
  await copyProject(src, srcId);
  await duplicateProject(
    { ...dupInput, projectName: 'Garage Neuf', folderName: 'garage-identite', dbTest: 'ident_test', dbProd: 'ident_prod' },
    { sourceRoot: srcId, destParent: tmpRoot, mongoUri: uri, stamp: 'ident', exec: execOk }
  );
  const profilEcrit = await fs.readFile(
    path.join(tmpRoot, 'garage-identite', 'backend', 'src', 'deployment-engine', 'config', 'project.profile.js'),
    'utf8',
  );
  check('DUPLICATION RÉELLE : la copie porte sa PROPRE identité technique',
    profilEcrit.includes("export const PROJECT_SLUG = 'garage-neuf'"), profilEcrit.slice(0, 80));
  check('…et plus aucune trace de celle de la source',
    !profilEcrit.includes('sourceslug') && !profilEcrit.includes('sourceid'));

  /* ---- 5septies. AUCUN MÉDIA CLIENT NE TRAVERSE UNE DUPLICATION ---- */
  /**
   * `uploads` porte les logos, les photos de véhicules, les documents — les
   * données d'un CLIENT. Le dossier doit exister dans la copie (le runtime y
   * écrit dès le premier envoi), son contenu ne doit jamais y arriver.
   *
   * Le dépôt l'ignore, donc il est vide en clone frais : le défaut ne se voyait
   * que sur un poste où le projet source avait réellement servi.
   */
  /**
   * ── LE CONTRÔLE PORTE SUR UN CHEMIN, PLUS SUR UN NOM ─────────────────────
   *
   * Il vérifiait `COPY_EMPTY_ONLY.has('uploads')`. Le registre désigne
   * désormais des CHEMINS (`backend/uploads`), et la nuance n'est pas
   * cosmétique : un nom vide tout dossier qui le porte, où qu'il soit — y
   * compris un « logs » légitime au milieu d'une bibliothèque tierce.
   *
   * L'assertion est donc réécrite, et ÉLARGIE : les trois dossiers dont la
   * première duplication réelle a prouvé qu'ils fuyaient — médias, documents
   * contractuels, journaux — sont vérifiés ensemble.
   */
  for (const attendu of ['backend/uploads', 'backend/storage', 'backend/logs']) {
    check(`${attendu} est déclaré « structure seulement »`, COPY_EMPTY_ONLY.has(attendu));
  }

  const srcMedias = path.join(tmpRoot, 'source-medias');
  await copyProject(src, srcMedias);
  await fs.mkdir(path.join(srcMedias, 'backend', 'uploads'), { recursive: true });
  await fs.writeFile(path.join(srcMedias, 'backend', 'uploads', 'logo-du-client.webp'), 'binaire');
  await fs.writeFile(path.join(srcMedias, 'backend', 'uploads', 'vehicule-42.jpg'), 'binaire');

  const cible = path.join(tmpRoot, 'copie-sans-medias');
  await copyProject(srcMedias, cible);
  check('LE DOSSIER uploads EXISTE dans la copie',
    await exists(path.join(cible, 'backend', 'uploads')));
  const dedans = await fs.readdir(path.join(cible, 'backend', 'uploads'));
  check('…et il est VIDE : aucun média du client source', dedans.length === 0, dedans.join(','));
  check('…tandis que la source les a toujours',
    (await fs.readdir(path.join(srcMedias, 'backend', 'uploads'))).length === 2);

  /* ---- 5quinquies. Échec de copie / transformation -> FAILED ---- */
  check('duplicateProject : source absente -> échec de copie',
    await threws(() => duplicateProject(
      { ...dupInput, folderName: 'garage-missing-source', dbTest: 'missing_source_test', dbProd: 'missing_source_prod' },
      { sourceRoot: path.join(tmpRoot, 'missing-source'), destParent: tmpRoot, mongoUri: uri, stamp: 'missing-source', exec: execOk }
    )));
  const srcBroken = path.join(tmpRoot, 'source-broken');
  await fs.mkdir(srcBroken, { recursive: true });
  await fs.writeFile(path.join(srcBroken, 'package.json'), JSON.stringify({ name: 'broken-root', private: true }, null, 2));
  check('duplicateProject : backend absent -> échec de transformation',
    await threws(() => duplicateProject(
      { ...dupInput, folderName: 'garage-broken', dbTest: 'broken_test', dbProd: 'broken_prod' },
      { sourceRoot: srcBroken, destParent: tmpRoot, mongoUri: uri, stamp: 'broken', exec: execOk }
    )));

  /* ══════════════════════════════════════════════════════════════════════════
     6. LA PROPRETÉ DU CLONE — la garde née de la première duplication réelle.

     Elle a livré 7 006 documents contractuels du client source. Ce qui manquait
     n'était pas la règle — `uploads` la portait déjà — mais sa VÉRIFICATION :
     une exclusion qui échoue en silence produit exactement le dommage qu'elle
     prétendait empêcher.
     ══════════════════════════════════════════════════════════════════════════ */
  console.log(`
6. Propreté du clone (registre d’arborescence)`);
  const { assertCleanTree, TREE_POLICY, TREE_ENTRIES } =
    await import('../duplication-engine/config/duplication.tree.js');

  const verdictDe = (cible) => TREE_ENTRIES.find((e) => e.target === cible)?.policy;
  check('backend/storage est déclaré COPY_EMPTY', verdictDe('backend/storage') === TREE_POLICY.COPY_EMPTY);
  check('backend/logs est déclaré COPY_EMPTY', verdictDe('backend/logs') === TREE_POLICY.COPY_EMPTY);
  check('one-off est déclaré IGNORE', verdictDe('one-off') === TREE_POLICY.IGNORE);
  check('.claude est déclaré IGNORE', verdictDe('.claude') === TREE_POLICY.IGNORE);
  check('chaque entrée du registre porte un motif', TREE_ENTRIES.every((e) => typeof e.why === 'string' && e.why.trim().length >= 10),
    TREE_ENTRIES.filter((e) => !(e.why ?? '').trim()).map((e) => e.target).join(','));

  /* — La source la plus dangereuse : celle qui a réellement servi — */
  const srcVecu = path.join(tmpRoot, 'source-vecue');
  await copyProject(src, srcVecu);
  for (const [rel, contenu] of [
    ['backend/storage/contracts/6a1/contrat-signe.pdf', '%PDF-1.4 fictif'],
    ['backend/logs/email-diagnostic.log', 'destinataire: client@source.fr'],
    ['backend/uploads/logo-client.webp', 'binaire'],
    ['backend/migration-reports/2026-08-01.json', '{"donnees":"metier"}'],
  ]) {
    await fs.mkdir(path.dirname(path.join(srcVecu, rel)), { recursive: true });
    await fs.writeFile(path.join(srcVecu, rel), contenu);
  }
  await fs.mkdir(path.join(srcVecu, '.claude', 'skills'), { recursive: true });
  await fs.writeFile(path.join(srcVecu, '.claude', 'skills', 'local.md'), 'outillage machine');
  await fs.mkdir(path.join(srcVecu, 'backend', 'src', 'scripts', 'one-off'), { recursive: true });
  await fs.writeFile(path.join(srcVecu, 'backend', 'src', 'scripts', 'one-off', 'repare-la-source.js'), '// vise la base de la source');

  const clone = path.join(tmpRoot, 'clone-propre');
  await copyProject(srcVecu, clone);

  for (const [libelle, rel] of [
    ['documents contractuels', 'backend/storage'],
    ['journaux', 'backend/logs'],
    ['médias', 'backend/uploads'],
    ['rapports de migration', 'backend/migration-reports'],
  ]) {
    const dedans = await fs.readdir(path.join(clone, ...rel.split('/'))).catch(() => null);
    check(`${rel} existe dans la copie`, Array.isArray(dedans), String(dedans));
    check(`…et ne contient AUCUN ${libelle} de la source`, (dedans ?? ['?']).length === 0, (dedans ?? []).join(','));
  }
  check('.claude (outillage machine) n’est pas copié', !(await exists(path.join(clone, '.claude'))));
  check('one-off (réparations d’un autre projet) n’est pas copié',
    !(await exists(path.join(clone, 'backend', 'src', 'scripts', 'one-off'))));

  check('assertCleanTree accepte un clone propre', Boolean((await assertCleanTree(clone)).ok));

  /* — Et refuse tout ce qui aurait dû rester à la source — */
  await fs.writeFile(path.join(clone, 'backend', 'storage', 'contrat-oublie.pdf'), '%PDF');
  const refus = await assertCleanTree(clone).then(() => null, (e) => e);
  check('assertCleanTree REFUSE un document du client source', refus?.code === 'DUPLICATION_TREE_NOT_CLEAN');
  check('…en nommant le dossier fautif', /backend\/storage/.test(refus?.message ?? ''));
  await fs.rm(path.join(clone, 'backend', 'storage', 'contrat-oublie.pdf'));

  await fs.mkdir(path.join(clone, 'tools', 'one-off'), { recursive: true });
  const refus2 = await assertCleanTree(clone).then(() => null, (e) => e);
  check('assertCleanTree REFUSE un dossier exclu qui a survécu', refus2?.code === 'DUPLICATION_TREE_NOT_CLEAN');
  await fs.rm(path.join(clone, 'tools', 'one-off'), { recursive: true, force: true });

  /* — Une source FRAÎCHE n'a ni storage ni logs : la copie doit les créer — */
  const srcFrais = path.join(tmpRoot, 'source-fraiche');
  await copyProject(src, srcFrais);
  const cloneFrais = path.join(tmpRoot, 'clone-source-fraiche');
  await copyProject(srcFrais, cloneFrais);
  check('une source sans backend/storage produit tout de même le dossier',
    await exists(path.join(cloneFrais, 'backend', 'storage')));
  check('…et le runtime trouve aussi backend/logs',
    await exists(path.join(cloneFrais, 'backend', 'logs')));

  /* ══════════════════════════════════════════════════════════════════════════
     7. L'IDENTITÉ — toutes ses autorités, pas seulement le profil.
     ══════════════════════════════════════════════════════════════════════════ */
  console.log(`
7. Identité complète de la copie`);
  const { readProjectIdentity, rewriteProjectIdentity, scanResidualSourceIdentity } =
    await import('../duplication-engine/identity.js');

  const srcIdent = path.join(tmpRoot, 'source-identite');
  await copyProject(src, srcIdent);
  const ecrire = async (rel, contenu) => {
    await fs.mkdir(path.dirname(path.join(srcIdent, rel)), { recursive: true });
    await fs.writeFile(path.join(srcIdent, rel), contenu, 'utf8');
  };
  await ecrire('backend/src/deployment-engine/config/project.profile.js',
    "export const PROJECT_SLUG = 'ancien';\nexport const PROJECT_ID = 'ancien06';\n");
  await ecrire('backend/src/deployment-engine/engine.manifest.json',
    JSON.stringify({ engine: 'deployment-engine', supportedProfiles: ['ancien', 'panel'] }, null, 2));
  await ecrire('backend/src/duplication-engine/engine.manifest.json',
    JSON.stringify({ engine: 'duplication-engine', supportedProfiles: ['ancien'] }, null, 2));
  await ecrire('package.json', JSON.stringify({ name: 'ancien-06', description: 'Ancien Projet — monorepo' }, null, 2));
  await ecrire('backend/package.json', JSON.stringify({ name: 'ancien-backend', main: 'src/server.js' }, null, 2));
  await ecrire('backend/package-lock.json', JSON.stringify({ name: 'ancien-backend', lockfileVersion: 3, packages: { '': { name: 'ancien-backend' } } }, null, 2));
  await ecrire('manager/package.json', JSON.stringify({ name: 'ancien-manager' }, null, 2));
  await ecrire('manager/index.html', '<!doctype html><title>Ancien Projet — Manager</title>');
  await ecrire('vitrine/index.html',
    '<!doctype html><title>Ancien Projet — Lavage</title>'
    + '<meta property="og:site_name" content="Ancien Projet" />'
    + '<meta name="description" content="texte commercial de la source" />');
  await ecrire('scripts/dev-canonical.mjs', "console.log('  Ancien Projet — démarrage DEV canonique');\n");

  const identiteSource = await readProjectIdentity(srcIdent);
  check('readProjectIdentity lit le slug de la source', identiteSource.slug === 'ancien');
  check('…et son identifiant de build', identiteSource.projectId === 'ancien06');

  const cloneIdent = path.join(tmpRoot, 'clone-identite');
  await copyProject(srcIdent, cloneIdent);
  await fs.writeFile(
    path.join(cloneIdent, 'backend/src/deployment-engine/config/project.profile.js'.split('/').join(path.sep)),
    "export const PROJECT_SLUG = 'neuf';\nexport const PROJECT_ID = 'neuf';\n", 'utf8',
  );
  const applique = await rewriteProjectIdentity(
    cloneIdent, { slug: 'neuf', projectId: 'neuf', projectName: 'Projet Neuf' },
    { source: identiteSource },
  );

  const lireJson = async (rel) => JSON.parse(await fs.readFile(path.join(cloneIdent, ...rel.split('/')), 'utf8'));
  const lireTexte = (rel) => fs.readFile(path.join(cloneIdent, ...rel.split('/')), 'utf8');

  const manifDep = await lireJson('backend/src/deployment-engine/engine.manifest.json');
  check('le manifeste du moteur sert le profil de la COPIE', manifDep.supportedProfiles.includes('neuf'));
  check('…et plus celui de la source', !manifDep.supportedProfiles.includes('ancien'));
  check('…sans perdre les autres profils légitimes', manifDep.supportedProfiles.includes('panel'));

  check('le paquet racine porte le slug', (await lireJson('package.json')).name === 'neuf');
  check('le paquet backend porte slug-dossier', (await lireJson('backend/package.json')).name === 'neuf-backend');
  check('le paquet manager aussi', (await lireJson('manager/package.json')).name === 'neuf-manager');
  const lock = await lireJson('backend/package-lock.json');
  check('le lockfile suit le paquet', lock.name === 'neuf-backend' && lock.packages[''].name === 'neuf-backend');
  check('la description garde son propos, change de nom',
    (await lireJson('package.json')).description === 'Projet Neuf — monorepo');

  const htmlManager = await lireTexte('manager/index.html');
  check('le titre d’onglet du manager nomme la copie', htmlManager.includes('<title>Projet Neuf — Manager</title>'));
  const htmlVitrine = await lireTexte('vitrine/index.html');
  check('le titre de la vitrine aussi', htmlVitrine.includes('<title>Projet Neuf — Lavage</title>'));
  check('og:site_name nomme la copie', htmlVitrine.includes('content="Projet Neuf"'));
  check('le texte COMMERCIAL n’est pas inventé par le moteur',
    htmlVitrine.includes('texte commercial de la source'));
  check('…mais il est SIGNALÉ à personnaliser',
    applique.toReview.some((t) => t.startsWith('vitrine/index.html')));

  check('la bannière de démarrage nomme la copie',
    (await lireTexte('scripts/dev-canonical.mjs')).includes('Projet Neuf — démarrage DEV canonique'));

  /* — Une réécriture qui n'a pas pris doit être BRUYANTE — */
  const cloneRate = path.join(tmpRoot, 'clone-identite-ratee');
  await copyProject(srcIdent, cloneRate);
  /**
   * LA PANNE SIMULÉE EST UNE RÉÉCRITURE QUI *SEMBLE* RÉUSSIR.
   *
   * Faire échouer l'écriture ne prouverait rien : l'erreur remonterait d'elle-
   * même. Ce qu'on veut éprouver est le cas dangereux — l'écriture rend sans
   * broncher, et le fichier porte encore l'ancienne valeur. C'est exactement la
   * forme qu'avait le défaut d'origine : un moteur convaincu d'avoir renommé.
   */
  const MANIFESTE_INCHANGE = `${JSON.stringify({ engine: 'deployment-engine', supportedProfiles: ['ancien', 'panel'] }, null, 2)}\n`;
  const fsPiege = {
    readFile: fs.readFile, readdir: fs.readdir, rename: fs.rename,
    writeFile: async (p, c, e) => fs.writeFile(p, String(p).includes('engine.manifest.json') ? MANIFESTE_INCHANGE : c, e),
  };
  const rate = await rewriteProjectIdentity(
    cloneRate, { slug: 'neuf', projectId: 'neuf', projectName: 'Projet Neuf' },
    { source: identiteSource, fsMod: fsPiege },
  ).then(() => null, (e) => e);
  check('une réécriture d’identité qui échoue LÈVE', rate?.code === 'DUPLICATION_IDENTITY_REWRITE_FAILED');
  check('…en nommant le champ resté en arrière', /supportedProfiles|manifest/.test(JSON.stringify(rate?.details ?? {}) + (rate?.message ?? '')));

  /* ── Le balayage résiduel : bruit maîtrisé, limites déclarées ──────────── */
  /**
   * Un jeton de moins de quatre caractères n'est pas cherchable sans noyer le
   * rapport : « src » satisfait n'importe quelle règle de frontière dans
   * `"main": "src/server.js"`. Le balayage refuse de le chercher, ET LE DIT.
   * Une limite tue laisserait croire à un dépôt propre.
   */
  const trop_court = await scanResidualSourceIdentity(cloneIdent, { slug: 'src', projectId: 'src' });
  check('un jeton trop court n’est pas cherché', trop_court.occurrences.length === 0);
  check('…et son abandon est DÉCLARÉ', trop_court.skippedTokens.includes('src'));

  const cherchable = await scanResidualSourceIdentity(cloneIdent, identiteSource);
  check('un jeton cherchable ne relève rien dans un clone dont l’identité a été reprise',
    cherchable.code.length === 0,
    cherchable.code.slice(0, 3).map((o) => `${o.file}:${o.line}`).join(' '));
  check('…et il a bien balayé des fichiers', cherchable.files > 0);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (err) {
  console.error('DUPLICATION TEST CRASHED:', err);
  fail++;
} finally {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  await mongod.stop();
  process.exit(fail === 0 ? 0 : 1);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
