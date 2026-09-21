/* UI_CANNOT_REACTIVATE_ACTIVE_MODE — l'ancien comportement ne peut pas revenir.
 *
 * ── CE QUE CE FICHIER FERME ──────────────────────────────────────────────────
 *
 * Le lot L2 a retiré la bascule TEST/PROD des écrans. Retirer un bouton ne
 * prouve rien : la route existait toujours, et un appel HTTP direct, un vieux
 * Manager en cache, ou une ligne de JSX réintroduite auraient suffi à ramener
 * la doctrine révoquée.
 *
 * On vérifie donc les DEUX étages :
 *
 *   · HTTP        — aucune requête, si bien formée soit-elle, ne repose
 *                   `activeMode` ni ne modifie un état ;
 *   · STRUCTUREL  — aucune interface (Manager, Panel) ne porte encore le
 *                   vocabulaire du choix, ni le client capable de l'émettre.
 *
 * Le second compte autant que le premier : un backend qui refuse pendant qu'un
 * écran propose est un écran qui ment.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'revoked_test';
process.env.DB_PROD = 'revoked_prod';
process.env.JWT_SECRET = 'test-secret-jwt-revoked-0123456789';
process.env.PORT = '4139';
process.env.CORS_ORIGINS = 'http://localhost:6061';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

const path = await import('node:path');
const fs = await import('node:fs/promises');
const { fileURLToPath } = await import('node:url');

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
await connectDatabase();
await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();
// LOT 2C — le DÉCOR de recette (dev@mail.com, admin@mail.com) ne vient plus du
// produit : `bootstrap()` ne pose aucun mot de passe. Voir helpers/testAccounts.helper.js.
await (await import("./helpers/testAccounts.helper.js")).seedTestAccounts();

const { IntegratedApi } = await import('../models/IntegratedApi.model.js');
const { encryptSecret } = await import('../utils/integratedApiCrypto.js');
const { createApp } = await import('../app.js');
const { signToken } = await import('../utils/signer.js').catch(() => ({ signToken: null }));

/* ── Un serveur réel, un DEV réel ────────────────────────────────────────── */
const app = createApp();
const server = app.listen(Number(process.env.PORT));
const base = `http://127.0.0.1:${process.env.PORT}`;

