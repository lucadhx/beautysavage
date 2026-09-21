/* CONFORMITÉ DES PONTS (LOT 6) — verrouille les règles d'architecture des
 * Phases 0/0.5/1 (docs/panelXvitrine/) :
 *
 *   1. EXCLUSIVITÉ  — aucun composant métier n'importe les modules de pont ;
 *      seule la surface déclarée (routes/controller/middleware ProjectBridge,
 *      montage routes/index.js, tests) y a droit. Réciproquement, le module
 *      panelBridge n'importe RIEN du métier (découplage maximal, revendable).
 *   2. SPEC <-> CODE — chaque route, code d'erreur, type d'entité et version
 *      du contrat exécutable (bridgeContract.js) figure dans les fichiers
 *      OpenAPI officiels (docs/panelXvitrine/spec/), et les exemples canoniques
 *      du contrat valident contre leurs propres schémas.
 *   3. INTERFACES    — le stub de Panel et le client HTTP honorent exactement
 *      l'interface PanelClient ; les erreurs du catalogue portent toutes un
 *      statut HTTP cohérent.
 *
 * Runner autonome : AUCUNE base, AUCUN réseau. */
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(__dirname, '../../..');
const SPEC_DIR = path.join(REPO_ROOT, 'docs', 'panelXvitrine', 'spec');

const {
  CONTRACT_VERSION,
  PANEL_API_ROUTES,
  PROJECT_API_ROUTES,
  SYNC_ENTITY_TYPES,
  CONTRACT_EXAMPLES,
  syncChangeSchema,
  heartbeatSchema,
  bootstrapRequestSchema,
  identitySchema,
  operationInvocationSchema,
  projectManifestSchema,
  BRIDGE_ERROR_CODES,
  bridgeError,
  PANEL_CLIENT_METHODS,
  isPanelClient,
  createPanelStub,
  HttpPanelClient,
  CAPABILITY_TIMEOUT_MS,
} = await import('../services/panelBridge/index.js');

// ---------------------------------------------------------------------------
console.log('\n1. Spec OpenAPI <-> contrat exécutable');
const panelSpec = await fs.readFile(path.join(SPEC_DIR, 'PanelBridge.openapi.yaml'), 'utf8');
const projectSpec = await fs.readFile(path.join(SPEC_DIR, 'ProjectBridge.openapi.yaml'), 'utf8');
{
  check('version du contrat présente dans PanelBridge.openapi.yaml', panelSpec.includes(`version: ${CONTRACT_VERSION}`));
  check('version du contrat présente dans ProjectBridge.openapi.yaml', projectSpec.includes(`version: ${CONTRACT_VERSION}`));

  for (const [name, route] of Object.entries(PANEL_API_ROUTES)) {
    check(`route Panel « ${name} » (${route}) documentée`, panelSpec.includes(route));
  }
  for (const [name, route] of Object.entries(PROJECT_API_ROUTES)) {
    check(`route Projet « ${name} » (${route}) documentée`, projectSpec.includes(route));
  }

  const specUnion = panelSpec + projectSpec;
  for (const code of Object.values(BRIDGE_ERROR_CODES)) {
    check(`code d'erreur ${code} documenté dans la spec`, specUnion.includes(code));
  }
  for (const type of SYNC_ENTITY_TYPES) {
    check(`entityType ${type} présent dans les DEUX specs`, panelSpec.includes(`- ${type}`) && projectSpec.includes(`- ${type}`));
  }
  check('en-tête X-Bridge-Contract-Version documenté (2 specs)',
    panelSpec.includes('X-Bridge-Contract-Version') && projectSpec.includes('X-Bridge-Contract-Version'));
}

