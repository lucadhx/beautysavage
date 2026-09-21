/*
 * RÉSOLUTION AUTOMATIQUE des URLs de webhook — le propriétaire ne saisit
 * JAMAIS une URL.
 *
 * Couvre :
 *  - resolvePublicBackendUrl(mode) : ordres de résolution TEST et PROD, ngrok
 *    détecté automatiquement (jamais en PROD), localhost jamais exploitable,
 *    état structuré WEBHOOK_PUBLIC_URL_UNAVAILABLE ;
 *  - buildWebhookUrl / registre des webhooks gérés (provider+category+mode) ;
 *  - convention de description canonique + reconnaissance legacy ;
 *  - LOT 11 : changement d'URL ngrok → webhook TEST mis à jour (même
 *    webhookId, aucun doublon), PROD jamais touché.
 *
 * Style promote.test.js : runner autonome. Mongo en mémoire, Brevo + ngrok simulés.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.ENV = 'TEST';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  process.env.INTEGRATED_API_ENCRYPTION_KEY || 'a'.repeat(64);
const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'webhook_url_resolution_test';
/**
 * ══ CES DEUX VARIABLES SONT EFFACÉES DEUX FOIS, ET C'EST NÉCESSAIRE ═════════
 *
 * Les effacer ICI ne suffit pas : le premier import de `config/env.js`, plus
 * bas, appelle `dotenv.config()`, qui les REPOSE depuis le `.env` du projet.
 * Elles n'y étaient pas dans le projet où cette suite a été écrite ; elles y
 * sont dans TOUT projet appairé, puisque `PUBLIC_BACKEND_URL` est justement ce
 * que la doctrine d'appairage demande d'y écrire.
 *
 * La suite échouait donc sur deux contrôles — « localhost jamais exploitable »
 * — non pas parce que le code avait changé, mais parce que le projet était
 * correctement configuré. Un test qui ne passe que sur un projet non configuré
 * ne prouve rien de celui qu'on livre.
 *
 * `neutraliserEnvironnement()` est rappelée après les imports.
 */
function neutraliserEnvironnement() {
  delete process.env.PUBLIC_BACKEND_URL;
  delete process.env.WEBHOOK_INSTALLATION_ID;
}
neutraliserEnvironnement();

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

// ---------------------------------------------------------------------------
// Réseau simulé : API locale ngrok + API Brevo. Tout le reste passe au réel.
// ---------------------------------------------------------------------------
const realFetch = globalThis.fetch;
let ngrokTunnels = null; // null = ngrok absent ; sinon liste de tunnels
let remoteWebhooks = [];
let brevoCalls = [];

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

globalThis.fetch = async (input, options = {}) => {
  const href = typeof input === 'string' ? input : String(input?.url ?? input);
  const method = options.method || 'GET';

  if (href.includes('127.0.0.1:4040/api/tunnels')) {
    if (ngrokTunnels === null) throw new TypeError('fetch failed'); // ngrok arrêté
    return json(200, { tunnels: ngrokTunnels });
  }
  if (/^https?:\/\/[^/]*brevo/.test(href)) {
    const path = decodeURIComponent(href.replace(/^https?:\/\/[^/]*\/v3/, ''));
    brevoCalls.push({ method, path, body: options.body ? JSON.parse(options.body) : null });
    if (method === 'GET' && path === '/account') return json(200, { email: 'a@b.fr' });
    if (path.startsWith('/webhooks')) {
      if (method === 'GET') return json(200, { webhooks: remoteWebhooks });
      if (method === 'POST') return json(201, { id: 'wh-created' });
      if (method === 'PUT') return json(200, {});
      if (method === 'DELETE') return json(200, {});
    }
    return json(404, { message: path });
  }
  return realFetch(input, options);
};

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();
const { bootstrap } = await import('../config/bootstrap.js');
await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();

