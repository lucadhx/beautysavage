/*
 * Non-régression : résolution du .env DISTANT (deployEnv.js).
 *
 * RÈGLE : DÉPLOYER embarque le .env du projet TEL QUEL (mêmes MONGODB_URI,
 * DB_TEST, DB_PROD, JWT_SECRET, clé de chiffrement). On n'écrase QUE ce qui est
 * spécifique à l'hôte (ENV, PORT, CORS_ORIGINS, PUBLIC_URL). Le renommage de
 * base n'a lieu QUE lors d'une DUPLICATION, jamais au déploiement. Aucun réseau.
 */
import { buildRemoteEnv, describeRemoteEnv, parseEnv, serializeEnv } from '../deployment-engine/deployEnv.js';

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };

const TARGET = { host: 'demo-sbauto.lycarz.com', backendPort: 5011, managerHost: 'manager.demo-sbauto.lycarz.com' };

// .env source RÉALISTE (mêmes clés que le vrai backend/.env).
const SRC = {
  ENV: 'TEST',
  MONGODB_URI: 'mongodb+srv://usr:PWD123@cluster0.abcd.mongodb.net',
  DB_TEST: 'sbauto06_test',
  DB_PROD: 'sbauto06_prod',
  JWT_SECRET: 'un-secret-de-controle-tres-long-et-aleatoire-1234567890',
  JWT_EXPIRES_IN: '7d',
  PORT: '6070',
  CORS_ORIGINS: 'http://localhost:6071,http://localhost:6070',
  PUBLIC_URL: 'http://localhost:6070',
  INTEGRATED_API_ENCRYPTION_KEY: 'a'.repeat(64),
  DEPLOY_VPS_SESSION_TTL_MS: '900000', // plan de contrôle : NE doit PAS partir sur le VPS
};

