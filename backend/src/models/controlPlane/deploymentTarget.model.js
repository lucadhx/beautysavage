/**
 * DeploymentTarget — destination distante DURABLE (plan de contrôle P2).
 *
 * Enregistré sur la connexion du PLAN DE CONTRÔLE (base dédiée, indépendante de
 * l'ENV local). AUCUN secret n'est stocké ici : ni mot de passe VPS, ni clé SSH,
 * ni token DNS, ni .env — uniquement des métadonnées non sensibles + des
 * RÉFÉRENCES (id) vers d'autres documents.
 *
 * Deux axes d'état distincts :
 *   - `status`      : cycle de vie de l'OPÉRATION (DRAFT/READY/DEPLOYING/…) ;
 *   - `healthStatus`: SANTÉ observée (UNKNOWN/HEALTHY/DEGRADED/UNREACHABLE).
 */
import mongoose from 'mongoose';
import { PROJECT_ID } from '../../deployment-engine/config/project.profile.js';

export const TARGET_STATUS = ['DRAFT', 'READY', 'DEPLOYING', 'HEALTHY', 'DEGRADED', 'FAILED', 'UPDATING', 'ROLLING_BACK', 'ROLLED_BACK', 'DISABLED'];
export const TARGET_HEALTH = ['UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNREACHABLE'];
export const TARGET_ENVIRONMENTS = ['TEST', 'PROD'];

const serverSchema = new mongoose.Schema(
  {
    host: { type: String, default: null }, // IP/hôte SSH (jamais le mot de passe : RAM seule)
    port: { type: Number, default: 22 },
    username: { type: String, default: 'root' },
  },
  { _id: false }
);

const deploymentTargetSchema = new mongoose.Schema(
  {
    projectKey: { type: String, required: true, trim: true, default: PROJECT_ID },
    name: { type: String, required: true, trim: true },

    targetEnvironment: { type: String, enum: TARGET_ENVIRONMENTS, required: true },

    // Domaines (hostnames SANS protocole ni chemin).
    siteHostname: { type: String, required: true, lowercase: true, trim: true },
    managerHostname: { type: String, required: true, lowercase: true, trim: true },
    apiHostname: { type: String, required: true, lowercase: true, trim: true },

    // URLs publiques canoniques (HTTPS).
    siteUrl: { type: String, required: true },
    managerUrl: { type: String, required: true },
    apiUrl: { type: String, required: true },

    backendPort: { type: Number, required: true },

    server: { type: serverSchema, default: () => ({}) },

    dnsProvider: { type: String, default: null },
    dnsZone: { type: String, default: null },

    remoteRoot: { type: String, default: '/var/www' },
    currentSymlinkPath: { type: String, default: null },

    // Références (jamais de valeurs sensibles).
    currentReleaseId: { type: mongoose.Schema.Types.ObjectId, default: null },
    previousReleaseId: { type: mongoose.Schema.Types.ObjectId, default: null },
    lastDeploymentRunId: { type: String, default: null }, // le run vit dans la base métier

    // Base métier de la destination (nom seulement — pas de credentials).
    dbName: { type: String, default: null },

    status: { type: String, enum: TARGET_STATUS, default: 'DRAFT' },
    healthStatus: { type: String, enum: TARGET_HEALTH, default: 'UNKNOWN' },

    currentVersion: { type: String, default: null },
    currentCommit: { type: String, default: null },

    lastSuccessfulDeploymentAt: { type: Date, default: null },
    lastHealthcheckAt: { type: Date, default: null },

    disabledAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null }, // soft-delete
  },
  { timestamps: true }
);

// Unicité : une destination active par (projectKey, targetEnvironment, siteHostname).
// Index partiel : les documents soft-deleted ne bloquent pas une recréation.
deploymentTargetSchema.index(
  { projectKey: 1, targetEnvironment: 1, siteHostname: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);

/**
 * Retourne le modèle DeploymentTarget lié à `conn` (idempotent : réutilise le
 * modèle déjà enregistré sur cette connexion). Testable via une connexion injectée.
 */
export function getDeploymentTargetModel(conn) {
  return conn.models.DeploymentTarget || conn.model('DeploymentTarget', deploymentTargetSchema);
}

export { deploymentTargetSchema };
export default getDeploymentTargetModel;
