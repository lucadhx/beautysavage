// C2 — Modèle d'attestation de présence/participation (PRÉPARATION C3). On stocke le modèle, les
// variables disponibles et un HTML de gabarit. AUCUNE génération de document final en C2 (preview
// seulement). Singleton (un modèle actif).
import mongoose from 'mongoose';

export const ATTESTATION_VARIABLES = Object.freeze([
  'clientName',
  'formationName',
  'sessionDate',
  'durationDays',
  'instituteName',
  'issuedAt'
]);

const attestationTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, default: 'Attestation de présence', trim: true },
    html: { type: String, default: '' },
    variables: { type: [String], default: () => [...ATTESTATION_VARIABLES] },
    active: { type: Boolean, default: true }
  },
  {
    timestamps: true,
    collection: 'attestation_templates'
  }
);

const AttestationTemplate = mongoose.model('AttestationTemplate', attestationTemplateSchema);
export default AttestationTemplate;
