/**
 * Appairage du projet à son Panel — persistance CHIFFRÉE (Phase 2A).
 *
 * Document SINGLETON (au plus un appairage par instance). Le bridgeToken —
 * l'unique secret des deux sens du pont (spec docs/panelXvitrine/spec/) — est
 * stocké chiffré AES-256-GCM via la clé maître INTEGRATED_API_ENCRYPTION_KEY,
 * exactement comme les credentials d'IntegratedAPI. AUCUN champ de ce modèle
 * ne contient jamais de secret en clair.
 *
 * Rotation prévue par construction : `bridgeTokenPrevious` porte l'ancien
 * token (chiffré) accepté jusqu'à `expiresAt` — même patron que la rotation
 * du secret webhook Brevo (fenêtre de transition, jamais de coupure).
 *
 * Ce modèle n'est lu/écrit QUE par l'adaptateur de persistance du pont
 * (services/panelBridge/persistence/) — verrouillé par bridge-conformity.
 */
import mongoose from 'mongoose';

const encryptedSecretSchema = new mongoose.Schema(
  {
    // Format intégral d'integratedApiCrypto : iv.authTag.ciphertext (base64).
    encryptedValue: { type: String, required: true },
  },
  { _id: false }
);

const bridgePairingSchema = new mongoose.Schema(
  {
    // Clé de singleton (index unique) : il n'existe qu'UN appairage.
    key: { type: String, required: true, unique: true, default: 'SINGLETON' },

    panelUrl: { type: String, required: true },
    /**
     * L'ORIGINE PUBLIQUE DU PANEL — celle où l'on envoie un NAVIGATEUR.
     *
     * `panelUrl` est l'adresse que le PONT appelle : une adresse de machine.
     * Elle ne désigne pas forcément l'endroit où un humain trouve l'écran
     * d'autorisation de la fédération — et chez L.Y Solution, elle ne le
     * désigne pas. Confondre les deux a produit un « Route inconnue :
     * GET /federation/authorize » sur le premier projet dupliqué.
     *
     * Facultative : un Panel antérieur à cette correction ne la déclare pas, et
     * le projet la déduit alors de l'adresse d'API (voir
     * `services/federation/panelFrontendUrl.js`).
     */
    panelFrontendUrl: { type: String, default: null },
    projectId: { type: String, required: true },
    panelName: { type: String, default: '' },
    pairedAt: { type: Date, required: true },

    bridgeToken: { type: encryptedSecretSchema, required: true },

    // Rotation : l'ancien token reste accepté jusqu'à expiresAt (fenêtre de
    // transition), puis devient lettre morte. null = aucune rotation en cours.
    bridgeTokenPrevious: {
      type: new mongoose.Schema(
        {
          encryptedValue: { type: String, required: true },
          expiresAt: { type: Date, required: true },
        },
        { _id: false }
      ),
      default: null,
    },
    tokenRotatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const BridgePairing = mongoose.model('BridgePairing', bridgePairingSchema);
export default BridgePairing;
