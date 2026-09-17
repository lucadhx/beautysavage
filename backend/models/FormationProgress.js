// C2 — Progression client d'une formation distancielle. Pas de quiz / score : seulement les
// leçons terminées → % chapitre → % formation (calcul côté service). Un doc par (user, formation).
import mongoose from 'mongoose';

const formationProgressSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    formationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Formation',
      required: true
    },
    completedLessonIds: {
      type: [mongoose.Schema.Types.ObjectId],
      default: []
    },
    lastLessonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lesson',
      default: null
    },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    // C3 — Attestation générée (PDF). certificateId opaque unique ; chemin local gitignoré.
    attestation: {
      certificateId: { type: String, default: '' },
      generatedAt: { type: Date, default: null }
    }
  },
  {
    timestamps: true,
    collection: 'formation_progress'
  }
);

formationProgressSchema.index({ userId: 1, formationId: 1 }, { unique: true });

const FormationProgress = mongoose.model('FormationProgress', formationProgressSchema);
export default FormationProgress;
