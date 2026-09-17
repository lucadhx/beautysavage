// C2 — Learning Studio : leçon d'un chapitre. Pas de quiz / note / examen. Vidéo = embed only
// (jamais d'upload). Ressources embarquées (PDF / lien / document).
import mongoose from 'mongoose';

export const LESSON_RESOURCE_TYPES = Object.freeze(['pdf', 'link', 'document']);

const resourceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: LESSON_RESOURCE_TYPES, default: 'link' },
    url: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    order: { type: Number, default: 0 },
    visible: { type: Boolean, default: true }
  },
  { _id: true }
);

const lessonSchema = new mongoose.Schema(
  {
    formationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Formation',
      required: true
    },
    chapterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Chapter',
      required: true
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    // Embed uniquement (YouTube/Vimeo/Loom/Wistia/iframe générique). Jamais d'upload vidéo.
    videoUrl: { type: String, default: '', trim: true },
    resources: { type: [resourceSchema], default: [] },
    order: { type: Number, default: 0 },
    visible: { type: Boolean, default: true },
    // Leçon offerte (aperçu gratuit hors achat).
    isFree: { type: Boolean, default: false },
    estimatedMinutes: { type: Number, default: 0, min: 0 }
  },
  {
    timestamps: true,
    collection: 'lessons'
  }
);

lessonSchema.index({ formationId: 1, chapterId: 1, order: 1 });

const Lesson = mongoose.model('Lesson', lessonSchema);
export default Lesson;
