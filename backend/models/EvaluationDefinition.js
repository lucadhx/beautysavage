// models/EvaluationDefinition.js
// FORMATION-EVALUATION — Définition d'évaluation d'une formation (agrégat racine).
//
// Choix d'architecture : une définition = 1 par formation, aggregate root embarquant sections →
// questions → réponses + deliverables. C'est une CONFIG (faible volume, éditée d'un bloc), donc
// l'embedding est le bon compromis (cf. GiftCardTemplate/Formation.options). Le cycle de vie CLIENT
// (tentatives, décisions, certificat) vit dans des collections séparées (EvaluationAttempt /
// EvaluationDecision / Certificate) pour un historique durable et une extensibilité future
// (correction IA, multi-correcteur, jurys) sans refonte.
//
// Le module est OPTIONNEL : une formation sans définition (ou définition inactive) reste 100 %
// valide — aucune régression du parcours d'apprentissage existant.
import mongoose from 'mongoose';

export const QUESTION_TYPES = Object.freeze(['true_false', 'quiz']);
export const QUIZ_MODES = Object.freeze(['single', 'multiple']);
export const DELIVERABLE_TYPES = Object.freeze(['photo_before_after', 'video']);

const answerSchema = new mongoose.Schema(
  {
    text: { type: String, default: '', trim: true },
    correct: { type: Boolean, default: false },
    order: { type: Number, default: 0 }
  },
  { _id: true }
);

const questionSchema = new mongoose.Schema(
  {
    type: { type: String, enum: QUESTION_TYPES, required: true },
    prompt: { type: String, default: '', trim: true },
    required: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    // true_false
    correctBoolean: { type: Boolean, default: true },
    // quiz
    mode: { type: String, enum: QUIZ_MODES, default: 'single' },
    answers: { type: [answerSchema], default: [] }
  },
  { _id: true }
);

const sectionSchema = new mongoose.Schema(
  {
    title: { type: String, default: '', trim: true },
    description: { type: String, default: '', trim: true },
    order: { type: Number, default: 0 },
    questions: { type: [questionSchema], default: [] }
  },
  { _id: true }
);

const deliverableSchema = new mongoose.Schema(
  {
    type: { type: String, enum: DELIVERABLE_TYPES, required: true },
    title: { type: String, default: '', trim: true },
    description: { type: String, default: '', trim: true },
    required: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    // vidéo : durée maximale (secondes), null = pas de limite
    maxDurationSeconds: { type: Number, default: null }
  },
  { _id: true }
);

const evaluationDefinitionSchema = new mongoose.Schema(
  {
    formationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Formation',
      required: true
    },
    // Actif = visible/soumissible par le client. Inactif = le parcours saute l'évaluation.
    active: { type: Boolean, default: false },
    version: { type: Number, default: 1 },
    sections: { type: [sectionSchema], default: [] },
    deliverables: { type: [deliverableSchema], default: [] },
    // Soft delete (jamais de suppression physique d'une définition référencée par des tentatives).
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null }
  },
  { timestamps: true, collection: 'evaluation_definitions' }
);

// Une seule définition par formation.
evaluationDefinitionSchema.index({ formationId: 1 }, { unique: true });

export default mongoose.models.EvaluationDefinition
  || mongoose.model('EvaluationDefinition', evaluationDefinitionSchema);
