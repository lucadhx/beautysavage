// models/EvaluationAttempt.js
// FORMATION-EVALUATION — Tentative d'évaluation d'un client (cycle de vie).
//
// Une tentative = un passage client (questionnaire + rendus) pour une formation. Statuts :
//   in_progress → submitted → (accepted | refused).
// Sur REFUS : la tentative reste (historique), ses réponses + fichiers sont EFFACÉS (scrub), et une
// NOUVELLE tentative (attemptNumber+1, in_progress) est créée. L'historique complet est reconstituable
// via les tentatives + les EvaluationDecision.
//
// Le SCORE n'est jamais stocké ici : il est calculé côté institut à la demande (le client ne doit
// jamais voir score / bonnes réponses).
import mongoose from 'mongoose';

export const ATTEMPT_STATUSES = Object.freeze(['in_progress', 'submitted', 'accepted', 'refused']);
export const DELIVERABLE_FILE_KINDS = Object.freeze(['before', 'after', 'video']);

const answerSchema = new mongoose.Schema(
  {
    sectionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    type: { type: String, default: '' },
    // true_false
    booleanValue: { type: Boolean, default: null },
    // quiz (single → 1 élément ; multiple → n)
    selectedAnswerIds: { type: [mongoose.Schema.Types.ObjectId], default: [] }
  },
  { _id: false }
);

const deliverableFileSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: DELIVERABLE_FILE_KINDS, required: true },
    url: { type: String, required: true },
    mime: { type: String, default: '' },
    size: { type: Number, default: 0 },
    uploadedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const attemptDeliverableSchema = new mongoose.Schema(
  {
    deliverableId: { type: mongoose.Schema.Types.ObjectId, required: true },
    type: { type: String, default: '' },
    files: { type: [deliverableFileSchema], default: [] }
  },
  { _id: false }
);

const evaluationAttemptSchema = new mongoose.Schema(
  {
    formationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Formation', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'FormationSession', default: null },
    definitionId: { type: mongoose.Schema.Types.ObjectId, ref: 'EvaluationDefinition', default: null },
    definitionVersion: { type: Number, default: 1 },
    attemptNumber: { type: Number, default: 1 },
    status: { type: String, enum: ATTEMPT_STATUSES, default: 'in_progress' },
    answers: { type: [answerSchema], default: [] },
    deliverables: { type: [attemptDeliverableSchema], default: [] },
    questionnaireCompletedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    // rempli au moment de la décision (dénormalisation pratique pour les listes institut)
    decidedAt: { type: Date, default: null }
  },
  { timestamps: true, collection: 'evaluation_attempts' }
);

evaluationAttemptSchema.index({ formationId: 1, userId: 1, attemptNumber: 1 });
evaluationAttemptSchema.index({ status: 1, submittedAt: -1 });
// Au plus UNE tentative in_progress par (formation, client) — évite les doublons de reprise.
evaluationAttemptSchema.index(
  { formationId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { status: 'in_progress' } }
);

export default mongoose.models.EvaluationAttempt
  || mongoose.model('EvaluationAttempt', evaluationAttemptSchema);
