/* ProjectBridge (LOT 3/4/6) — la surface /api/project-bridge/v1 testée en
 * HTTP RÉEL (serveur express éphémère + fetch), conformément à la spec
 * docs/panelXvitrine/spec/ProjectBridge.openapi.yaml : versionnement,
 * appairage requis, auth Bearer, accusés idempotents, catalogue vide,
 * désappairage. AUCUNE base de données. */

process.env.ENV = 'TEST';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017'; // jamais contactée ici
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

const express = (await import('express')).default;
const { errorHandler } = await import('../middlewares/error.middleware.js');
const projectBridgeRoutes = (await import('../routes/projectBridge.routes.js')).default;
const {
  APPLIED_ENTITY_TYPES,
  CONTRACT_VERSION,
  CONTRACT_VERSION_HEADER,
  identitySchema,
  projectManifestSchema,
  buildDiagnosticChange,
  newBridgeId,
  nowIso,
  EMITTERS,
  setPairing,
  clearPairing,
} = await import('../services/panelBridge/index.js');
const { resetProjectBridgeStateForTests } = await import(
  '../services/projectBridge/projectBridge.service.js'
);

await clearPairing();
resetProjectBridgeStateForTests();

const app = express();
app.use(express.json());
app.use('/api/project-bridge/v1', projectBridgeRoutes);
app.use(errorHandler);
const server = app.listen(0);
const { port } = server.address();
const BASE = `http://127.0.0.1:${port}/api/project-bridge/v1`;

const TOKEN = 'bridge-token-de-test-0123456789abcdef';
const H = {
  [CONTRACT_VERSION_HEADER]: CONTRACT_VERSION,
  'content-type': 'application/json',
};
const AUTH = { ...H, authorization: `Bearer ${TOKEN}` };

async function call(method, path, { headers = H, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json, headers: res.headers };
}

console.log('\nVersionnement du contrat (en-tête obligatoire, y compris /ping)');
{
  const noHeader = await call('GET', '/ping', { headers: {} });
  check('sans en-tête -> 409', noHeader.status === 409);
  check('…code BRIDGE_CONTRACT_VERSION_UNSUPPORTED', noHeader.json?.code === 'BRIDGE_CONTRACT_VERSION_UNSUPPORTED');

  const wrongMajor = await call('GET', '/ping', { headers: { [CONTRACT_VERSION_HEADER]: '2.0.0' } });
  check('majeure inconnue -> 409', wrongMajor.status === 409);

  const okPing = await call('GET', '/ping');
  check('avec en-tête -> 200', okPing.status === 200);
  check('la réponse annonce SA version', okPing.headers.get(CONTRACT_VERSION_HEADER) === CONTRACT_VERSION);

  // Le 409 « reçu : aucune » se diagnostique côté ÉMETTEUR ; encore faut-il
  // que le message le dise. Un « non supportée » nu enverrait chercher une
  // divergence de majeures là où l'en-tête manque tout simplement.
  check('…le message distingue « aucune » d’une majeure divergente',
    /reçu : aucune/.test(noHeader.json?.message ?? '')
    && /reçu : 2\.0\.0/.test(wrongMajor.json?.message ?? ''));

  // La garde est montée par `router.use` : elle DOIT couvrir chaque route du
  // pont, pas seulement /ping. Une route ajoutée hors de la chaîne fuirait.
  for (const [method, path, body] of [
    ['GET', '/ping'],
    ['GET', '/identity'],
    ['GET', '/health'],
    ['GET', '/manifest'],
    ['GET', '/sync/pull'],
    ['GET', '/operations'],
    ['POST', '/sync/push', { changes: [] }],
    ['POST', '/operations/contract.cancel/invoke', { invocationId: newBridgeId(), params: {} }],
    ['POST', '/unpair'],
  ]) {
    const nu = await call(method, path, { headers: {}, body });
    const bad = await call(method, path, { headers: { [CONTRACT_VERSION_HEADER]: '2.0.0' }, body });
    check(`${method} ${path} : sans en-tête ET majeure inconnue -> 409 (garde universelle)`,
      nu.status === 409 && nu.json?.code === 'BRIDGE_CONTRACT_VERSION_UNSUPPORTED'
      && bad.status === 409 && bad.json?.code === 'BRIDGE_CONTRACT_VERSION_UNSUPPORTED');
  }

  // Les en-têtes HTTP sont insensibles à la casse (RFC 9110 §5.1) : un client
  // qui écrit la graphie canonique de la spec doit être accepté à l'identique.
  for (const spelling of [
    'x-bridge-contract-version',
    'X-Bridge-Contract-Version',
    'X-BRIDGE-CONTRACT-VERSION',
  ]) {
    const res = await call('GET', '/ping', { headers: { [spelling]: CONTRACT_VERSION } });
    check(`graphie « ${spelling} » acceptée`, res.status === 200);
  }

  // Un espace de bordure est légal dans une valeur d'en-tête et ne change
  // rien au sens : les deux miroirs doivent en juger pareil.
  const padded = await call('GET', '/ping', { headers: { [CONTRACT_VERSION_HEADER]: ` ${CONTRACT_VERSION} ` } });
  check('valeur rognée avant analyse (espaces de bordure sans effet)', padded.status === 200);

  // Une mineure/corrective différente reste compatible : SEULE la majeure
  // gouverne. C'est ce qui permet de déployer les deux côtés séparément.
  const [major] = CONTRACT_VERSION.split('.');
  for (const compatible of [`${major}.0.0`, `${major}.99.99`]) {
    const res = await call('GET', '/ping', { headers: { [CONTRACT_VERSION_HEADER]: compatible } });
    check(`mineure différente (${compatible}) acceptée`, res.status === 200);
  }
  for (const incompatible of ['0.9.9', '2.0.0', 'abc', '1.3', '']) {
    const res = await call('GET', '/ping', { headers: { [CONTRACT_VERSION_HEADER]: incompatible } });
    check(`version refusée (« ${incompatible || 'vide'} ») -> 409`, res.status === 409);
  }
}

