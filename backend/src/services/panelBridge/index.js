/**
 * PanelBridge — point d'entrée du module (barrel).
 *
 * RÈGLE D'ARCHITECTURE (00_ECOSYSTEME §8, interdit n°1) : ce dossier est le
 * SEUL endroit du projet qui connaît le Panel (URL, auth, transport, DTO).
 * Les seuls importeurs légitimes hors de ce dossier sont : le module
 * ProjectBridge (état d'appairage partagé), ses routes/controller/middleware,
 * et les tests. Cette exclusivité est verrouillée par
 * `backend/src/scripts/bridge-conformity.test.js`.
 */
export {
  CONTRACT_VERSION,
  MANIFEST_FORMAT_VERSION,
  CONTRACT_VERSION_HEADER,
  SYNC_ENTITY_TYPES,
  APPLIED_ENTITY_TYPES,
  PHASE1_APPLIED_ENTITY_TYPES,
  EMITTERS,
  ACK_STATUS,
  PANEL_API_ROUTES,
  PROJECT_API_ROUTES,
  syncChangeSchema,
  syncPushRequestSchema,
  syncAckSchema,
  syncPushResponseDataSchema,
  syncPullResponseDataSchema,
  heartbeatSchema,
  bootstrapRequestSchema,
  bootstrapResponseDataSchema,
  identitySchema,
  operationInvocationSchema,
  projectManifestSchema,
  parseOrThrow,
  isContractCompatible,
  assertContractCompatible,
  newBridgeId,
  nowIso,
  buildDiagnosticChange,
  CONTRACT_EXAMPLES,
} from './bridgeContract.js';

export {
  BridgeError,
  bridgeError,
  BRIDGE_ERROR_CODES,
  BRIDGE_LOCAL_ERROR_CODES,
} from './bridgeErrors.js';

export {
  configureBridgeRuntime,
  getPanelBridge,
  pairWithPanel,
  unpairFromPanel,
  startupBridgeHello,
  resetBridgeRuntimeForTests,
} from './bridgeRuntime.js';
export {
  configurePairingPersistence,
  hydratePairing,
  setPairing,
  clearPairing,
  rotateBridgeToken,
  isPaired,
  currentBridgeToken,
  verifyIncomingBridgeToken,
  describePairing,
  /**
   * L'APPAIRAGE PRÉVIENT QUAND IL CHANGE — la dépendance structurante du
   * projet ne peut plus apparaître dans l'indifférence générale.
   */
  onPairingChanged,
  resetPairingCacheForTests,
  resetPairingObserversForTests,
} from './pairingStore.js';

export { PANEL_CLIENT_METHODS, isPanelClient, HttpPanelClient, CAPABILITY_TIMEOUT_MS } from './PanelClient.js';
export { createPanelStub } from './panelStub.js';
export { PanelBridge, BRIDGE_STATES } from './PanelBridge.js';