const { config } = await import('../config/env.js');
const { SystemConfiguration } = await import('../models/SystemConfiguration.model.js');
const { IntegratedApi } = await import('../models/IntegratedApi.model.js');
const { encryptSecret, lastFourOf } = await import('../utils/integratedApiCrypto.js');
const {
  resolvePublicBackendUrl,
  PUBLIC_URL_SOURCE,
  WEBHOOK_PUBLIC_URL_UNAVAILABLE,
  isPubliclyReachableUrl,
} = await import('../services/networkConfig.service.js');
const {
  buildWebhookUrl,
  expectedWebhookUrl,
  managedWebhookDescription,
  legacyManagedWebhookDescriptions,
  isManagedDescription,
  managedWebhookSpec,
} = await import('../services/webhooks/managedWebhookRegistry.js');
const { resetNgrokCache } = await import('../services/ngrokTunnel.service.js');

// `config/env.js` a chargé le `.env` du projet en passant : on refait le vide.
neutraliserEnvironnement();

const NGROK_1 = 'https://abc123.ngrok-free.app';
const NGROK_2 = 'https://xyz789.ngrok-free.app';
const PROD_URL = 'https://api.demo-sbauto.lycarz.com';
const tunnel = (url, port = config.port) => ({ public_url: url, config: { addr: `http://localhost:${port}` } });

async function setBackendUrl(url) {
  await SystemConfiguration.updateOne({}, { $set: { 'network.backendUrl': url } }, { upsert: true });
}

