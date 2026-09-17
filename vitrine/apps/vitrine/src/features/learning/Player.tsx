// C2 — Lecteur de formation distancielle (vitrine, mobile-first). En moins de 3 clics : ouvrir →
// lancer la vidéo → terminer → continuer. Desktop : navigation gauche + vidéo droite. Mobile :
// vidéo en haut, bouton terminé, leçon suivante, accordion en dessous. Confetti léger à 100%.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LessonEmbed, LoadingState, ErrorState } from '@bs/ui';
import type { LearnerLesson } from '@bs/api-client';
import { attestationDownloadUrl } from '@bs/api-client';
import { useMyLearningFormation, useCompleteLesson } from './hooks';
import { Confetti } from './Confetti';
import { EvaluationFlow } from '../evaluation/EvaluationFlow';
import './learning.css';

const RESOURCE_ICON: Record<string, string> = { pdf: 'bi-file-earmark-pdf', link: 'bi-link-45deg', document: 'bi-file-earmark-text' };

export function FormationPlayer({ formationId }: { formationId: string }) {
  const query = useMyLearningFormation(formationId);
  const complete = useCompleteLesson(formationId);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [wasComplete, setWasComplete] = useState(false);

  // Liste ordonnée des leçons (chapitre.ordre puis leçon.ordre).
  const orderedLessons = useMemo<LearnerLesson[]>(() => {
    if (!query.data) return [];
    const chapterOrder = new Map(query.data.chapters.map((c) => [c.id, c.order]));
    return [...query.data.lessons].sort((a, b) => {
      const ca = chapterOrder.get(a.chapterId) ?? 0;
      const cb = chapterOrder.get(b.chapterId) ?? 0;
      return ca !== cb ? ca - cb : a.order - b.order;
    });
  }, [query.data]);

  // Leçon active par défaut = dernière vue, sinon première.
  useEffect(() => {
    if (!activeId && orderedLessons.length > 0 && query.data) {
      setActiveId(query.data.progress.lastLessonId || orderedLessons[0].id);
    }
  }, [activeId, orderedLessons, query.data]);

  if (query.isPending) return <LoadingState label="Chargement de la formation…" />;
  if (query.isError || !query.data) {
    return <ErrorState title="Formation indisponible." detail="Connectez-vous avec le compte ayant acquis la formation." />;
  }

  const { formation, chapters, progress } = query.data;
  const completed = new Set(progress.completedLessonIds);
  const activeLesson = orderedLessons.find((l) => l.id === activeId) || orderedLessons[0] || null;
  const activeIndex = activeLesson ? orderedLessons.findIndex((l) => l.id === activeLesson.id) : -1;
  const nextLesson = activeIndex >= 0 ? orderedLessons[activeIndex + 1] : undefined;
  const prevLesson = activeIndex > 0 ? orderedLessons[activeIndex - 1] : undefined;
  const isComplete = Boolean(progress.completedAt);

  function markDone() {
    if (!activeLesson) return;
    complete.mutate(activeLesson.id, {
      onSuccess: (p) => {
        if (p.completedAt && !wasComplete) { setWasComplete(true); setShowConfetti(true); }
        if (nextLesson) setActiveId(nextLesson.id);
      },
    });
  }

  const lessonsByChapter = (chapterId: string) => orderedLessons.filter((l) => l.chapterId === chapterId);

  const nav = (
    <nav className="bs-lrn__nav" aria-label="Chapitres">
      {chapters.map((ch) => (
        <details key={ch.id} className="bs-lrn__chapter" open>
          <summary className="bs-lrn__chaptertitle">{ch.title}</summary>
          <ul className="bs-lrn__lessons">
            {lessonsByChapter(ch.id).map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  className={`bs-lrn__lesson${l.id === activeLesson?.id ? ' bs-lrn__lesson--active' : ''}`}
                  onClick={() => setActiveId(l.id)}
                >
                  <i className={`bi ${completed.has(l.id) ? 'bi-check-circle-fill' : 'bi-circle'}`} aria-hidden="true" />
                  <span>{l.title}</span>
                  {l.estimatedMinutes ? <span className="bs-lrn__min">{l.estimatedMinutes} min</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </nav>
  );

  return (
    <article className="bs-lrn">
      {showConfetti ? <Confetti onDone={() => setShowConfetti(false)} /> : null}
      <div className="bs-lrn__head">
        <Link to="/mes-formations" className="bs-lrn__back">← Mes formations</Link>
        <h1 className="bs-lrn__title">{formation.name}</h1>
        <div className="bs-lrn__progress" role="progressbar" aria-valuenow={progress.formationPct} aria-valuemin={0} aria-valuemax={100}>
          <span className="bs-lrn__progressbar" style={{ width: `${progress.formationPct}%` }} />
        </div>
        <span className="bs-lrn__pct">{progress.formationPct}% terminé</span>
        {isComplete ? (
          <a className="bs-btn bs-lrn__attestation" href={attestationDownloadUrl(formation.id)} target="_blank" rel="noreferrer">
            <i className="bi bi-award" aria-hidden="true" /> Télécharger l'attestation
          </a>
        ) : null}
      </div>

      <div className="bs-lrn__layout">
        <div className="bs-lrn__main">
          {activeLesson ? (
            <>
              <LessonEmbed url={activeLesson.videoUrl} title={activeLesson.title} />
              <h2 className="bs-lrn__lessontitle">{activeLesson.title}</h2>
              {activeLesson.description ? <p className="bs-lrn__desc">{activeLesson.description}</p> : null}

              {activeLesson.resources.length > 0 ? (
                <div className="bs-lrn__resources">
                  <h3 className="bs-lrn__restitle">Téléchargements</h3>
                  {activeLesson.resources.map((r) => (
                    <a key={r.id} href={r.url} target="_blank" rel="noreferrer" className="bs-lrn__resource">
                      <i className={`bi ${RESOURCE_ICON[r.type] || 'bi-paperclip'}`} aria-hidden="true" />
                      <span>{r.name}</span>
                      <i className="bi bi-download" aria-hidden="true" />
                    </a>
                  ))}
                </div>
              ) : null}

              <div className="bs-lrn__actions">
                {prevLesson ? (
                  <button type="button" className="bs-btn bs-btn--secondary" onClick={() => setActiveId(prevLesson.id)} aria-label="Leçon précédente">
                    <i className="bi bi-arrow-left" aria-hidden="true" />
                  </button>
                ) : null}
                <button type="button" className="bs-btn" disabled={complete.isPending} onClick={markDone}>
                  <i className="bi bi-check-lg" aria-hidden="true" /> {completed.has(activeLesson.id) ? 'Revoir comme terminé' : "J'ai terminé"}
                </button>
                {nextLesson ? (
                  <button type="button" className="bs-btn bs-btn--secondary" onClick={() => setActiveId(nextLesson.id)}>
                    Leçon suivante <i className="bi bi-arrow-right" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <p className="bs-lrn__empty">Cette formation n’a pas encore de contenu.</p>
          )}
        </div>
        <aside className="bs-lrn__aside">{nav}</aside>
      </div>
      {isComplete ? <EvaluationFlow formationId={formation.id} /> : null}
    </article>
  );
}