async function api(method, route, { token, body } = {}) {
  const res = await fetch(`${base}/api${route}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

const { User } = await import('../models/User.model.js');
const { ROLES } = await import('../utils/constants.js');
/*
  ══ ON PREND LE COMPTE DE LA RECETTE, PAS « UN DEV » ═════════════════════════

  `findOne({ role: DEV })` rendait le PREMIER développeur trouvé. Sur un poste
  de développement, ce n'est pas celui du décor de recette : l'amorçage crée
  aussi un compte DEV local dérivé du `.env` de la machine, qui naît EN ATTENTE
  D'ACTIVATION et n'a donc aucun mot de passe. La connexion échouait — « un DEV
  est connecté » au rouge — et toute la suite s'effondrait derrière, pour une
  raison qui n'avait rien à voir avec ce qu'elle éprouve.

  Le décor sème `dev@mail.com` et connaît son mot de passe : c'est LUI qu'il
  faut demander. Le repli sur « n'importe quel DEV » reste là pour un
  environnement où le décor n'aurait pas été posé.
*/
const devUser = (await User.findOne({ email: 'dev@mail.com', role: ROLES.DEV }).lean())
  ?? (await User.findOne({ role: ROLES.DEV }).lean());
const login = await api('POST', '/auth/login', {
  body: { email: devUser?.email ?? 'dev@mail.com', password: '123dev' },
});
const devToken = login.json?.data?.token ?? null;

section('Préparation');
{
  check('un DEV est connecté', typeof devToken === 'string');
  await IntegratedApi.updateOne(
    { provider: 'STRIPE' },
    {
      $set: {
        activeMode: 'TEST',
        'modes.TEST.credentials.secretKey': { encryptedValue: encryptSecret('sk_test_REVOKED_SENTINEL'), lastFour: 'INEL' },
        'modes.TEST.configured': true,
        'modes.PROD.credentials.secretKey': { encryptedValue: encryptSecret('sk_live_REVOKED_SENTINEL'), lastFour: 'INEL' },
        'modes.PROD.configured': true,
        'modes.PROD.verified': true,
      },
    },
  );
}

section('HTTP — aucune requête ne peut reposer activeMode');
{
  const avant = await IntegratedApi.findOne({ provider: 'STRIPE' }).lean();

  /**
   * Toutes les formes que l'ancien client savait produire, plus celles qu'un
   * script d'exploitation pourrait tenter. Aucune ne doit aboutir.
   */
  const tentatives = [
    ['mode PROD + verbe exact', { mode: 'PROD', confirmation: 'ACTIVER STRIPE PROD' }],
    ['mode PROD nu', { mode: 'PROD' }],
    ['retour vers TEST', { mode: 'TEST' }],
    ['corps vide', {}],
    ['mode inventé', { mode: 'STAGING' }],
    ['casse minuscule', { mode: 'prod', confirmation: 'ACTIVER STRIPE PROD' }],
  ];

  /**
   * ══ LE REFUS EST DEVENU UNE ABSENCE (R11) ═══════════════════════════════
   *
   * Ces requêtes recevaient un 409 `ACTIVE_MODE_REVOKED` : la route existait et
   * refusait. Elle a disparu avec toute la surface d'administration des
   * IntegratedAPI — Brevo étant passé sous autorité plateforme, aucun des
   * quatre fournisseurs n'était plus administrable localement.
   *
   * La garantie que ce fichier défend — « la bascule TEST/PROD ne peut pas
   * revenir » — en sort renforcée : un 409 est un `if` dans un contrôleur, un
   * 404 est l'absence du contrôleur.
   */
  for (const [nom, corps] of tentatives) {
    const r = await api('POST', '/integrated-apis/STRIPE/active-mode', { token: devToken, body: corps });
    check(`${nom} → route inexistante`, r.status === 404);
  }

  const apres = await IntegratedApi.findOne({ provider: 'STRIPE' }).lean();
  check('AUCUN champ n’a bougé en base',
    apres.activeMode === avant.activeMode
    && String(apres.modeUpdatedAt) === String(avant.modeUpdatedAt)
    && String(apres.modeUpdatedBy) === String(avant.modeUpdatedBy));

  /*
   * Sans jeton, la reponse est un 404 elle aussi : la route n'existe plus, et
   * l'absence se constate AVANT l'authentification. C'est le bon ordre — une
   * route morte ne doit pas reveler qu'elle a existe en exigeant d'abord un
   * jeton.
   */
  const sansJeton = await api('POST', '/integrated-apis/STRIPE/active-mode', { body: { mode: 'PROD' } });
  check('sans authentification → route inexistante aussi', sansJeton.status === 404);
}

/*
 * ══ DEUX SECTIONS ONT DISPARU AVEC LEUR ROUTE (R11) ═══════════════════════
 *
 * « Le refus NOMME le monde imposé » inspectait le CORPS du 409 : il exigeait
 * que le message dise quel monde s'impose, plutôt que d'envoyer l'exploitant
 * chercher. C'était juste tant qu'un refus était rendu — il n'y a plus de
 * refus, il n'y a plus de route.
 *
 * « La lecture expose le monde EFFECTIF » lisait `GET /integrated-apis`,
 * supprimée elle aussi : cette liste n'alimentait que la page d'administration.
 *
 * Ce que ces deux sections protégeaient — le monde du runtime est la seule
 * autorité, `activeMode` n'en est plus une — reste éprouvé, et sur le
 * mécanisme plutôt que sur sa mise en forme HTTP :
 * `integrated-api-environment-routing.test.js` le vérifie sur le coffre, et
 * `integrated-api-panel-authority.test.js` verrouille l'absence des routes.
 */

section('STRUCTUREL — aucune interface ne propose plus le choix');
{
  const racine = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));

  async function fichiers(dossier, extensions) {
    const out = [];
    let entrees = [];
    try { entrees = await fs.readdir(dossier, { withFileTypes: true }); } catch { return out; }
    for (const e of entrees) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
      const complet = path.join(dossier, e.name);
      if (e.isDirectory()) out.push(...await fichiers(complet, extensions));
      else if (extensions.some((x) => e.name.endsWith(x))) out.push(complet);
    }
    return out;
  }

  const manager = await fichiers(path.join(racine, 'manager', 'src'), ['.ts', '.tsx']);
  check('le Manager est bien inspecté', manager.length > 20);

  const fautifs = [];
  for (const f of manager) {
    const brut = await fs.readFile(f, 'utf8');
    // Les commentaires EXPLIQUENT la révocation : c'est leur rôle, on les ôte.
    const code = brut.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (/setActiveMode\s*\(/.test(code)) fautifs.push(`${path.basename(f)} : appelle setActiveMode`);
    if (/active-mode/.test(code)) fautifs.push(`${path.basename(f)} : cible la route active-mode`);
    if (/crossModeRisk/.test(code)) fautifs.push(`${path.basename(f)} : lit crossModeRisk`);
  }
  check(`aucun appel de bascule dans le Manager${fautifs.length ? ` (${fautifs.join(' · ')})` : ''}`,
    fautifs.length === 0);

  // Le Panel : son écran legacy ne doit plus parler de « mode côté Panel ».
  const panel = await fichiers(path.join(racine, '..', 'Panel', 'frontend', 'src'), ['.tsx']);
  if (panel.length > 0) {
    const suspects = [];
    for (const f of panel) {
      const code = (await fs.readFile(f, 'utf8'))
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
      if (/Mode côté Panel/.test(code)) suspects.push(path.basename(f));
      if (/crossModeRisk/.test(code)) suspects.push(path.basename(f));
    }
    check(`le Panel ne propose plus de mode fournisseur${suspects.length ? ` (${suspects.join(', ')})` : ''}`,
      suspects.length === 0);
  } else {
    console.log('  ~ Panel absent à côté — vérification structurelle sautée.');
  }
}

section('OBSERVABILITÉ — le routage est journalisable, sans secret');
{
  const routage = await import('../services/integratedApiEnvironment.js');
  const stripe = routage.describeRouting('STRIPE');
  check('le routage porte provider, scope, runtime et resolved',
    stripe.provider === 'STRIPE' && stripe.scope === 'ENVIRONMENT'
    && stripe.runtimeEnvironment === 'TEST' && stripe.resolvedProviderEnvironment === 'TEST');
  check('pour ENVIRONMENT, runtime et resolved sont IDENTIQUES',
    stripe.runtimeEnvironment === stripe.resolvedProviderEnvironment);

  const hostinger = routage.describeRouting('HOSTINGER');
  check('un fournisseur global n’a PAS d’environnement inventé',
    hostinger.resolvedProviderEnvironment === null);
  check('…mais sa case de coffre est nommée à part',
    hostinger.credentialSlot === 'TEST' && hostinger.scope === 'PANEL_GLOBAL');

  check('aucun secret dans l’observation',
    !JSON.stringify([stripe, hostinger]).match(/sk_(test|live)_|xkeysib-|whsec_/));

  // Déduplication : une ligne par tuple, pas une par lecture de clé.
  routage._resetRoutingObservations();
  const premier = routage.observeRouting('STRIPE');
  const second = routage.observeRouting('STRIPE');
  check('deux observations du même tuple rendent le même constat',
    JSON.stringify(premier) === JSON.stringify(second));
}

await new Promise((r) => server.close(r));
await disconnectDatabase();
console.log(`\n${pass} réussis, ${fail} échoués`);
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
