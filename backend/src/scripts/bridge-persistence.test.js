/* Persistance CHIFFRÉE de l'appairage (Phase 2A, objectif 1) — prouve que :
 * un redémarrage du backend ne casse JAMAIS l'appairage ; aucun secret n'est
 * écrit en clair ; la rotation du bridgeToken offre une fenêtre de transition
 * qui survit elle aussi au redémarrage ; le désappairage purge tout.
 * Runner autonome sur mongodb-memory-server. */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt-long-enough-32chars!!';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();

const {
  configurePairingPersistence,
  hydratePairing,
  setPairing,
  clearPairing,
  rotateBridgeToken,
  isPaired,
  verifyIncomingBridgeToken,
  describePairing,
  resetPairingCacheForTests,
} = await import('../services/panelBridge/pairingStore.js');
const { createMongoPairingAdapter } = await import(
  '../services/panelBridge/persistence/mongoPairingAdapter.js'
);
const { BridgePairing } = await import('../models/BridgePairing.model.js');

const TOKEN = 'bridge-token-secret-0123456789abcdef';
const TOKEN2 = 'bridge-token-ROTATED-fedcba9876543210';

configurePairingPersistence(createMongoPairingAdapter());

console.log('\nHydratation à froid : aucun appairage');
{
  const restored = await hydratePairing();
  check('hydrate sans document -> null', restored === null);
  check('non appairé', !isPaired());
}

console.log('\nAppairage persisté, secrets chiffrés au repos');
{
  await setPairing({
    panelUrl: 'https://panel.example.com',
    projectId: '3f2f1a10-6a58-4c8e-9d3a-1c2b3d4e5f60',
    panelName: 'panel-reel',
    bridgeToken: TOKEN,
  });
  check('appairé (RAM)', isPaired());
  check('token courant vérifiable', verifyIncomingBridgeToken(TOKEN));

  const raw = await BridgePairing.findOne({ key: 'SINGLETON' }).lean();
  check('document singleton écrit', Boolean(raw));
  check('bridgeToken chiffré (format iv.authTag.ciphertext)', /^[^.]+\.[^.]+\.[^.]+$/.test(raw.bridgeToken.encryptedValue));
  const serialized = JSON.stringify(raw);
  check('AUCUN token en clair dans le document', !serialized.includes(TOKEN));
  check('métadonnées non sensibles présentes', raw.panelUrl === 'https://panel.example.com' && raw.panelName === 'panel-reel');
}

console.log('\nRedémarrage simulé : l’appairage survit');
{
  resetPairingCacheForTests(); // le process « redémarre » : RAM vide
  check('après redémarrage, RAM vide', !isPaired());
  check('…donc vérification refusée', !verifyIncomingBridgeToken(TOKEN));

  const restored = await hydratePairing();
  check('hydratation restaure l’appairage', restored?.paired === true && isPaired());
  check('…panelUrl restaurée', describePairing().panelUrl === 'https://panel.example.com');
  check('…le token redevient vérifiable', verifyIncomingBridgeToken(TOKEN));
  check('…un token forgé reste refusé', !verifyIncomingBridgeToken('token-forge'));
}

console.log('\nRotation du bridgeToken : fenêtre de transition');
{
  await rotateBridgeToken(TOKEN2, { windowMs: 60_000 });
  check('nouveau token accepté', verifyIncomingBridgeToken(TOKEN2));
  check('ancien token accepté PENDANT la fenêtre', verifyIncomingBridgeToken(TOKEN));
  check('fenêtre signalée (vue non sensible)', describePairing().rotationWindowOpen === true);
  check('tokenRotatedAt renseigné', Boolean(describePairing().tokenRotatedAt));

  const raw = await BridgePairing.findOne({ key: 'SINGLETON' }).lean();
  const serialized = JSON.stringify(raw);
  check('rotation persistée (previous chiffré)', Boolean(raw.bridgeTokenPrevious?.encryptedValue));
  check('aucun des deux tokens en clair', !serialized.includes(TOKEN) && !serialized.includes(TOKEN2));

  // La fenêtre survit AUSSI au redémarrage.
  resetPairingCacheForTests();
  await hydratePairing();
  check('après redémarrage : nouveau token OK', verifyIncomingBridgeToken(TOKEN2));
  check('après redémarrage : ancien token encore OK', verifyIncomingBridgeToken(TOKEN));
}

console.log('\nExpiration de la fenêtre : l’ancien token meurt');
{
  const TOKEN3 = 'bridge-token-TROISIEME-a1b2c3d4e5f60718';
  await rotateBridgeToken(TOKEN3, { windowMs: 120 }); // fenêtre courte : previous = TOKEN2
  check('previous (TOKEN2) accepté avant expiration', verifyIncomingBridgeToken(TOKEN2));
  check('le tout premier token (2 rotations en arrière) est mort', !verifyIncomingBridgeToken(TOKEN));
  await sleep(180);
  check('previous refusé après expiration', !verifyIncomingBridgeToken(TOKEN2));
  check('le token courant reste accepté', verifyIncomingBridgeToken(TOKEN3));
  check('fenêtre fermée (vue non sensible)', describePairing().rotationWindowOpen === false);
}

console.log('\nDésappairage : purge complète, idempotent');
{
  await clearPairing();
  check('RAM vidée', !isPaired());
  check('document supprimé', (await BridgePairing.countDocuments({})) === 0);
  const restored = await hydratePairing();
  check('hydratation après purge -> null', restored === null);
  await clearPairing();
  check('clearPairing idempotent', !isPaired());
}

configurePairingPersistence(null); // ne pas polluer d'autres suites du process
await disconnectDatabase();
await mongod.stop();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
