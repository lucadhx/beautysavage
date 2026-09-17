// C2 — Learning Studio : chapitre d'une formation distancielle. Niveau intermédiaire
// Formation → **Chapitre** → Leçon → Ressource. Additif : ne remplace pas FormationModule (legacy
// Vanilla) ; le nouveau parcours pédagogique React utilise Chapter + Lesson.
import mongoose from 'mongoose';

const chapterSchema = new mongoose.Schema(
  {
    formationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Formation',
      required: true
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    order: { type: Number, default: 0 },
    visible: { type: Boolean, default: true }
  },
  {
    timestamps: true,
    collection: 'chapters'
  }
);

chapterSchema.index({ formationId: 1, order: 1 });

const Chapter = mongoose.model('Chapter', chapterSchema);
export default Chapter;
