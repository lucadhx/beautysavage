import mongoose from 'mongoose';
import { STORABLE_PROVIDER_VALUES, MODE_VALUES, requiredFieldKeys } from '../utils/integratedApiCatalog.js';
import { WEBHOOK_CONFIG_STATUS } from '../utils/brevoWebhookConstants.js';

/**
 * Registre des intégrations d'API tierces (Stripe, Yousign, …).
 *
 * Un document par fournisseur. Chaque fournisseur possède DEUX jeux de
 * credentials chiffrés (`modes.TEST` / `modes.PROD`) totalement séparés, et un
 * `activeMode` choisi par un DEV — INDÉPENDANT de l'environnement applicatif
 * (config.env / base MongoDB). Le driver consomme TOUJOURS le mode actif (ou un
 * mode explicite pour un test), JAMAIS l'ENV.
 *
 * Secrets stockés CHIFFRÉS (AES-256-GCM), jamais en clair, jamais renvoyés au
 * frontend (le controller masque à la sérialisation).
 */

// Un credential chiffré. `encryptedValue` = "iv.authTag.ciphertext" (base64).
const credentialSchema = new mongoose.Schema(
  {
    encryptedValue: { type: String, required: true },
    lastFour: { type: String, default: '' },
    updatedAt: { type: Date, default: Date.now },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false }
);

/**
 * État de configuration du WEBHOOK GÉRÉ d'un mode — commun aux TROIS providers
 * (Brevo/Stripe/Yousign) depuis l'uniformisation : id distant, URL
 * synchronisée, événements souscrits, état, santé, dernier événement reçu.
 * Porté PAR MODE, isolé comme les credentials. Ne contient AUCUN secret : le
 * secret (Bearer ou HMAC) vit dans `credentials.webhookSecret` (chiffré).
 */
const webhookConfigSchema = new mongoose.Schema(
  {
    webhookId: { type: String, default: null }, // id distant Brevo (POST /v3/webhooks)
    webhookUrl: { type: String, default: '' }, // URL canonique dérivée de config.publicUrl
    subscribedEvents: { type: [String], default: [] },
    authenticationType: { type: String, default: 'BEARER' },
    status: {
      type: String,
      enum: Object.values(WEBHOOK_CONFIG_STATUS),
      default: WEBHOOK_CONFIG_STATUS.NOT_CONFIGURED,
    },
    active: { type: Boolean, default: false },
    lastSyncedAt: { type: Date, default: null },
    lastReceivedAt: { type: Date, default: null },
    // Type NORMALISÉ du dernier événement reçu (ACCEPTED, DELIVERED…) — activité
    // de suivi affichée au Manager, jamais un critère de santé.
    lastReceivedType: { type: String, default: null },
    // Fenêtre de rotation : l'ancien secret reste accepté jusqu'à cette date.
    previousSecretValidUntil: { type: Date, default: null },
    /**
     * Refus d'authentification (401) d'un appel entrant. C'est le SEUL signal qui
     * distingue « Brevo n'a jamais appelé » de « Brevo a appelé, token refusé » :
     * un refus a lieu avant toute persistance d'événement.
     */
    lastAuthRejectedAt: { type: Date, default: null },
    authRejectedCount: { type: Number, default: 0 },
    /**
     * SANTÉ du webhook — sa JOIGNABILITÉ réelle, distincte de son existence chez
     * Brevo. Un webhook enregistré dont le tunnel est tombé n'est PAS opérationnel :
     * l'issue des envois deviendrait inconnaissable. `healthyUntil` borne la
     * validité de la preuve (courte en TEST/ngrok, plus longue en PROD).
     */
    healthStatus: { type: String, enum: ['UNKNOWN', 'HEALTHY', 'UNREACHABLE'], default: 'UNKNOWN' },
    healthCheckedAt: { type: Date, default: null },
    healthyUntil: { type: Date, default: null },
    healthErrorSafe: {
      code: { type: String, default: '' },
      message: { type: String, default: '' },
    },
    lastErrorSafe: {
      code: { type: String, default: '' },
      message: { type: String, default: '' },
    },
    /**
     * DERNIER RAPPORT D'EXÉCUTION (Synchroniser/Réparer/Tester) — persisté quel
     * que soit le bouton utilisé. Structure produite par webhookRunReport.service
     * (contexte, résultats, exception masquée, diagnostic, correction suggérée,
     * texte collable). JAMAIS de secret : tout est masqué avant persistance.
     */
    lastRunReport: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Dernière tentative d'action, réussie ou non. */
    lastAttemptAt: { type: Date, default: null },
    /** Dernière action terminée en SUCCESS. */
    lastSuccessAt: { type: Date, default: null },
  },
  { _id: false }
);