console.log('\nNon appairé : 503 BRIDGE_NOT_PAIRED (état normal), ping public');
{
  const ping = await call('GET', '/ping');
  check('ping public : paired=false', ping.json?.data?.paired === false);

  for (const [method, path, body] of [
    ['GET', '/identity'],
    ['GET', '/health'],
    ['GET', '/manifest'],
    ['POST', '/sync/push', { changes: [buildDiagnosticChange({ emitter: EMITTERS.PANEL })] }],
    ['GET', '/sync/pull'],
    ['GET', '/operations'],
    ['POST', '/operations/contract.cancel/invoke', { invocationId: newBridgeId(), params: {} }],
  ]) {
    const res = await call(method, path, { headers: AUTH, body });
    check(`${method} ${path} -> 503 BRIDGE_NOT_PAIRED`, res.status === 503 && res.json?.code === 'BRIDGE_NOT_PAIRED');
  }

  const unpair = await call('POST', '/unpair', { headers: AUTH });
  check('unpair sans appairage -> 401 (spec : jamais 503)', unpair.status === 401 && unpair.json?.code === 'BRIDGE_UNAUTHORIZED');
}

console.log('\nAppairé : auth Bearer stricte');
await setPairing({ panelUrl: 'https://panel.example.com', projectId: newBridgeId(), panelName: 'panel-stub', bridgeToken: TOKEN });
{
  const noAuth = await call('GET', '/identity');
  check('sans Bearer -> 401', noAuth.status === 401 && noAuth.json?.code === 'BRIDGE_UNAUTHORIZED');

  const badAuth = await call('GET', '/identity', { headers: { ...H, authorization: 'Bearer mauvais-token' } });
  check('mauvais Bearer -> 401', badAuth.status === 401);

  const identity = await call('GET', '/identity', { headers: AUTH });
  check('bon Bearer -> 200', identity.status === 200);
  check('identité conforme au DTO Identity', identitySchema.safeParse(identity.json?.data).success);
  check('projectName lu depuis PROJECT_NAME', identity.json?.data?.projectName === 'SB Auto 06');
  check('projectKey dérivée en slug', identity.json?.data?.projectKey === 'sb-auto-06');
  check('environment = ENV applicatif', identity.json?.data?.environment === 'TEST');

  const health = await call('GET', '/health', { headers: AUTH });
  check('health -> OK', health.status === 200 && health.json?.data?.status === 'OK');

  const ping = await call('GET', '/ping');
  check('ping public : paired=true', ping.json?.data?.paired === true);
}