console.log('\n2. Les exemples canoniques du contrat valident leurs schémas');
{
  check('exemple SyncChange', syncChangeSchema.safeParse(CONTRACT_EXAMPLES.syncChange).success);
  check('exemple tombstone', syncChangeSchema.safeParse(CONTRACT_EXAMPLES.tombstone).success);
  check('tombstone corrompu (payload non null) REFUSÉ',
    !syncChangeSchema.safeParse({ ...CONTRACT_EXAMPLES.tombstone, payload: { x: 1 } }).success);
  check('exemple Heartbeat', heartbeatSchema.safeParse(CONTRACT_EXAMPLES.heartbeat).success);
  check('exemple BootstrapRequest', bootstrapRequestSchema.safeParse(CONTRACT_EXAMPLES.bootstrapRequest).success);
  check('exemple Identity', identitySchema.safeParse(CONTRACT_EXAMPLES.identity).success);
  check('exemple OperationInvocation', operationInvocationSchema.safeParse(CONTRACT_EXAMPLES.operationInvocation).success);
  check('exemple ProjectManifest', projectManifestSchema.safeParse(CONTRACT_EXAMPLES.projectManifest).success);
  check('manifeste avec module inconnu du schéma REFUSÉ (strict)',
    !projectManifestSchema.safeParse({ ...CONTRACT_EXAMPLES.projectManifest, intrus: true }).success);
  check('bootstrap AVEC manifeste accepté (champ optionnel ≥ 1.1.0)',
    bootstrapRequestSchema.safeParse({ ...CONTRACT_EXAMPLES.bootstrapRequest, manifest: CONTRACT_EXAMPLES.projectManifest }).success);
  check('champ inconnu REFUSÉ (schémas stricts)',
    !syncChangeSchema.safeParse({ ...CONTRACT_EXAMPLES.syncChange, intrus: true }).success);
}

console.log('\n3. Erreurs cohérentes (code -> statut HTTP canonique)');
{
  const expected = {
    [BRIDGE_ERROR_CODES.UNAUTHORIZED]: 401,
    [BRIDGE_ERROR_CODES.PAIRING_CODE_INVALID]: 401,
    [BRIDGE_ERROR_CODES.ALREADY_PAIRED]: 409,
    [BRIDGE_ERROR_CODES.NOT_PAIRED]: 503,
    [BRIDGE_ERROR_CODES.CONTRACT_VERSION_UNSUPPORTED]: 409,
    [BRIDGE_ERROR_CODES.INVALID_PAYLOAD]: 400,
    [BRIDGE_ERROR_CODES.ENTITY_TYPE_UNSUPPORTED]: 422,
    [BRIDGE_ERROR_CODES.OPERATION_UNKNOWN]: 404,
    [BRIDGE_ERROR_CODES.OPERATION_FAILED]: 422,
    [BRIDGE_ERROR_CODES.RATE_LIMITED]: 429,
    [BRIDGE_ERROR_CODES.INTERNAL]: 500,
  };
  for (const [code, status] of Object.entries(expected)) {
    const err = bridgeError(code);
    check(`${code} -> ${status} + details.code`, err.statusCode === status && err.details?.code === code && Boolean(err.message));
  }
}

console.log('\n4. Interfaces : stub et client HTTP honorent PanelClient');
{
  const stub = createPanelStub();
  check('le stub honore l’interface PanelClient', isPanelClient(stub));
  const httpClient = new HttpPanelClient({ baseUrl: 'https://panel.example.com', tokenProvider: () => null });
  check('HttpPanelClient honore l’interface PanelClient', isPanelClient(httpClient));
  for (const method of PANEL_CLIENT_METHODS) {
    check(`méthode d'interface « ${method} » présente sur les deux`, typeof stub[method] === 'function' && typeof httpClient[method] === 'function');
  }
}

