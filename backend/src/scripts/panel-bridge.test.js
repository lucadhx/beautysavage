/* PanelBridge (LOT 3/4/5/6) — cycle de vie complet de la façade contre le
 * STUB de Panel : appairage, heartbeat, dégradation/reprise, outbox,
 * push/pull, anti-écho, idempotence, désappairage. Runner autonome, AUCUNE
 * base de données, AUCUN réseau : le module du pont est découplé par
 * construction (vérifié par bridge-conformity.test.js). */

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
async function rejectsWith(fn, code) {
  try {
    await fn();
    return false;
  } catch (err) {
    return err?.code === code || err?.details?.code === code;
  }
}

const {
  PanelBridge,
  BRIDGE_STATES,
  createPanelStub,
  buildDiagnosticChange,
  newBridgeId,
  nowIso,
  isContractCompatible,
  isPaired,
  clearPairing,
  BRIDGE_ERROR_CODES,
  BRIDGE_LOCAL_ERROR_CODES,
  EMITTERS,
  ACK_STATUS,
  CONTRACT_VERSION,
} = await import('../services/panelBridge/index.js');

const IDENTITY = {
  projectKey: 'sb-auto-06',
  projectName: 'SB Auto 06',
  environment: 'TEST',
  softwareVersion: 'abc1234',
  contractVersion: CONTRACT_VERSION,
};

await clearPairing(); // isolation : aucun état hérité d'un autre test du process

console.log('\nVersionnement du contrat');
{
  check('même majeure -> compatible', isContractCompatible(CONTRACT_VERSION));
  check('mineure supérieure -> compatible', isContractCompatible('1.9.9'));
  check('majeure différente -> incompatible', !isContractCompatible('2.0.0'));
  check('chaîne invalide -> incompatible', !isContractCompatible('quarante-deux'));
}

console.log('\nÉtat initial : UNCONFIGURED = Standalone de première classe');
const stub = createPanelStub();
const bridge = new PanelBridge({ client: stub });
{
  check('état initial UNCONFIGURED', bridge.getStatus().state === BRIDGE_STATES.UNCONFIGURED);
  check('non appairé', bridge.getStatus().pairing.paired === false);

  const hb = await bridge.heartbeat({ softwareVersion: 'abc1234', environment: 'TEST' });
  check('heartbeat sans appairage : ne lève pas, delivered=false', hb.delivered === false);
  check('…avec raison NOT_PAIRED', hb.reason === BRIDGE_ERROR_CODES.NOT_PAIRED);

  const flush = await bridge.flushOutbox();
  check('flush sans appairage : no-op propre', flush.delivered === 0 && flush.reason === BRIDGE_ERROR_CODES.NOT_PAIRED);

  const pull = await bridge.pullUpdates();
  check('pull sans appairage : no-op propre', pull.applied === 0 && pull.reason === BRIDGE_ERROR_CODES.NOT_PAIRED);
}

console.log('\nAppairage (bootstrap)');
{
  const bad = await rejectsWith(
    () => bridge.pair({ identity: IDENTITY, pairingCode: 'MAUVAIS-CODE' }),
    BRIDGE_ERROR_CODES.PAIRING_CODE_INVALID
  );
  check('code d’appairage invalide -> BRIDGE_PAIRING_CODE_INVALID', bad);
  check('…et l’état reste UNCONFIGURED', bridge.getStatus().state === BRIDGE_STATES.UNCONFIGURED);

  const pairing = await bridge.pair({ identity: IDENTITY, pairingCode: 'PAIR-OK' });
  check('appairage réussi -> CONNECTED', bridge.getStatus().state === BRIDGE_STATES.CONNECTED);
  check('pairingStore appairé', isPaired() && pairing.paired === true);
  check('le stub a délivré un token', stub.inspect().paired && Boolean(stub.inspect().issuedToken));
  check('le token n’apparaît PAS dans le statut', !JSON.stringify(bridge.getStatus()).includes(stub.inspect().issuedToken));

  const again = await rejectsWith(
    () => bridge.pair({ identity: IDENTITY, pairingCode: 'PAIR-OK' }),
    BRIDGE_ERROR_CODES.ALREADY_PAIRED
  );
  check('double appairage refusé -> BRIDGE_ALREADY_PAIRED', again);
}

console.log('\nHeartbeat : reprise CONNECTED <-> DEGRADED');
{
  const ok1 = await bridge.heartbeat({ softwareVersion: 'abc1234', environment: 'TEST' });
  check('heartbeat livré', ok1.delivered === true);
  check('lastHeartbeatAt renseigné', Boolean(bridge.getStatus().lastHeartbeatAt));

  stub.failNextWith(BRIDGE_ERROR_CODES.INTERNAL);
  const ko = await bridge.heartbeat({ softwareVersion: 'abc1234', environment: 'TEST' });
  check('panne du Panel : delivered=false SANS exception', ko.delivered === false);
  check('…état DEGRADED', bridge.getStatus().state === BRIDGE_STATES.DEGRADED);
  check('…lastError renseigné', bridge.getStatus().lastError?.code === BRIDGE_ERROR_CODES.INTERNAL);

  const ok2 = await bridge.heartbeat({ softwareVersion: 'abc1234', environment: 'TEST' });
  check('reprise automatique -> CONNECTED', ok2.delivered === true && bridge.getStatus().state === BRIDGE_STATES.CONNECTED);
}