console.log('\nManifeste officiel (contrat ≥ 1.1.0) : servi, conforme, jamais déduit');
{
  const res = await call('GET', '/manifest', { headers: AUTH });
  check('GET /manifest -> 200', res.status === 200);
  const m = res.json?.data;
  check('conforme au schéma ProjectManifest', projectManifestSchema.safeParse(m).success);
  check('identité du manifeste = identité du pont', m?.project?.key === 'sb-auto-06' && m?.project?.name === 'SB Auto 06' && m?.project?.environment === 'TEST');
  check('contrat annoncé = CONTRACT_VERSION', m?.bridge?.contractVersion === CONTRACT_VERSION && m?.contracts?.panelBridge === CONTRACT_VERSION);
  check('basePath du ProjectBridge déclaré', m?.bridge?.projectBridgeBasePath === '/api/project-bridge/v1');
  // L'invariant porte sur la DÉRIVATION, pas sur une liste figée : le
  // manifeste doit publier EXACTEMENT ce que le code applique. Recopier la
  // liste attendue ici la ferait diverger au premier ajout — ce que ce test
  // est justement censé empêcher.
  check(
    'sync DÉRIVÉE du code : supportedEntityTypes = APPLIED_ENTITY_TYPES',
    JSON.stringify(m?.sync?.supportedEntityTypes) === JSON.stringify([...APPLIED_ENTITY_TYPES])
  );
  check(
    'les types appliqués incluent la configuration d’entreprise et les API intégrées',
    m?.sync?.supportedEntityTypes?.includes('DEV_COMPANY')
      && m?.sync?.supportedEntityTypes?.includes('INTEGRATED_API_CONFIG')
  );
  // Le catalogue n'est plus vide : les opérations contractuelles y sont
  // entrées (Lot 2A). Ce qui reste verrouillé, c'est qu'il soit FERMÉ — seules
  // les opérations réellement implémentées y figurent.
  check('catalogue d’opérations : les actions contractuelles y figurent',
    Array.isArray(m?.sync?.operations) && m.sync.operations.includes('contract.cancel_at_period_end'));
  check('…et rien d’autre que des opérations connues',
    m.sync.operations.every((id) => id.startsWith('contract.')));
  check('modules déclarés (registre non vide)', Array.isArray(m?.modules) && m.modules.length >= 8);
  check('module panel-bridge déclaré ACTIVE', m?.modules?.some((x) => x.id === 'panel-bridge' && x.status === 'ACTIVE'));
  check('features : sync.diagnostic AVAILABLE', m?.features?.some((f) => f.id === 'sync.diagnostic' && f.status === 'AVAILABLE'));
  check('features : les lots non livrés sont RESERVED', m?.features?.some((f) => f.id === 'sync.contracts' && f.status === 'RESERVED'));
}

