/**
 * DeploymentRelease — version IMMUABLE déployée/préparée sur une destination
 * (plan de contrôle P2). Enregistré sur la connexion du plan de contrôle.
 *
 * Une release ACTIVE = la version actuellement servie. L'activation d'une nouvelle
 * release désactive l'ancienne (INACTIVE) et conserve la référence précédente.
 * `remotePath` doit rester SOUS le répertoire autorisé de la destination (aucune
 * traversée de chemin). Aucun secret n'est stocké ici.
 */
import mongoose from 'mongoose';

export const RELEASE_STATUS = ['PREPARING', 'UPLOADED', 'INSTALLED', 'ACTIVE', 'INACTIVE', 'FAILED', 'ROLLED_BACK', 'REMOVED'];

const deploymentReleaseSchema = new mongoose.Schema(
  {
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },

    releaseKey: { type: String, required: true }, // identifiant lisible/stable de la release
    version: { type: String, default: null },
    commitHash: { type: String, default: null }, // provient du build RÉEL, jamais inventé
    branch: { type: String, default: null },

    artifactChecksum: { type: String, default: null },
    artifactSize: { type: Number, default: null },

    remotePath: { type: String, required: true },
    status: { type: String, enum: RELEASE_STATUS, default: 'PREPARING' },

    deploymentRunId: { type: String, default: null },

    previousReleaseId: { type: mongoose.Schema.Types.ObjectId, default: null },
    rollbackOfReleaseId: { type: mongoose.Schema.Types.ObjectId, default: null },

    uploadedAt: { type: Date, default: null },
    installedAt: { type: Date, default: null },
    activatedAt: { type: Date, default: null },
    deactivatedAt: { type: Date, default: null },

    healthcheckResult: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

// Unicité de la clé de release par destination.
deploymentReleaseSchema.index({ targetId: 1, releaseKey: 1 }, { unique: true });
// Au plus UNE release ACTIVE par destination (index partiel unique).
deploymentReleaseSchema.index(
  { targetId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'ACTIVE' } }
);

export function getDeploymentReleaseModel(conn) {
  return conn.models.DeploymentRelease || conn.model('DeploymentRelease', deploymentReleaseSchema);
}

export { deploymentReleaseSchema };
export default getDeploymentReleaseModel;
