/* End-to-end smoke test against an in-memory MongoDB. Not shipped in prod. */
import { MongoMemoryServer } from 'mongodb-memory-server';
import { normalizeAppUrl } from '../utils/normalizeAppUrl.js';
import { probeUrl, isPrivateIp } from '../utils/urlProbe.js';
import { SystemConfiguration } from '../models/SystemConfiguration.model.js';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret';
process.env.PORT = '4123';
process.env.CORS_ORIGINS = 'http://localhost:5173,http://localhost:5174'; // fixe pour le test CORS (dotenv n'écrase pas)

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
const { createApp } = await import('../app.js');

await connectDatabase();
await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();
// LOT 2C — le décor de recette ne vient plus du produit (voir helpers/testAccounts.helper.js).
await (await import("./helpers/testAccounts.helper.js")).seedTestAccounts();
const app = createApp();
const server = app.listen(4123);
const base = 'http://localhost:4123';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
async function api(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = res.status === 204 ? null : await res.json();
  return { status: res.status, json };
}

try {
  // Health & meta
  check('health ok', (await api('GET', '/health')).json.data.status === 'ok');
  check('meta media catalog', (await api('GET', '/api/meta')).json.data.mediaCatalog.length > 0);

  // Auth: admin + dev seeded
  const adminLogin = await api('POST', '/api/auth/login', {
    body: { email: 'admin@mail.com', password: '123admin' },
  });
  check('admin login', adminLogin.status === 200 && !!adminLogin.json.data.token);
  check('admin role', adminLogin.json.data.user.role === 'ADMIN');
  const adminToken = adminLogin.json.data.token;

  const devLogin = await api('POST', '/api/auth/login', {
    body: { email: 'dev@mail.com', password: '123dev' },
  });
  check('dev login', devLogin.status === 200);
  const devToken = devLogin.json.data.token;

  check('bad password rejected', (await api('POST', '/api/auth/login', {
    body: { email: 'admin@mail.com', password: 'wrong' },
  })).status === 401);

  // Test-mode quick login
  const testAccts = await api('GET', '/api/auth/test-accounts');
  check('test-accounts enabled in TEST', testAccts.json.data.enabled === true && testAccts.json.data.accounts.length === 2);
  const quickLogin = await api('POST', '/api/auth/dev-login', { body: { email: 'admin@mail.com' } });
  check('dev-login issues a token in TEST', quickLogin.status === 200 && !!quickLogin.json.data.token);
  check('dev-login unknown account 404', (await api('POST', '/api/auth/dev-login', { body: { email: 'nobody@mail.com' } })).status === 404);

  // Company singleton
  const company = await api('GET', '/api/company', { token: adminToken });
  check('company has media catalog', company.json.data.media.length === 6);
  check('no website medium', !company.json.data.media.some((m) => m.key === 'website'));

  const companyUpdate = await api('PUT', '/api/company', {
    token: adminToken,
    body: { name: 'Nice Detailing', media: company.json.data.media.map((m) =>
      m.key === 'whatsapp' ? { ...m, value: '+33600000000', enabled: true } : m) },
  });
  check('company updated', companyUpdate.json.data.name === 'Nice Detailing');

  // Ré-enregistrement avec un __v périmé (cas réel après migration) : ne doit pas 500.
  const staleSave = await api('PUT', '/api/company', {
    token: adminToken,
    body: { ...companyUpdate.json.data, __v: 0, tagline: 'Encore' },
  });
  check('company save ignores stale __v', staleSave.status === 200 && staleSave.json.data.tagline === 'Encore');

  // Compteur de clients satisfaits (porté par la fiche entreprise)
  const withClients = await api('PUT', '/api/company', {
    token: adminToken,
    body: { ...companyUpdate.json.data, satisfiedClients: 250 },
  });
  check('satisfiedClients saved', withClients.json.data.satisfiedClients === 250);

  /* ── LES CHAPITRES ────────────────────────────────────────────────────────
   *
   * Le seul référentiel de contenu structuré du site. Il remplace, à lui seul,
   * les huit du moteur d'origine — d'où une section de recette qui tient en
   * quarante lignes là où elle en occupait deux cents.
   */
  check('chapters require auth', (await api('GET', '/api/chapters')).status === 401);

  const chapitre = await api('POST', '/api/chapters', {
    token: adminToken,
    body: {
      kicker: '02 / CONCEPTION',
      title: 'Conception',
      lead: 'Le projet commence par l’entreprise, pas par un modèle.',
      layout: 'PILLARS',
      items: [
        { icon: 'Fingerprint', label: 'IDENTITÉ', title: 'Comprendre', text: 'L’univers, le métier, la clientèle.' },
        { icon: 'Compass', label: 'DIRECTION', title: 'Décider', text: 'Une direction artistique qui lui est propre.' },
      ],
      statement: { label: 'PRINCIPE', text: 'Nous ne choisissons pas un design. Nous créons le vôtre.' },
    },
  });
  check('chapter created', chapitre.status === 201 && chapitre.json.data.title === 'Conception');
  const chapterId = chapitre.json.data._id;
  check('chapter slug derived from title', chapitre.json.data.slug === 'conception');
  check('chapter items renumbered by POSITION', chapitre.json.data.items[1].order === 20);

  check('chapter rejects unknown layout', (await api('POST', '/api/chapters', {
    token: adminToken, body: { title: 'X', layout: 'MOSAIC' },
  })).status === 400);
  check('chapter rejects a voletless title', (await api('POST', '/api/chapters', {
    token: adminToken, body: { title: 'Y', items: [{ label: 'sans titre' }] },
  })).status === 400);

  /**
   * LE SLUG NE SUIT PAS LE TITRE — c'est le contrat du contrôleur, et il se
   * vérifie ici : un chapitre renommé garde son adresse, donc ses liens.
   */
  const renomme = await api('PUT', `/api/chapters/${chapterId}`, {
    token: adminToken,
    body: { ...chapitre.json.data, title: 'La conception' },
  });
  check('chapter renamed keeps its slug', renomme.json.data.slug === 'conception');

  const second = await api('POST', '/api/chapters', {
    token: adminToken,
    body: { title: 'Architecture', layout: 'SPLIT', items: [] },
  });
  check('second chapter created', second.status === 201);
  const reordonne = await api('PATCH', '/api/chapters/reorder', {
    token: adminToken,
    body: { items: [{ id: second.json.data._id, order: 0 }, { id: chapterId, order: 1 }] },
  });
  check('chapters reordered by navOrder', reordonne.json.data[0]._id === second.json.data._id);

  // Les pages éditoriales restent, et cohabitent avec les chapitres.
  const page = await api('POST', '/api/pages', {
    token: adminToken,
    body: { title: 'Mentions', blocks: [{ type: 'RICH_TEXT', html: '<p>Bonjour</p>' }] },
  });
  check('editorial page created', page.status === 201 && page.json.data.slug === 'mentions');

  // ---- SystemConfiguration.network (DEV only) ----
  const { isOriginAllowed } = await import('../config/corsOrigins.js');

  // normalizeAppUrl (unit)
  check('normalize strips trailing slash', normalizeAppUrl('https://api.domaine.com/') === 'https://api.domaine.com');
  let pathThrew = false;
  try { normalizeAppUrl('https://domaine.com/api/foo'); } catch { pathThrew = true; }
  check('normalize rejects path', pathThrew);

  // Accès
  check('sysconf unauth 401', (await api('GET', '/api/system-configuration/network')).status === 401);
  check('sysconf admin forbidden 403', (await api('GET', '/api/system-configuration/network', { token: adminToken })).status === 403);
  const netGet = await api('GET', '/api/system-configuration/network', { token: devToken });
  check('sysconf dev read + defaults', netGet.status === 200 && netGet.json.data.network.backendUrl === 'http://localhost:6100');
  check('sysconf single document', (await SystemConfiguration.countDocuments()) === 1);

  // Modification DEV + normalisation + updatedBy
  const netUpd = await api('PUT', '/api/system-configuration/network', {
    token: devToken,
    body: { backendUrl: 'http://localhost:6070/', managerUrl: 'http://localhost:6071', websiteUrl: 'http://localhost:6062' },
  });
  check('sysconf update normalizes slash', netUpd.status === 200 && netUpd.json.data.network.backendUrl === 'http://localhost:6070');
  check('sysconf records updatedBy', !!netUpd.json.data.updatedBy && !!netUpd.json.data.updatedBy.email);
  check('sysconf still single', (await SystemConfiguration.countDocuments()) === 1);
  check('admin cannot modify sysconf', (await api('PUT', '/api/system-configuration/network', {
    token: adminToken, body: { backendUrl: 'http://a.com', managerUrl: 'http://b.com', websiteUrl: 'http://c.com' },
  })).status === 403);

  // Validation
  check('reject empty url', (await api('PUT', '/api/system-configuration/network', { token: devToken, body: { backendUrl: '', managerUrl: 'http://a.com', websiteUrl: 'http://b.com' } })).status === 400);
  check('reject non-web protocol', (await api('PUT', '/api/system-configuration/network', { token: devToken, body: { backendUrl: 'ftp://a.com', managerUrl: 'http://a.com', websiteUrl: 'http://b.com' } })).status === 400);
  check('reject path in url', (await api('PUT', '/api/system-configuration/network', { token: devToken, body: { backendUrl: 'http://a.com/api', managerUrl: 'http://a.com', websiteUrl: 'http://b.com' } })).status === 400);
  check('reject credentials in url', (await api('PUT', '/api/system-configuration/network', { token: devToken, body: { backendUrl: 'http://u:p@a.com', managerUrl: 'http://a.com', websiteUrl: 'http://b.com' } })).status === 400);

  // SSRF / connectivité
  check('isPrivateIp detects local/private/metadata', isPrivateIp('127.0.0.1') && isPrivateIp('10.1.2.3') && isPrivateIp('169.254.169.254') && isPrivateIp('::1') && !isPrivateIp('8.8.8.8'));
  const probeRefused = await probeUrl(`${base}/health`, { allowPrivate: false });
  check('probe refuses localhost when private forbidden (PROD)', probeRefused.reachable === false && /interdite/i.test(probeRefused.message));
  const probeOk = await probeUrl(`${base}/health`, { allowPrivate: true });
  check('probe reaches localhost when allowed (TEST)', probeOk.reachable === true && probeOk.statusCode === 200);
  const probeRefused2 = await probeUrl('http://127.0.0.1:9', { allowPrivate: true }); // rien n'écoute
  check('probe reports unreachable host', probeRefused2.reachable === false);

  // Endpoint de test (DEV) — TEST autorise localhost
  const testRes = await api('POST', '/api/system-configuration/network/test', {
    token: devToken, body: { backendUrl: base, managerUrl: 'http://localhost:6071', websiteUrl: 'http://localhost:6062' },
  });
  check('network test endpoint (dev)', testRes.status === 200 && typeof testRes.json.data.backend.reachable === 'boolean');
  check('admin cannot run network test', (await api('POST', '/api/system-configuration/network/test', { token: adminToken, body: { backendUrl: base, managerUrl: base, websiteUrl: base } })).status === 403);

  // CORS dynamique (le PUT ci-dessus a rafraîchi le cache)
  await api('PUT', '/api/system-configuration/network', { token: devToken, body: { backendUrl: 'http://localhost:6070', managerUrl: 'http://localhost:6071', websiteUrl: 'http://localhost:6062' } });
  check('cors allows configured manager origin', isOriginAllowed('http://localhost:6071'));
  check('cors allows configured website origin', isOriginAllowed('http://localhost:6062'));
  check('cors keeps env fallback origins', isOriginAllowed('http://localhost:5173'));
  check('cors rejects unknown origin', !isOriginAllowed('http://evil.example.com'));

  // Config réseau publique (filtrée : pas de managerUrl)
  const pubNet = (await api('GET', '/api/public/network-configuration')).json.data;
  check('public network filtered (no managerUrl)', !!pubNet.backendUrl && !!pubNet.websiteUrl && pubNet.managerUrl === undefined);

  // Theme (reduced palette)
  const vTheme = (await api('GET', '/api/theme/vitrine', { token: adminToken })).json.data;
  check('vitrine theme reduced palette', vTheme.colors.background?.startsWith('#') && vTheme.colors.accent?.startsWith('#'));
  /**
   * LE DÉFAUT SOMBRE EST CELUI DE CE PROJET — noir profond, pas le bleu nuit
   * du moteur d'origine. Le vérifier ici garde la palette du plan de site :
   * « noir et gris profond ».
   */
  check('vitrine theme dark default', vTheme.colors.background.toLowerCase() === '#08080a');
  check('vitrine theme accent = violet du logo', vTheme.colors.accent.toLowerCase() === '#8b8f96' || vTheme.colors.accent.toLowerCase() === '#7c5cff');
  // Admin cannot touch manager theme (DEV only)
  check('admin blocked from manager theme', (await api('PUT', '/api/theme/manager', {
    token: adminToken, body: { colors: { primary: '#000' } },
  })).status === 403);
  check('dev can update manager theme', (await api('PUT', '/api/theme/manager', {
    token: devToken, body: { radius: '1rem' },
  })).status === 200);

  // DEV-only routes blocked for admin
  check('admin blocked from accounts', (await api('GET', '/api/accounts', { token: adminToken })).status === 403);
  /*
    ══ ON VÉRIFIE QUI EST LÀ, PAS COMBIEN ═════════════════════════════════════

    L'assertion valait `length === 2` : le décor de recette sème exactement
    deux comptes. Mais l'amorçage en crée LÉGITIMEMENT un troisième sur un
    poste de développement — le compte DEV local, dérivé du `.env` de la
    machine (`LOCAL_DEV_CREATED`). La recette échouait donc chez le
    développeur et passait ailleurs : le pire des deux mondes, puisque le rouge
    n'apprend rien et finit par être ignoré.

    Ce que cette ligne doit prouver, c'est qu'un DEV OBTIENT la liste et qu'elle
    contient bien les comptes attendus. Le nombre exact appartient à la machine.
  */
  const comptes = (await api('GET', '/api/accounts', { token: devToken })).json.data;
  const adresses = new Set((comptes ?? []).map((c) => c.email));
  check('dev sees accounts',
    Array.isArray(comptes) && adresses.has('dev@mail.com') && adresses.has('admin@mail.com'));

  // Account creation by DEV
  const newAcc = await api('POST', '/api/accounts', {
    token: devToken, body: { email: 'admin2@mail.com', password: 'secret1', role: 'ADMIN' },
  });
  check('dev creates account', newAcc.status === 201);

  // Site suspension (DEV only)
  check('admin cannot suspend', (await api('POST', '/api/site-status/suspend', { token: adminToken, body: {} })).status === 403);
  const suspend = await api('POST', '/api/site-status/suspend', { token: devToken, body: { reason: 'Maintenance' } });
  check('dev suspends site', suspend.json.data.status === 'SUSPENDED');

  // Public bootstrap reflects suspension
  const pub = await api('GET', '/api/public/bootstrap');
  check('public shows suspended', pub.json.data.suspended === true);

  await api('POST', '/api/site-status/reactivate', { token: devToken });
  const pub2 = await api('GET', '/api/public/bootstrap');
  check('public active after reactivate', pub2.json.data.suspended === false);
  check('public returns published chapters', pub2.json.data.chapters.length === 2);
  /**
   * LES CHAPITRES ARRIVENT ENTIERS — volets compris. C'est ce qui distingue
   * leur traitement de celui des pages, dont le bootstrap ne porte que
   * l'entrée : la vitrine peint l'accueil à partir de ces volets, et un
   * aller-retour de plus par chapitre se verrait.
   */
  const conception = pub2.json.data.chapters.find((c) => c.slug === 'conception');
  check('…avec leurs volets', conception.items.length === 2);
  check('…et leur phrase de clôture', conception.statement.label === 'PRINCIPE');
  /**
   * LE BOOTSTRAP PORTE L'ENTRÉE D'UNE PAGE, JAMAIS SON CONTENU.
   *
   * La page créée plus haut a UN bloc. S'il traversait, la liste en porterait
   * un — c'est cela qu'on mesure, et non la présence du champ : selon la
   * version de mongoose, un tableau non sélectionné revient absent ou vide, et
   * les deux sont acceptables. Ce qui ne l'est pas, c'est qu'il revienne
   * REMPLI : le poids de la première requête du site grossirait alors à
   * proportion de ce que le client rédige.
   */
  check('public pages carry NO blocks', (pub2.json.data.pages[0].blocks ?? []).length === 0);
  check('public chapter by slug', (await api('GET', '/api/public/chapters/conception')).status === 200);
  check('unpublished chapter is 404, never blank', (await api('GET', '/api/public/chapters/inconnu')).status === 404);
  check('public bootstrap includes network (filtered)', !!pub2.json.data.network.backendUrl && pub2.json.data.network.managerUrl === undefined);
  check('public returns satisfiedClients', pub2.json.data.company.satisfiedClients === 250);

  // Change password
  const changed = await api('PATCH', '/api/auth/password', {
    token: adminToken,
    body: { currentPassword: '123admin', newPassword: 'newpass1', confirmPassword: 'newpass1' },
  });
  check('password changed', changed.status === 200);
  check('login with new password', (await api('POST', '/api/auth/login', {
    body: { email: 'admin@mail.com', password: 'newpass1' },
  })).status === 200);

  // Suppression d'un chapitre
  check('chapter deleted', (await api('DELETE', `/api/chapters/${chapterId}`, { token: adminToken })).status === 204);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (err) {
  console.error('SMOKE TEST CRASHED:', err);
  fail++;
} finally {
  server.close();
  await disconnectDatabase();
  await mongod.stop();
  process.exit(fail === 0 ? 0 : 1);
}