try {
  // ═══════════════════════════════════════════════════════════════════════════
  section('1. isPubliclyReachableUrl — HTTPS public uniquement');
  check('https public → oui', isPubliclyReachableUrl(PROD_URL) === true);
  check('http public → non', isPubliclyReachableUrl('http://exemple.fr') === false);
  check('https localhost → non', isPubliclyReachableUrl('https://localhost:6070') === false);
  check('127.0.0.1 → non', isPubliclyReachableUrl('https://127.0.0.1') === false);
  check('vide/invalide → non', !isPubliclyReachableUrl('') && !isPubliclyReachableUrl('pas-une-url'));

  // ═══════════════════════════════════════════════════════════════════════════
  section('2. resolvePublicBackendUrl(TEST) — ordre : ngrok → Config Système → env → localhost');
  {
    // ngrok PRIORITAIRE : même avec une Config Système publique (périmée), le
    // tunnel COURANT fait foi.
    await setBackendUrl('https://vieille-url.ngrok-free.app');
    ngrokTunnels = [tunnel(NGROK_1)];
    resetNgrokCache();
    const r = await resolvePublicBackendUrl('TEST');
    check('ngrok détecté : URL du tunnel', r.url === NGROK_1);
    check('ngrok détecté : source NGROK', r.source === PUBLIC_URL_SOURCE.NGROK);
    check('ngrok détecté : exploitable', r.webhookReady === true);
  }
  {
    // Un tunnel vers un AUTRE port (manager 6071) n'est PAS le backend.
    ngrokTunnels = [tunnel('https://manager-tunnel.ngrok-free.app', 6071)];
    resetNgrokCache();
    await setBackendUrl('');
    const r = await resolvePublicBackendUrl('TEST');
    check('tunnel d’un autre service : ignoré', r.source !== PUBLIC_URL_SOURCE.NGROK);
  }
  {
    // ngrok absent → Config Système publique.
    ngrokTunnels = null;
    resetNgrokCache();
    await setBackendUrl(NGROK_2);
    const r = await resolvePublicBackendUrl('TEST');
    check('sans tunnel : Config Système', r.url === NGROK_2 && r.source === PUBLIC_URL_SOURCE.SYSTEM_CONFIGURATION);
  }
  {
    // ngrok absent + Config localhost → LOCALHOST, jamais exploitable.
    ngrokTunnels = null;
    resetNgrokCache();
    await setBackendUrl('http://localhost:6070');
    const r = await resolvePublicBackendUrl('TEST');
    check('localhost : backend vivant mais webhooks indisponibles',
      r.source === PUBLIC_URL_SOURCE.LOCALHOST && r.webhookReady === false);
    check('localhost : code structuré', r.code === WEBHOOK_PUBLIC_URL_UNAVAILABLE);
  }
  {
    // Variable d'environnement en secours.
    ngrokTunnels = null;
    resetNgrokCache();
    await setBackendUrl('');
    process.env.PUBLIC_BACKEND_URL = 'https://secours.exemple.fr';
    const r = await resolvePublicBackendUrl('TEST');
    check('env : source ENVIRONMENT', r.url === 'https://secours.exemple.fr' && r.source === PUBLIC_URL_SOURCE.ENVIRONMENT);
    delete process.env.PUBLIC_BACKEND_URL;
  }
  {
    // Rien du tout → état structuré, jamais une exception.
    ngrokTunnels = null;
    resetNgrokCache();
    await setBackendUrl('');
    const r = await resolvePublicBackendUrl('TEST');
    check('rien : NONE + WEBHOOK_PUBLIC_URL_UNAVAILABLE',
      r.source === PUBLIC_URL_SOURCE.NONE && r.code === WEBHOOK_PUBLIC_URL_UNAVAILABLE && r.webhookReady === false);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('3. resolvePublicBackendUrl(PROD) — JAMAIS ngrok, HTTPS obligatoire');
  {
    // Même avec un tunnel ngrok VIVANT, PROD ne le considère jamais.
    ngrokTunnels = [tunnel(NGROK_1)];
    resetNgrokCache();
    await setBackendUrl(PROD_URL);
    const r = await resolvePublicBackendUrl('PROD');
    check('PROD : Config Système (écrite par le déploiement)',
      r.url === PROD_URL && r.source === PUBLIC_URL_SOURCE.SYSTEM_CONFIGURATION);
    check('PROD : ngrok ignoré même vivant', r.url !== NGROK_1);
  }
  {
    // Config localhost/HTTP → indisponible (jamais un webhook PROD vers localhost).
    await setBackendUrl('http://localhost:6070');
    const r = await resolvePublicBackendUrl('PROD');
    check('PROD localhost : indisponible', r.webhookReady === false && r.code === WEBHOOK_PUBLIC_URL_UNAVAILABLE);
  }
  {
    await setBackendUrl('');
    process.env.PUBLIC_BACKEND_URL = PROD_URL;
    const r = await resolvePublicBackendUrl('PROD');
    check('PROD env de secours : ENVIRONMENT', r.source === PUBLIC_URL_SOURCE.ENVIRONMENT && r.url === PROD_URL);
    delete process.env.PUBLIC_BACKEND_URL;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('4. buildWebhookUrl / registre — construction CENTRALISÉE');
  {
    /*
     * R11 — LE TÉMOIN EST DEVENU STRIPE.
     *
     * Les sections 4 à 7 éprouvaient la construction d'URL sur le webhook Brevo
     * de ce projet. Il n'existe plus : les e-mails partent du compte Brevo DU
     * PANEL, les événements de livraison suivent le compte, et la route locale
     * a été supprimée avec la clé qui la déclarait.
     *
     * La RÈGLE, elle, est inchangée et toujours vitale : une URL de webhook se
     * construit à UN SEUL endroit, à partir de la racine publique, jamais
     * stockée en entier. Stripe la porte désormais — c'est le seul webhook que
     * ce projet possède encore, donc le seul témoin honnête.
     *
     * Les sections 5 à 7 (description canonique, changement d'URL ngrok,
     * façade `expectedWebhookUrl`) éprouvaient la RÉCONCILIATION DISTANTE d'un
     * webhook Brevo via `ensureBrevoTransactionalWebhook`. Cette fonction a été
     * supprimée : il n'y a plus rien à réconcilier chez Brevo depuis ce projet.
     * La réconciliation Stripe, elle, garde ses propres suites.
     */
    check('Stripe : URL construite depuis la racine publique',
      buildWebhookUrl({ provider: 'STRIPE', category: 'payment', mode: 'TEST', publicBackendUrl: NGROK_1 })
      === `${NGROK_1}/api/webhooks/stripe`);
    check('slash final absorbé',
      buildWebhookUrl({ provider: 'STRIPE', category: 'payment', mode: 'TEST', publicBackendUrl: `${NGROK_1}/` })
      === `${NGROK_1}/api/webhooks/stripe`);
    check("racine absente → ''",
      buildWebhookUrl({ provider: 'STRIPE', category: 'payment', mode: 'TEST', publicBackendUrl: '' }) === '');
    check('le registre ne connaît plus de webhook Brevo',
      (() => { try { managedWebhookSpec('BREVO', 'transactional'); return false; } catch { return true; } })());
  }

} finally {
  await disconnectDatabase();
  await mongod.stop();
  globalThis.fetch = realFetch;
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