// ---------------------------------------------------------------------------
console.log('\n4bis. Budgets de temps : une capacité n’est pas un aller-retour de pont');
{
  /*
    LE DÉFAUT VERROUILLÉ ICI.

    Toutes les requêtes du pont partageaient le budget de 10 s. Or le Panel,
    pour une CAPACITÉ, appelle un tiers et attend SA réponse avant de nous
    répondre. Un préflight a échoué à l'étape `dns.zone` à 10,007 s — le
    budget à la milliseconde près — en annonçant « Panel injoignable »,
    quand le même Panel répondait au ping en 37 ms.

    Ces contrôles n'attendent rien : les budgets sont ramenés à quelques
    millisecondes, et c'est leur ÉCART qui est vérifié, pas leur valeur.
  */

  /** Une réponse de pont valide — enveloppe `{ success, data }`. */
  const enveloppe = () =>
    new Response(JSON.stringify({ success: true, data: { ok: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  /** `fetch` qui répond après `delai` ms, et honore l'abandon comme le vrai. */
  const fetchLent = (delai) => (_url, { signal } = {}) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(enveloppe()), delai);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        reject(err);
      });
    });

  const clientLent = () =>
    new HttpPanelClient({
      baseUrl: 'https://panel.example.com',
      tokenProvider: () => 'jeton',
      timeoutMs: 20,
      capabilityTimeoutMs: 400,
      fetchImpl: fetchLent(120),
    });

  check(
    'le budget par défaut d’une capacité dépasse celui d’un aller-retour de pont',
    CAPABILITY_TIMEOUT_MS
      > new HttpPanelClient({ baseUrl: 'https://p.example', tokenProvider: () => null }).timeoutMs,
  );

  // Une invocation de capacité SURVIT à une réponse plus lente que le budget
  // ordinaire : c'est exactement le préflight qui échouait.
  let capacite;
  try {
    const data = await clientLent().invokeCapability('dns.zone.resolve', { operationId: 'x' });
    capacite = data?.ok === true ? true : 'enveloppe inattendue';
  } catch (err) {
    capacite = `échec inattendu : ${err?.message}`;
  }
  check('une capacité plus lente que le budget de pont aboutit', capacite === true, String(capacite));

  // …et le budget ordinaire n'est PAS relevé au passage : un aller-retour mou
  // doit toujours être abandonné, sans quoi le démarrage se bloquerait.
  let battement = null;
  try {
    await clientLent().heartbeat({});
  } catch (err) {
    battement = err;
  }
  check(
    'un aller-retour de pont garde son budget court',
    Boolean(battement) && /délai imparti/.test(battement.message ?? ''),
    String(battement?.message ?? 'aucune erreur'),
  );
  check(
    'un délai dépassé ne se dit plus « injoignable »',
    !/injoignable/.test(battement?.message ?? ''),
    battement?.message,
  );

  // Une VRAIE panne réseau garde son libellé : autre cause, autre geste de
  // réparation.
  let panne = null;
  try {
    await new HttpPanelClient({
      baseUrl: 'https://panel.example.com',
      tokenProvider: () => 'jeton',
      fetchImpl: () => Promise.reject(Object.assign(new Error('ECONNREFUSED'), { name: 'TypeError' })),
    }).heartbeat({});
  } catch (err) {
    panne = err;
  }
  check('une panne réseau reste « injoignable »', /injoignable/.test(panne?.message ?? ''), panne?.message);
}

// ---------------------------------------------------------------------------
console.log('\n5. Exclusivité et découplage des imports');

/** Liste récursive des .js sous un dossier. */
async function listJs(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listJs(full)));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Spécificateurs importés (import statique OU dynamique) d'un fichier. */
function importSpecifiers(source) {
  const specs = [];
  const staticRe = /import\s[^'"]*['"]([^'"]+)['"]/g;
  const dynamicRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = staticRe.exec(source))) specs.push(m[1]);
  while ((m = dynamicRe.exec(source))) specs.push(m[1]);
  return specs;
}

const allFiles = await listJs(SRC_ROOT);
const rel = (f) => path.relative(SRC_ROOT, f).replaceAll('\\', '/');