console.log('\nSync push : accusés PAR écriture, idempotence, refus propres');
{
  const diag = buildDiagnosticChange({ emitter: EMITTERS.PANEL });
  const first = await call('POST', '/sync/push', { headers: AUTH, body: { changes: [diag] } });
  check('DIAGNOSTIC appliqué', first.status === 200 && first.json?.data?.results?.[0]?.status === 'APPLIED');

  const replay = await call('POST', '/sync/push', { headers: AUTH, body: { changes: [diag] } });
  check('relivraison -> DUPLICATE (idempotence)', replay.json?.data?.results?.[0]?.status === 'DUPLICATE');

  const reserved = {
    writeId: newBridgeId(),
    entityType: 'CONTRACT',
    entityId: newBridgeId(),
    deleted: false,
    payload: { any: true },
    modifiedAt: nowIso(),
    emitter: EMITTERS.PANEL,
  };
  const rejected = await call('POST', '/sync/push', { headers: AUTH, body: { changes: [reserved] } });
  const ack = rejected.json?.data?.results?.[0];
  check('type réservé (lot non livré) -> REJECTED, jamais 500', rejected.status === 200 && ack?.status === 'REJECTED');
  check('…code BRIDGE_ENTITY_TYPE_UNSUPPORTED', ack?.code === 'BRIDGE_ENTITY_TYPE_UNSUPPORTED');

  const wrongEmitter = await call('POST', '/sync/push', {
    headers: AUTH,
    body: { changes: [buildDiagnosticChange({ emitter: EMITTERS.PROJECT })] },
  });
  check('emitter PROJECT sur ce sens -> REJECTED', wrongEmitter.json?.data?.results?.[0]?.status === 'REJECTED');

  const malformed = await call('POST', '/sync/push', { headers: AUTH, body: { changes: [{ pas: 'conforme' }] } });
  check('payload non conforme -> 400 BRIDGE_INVALID_PAYLOAD', malformed.status === 400 && malformed.json?.code === 'BRIDGE_INVALID_PAYLOAD');

  const tombstoneBroken = await call('POST', '/sync/push', {
    headers: AUTH,
    body: { changes: [{ ...buildDiagnosticChange({ emitter: EMITTERS.PANEL }), deleted: true }] },
  });
  check('tombstone avec payload non null -> 400', tombstoneBroken.status === 400);
}

console.log('\nSync pull / catalogue d’opérations (Phase 1 : vides, conformes)');
{
  const pull = await call('GET', '/sync/pull?limit=50', { headers: AUTH });
  check('pull -> page vide, hasMore=false', pull.status === 200 && pull.json?.data?.changes?.length === 0 && pull.json?.data?.hasMore === false);
  check('…curseur stable', typeof pull.json?.data?.cursor === 'string');

  const ops = await call('GET', '/operations', { headers: AUTH });
  // Sans base, le catalogue se publie quand même — en annonçant qu'aucune
  // action n'est disponible. Une panne de base n'est pas une panne de pont.
  check('catalogue publié malgré l’absence de base',
    ops.status === 200 && Array.isArray(ops.json?.data?.operations) && ops.json.data.operations.length > 0);
  check('…toutes les actions annoncées INDISPONIBLES',
    ops.json.data.operations.every((o) => o.available === false));
  check('…et versionné', ops.json?.data?.contractVersion === CONTRACT_VERSION);

  const invoke = await call('POST', '/operations/contract.cancel/invoke', {
    headers: AUTH,
    body: { invocationId: newBridgeId(), params: {} },
  });
  check('invocation -> 404 BRIDGE_OPERATION_UNKNOWN', invoke.status === 404 && invoke.json?.code === 'BRIDGE_OPERATION_UNKNOWN');

  const invokeBad = await call('POST', '/operations/contract.cancel/invoke', { headers: AUTH, body: { pas: 'conforme' } });
  check('invocation non conforme -> 400', invokeBad.status === 400 && invokeBad.json?.code === 'BRIDGE_INVALID_PAYLOAD');
}

console.log('\nDésappairage notifié par le Panel');
{
  const unpair = await call('POST', '/unpair', { headers: AUTH });
  check('unpair -> 200 unpaired', unpair.status === 200 && unpair.json?.data?.unpaired === true);

  const after = await call('GET', '/identity', { headers: AUTH });
  check('après révocation : la surface se referme (503)', after.status === 503 && after.json?.code === 'BRIDGE_NOT_PAIRED');

  const ping = await call('GET', '/ping');
  check('ping public : paired=false', ping.json?.data?.paired === false);
}

server.close();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
