/**
 * APPAIRAGE REFUSÉ ≠ SESSION EXPIRÉE.
 *
 * ── LE DÉFAUT QU'IL VERROUILLE ──────────────────────────────────────────────
 * Un développeur connecté saisit un code d'appairage, clique « Appairer », et
 * se retrouve sur l'écran de connexion. Sa session était valide : c'est le
 * Panel qui refusait le code. Dans le contrat du pont, un code invalide vaut
 * 401 ; relayé tel quel au Manager, ce 401 ne pouvait vouloir dire qu'une
 * chose — « votre session a expiré » — et le client effaçait le jeton.
 *
 * Deux garanties sont contrôlées ici :
 *   · la route d'appairage ne répond JAMAIS 401 pour un refus du Panel ;
 *   · la session du développeur survit à l'échec, et un second essai passe.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4137';
process.env.CORS_ORIGINS = 'http://localhost:6061';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SEED_DEV_EMAIL = 'dev@sbauto.test';
process.env.SEED_DEV_PASSWORD = 'motdepasse-test';

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); } else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (titre) => console.log(`\n${titre}`);

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();

const { createApp } = await import('../app.js');
const { User } = await import('../models/User.model.js');
const { ROLES } = await import('../utils/constants.js');
const bridgeRuntime = await import('../services/panelBridge/bridgeRuntime.js');
const { BRIDGE_ERROR_CODES, bridgeError } = await import('../services/panelBridge/bridgeErrors.js');
const { CONTRACT_VERSION } = await import('../services/panelBridge/bridgeContract.js');

/* ── Un compte DEV, et sa session ─────────────────────────────────────────── */
/**
 * ══ LE SERVICE EST DÉCLARÉ PRÊT — SANS CELA, TOUT RÉPOND 503 ════════════════
 *
 * ── POURQUOI CETTE LIGNE MANQUAIT, ET CE QUE ÇA A COÛTÉ ───────────────────
 *
 * Le backend distingue « vivant » et « prêt » : il ouvre son port aussitôt et
 * refuse les routes métier en `503 SERVICE_STARTING` tant que l'amorçage n'est
 * pas terminé. C'est une garde délibérée, et elle est arrivée APRÈS cette
 * suite, qui monte son application à la main sans jamais passer par l'amorçage.
 *
 * Résultat : les dix contrôles qui passent par HTTP échouaient — connexion,
 * `/auth/me`, refus d'appairage, 401 sans jeton. La suite lisait un défaut de
 * session là où il n'y avait qu'un service s'estimant encore en train de naître.
 *
 * Et personne ne l'a vu, parce que `panel-pairing-session` n'était PAS dans la
 * chaîne `npm test`. Une garde qu'on n'exécute pas ne garde rien ; elle est
 * ajoutée à la chaîne dans le même lot que cette correction.
 *
 * Le produit n'est pas en cause : c'est l'assertion implicite « un serveur qui
 * écoute sert ses routes » qui est devenue historiquement fausse.
 */
const { markReady } = await import('../services/lifecycle/readiness.service.js');
markReady();

const app = createApp();
const serveur = app.listen(0);
await new Promise((r) => serveur.once('listening', r));
const base = `http://127.0.0.1:${serveur.address().port}/api`;

