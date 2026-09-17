// C2 — Progression formation distancielle. Pas de quiz/score : leçons terminées → % chapitre →
// % formation. Pur (computeProgress) + persistance (markLessonComplete).
import FormationProgress from '../../models/FormationProgress.js';

/**
 * Calcule la progression à partir des chapitres/leçons visibles et de l'ensemble des leçons
 * terminées. Renvoie { formation: {total, done, pct}, chapters: [{chapterId, total, done, pct}] }.
 * Seules les leçons visibles comptent (une leçon cachée ne bloque pas le 100%).
 */
export function computeProgress(chapters, lessons, completedLessonIds = []) {
  const completed = new Set((completedLessonIds || []).map(String));
  const visibleLessons = (lessons || []).filter(l => l.visible !== false);

  const byChapter = new Map();
  for (const lesson of visibleLessons) {
    const key = String(lesson.chapterId);
    if (!byChapter.has(key)) byChapter.set(key, { total: 0, done: 0 });
    const agg = byChapter.get(key);
    agg.total += 1;
    if (completed.has(String(lesson._id || lesson.id))) agg.done += 1;
  }

  const chapterStats = (chapters || [])
    .filter(c => c.visible !== false)
    .map(c => {
      const agg = byChapter.get(String(c._id || c.id)) || { total: 0, done: 0 };
      return {
        chapterId: String(c._id || c.id),
        total: agg.total,
        done: agg.done,
        pct: agg.total > 0 ? Math.round((agg.done / agg.total) * 100) : 0
      };
    });

  const total = visibleLessons.length;
  const done = visibleLessons.filter(l => completed.has(String(l._id || l.id))).length;
  return {
    formation: { total, done, pct: total > 0 ? Math.round((done / total) * 100) : 0 },
    chapters: chapterStats
  };
}

/** Charge (ou crée) la progression d'un client pour une formation. */
export async function getOrCreateProgress(userId, formationId) {
  let doc = await FormationProgress.findOne({ userId, formationId });
  if (!doc) {
    doc = await FormationProgress.create({ userId, formationId, completedLessonIds: [], startedAt: null });
  }
  return doc;
}

/**
 * Marque une leçon terminée (idempotent). Met à jour lastLessonId + startedAt (1re fois).
 * Retourne { progressDoc, justStarted, alreadyCompleted }.
 */
export async function markLessonComplete(userId, formationId, lessonId) {
  const doc = await getOrCreateProgress(userId, formationId);
  const set = new Set(doc.completedLessonIds.map(String));
  const alreadyCompleted = set.has(String(lessonId));
  let justStarted = false;
  if (!doc.startedAt) {
    doc.startedAt = new Date();
    justStarted = true;
  }
  if (!alreadyCompleted) {
    doc.completedLessonIds.push(lessonId);
  }
  doc.lastLessonId = lessonId;
  await doc.save();
  return { progressDoc: doc, justStarted, alreadyCompleted };
}

/**
 * Réévalue la complétion globale : si toutes les leçons visibles sont terminées et que la
 * formation n'était pas marquée terminée, pose completedAt. Retourne { progressDoc, justCompleted, progress }.
 */
export async function refreshCompletion(progressDoc, chapters, lessons) {
  const progress = computeProgress(chapters, lessons, progressDoc.completedLessonIds);
  let justCompleted = false;
  if (progress.formation.total > 0 && progress.formation.pct === 100 && !progressDoc.completedAt) {
    progressDoc.completedAt = new Date();
    await progressDoc.save();
    justCompleted = true;
  }
  return { progressDoc, justCompleted, progress };
}
