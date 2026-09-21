/**
 * Adaptateur de persistance Mongo de l'appairage (Phase 2A).
 *
 * SEUL fichier du module de pont autorisé à toucher un modèle Mongo et la
 * cryptographie applicative (exception étroite et documentée du test
 * bridge-conformity : le cœur du pont reste découplé du métier ; la
 * persistance est de l'infrastructure, injectée dans pairingStore.js via
 * `configurePairingPersistence`).
 *
 * Contrat d'adaptateur (interface PairingPersistence) :
 *   load()  -> pairing EN CLAIR (déchiffré) ou null
 *   save(p) -> upsert du singleton, secrets CHIFFRÉS avant écriture
 *   clear() -> suppression du singleton (idempotent)
 *
 * Les secrets ne sont en clair qu'EN MÉMOIRE, jamais dans un document.
 */
import { BridgePairing } from '../../../models/BridgePairing.model.js';
import { encryptSecret, decryptSecret } from '../../../utils/integratedApiCrypto.js';

export function createMongoPairingAdapter() {
  return {
    async load() {
      const doc = await BridgePairing.findOne({ key: 'SINGLETON' }).lean();
      if (!doc) return null;
      const previous =
        doc.bridgeTokenPrevious?.encryptedValue && doc.bridgeTokenPrevious?.expiresAt
          ? {
              token: decryptSecret(doc.bridgeTokenPrevious.encryptedValue),
              expiresAt: new Date(doc.bridgeTokenPrevious.expiresAt).toISOString(),
            }
          : null;
      return {
        panelUrl: doc.panelUrl,
        panelFrontendUrl: doc.panelFrontendUrl || null,
        projectId: doc.projectId,
        panelName: doc.panelName || '',
        pairedAt: new Date(doc.pairedAt).toISOString(),
        bridgeToken: decryptSecret(doc.bridgeToken.encryptedValue),
        bridgeTokenPrevious: previous,
        tokenRotatedAt: doc.tokenRotatedAt ? new Date(doc.tokenRotatedAt).toISOString() : null,
      };
    },

    async save(pairing) {
      await BridgePairing.findOneAndUpdate(
        { key: 'SINGLETON' },
        {
          $set: {
            panelUrl: pairing.panelUrl,
            panelFrontendUrl: pairing.panelFrontendUrl || null,
            projectId: pairing.projectId,
            panelName: pairing.panelName || '',
            pairedAt: new Date(pairing.pairedAt),
            bridgeToken: { encryptedValue: encryptSecret(pairing.bridgeToken) },
            bridgeTokenPrevious: pairing.bridgeTokenPrevious
              ? {
                  encryptedValue: encryptSecret(pairing.bridgeTokenPrevious.token),
                  expiresAt: new Date(pairing.bridgeTokenPrevious.expiresAt),
                }
              : null,
            tokenRotatedAt: pairing.tokenRotatedAt ? new Date(pairing.tokenRotatedAt) : null,
          },
        },
        { upsert: true, new: true }
      );
    },

    async clear() {
      await BridgePairing.deleteOne({ key: 'SINGLETON' });
    },
  };
}