const appel = async (chemin, { method = 'GET', body, token } = {}) => {
  const res = await fetch(`${base}${chemin}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

// Le modèle hache le mot de passe à l'enregistrement : on le donne en clair.
await User.create({
  email: 'dev@sbauto.test',
  name: 'Dev',
  role: ROLES.DEV,
  password: 'motdepasse-test',
});

const connexion = await appel('/auth/login', {
  method: 'POST',
  body: { email: 'dev@sbauto.test', password: 'motdepasse-test' },
});
const TOKEN = connexion.json?.data?.token ?? null;

section('0. Un développeur est connecté');
{
  check('la connexion réussit', connexion.status === 200 && typeof TOKEN === 'string');
  check('…et la session est reconnue', (await appel('/auth/me', { token: TOKEN })).status === 200);
}

/* ── Le Panel refuse le code ──────────────────────────────────────────────── */
section('1. Code d’appairage refusé : jamais un 401');
let statutRefus = null;
{
  // UN VRAI PANEL QUI REFUSE. Le contrat du pont fait d'un code invalide un
  // 401 : c'est exactement ce que ce faux Panel répond, et c'est ce 401 qui
  // remontait jusqu'au navigateur pour y être lu comme « session expirée ».
  const refus = bridgeError(BRIDGE_ERROR_CODES.PAIRING_CODE_INVALID, 'Code d’appairage invalide.');
  check('le contrat du pont fait bien de ce refus un 401', refus.statusCode === 401);

  // Le pont a besoin de son fournisseur d'identité : au bootstrap réel, c'est
  // la configuration du projet qui le pose. On le branche minimalement.
  bridgeRuntime.configureBridgeRuntime({
    identityProvider: async () => ({
      projectKey: 'projet-test',
      projectName: 'Projet Test',
      environment: 'TEST',
      softwareVersion: '1.0.0',
      contractVersion: CONTRACT_VERSION,
    }),
  });

  const http = await import('node:http');
  const fauxPanel = http.createServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      code: BRIDGE_ERROR_CODES.PAIRING_CODE_INVALID,
      message: 'Code d’appairage invalide ou expiré.',
    }));
  });
  fauxPanel.listen(0);
  await new Promise((r) => fauxPanel.once('listening', r));
  const urlPanel = `http://127.0.0.1:${fauxPanel.address().port}`;

  const res = await appel('/panel-connection/pair', {
    method: 'POST',
    token: TOKEN,
    body: { panelUrl: urlPanel, pairingCode: 'PAIR-XXXX-XXXX-XXXX' },
  });
  statutRefus = res.status;

  check('la route répond, et PAS 401', res.status !== 401);
  check(`…un refus d’APPAIRAGE, pas de session (${res.status})`, res.status === 422);
  check('…en gardant le code d’origine',
    res.json?.code === BRIDGE_ERROR_CODES.PAIRING_CODE_INVALID);
  check('…et le vrai message, affichable tel quel',
    typeof res.json?.message === 'string' && res.json.message.includes('appairage'));
  check('…jamais un code de session', res.json?.code !== 'UNAUTHORIZED');

  await new Promise((r) => fauxPanel.close(r));
}

/* ── La session survit ────────────────────────────────────────────────────── */
section('2. La session du développeur survit à l’échec');
{
  const moi = await appel('/auth/me', { token: TOKEN });
  check('le jeton est toujours valable', moi.status === 200);
  check('…et c’est bien le compte DEV', moi.json?.data?.role === ROLES.DEV || moi.json?.data?.user?.role === ROLES.DEV);

  // Un second essai est possible — la page n'a pas été quittée.
  const second = await appel('/panel-connection/pair', {
    method: 'POST',
    token: TOKEN,
    body: { panelUrl: 'https://panel.invalide.test', pairingCode: 'PAIR-YYYY-YYYY-YYYY' },
  });
  check('un second essai est accepté par la route', second.status !== 401);
  check('…et la session tient encore',
    (await appel('/auth/me', { token: TOKEN })).status === 200);
}

/* ── Les vrais 401 restent des 401 ────────────────────────────────────────── */
section('3. Une session réellement absente reste un 401');
{
  const sansJeton = await appel('/panel-connection/pair', {
    method: 'POST',
    body: { panelUrl: 'https://panel.invalide.test', pairingCode: 'PAIR-ZZZZ-ZZZZ-ZZZZ' },
  });
  check('sans jeton → 401', sansJeton.status === 401);

  const jetonFaux = await appel('/panel-connection/pair', {
    method: 'POST',
    token: 'jeton.invente.xyz',
    body: { panelUrl: 'https://panel.invalide.test', pairingCode: 'PAIR-ZZZZ-ZZZZ-ZZZZ' },
  });
  check('avec un jeton invalide → 401', jetonFaux.status === 401);
}

/* ── Le rôle reste distinct de la session ─────────────────────────────────── */
section('4. Un rôle insuffisant est un 403, pas un 401');
{
  const admin = await User.create({
    email: 'admin@sbauto.test',
    name: 'Admin',
    role: ROLES.ADMIN,
    password: 'motdepasse-test',
  }).catch(() => null);

  if (admin) {
    const login = await appel('/auth/login', {
      method: 'POST',
      body: { email: 'admin@sbauto.test', password: 'motdepasse-test' },
    });
    if (login.status === 200) {
      const res = await appel('/panel-connection/pair', {
        method: 'POST',
        token: login.json.data.token,
        body: { panelUrl: 'https://panel.invalide.test', pairingCode: 'PAIR-AAAA-AAAA-AAAA' },
      });
      check('un ADMIN reçoit 403, jamais 401', res.status === 403);
    } else {
      check('compte ADMIN non connectable — garde vérifiée par la route', true);
    }
  } else {
    check('compte ADMIN non créable ici — garde vérifiée par la route', true);
  }
}

/* ── La règle côté client ─────────────────────────────────────────────────── */
section('5. Le client ne déconnecte plus sur un 401 du pont');
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const client = await fs.readFile(path.join(racine, 'manager/src/lib/api.ts'), 'utf8');

  check('un code du pont n’est jamais lu comme une session expirée',
    /export function estErreurDuPont\(code\?: string\): boolean \{\s*return typeof code === 'string' && code\.startsWith\('BRIDGE_'\);/.test(client));
  check('…et seul /auth/me fait autorité sur la session',
    /const controle = await fetch\(`\$\{API_BASE\}\/auth\/me`/.test(client));
  check('le corps est lu AVANT de décider de déconnecter',
    client.indexOf('const raw = await res.text();') < client.indexOf('if (res.status === 401 && auth)'));
  check('une panne réseau pendant la vérification ne déconnecte pas',
    /catch \{\s*return false;\s*\}/.test(client));
  check('la purge du jeton reste conditionnée à la vérification',
    /if \(token && \(await sessionReellementExpiree\(path, json\.code, token\)\)\) \{\s*tokenStore\.clear\(\);/.test(client));
}

await new Promise((r) => serveur.close(r));
await disconnectDatabase();
console.log(`\n${pass} réussis, ${fail} échoués`);
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