console.log('\nOutbox : accumulation, panne, reprise, idempotence');
{
  const bogus = await rejectsWith(
    () => Promise.resolve(bridge.queueLocalChange({ nimporte: 'quoi' })),
    BRIDGE_ERROR_CODES.INVALID_PAYLOAD
  );
  check('écriture non conforme refusée -> BRIDGE_INVALID_PAYLOAD', bogus);

  const echoPanel = await rejectsWith(
    () => Promise.resolve(bridge.queueLocalChange(buildDiagnosticChange({ emitter: EMITTERS.PANEL }))),
    BRIDGE_ERROR_CODES.INVALID_PAYLOAD
  );
  check('emitter PANEL refusé dans l’outbox locale', echoPanel);

  const c1 = bridge.queueLocalChange(buildDiagnosticChange({ emitter: EMITTERS.PROJECT }));
  const c2 = bridge.queueLocalChange(buildDiagnosticChange({ emitter: EMITTERS.PROJECT }));
  const c3 = bridge.queueLocalChange(buildDiagnosticChange({ emitter: EMITTERS.PROJECT }));
  check('3 écritures en file', bridge.getStatus().outboxSize === 3);

  stub.goOffline();
  const offline = await bridge.flushOutbox();
  check('Panel injoignable : rien livré, file INTACTE', offline.delivered === 0 && offline.pending === 3);
  check('…raison locale PANEL_UNREACHABLE', offline.reason === BRIDGE_LOCAL_ERROR_CODES.PANEL_UNREACHABLE);
  check('…état DEGRADED', bridge.getStatus().state === BRIDGE_STATES.DEGRADED);

  stub.goOnline();
  const flushed = await bridge.flushOutbox();
  check('reprise : 3 écritures livrées', flushed.delivered === 3 && flushed.pending === 0);
  check('…état CONNECTED', bridge.getStatus().state === BRIDGE_STATES.CONNECTED);
  check('le stub a bien reçu c1..c3', stub.inspect().received.length === 3);

  // Relivraison du même writeId : le stub répond DUPLICATE, la file se vide.
  bridge.outbox.push(c1);
  const dup = await bridge.flushOutbox();
  check('relivraison idempotente (DUPLICATE, file vidée)', dup.pending === 0 && stub.inspect().received.length === 3);

  // Le stub rejette un emitter invalide au niveau accusé (REJECTED).
  const direct = await stub.pushChanges({
    changes: [{ ...buildDiagnosticChange({ emitter: EMITTERS.PROJECT }), emitter: EMITTERS.PANEL }],
  });
  check('stub : emitter PANEL sur push -> REJECTED', direct.results[0].status === ACK_STATUS.REJECTED);

  void c2; void c3;
}

console.log('\nPull : application, anti-écho, idempotence, types non livrés');
{
  const appliedByHandler = [];
  bridge.registerApplyHandler('DIAGNOSTIC', async ({ change }) => appliedByHandler.push(change));

  const unknownHandler = await rejectsWith(
    () => Promise.resolve(bridge.registerApplyHandler('PAS_UN_TYPE', async () => {})),
    BRIDGE_ERROR_CODES.ENTITY_TYPE_UNSUPPORTED
  );
  check('handler sur type inconnu refusé', unknownHandler);

  const fromPanel1 = buildDiagnosticChange({ emitter: EMITTERS.PANEL });
  const tombstone = {
    writeId: newBridgeId(),
    entityType: 'DIAGNOSTIC',
    entityId: fromPanel1.entityId,
    deleted: true,
    payload: null,
    modifiedAt: nowIso(),
    emitter: EMITTERS.PANEL,
  };
  // Écho : une écriture émise par CE projet nous revient du Panel — elle ne
  // doit JAMAIS être ré-appliquée (règle anti-écho, 11 §1.1 n°4).
  const localWriteId = [...bridge.localWriteIds][0];
  const echo = { ...buildDiagnosticChange({ emitter: EMITTERS.PANEL }), writeId: localWriteId };
  // Type déclaré au contrat mais sans handler enregistré (lot non livré).
  const reserved = {
    writeId: newBridgeId(),
    entityType: 'CONTRACT',
    entityId: newBridgeId(),
    deleted: false,
    payload: { any: true },
    modifiedAt: nowIso(),
    emitter: EMITTERS.PANEL,
  };

  stub.enqueuePanelChange(fromPanel1);
  stub.enqueuePanelChange(tombstone);
  stub.enqueuePanelChange(echo);
  stub.enqueuePanelChange(reserved);

  const pull1 = await bridge.pullUpdates();
  check('2 écritures DIAGNOSTIC appliquées (dont le tombstone)', pull1.applied === 2 && appliedByHandler.length === 2);
  check('le handler a reçu le tombstone', appliedByHandler.some((c) => c.deleted === true));
  check('écho + type réservé ignorés (skipped=2)', pull1.skipped === 2);
  check('curseur avancé', bridge.getStatus().pullCursor === '4');

  const pull2 = await bridge.pullUpdates();
  check('re-pull : rien de neuf, rien de ré-appliqué', pull2.applied === 0 && appliedByHandler.length === 2);

  // Un handler qui échoue ne casse ni la page ni le pont.
  bridge.registerApplyHandler('DIAGNOSTIC', async () => {
    throw new Error('boum volontaire');
  });
  stub.enqueuePanelChange(buildDiagnosticChange({ emitter: EMITTERS.PANEL }));
  const pull3 = await bridge.pullUpdates();
  check('handler en échec : skipped, pas d’exception', pull3.applied === 0 && pull3.skipped === 1);
  check('…lastError renseigné', bridge.getStatus().lastError?.message === 'boum volontaire');
}