// État d'un MODE fournisseur (jeu de credentials + base URL + dernier test).
const modeSchema = new mongoose.Schema(
  {
    credentials: { type: Map, of: credentialSchema, default: () => new Map() },
    // Base URL du mode (pré-remplie au seed, ÉDITABLE). Le driver utilise TOUJOURS
    // cette valeur ; vide -> défaut du catalogue. Jamais de constante codée en dur.
    baseUrl: { type: String, default: '' },
    configured: { type: Boolean, default: false }, // dérivé : tous les champs requis présents
    verified: { type: Boolean, default: false }, // un test de connexion a réussi APRÈS la dernière config
    verifiedAt: { type: Date, default: null }, // horodatage de la dernière preuve de connexion
    // Empreinte NON réversible (sha256) des credentials requis au moment de la
    // vérification. Prouve que `verified` concerne la CLÉ ACTUELLE, pas une
    // ancienne : si la clé change, l'empreinte ne correspond plus. Jamais la clé
    // en clair. Vide = vérification antérieure à ce champ (traitée en rétrocompat).
    verifiedFingerprint: { type: String, default: '' },
    lastTestedAt: { type: Date, default: null },
    lastTestStatus: { type: String, enum: ['SUCCESS', 'FAILED', null], default: null },
    lastTestMessage: { type: String, default: '' },
    // Diagnostic enrichi du dernier test (compte, organisation, version API,
    // temps de réponse…). Données NON sensibles uniquement.
    lastTestDetails: { type: mongoose.Schema.Types.Mixed, default: null },
    // Configuration du webhook transactionnel (Brevo). Optionnel, non sensible.
    webhook: { type: webhookConfigSchema, default: () => ({}) },
  },
  { _id: false }
);

const integratedApiSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      /**
       * CE QUI PEUT EXISTER, pas ce qui est offert.
       *
       * Le catalogue ne propose plus `YOUSIGN` — la signature y est un domaine.
       * Mais une base déployée en porte encore un document, et la purge doit
       * pouvoir l'écrire pour le vider. Un schéma qui refuserait ce nom
       * rendrait ce document impossible à nettoyer.
       */
      enum: STORABLE_PROVIDER_VALUES,
      required: true,
      unique: true,
      uppercase: true,
    },
    displayName: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    // MODE FOURNISSEUR actif — indépendant de config.env. Défaut : TEST (sûr).
    activeMode: { type: String, enum: MODE_VALUES, default: 'TEST' },
    modes: {
      TEST: { type: modeSchema, default: () => ({}) },
      PROD: { type: modeSchema, default: () => ({}) },
    },
    modeUpdatedAt: { type: Date, default: null },
    modeUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

/** Recalcule `configured` d'un mode : tous les champs requis présents. */
integratedApiSchema.methods.recomputeConfigured = function recomputeConfigured(mode) {
  const required = requiredFieldKeys(this.provider);
  const creds = this.modes?.[mode]?.credentials;
  const has = (k) => Boolean(creds && creds.get && creds.get(k));
  const configured = required.every(has);
  if (this.modes?.[mode]) this.modes[mode].configured = configured;
  return configured;
};

integratedApiSchema.methods.recomputeAll = function recomputeAll() {
  for (const mode of MODE_VALUES) this.recomputeConfigured(mode);
  return this;
};

export const IntegratedApi = mongoose.model('IntegratedApi', integratedApiSchema);
export default IntegratedApi;
