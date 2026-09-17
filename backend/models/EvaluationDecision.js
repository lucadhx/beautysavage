// models/EvaluationDecision.js
// FORMATION-EVALUATION — Décision de l'institut sur une tentative (validation / refus).
//
// Chaque décision est IMMUABLE et CONSERVÉE (jamais supprimée) : c'est le socle de l'historique.
// Un refus n'efface pas la décision ni la tentative ; il efface seulement les réponses/fichiers de
// la tentative refusée puis crée une nouvelle tentative. Le commentaire est OBLIGATOIRE (validé côté
// service, pas seulement au niveau schéma).
import mongoose from 'mongoose';

export const DECISION_TYPES = Object.freeze(['accepted', 'refused']);

const evaluationDecisionSchema = new mongoose.Schema(
  {
    attemptId: { type: mongoose.Schema.Types.ObjectId, ref: 'EvaluationAttempt', required: true },
    formationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Formation', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    attemptNumber: { type: Number, default: 1 },
    decision: { type: String, enum: DECISION_TYPES, required: true },
    comment: { type: String, required: true, trim: true },
    // score au moment de la décision (snapshot, visible institut uniquement)
    scorePercent: { type: Number, default: null },
    reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewerName: { type: String, default: '' },
    // lien vers le certificat créé si accepted
    certificateId: { type: String, default: '' }
  },
  { timestamps: true, collection: 'evaluation_decisions' }
);

evaluationDecisionSchema.index({ userId: 1, formationId: 1, createdAt: -1 });
evaluationDecisionSchema.index({ attemptId: 1 });

export default mongoose.models.EvaluationDecision
  || mongoose.model('EvaluationDecision', evaluationDecisionSchema);