console.log('\nDésappairage : retour au Standalone, idempotent');
{
  bridge.queueLocalChange(buildDiagnosticChange({ emitter: EMITTERS.PROJECT }));
  const res = await bridge.unpair();
  check('unpaired', res.unpaired === true);
  check('état UNCONFIGURED', bridge.getStatus().state === BRIDGE_STATES.UNCONFIGURED);
  check('pairingStore vidé', !isPaired());
  check('outbox purgée', bridge.getStatus().outboxSize === 0);
  check('curseur purgé', bridge.getStatus().pullCursor === null);
  check('le stub a été notifié', stub.inspect().paired === false);

  const again = await bridge.unpair();
  check('désappairage idempotent', again.unpaired === true);

  const hb = await bridge.heartbeat({ softwareVersion: 'abc1234', environment: 'TEST' });
  check('après débranchement : heartbeat no-op propre', hb.delivered === false && hb.reason === BRIDGE_ERROR_CODES.NOT_PAIRED);
}

console.log('\nRuntime applicatif (Phase 2A) : prêt pour un Panel réel');
{
  const {
    configureBridgeRuntime,
    getPanelBridge,
    pairWithPanel,
    unpairFromPanel,
    startupBridgeHello,
    resetBridgeRuntimeForTests,
  } = await import('../services/panelBridge/index.js');

  resetBridgeRuntimeForTests();
  check('non configuré : getPanelBridge() -> null (non appairé)', getPanelBridge() === null);
  check('hello non appairé : no-op propre', (await startupBridgeHello()).skipped === true);
  check(
    'pairWithPanel sans configuration -> erreur explicite',
    await (async () => {
      try { await pairWithPanel({ panelUrl: 'https://p.example.com', pairingCode: 'PAIR-OK' }); return false; }
      catch (err) { return /configureBridgeRuntime/.test(err.message); }
    })()
  );

  const runtimeStub = createPanelStub();
  const FAKE_MANIFEST = {
    manifestVersion: '1.0.0',
    project: { key: IDENTITY.projectKey, name: IDENTITY.projectName, environment: 'TEST', softwareVersion: 'abc1234' },
    bridge: { contractVersion: CONTRACT_VERSION, projectBridgeBasePath: '/api/project-bridge/v1' },
    contracts: { panelBridge: CONTRACT_VERSION, projectBridge: CONTRACT_VERSION },
    sync: { supportedEntityTypes: ['DIAGNOSTIC'], operations: [] },
    modules: [{ id: 'panel-bridge', title: 'Pont Panel', status: 'ACTIVE' }],
    features: [{ id: 'sync.diagnostic', status: 'AVAILABLE' }],
  };
  configureBridgeRuntime({
    identityProvider: async () => IDENTITY,
    manifestProvider: async () => FAKE_MANIFEST,
    clientFactory: () => runtimeStub, // stub = TESTS uniquement (défaut : HTTP réel)
  });

  const pairing = await pairWithPanel({ panelUrl: 'https://panel.example.com', pairingCode: 'PAIR-OK' });
  check('pairWithPanel appaire', pairing.paired === true && isPaired());
  check('le manifeste a été joint au bootstrap', runtimeStub.inspect().lastBootstrapRequest?.manifest?.manifestVersion === '1.0.0');
  const instance = getPanelBridge();
  check('getPanelBridge() renvoie l’instance appairée', instance !== null && instance.getStatus().state === BRIDGE_STATES.CONNECTED);
  check('instance unique (singleton runtime)', getPanelBridge() === instance);

  const hello = await startupBridgeHello();
  check('hello au démarrage : heartbeat livré', hello.skipped === false && hello.heartbeat?.delivered === true);

  const un = await unpairFromPanel();
  check('unpairFromPanel débranche', un.unpaired === true && !isPaired());
  check('après débranchement : getPanelBridge() -> null', getPanelBridge() === null);
  resetBridgeRuntimeForTests();
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