{
  // 5a. Qui a le droit d'importer les modules de pont ?
  const ALLOWED_BRIDGE_IMPORTERS = new Set([
    'routes/index.js', // montage du routeur ProjectBridge uniquement
    'routes/projectBridge.routes.js',
    'controllers/projectBridge.controller.js',
    'middlewares/projectBridgeAuth.middleware.js',
    'config/bootstrap.js', // câblage : persistance de l'appairage + hello au démarrage
    // Phase 4 — administration de la connexion au Panel depuis le Manager.
    // Sans ce point d'entrée, l'appairage n'était atteignable que par script.
    'routes/panelBridge.routes.js',
    'controllers/panelBridge.controller.js',
  ]);
  const offenders = [];
  for (const file of allFiles) {
    const relPath = rel(file);
    if (relPath.startsWith('services/panelBridge/')) continue;
    if (relPath.startsWith('services/projectBridge/')) continue;
    if (relPath.startsWith('scripts/')) continue; // tests & outillage CLI
    const source = await fs.readFile(file, 'utf8');
    const bridgeImports = importSpecifiers(source).filter(
      (s) => s.includes('panelBridge') || s.includes('projectBridge')
    );
    // EXCEPTION ÉTROITE (Phase 4) : `bridgeContract.js` est le VOCABULAIRE
    // partagé — le miroir exécutable de la spec. Un composant qui applique
    // une charge utile venue du Panel doit la valider contre CE schéma ;
    // le dupliquer ferait diverger les deux côtés en silence, ce qui est
    // exactement ce que la règle cherche à empêcher.
    // Le reste du module (transport, runtime, appairage, ordonnanceur)
    // demeure interdit.
    // SECONDE EXCEPTION (L9) : `capabilityClient.js` — DEMANDER une capacité.
    // Même nature que le contrat : c'est le vocabulaire du plan de contrôle
    // (« je demande un verbe, le Panel décide du fournisseur, du monde et de
    // la clé »), pas le mécanisme du pont. La façade n'expose qu'une fonction
    // et aucun état ; l'appairage, la file, l'ordonnanceur et le transport
    // restent hors de portée du métier.
    // TROISIÈME EXCEPTION (L12.1) : `templateProjectionClient.js` — LIRE ce que
    // le Panel sert à ce projet en matière de modèles d'e-mail. Même nature que
    // les deux précédentes : un vocabulaire (« je lis la projection »), sans
    // état, sans accès au transport, à l'appairage ni à la file. Elle est
    // strictement en LECTURE : y ajouter un verbe d'écriture recréerait, en une
    // ligne et à l'endroit le plus discret du code, la seconde autorité de
    // contenu que ce lot a supprimée.
    const CONTRACT_LEVEL = ['bridgeContract.js', 'capabilityClient.js', 'templateProjectionClient.js'];
    const forbidden = bridgeImports.filter((s) => !CONTRACT_LEVEL.some((allowed) => s.endsWith(allowed)));
    if (forbidden.length > 0 && !ALLOWED_BRIDGE_IMPORTERS.has(relPath)) {
      offenders.push(`${relPath} -> ${forbidden.join(', ')}`);
    }
  }
  check('aucun composant métier n’importe le module de pont (hors contrat)', offenders.length === 0, offenders.join(' | '));

  // routes/index.js ne doit toucher qu'aux ROUTES du pont, jamais au module.
  const routesIndex = await fs.readFile(path.join(SRC_ROOT, 'routes/index.js'), 'utf8');
  const routesIndexBridgeImports = importSpecifiers(routesIndex).filter((s) => s.includes('anelBridge') || s.includes('rojectBridge'));
  // L'invariant porte sur la NATURE de ce qui est importé, pas sur son
  // nombre : routes/index.js monte des ROUTEURS, il ne doit jamais toucher au
  // module de pont lui-même. Depuis la Phase 4 il en monte deux — la surface
  // appelée par le Panel, et l'administration de la connexion côté projet.
  check(
    'routes/index.js n’importe que des routeurs de pont, jamais le module',
    routesIndexBridgeImports.length > 0 &&
      routesIndexBridgeImports.every((s) => s.endsWith('.routes.js'))
  );

  // 5b. Le module panelBridge n'importe RIEN du métier. Exception ÉTROITE et
  // volontaire : les adaptateurs d'infrastructure de persistence/ ont le droit
  // de toucher LE modèle d'appairage et LA crypto applicative — rien d'autre.
  /**
   * « INTERNE AU MODULE » SE VÉRIFIE PAR RÉSOLUTION, PAS PAR PRÉFIXE.
   *
   * La règle disait `s.startsWith('./')`. Elle décrivait donc « le même
   * dossier », pas « le module » : un fichier de `persistence/` remontant d'un
   * cran vers un frère du module — `../syncIncidents.js` — était compté comme
   * une dépendance EXTERNE, alors qu'il ne quitte pas `services/panelBridge/`.
   *
   * On résout le chemin et l'on vérifie qu'il reste sous la racine du module.
   * C'est strictement plus SÉVÈRE que l'ancienne forme : `../../models/...`
   * commençait aussi par `../` et se serait glissé dans une règle de préfixe.
   */
  const PANEL_BRIDGE_ROOT = path.join(SRC_ROOT, 'services/panelBridge');
  const resteDansLeModule = (file, spec) => {
    if (!spec.startsWith('.')) return false;
    const cible = path.resolve(path.dirname(file), spec);
    return cible === PANEL_BRIDGE_ROOT || cible.startsWith(PANEL_BRIDGE_ROOT + path.sep);
  };
  const ALLOWED_PANEL_BRIDGE_DEPS = [
    (s, file) => resteDansLeModule(file, s), // interne au module
    (s) => s.startsWith('node:'),
    (s) => s === 'zod',
    (s) => s === '../../utils/logger.js', // logger sans dépendance
  ];
  const ALLOWED_PERSISTENCE_DEPS = [
    (s) => s.endsWith('models/BridgePairing.model.js'),
    // L'outbox est DURABLE : une écriture métier perdue au redémarrage
    // n'arriverait jamais au Panel, sans que personne ne s'en aperçoive. Son
    // adaptateur vit donc ici, seul endroit du pont autorisé à toucher Mongo —
    // la frontière tient, elle ne s'élargit que par cette liste.
    (s) => s.endsWith('models/PanelOutboxEntry.model.js'),
    // L'ÉTAT DE CONSOMMATION est DURABLE, pour la raison symétrique : un
    // curseur perdu au redémarrage faisait rejouer tout le journal du Panel, et
    // rendait impossible de savoir ce qu'un projet avait réellement reçu. Son
    // adaptateur rejoint donc cette liste — qui reste une liste, justement pour
    // que chaque élargissement de la frontière soit un geste écrit.
    (s) => s.endsWith('models/BridgeSyncState.model.js'),
    (s) => s.endsWith('utils/integratedApiCrypto.js'),
    (s) => s.endsWith('utils/logger.js'),
  ];
  const panelBridgeFiles = allFiles.filter((f) => rel(f).startsWith('services/panelBridge/'));
  const badDeps = [];
  for (const file of panelBridgeFiles) {
    const relPath = rel(file);
    const isPersistenceAdapter = relPath.startsWith('services/panelBridge/persistence/');
    const source = await fs.readFile(file, 'utf8');
    for (const spec of importSpecifiers(source)) {
      const allowed =
        ALLOWED_PANEL_BRIDGE_DEPS.some((rule) => rule(spec, file)) ||
        (isPersistenceAdapter && ALLOWED_PERSISTENCE_DEPS.some((rule) => rule(spec, file)));
      if (!allowed) badDeps.push(`${relPath} -> ${spec}`);
    }
  }
  check('panelBridge découplé du métier (imports : interne, node:, zod, logger ; persistence/ : + modèle d’appairage + crypto)', badDeps.length === 0, badDeps.join(' | '));
  {
    // Le CŒUR du pont (hors persistence/) ne touche NI modèle NI crypto — la
    // frontière ne doit pas s'éroder par commodité.
    const coreOffenders = [];
    for (const file of panelBridgeFiles) {
      const relPath = rel(file);
      if (relPath.startsWith('services/panelBridge/persistence/')) continue;
      const source = await fs.readFile(file, 'utf8');
      if (importSpecifiers(source).some((s) => s.includes('models/') || s.includes('integratedApiCrypto'))) {
        coreOffenders.push(relPath);
      }
    }
    check('le cœur du pont (hors persistence/) n’importe ni modèle ni crypto', coreOffenders.length === 0, coreOffenders.join(' | '));
  }
  check('au moins 6 fichiers dans le module panelBridge', panelBridgeFiles.length >= 6);

  // 5c. projectBridge.service : uniquement node:, config, et le contrat du pont.
  const projectBridgeSource = await fs.readFile(
    path.join(SRC_ROOT, 'services/projectBridge/projectBridge.service.js'),
    'utf8'
  );
  const pbDeps = importSpecifiers(projectBridgeSource);
  const pbBad = pbDeps.filter(
    (s) => !s.startsWith('node:') && !s.startsWith('./') && !s.includes('config/env') && !s.includes('panelBridge/')
  );
  check('projectBridge.service découplé (node:, interne, config, contrat du pont)', pbBad.length === 0, pbBad.join(' | '));
  check('projectBridge n’importe PAS la façade PanelBridge (ponts découplés)', !pbDeps.some((s) => s.endsWith('PanelBridge.js')));
  check('projectBridge n’importe AUCUN modèle Mongo', !pbDeps.some((s) => s.includes('models/')));

  // 5d. Réciproque : le module panelBridge ignore projectBridge.
  const crossRefs = [];
  for (const file of panelBridgeFiles) {
    const source = await fs.readFile(file, 'utf8');
    if (importSpecifiers(source).some((s) => s.includes('projectBridge'))) crossRefs.push(rel(file));
  }
  check('panelBridge ignore projectBridge (aucune dépendance croisée)', crossRefs.length === 0, crossRefs.join(' | '));

  // 5e. Personne d'autre que PanelClient.js ne parle HTTP « au Panel ».
  const fetchOffenders = [];
  for (const file of panelBridgeFiles) {
    const relPath = rel(file);
    if (relPath.endsWith('PanelClient.js')) continue;
    const source = await fs.readFile(file, 'utf8');
    if (/\bfetchImpl\b|\bfetch\(/.test(source)) fetchOffenders.push(relPath);
  }
  check('dans le module, seul PanelClient.js transporte (fetch)', fetchOffenders.length === 0, fetchOffenders.join(' | '));
}

console.log('\n6. Montage HTTP conforme');
{
  const routesIndex = await fs.readFile(path.join(SRC_ROOT, 'routes/index.js'), 'utf8');
  check('routeur monté sous /project-bridge/v1', routesIndex.includes("'/project-bridge/v1'"));
  const routesFile = await fs.readFile(path.join(SRC_ROOT, 'routes/projectBridge.routes.js'), 'utf8');
  for (const endpoint of ["'/ping'", "'/identity'", "'/health'", "'/manifest'", "'/sync/push'", "'/sync/pull'", "'/operations'", "'/operations/:operationId/invoke'", "'/unpair'"]) {
    check(`endpoint ${endpoint} câblé`, routesFile.includes(endpoint));
  }
}

console.log('\n7. Les DOUBLES de Panel honorent la surface entière');
{
  /**
   * ══ LE DÉFAUT QUE CE CONTRÔLE FERME ═════════════════════════════════
   *
   * `isPanelClient` exige TOUTE la surface, et `new PanelBridge(...)` lève
   * sinon. Le contrat a gagné cinq méthodes (projection des modèles d'e-mail,
   * 1.11.0) sans que les doubles des recettes suivent : CINQ suites sont mortes
   * d'un coup, et aucune ne le disait. Elles échouaient sur le SYMPTÔME — un
   * endpoint distant absent, un cycle de worker manquant, un compteur à zéro —
   * pendant que la cause tenait en une méthode oubliée.
   *
   * On compare donc la LISTE FAISANT FOI à chaque double, et on NOMME ce qui
   * manque. Une recette qui ne s'exécute plus est pire qu'une recette absente :
   * elle laisse croire à une couverture qui n'existe pas.
   */
  const scripts = (await fs.readdir(path.join(SRC_ROOT, 'scripts')))
    .filter((f) => f.endsWith('.test.js'));
  const manquants = [];
  for (const f of scripts) {
    // eslint-disable-next-line no-await-in-loop
    const source = await fs.readFile(path.join(SRC_ROOT, 'scripts', f), 'utf8');
    /**
     * Un DOUBLE, c'est un fichier qui BRANCHE un client sur le pont. Une
     * recette qui raisonne SUR la liste — celle-ci — la cite sans l'incarner,
     * et se signalerait elle-même comme incomplète.
     */
    const estUnDouble = source.includes('introspectFederatedPrincipal')
      && source.includes('clientFactory')
      && !source.includes('PANEL_CLIENT_METHODS');
    if (!estUnDouble) continue;
    const absentes = PANEL_CLIENT_METHODS.filter((m) => !source.includes(m));
    if (absentes.length) manquants.push(`${f} → ${absentes.join(', ')}`);
  }
  check(`chaque double de Panel implémente les ${PANEL_CLIENT_METHODS.length} méthodes du contrat`,
    manquants.length === 0, manquants.join(' | '));
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
