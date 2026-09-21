/**
 * PRÉSENTATION PUBLIQUE DU PROJET — résolution des médias et projection des
 * contacts vers le manifeste.
 *
 * ── CE QUI EST VERROUILLÉ ICI ───────────────────────────────────────────────
 * Le manifeste ne publiait qu'une identité technique : le Panel affichait le
 * nom du projet et l'URL de l'API là où l'équipe attend le nom commercial du
 * client et l'adresse de son site. Ces contrôles portent sur les deux pièges
 * de cette remontée : un chemin `/uploads/...` publié tel quel (illisible hors
 * du projet), et une URL absolue héritée d'un projet SOURCE lors d'une
 * duplication (qui pointerait durablement le mauvais domaine).
 */
process.env.ENV = 'TEST';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017';
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt-long-enough-32chars!!';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
process.env.PROJECT_NAME = 'SB Auto 06';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

const { resolvePublicAssetUrl } = await import('../services/networkConfig.service.js');
const { projectManifestSchema } = await import('../services/panelBridge/bridgeContract.js');

const BACKEND = 'https://api.demo-sbauto.lycarz.com';
const SOURCE_BACKEND = 'https://api.projet-source.lycarz.com';

/* ────────────────────────────────────────────────────────────────────────── */
section('1. Résolution d’un média public');
{
  check('un chemin /uploads/… devient une URL absolue servie par CE backend',
    resolvePublicAssetUrl('/uploads/company/logo.png', BACKEND)
      === `${BACKEND}/uploads/company/logo.png`);

  check('une URL HTTPS absolue est conservée telle quelle',
    resolvePublicAssetUrl('https://cdn.exemple.com/logo.png', BACKEND)
      === 'https://cdn.exemple.com/logo.png');

  check('une URL HTTP simple n’est PAS publiée',
    resolvePublicAssetUrl('http://cdn.exemple.com/logo.png', BACKEND) === null);

  check('localhost n’est jamais publié — un lien mort vaut moins que rien',
    resolvePublicAssetUrl('/uploads/logo.png', 'http://localhost:5000') === null
    && resolvePublicAssetUrl('https://localhost/logo.png', BACKEND) === null);

  check('une valeur vide est omise, pas transformée',
    resolvePublicAssetUrl('', BACKEND) === null
    && resolvePublicAssetUrl(null, BACKEND) === null
    && resolvePublicAssetUrl(undefined, BACKEND) === null);

  check('un chemin relatif sans barre initiale est refusé (ambigu)',
    resolvePublicAssetUrl('uploads/logo.png', BACKEND) === null);

  check('sans URL de backend, un chemin local reste irrésoluble',
    resolvePublicAssetUrl('/uploads/logo.png', null) === null);

  check('la barre finale du backend ne produit pas de double barre',
    resolvePublicAssetUrl('/uploads/l.png', `${BACKEND}/`) === `${BACKEND}/uploads/l.png`);

  // Fonction PURE : même entrée, même sortie, aucun effet de bord.
  const runs = Array.from({ length: 10 }, () => resolvePublicAssetUrl('/uploads/l.png', BACKEND));
  check('fonction pure : 10 appels rendent le même résultat', new Set(runs).size === 1);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('2. Duplication : un duplicata n’hérite pas du domaine SOURCE');
{
  // Le cas qui motive la convention : la configuration est recopiée telle
  // quelle du projet source vers son duplicata.
  const CHEMIN_RELATIF = '/uploads/company/logo.png';
  const URL_ABSOLUE_SOURCE = `${SOURCE_BACKEND}/uploads/company/logo.png`;

  check('stocké en CHEMIN relatif : le duplicata sert SON propre domaine',
    resolvePublicAssetUrl(CHEMIN_RELATIF, BACKEND) === `${BACKEND}/uploads/company/logo.png`);
  check('…et ne mentionne jamais le domaine du projet source',
    !resolvePublicAssetUrl(CHEMIN_RELATIF, BACKEND).includes('projet-source'));

  // À l'inverse, une URL absolue héritée reste valide au sens du format : le
  // résolveur ne peut pas la corriger. C'est la CONVENTION qui protège, d'où
  // la documentation — et ce test qui en fixe la raison.
  check('stocké en URL ABSOLUE : le domaine source est conservé (piège documenté)',
    resolvePublicAssetUrl(URL_ABSOLUE_SOURCE, BACKEND) === URL_ABSOLUE_SOURCE);

  const fs = await import('node:fs');
  const doc = fs.readFileSync(
    new URL('../../../docs/panelXvitrine/MEDIAS_PUBLICS.md', import.meta.url), 'utf8',
  );
  check('la convention existe et recommande le chemin relatif',
    /chemin relatif/i.test(doc) && /duplicat/i.test(doc));
  check('…et aucun domaine de projet n’y est codé en dur',
    !/demo-sbauto\.lycarz\.com/.test(doc.replace(/api\.demo-sbauto\.lycarz\.com\/uploads/g, '')));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('3. Le manifeste enrichi reste rétrocompatible');
{
  const base = {
    manifestVersion: '1.0.0',
    project: { key: 'sb-auto-06', name: 'SB Auto 06', environment: 'TEST', softwareVersion: 'abc1234' },
    bridge: { contractVersion: '1.4.0', projectBridgeBasePath: '/api/project-bridge/v1' },
    contracts: { panelBridge: '1.4.0', projectBridge: '1.4.0' },
    sync: { supportedEntityTypes: ['DIAGNOSTIC'], operations: [] },
    modules: [{ id: 'vitrine', title: 'Vitrine', status: 'ACTIVE' }],
    features: [{ id: 'sync.diagnostic', status: 'AVAILABLE' }],
  };

  check('un manifeste SANS presentation reste accepté (projet 1.3.x)',
    projectManifestSchema.safeParse(base).success);

  const enrichi = {
    ...base,
    presentation: {
      companyName: 'Garage SB Auto',
      tagline: 'Votre garage de confiance',
      logoUrl: `${BACKEND}/uploads/company/logo.png`,
      faviconUrl: `${BACKEND}/uploads/company/favicon.ico`,
      contacts: { email: 'contact@sb.fr', phone: '+33 6 12 34 56 78', website: 'https://demo-sbauto.lycarz.com' },
    },
    network: {
      primaryDomain: 'demo-sbauto.lycarz.com',
      urls: {
        website: 'https://demo-sbauto.lycarz.com',
        manager: 'https://manager.demo-sbauto.lycarz.com',
        backend: BACKEND,
      },
    },
    descriptor: { name: 'SB Auto 06', type: 'vitrine', description: 'Votre garage de confiance' },
  };
  check('un manifeste ENRICHI est accepté', projectManifestSchema.safeParse(enrichi).success);

  check('un logoUrl qui n’est pas une URL est refusé',
    !projectManifestSchema.safeParse({
      ...enrichi, presentation: { ...enrichi.presentation, logoUrl: '/uploads/logo.png' },
    }).success);

  check('une clé inconnue dans presentation est refusée (contrat strict)',
    !projectManifestSchema.safeParse({
      ...enrichi, presentation: { ...enrichi.presentation, secret: 'x' },
    }).success);

  check('presentation vide est acceptée — tous les champs sont optionnels',
    projectManifestSchema.safeParse({ ...enrichi, presentation: {} }).success);
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
