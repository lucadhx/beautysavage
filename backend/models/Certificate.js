// models/Certificate.js
// FORMATION-EVALUATION — Diplôme délivré après validation d'une évaluation.
//
// Le certificat est la CONSÉQUENCE d'une validation, PAS une partie de la définition de la formation.
// Numéro unique opaque + token QR opaque (pour une future vérification d'authenticité — pas d'endpoint
// de vérification dans ce lot). Le PDF est stocké dans storage/certificates/<number>.pdf (gitignoré),
// jamais servi statiquement : téléchargement via endpoint streamé (comme les attestations C3).
import mongoose from 'mongoose';

const certificateSchema = new mongoose.Schema(
  {
    certificateNumber: { type: String, required: true, unique: true, trim: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    formationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Formation', required: true },
    attemptId: { type: mongoose.Schema.Types.ObjectId, ref: 'EvaluationAttempt', default: null },
    decisionId: { type: mongoose.Schema.Types.ObjectId, ref: 'EvaluationDecision', default: null },
    // Token opaque encodé dans le QR (jamais un secret). Sert la vérification future.
    qrToken: { type: String, default: '' },
    // Instantanés (le diplôme reste lisible même si la formation/le client change ensuite).
    clientNameSnapshot: { type: String, default: '' },
    formationNameSnapshot: { type: String, default: '' },
    instituteNameSnapshot: { type: String, default: '' },
    issuedAt: { type: Date, default: Date.now },
    pdfGeneratedAt: { type: Date, default: null },
    reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    revoked: { type: Boolean, default: false }
  },
  { timestamps: true, collection: 'certificates' }
);

certificateSchema.index({ userId: 1, formationId: 1, createdAt: -1 });

export default mongoose.models.Certificate
  || mongoose.model('Certificate', certificateSchema);