try {
  /* 1. Parse / serialize. */
  const p = parseEnv('A=1\n# c\nB="deux"\n\nC=trois');
  check('1. parseEnv : clés + quotes + commentaires', p.A === '1' && p.B === 'deux' && p.C === 'trois');
  check('1b. serializeEnv : round-trip', serializeEnv({ A: '1', B: 'x' }) === 'A=1\nB=x');

  /* 2. Déploiement PROD : DB + secrets VERBATIM, hôte écrasé. */
  const { remoteEnv: e, dbName } = buildRemoteEnv(TARGET, { env: 'PROD', source: { ...SRC } });
  check('2. MONGODB_URI VERBATIM (jamais réécrit)', e.MONGODB_URI === SRC.MONGODB_URI);
  check('2b. DB_TEST VERBATIM (du .env, jamais inventé)', e.DB_TEST === 'sbauto06_test');
  check('2c. DB_PROD VERBATIM (du .env, jamais inventé)', e.DB_PROD === 'sbauto06_prod');
  check('2d. JWT_SECRET VERBATIM (pas de génération)', e.JWT_SECRET === SRC.JWT_SECRET);
  check('2e. clé de chiffrement VERBATIM (pas de génération)', e.INTEGRATED_API_ENCRYPTION_KEY === SRC.INTEGRATED_API_ENCRYPTION_KEY);
  check('2f. JWT_EXPIRES_IN VERBATIM', e.JWT_EXPIRES_IN === '7d');

  /* 3. Overrides spécifiques à l'hôte — et RIEN d'autre. */
  check('3. ENV = env visé (PROD)', e.ENV === 'PROD');
  check('3b. PORT = backendPort de la cible', e.PORT === '5011');
  check('3c. CORS_ORIGINS = vitrine + Manager https', e.CORS_ORIGINS === 'https://demo-sbauto.lycarz.com,https://manager.demo-sbauto.lycarz.com');
  check('3d. PUBLIC_URL = https hôte', e.PUBLIC_URL === 'https://demo-sbauto.lycarz.com');
  check('3e. dbName effectif = DB_PROD (ENV=PROD)', dbName === 'sbauto06_prod');

  /* 4. Les clés PLAN DE CONTRÔLE ne partent pas sur le VPS. */
  check('4. DEPLOY_VPS_SESSION_TTL_MS exclu du .env distant', !('DEPLOY_VPS_SESSION_TTL_MS' in e));

  /* 5. Déploiement TEST : base effective = DB_TEST (toujours verbatim). */
  const t = buildRemoteEnv(TARGET, { env: 'TEST', source: { ...SRC } });
  check('5. ENV=TEST -> dbName effectif = DB_TEST', t.dbName === 'sbauto06_test' && t.remoteEnv.ENV === 'TEST');
  check('5b. DB_PROD toujours présent (verbatim) même en TEST', t.remoteEnv.DB_PROD === 'sbauto06_prod');

  /* 6. Clés additionnelles du .env reprises verbatim (ex. STRIPE_PROVIDER). */
  const withExtra = buildRemoteEnv(TARGET, {
    env: 'PROD',
    source: { ...SRC, STRIPE_PROVIDER: 'stripe', SIGNATURE_PROVIDER: 'stub' },
  });
  check('6. clé additionnelle STRIPE_PROVIDER reprise', withExtra.remoteEnv.STRIPE_PROVIDER === 'stripe');
  check('6b. clé additionnelle SIGNATURE_PROVIDER reprise', withExtra.remoteEnv.SIGNATURE_PROVIDER === 'stub');

  /*
   * 6c. LE RÉGLAGE GLOBAL DE GRÂCE N'EXISTE PLUS (L10.6B-1).
   *
   * `CONTRACT_PAYMENT_GRACE_DAYS` servait ici d'exemple de clé quelconque. Il
   * n'était lu par rien : une politique d'impayé affichée dans le `.env` et
   * appliquée nulle part. Elle vit désormais sur le CONTRAT. Ce contrôle
   * empêche sa réapparition — deux autorités pour la même question, c'est
   * exactement ce que le lot supprime.
   */
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const exemple = await fs.readFile(path.join(racine, '.env.example'), 'utf8');
  const envJs = await fs.readFile(path.join(racine, 'src/config/env.js'), 'utf8');
  const sansCommentaires = envJs.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
  check('6c. aucune variable de grâce dans .env.example', !/CONTRACT_PAYMENT_GRACE_DAYS/.test(exemple));
  check('6d. aucun réglage de grâce dans la configuration', !/contractPaymentGraceDays|GRACE_DAYS/.test(sansCommentaires));

  /* 7. Config incomplète -> erreur explicite, bloquante AVANT upload. */
  const miss = (src) => { try { buildRemoteEnv(TARGET, { env: 'PROD', source: src }); return null; } catch (err) { return err; } };
  check('7. MONGODB_URI absent -> DEPLOY_ENV_INCOMPLETE', miss({ ...SRC, MONGODB_URI: undefined })?.code === 'DEPLOY_ENV_INCOMPLETE');
  check('7b. DB_PROD absent (ENV=PROD) -> DEPLOY_ENV_INCOMPLETE', miss({ ...SRC, DB_PROD: undefined })?.code === 'DEPLOY_ENV_INCOMPLETE');
  check('7c. JWT_SECRET absent -> DEPLOY_ENV_INCOMPLETE', miss({ ...SRC, JWT_SECRET: undefined })?.code === 'DEPLOY_ENV_INCOMPLETE');
  check('7d. clé de chiffrement absente -> DEPLOY_ENV_INCOMPLETE', miss({ ...SRC, INTEGRATED_API_ENCRYPTION_KEY: undefined })?.code === 'DEPLOY_ENV_INCOMPLETE');
  const errMsg = miss({ ...SRC, MONGODB_URI: undefined });
  check('7e. message liste la variable manquante', /MONGODB_URI/.test(errMsg.message) && Array.isArray(errMsg.details?.missing));

  /* 8. describeRemoteEnv : résumé SANS aucune valeur secrète. */
  const desc = describeRemoteEnv({ remoteEnv: e, dbName, env: 'PROD' });
  const blob = JSON.stringify(desc);
  check('8. résumé ne fuit ni JWT ni clé ni mot de passe Mongo', !blob.includes(SRC.JWT_SECRET) && !blob.includes(SRC.INTEGRATED_API_ENCRYPTION_KEY) && !blob.includes('PWD123'));
  check('8b. résumé expose base + type mongo + hôte', desc.dbName === 'sbauto06_prod' && desc.mongo === 'atlas (mongodb+srv)' && desc.publicUrl === 'https://demo-sbauto.lycarz.com');

  /* 9. Ordre des clés préservé (lisibilité du .env distant). */
  const serialized = serializeEnv(e);
  check('9. le .env distant commence par les clés du source (ordre préservé)', serialized.startsWith('ENV=PROD\nMONGODB_URI='));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (err) {
  console.error('ENV TEST CRASHED:', err);
  fail++;
} finally {
  process.exit(fail === 0 ? 0 : 1);
}
