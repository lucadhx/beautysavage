// C2 — Learning Studio : édition Chapitres → Leçons → Ressources. Mobile-first : accordion de
// chapitres, chaque leçon ouvre un drawer (réutilise le pattern drawer cat-). Vidéo = embed only
// (LessonEmbed preview). Aucun tableau, tokens --bs-* only.
import { useState } from 'react';
import { LessonEmbed, isValidEmbed } from '@bs/ui';
import type { LearningLesson, LearningResource, LearningResourceType, LearningLessonInput } from '@bs/api-client';
import { CatField, CatalogueEmptyState, CatalogueSkeleton, CatalogueVisibilityToggle } from '../components';
import { useLearningTree, useLearningMutations } from './useLearning';
import './learning.css';

const RESOURCE_TYPES: { value: LearningResourceType; label: string; icon: string }[] = [
  { value: 'pdf', label: 'PDF', icon: 'bi-file-earmark-pdf' },
  { value: 'link', label: 'Lien', icon: 'bi-link-45deg' },
  { value: 'document', label: 'Document', icon: 'bi-file-earmark-text' },
];

// ── Ressources d'une leçon ──────────────────────────────────────────────────────
function ResourceList({ resources, onChange }: { resources: LearningResource[]; onChange: (r: LearningResource[]) => void }) {
  const add = () => onChange([...resources, { name: '', type: 'link', url: '', description: '', order: resources.length + 1, visible: true }]);
  const patch = (i: number, p: Partial<LearningResource>) => onChange(resources.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  return (
    <div className="lrn-resources">
      {resources.map((r, i) => (
        <div key={i} className="lrn-resource">
          <div className="cat-form__row">
            <input className="cat-input" placeholder="Nom" value={r.name} onChange={(e) => patch(i, { name: e.target.value })} />
            <select className="cat-input cat-input--narrow" value={r.type} onChange={(e) => patch(i, { type: e.target.value as LearningResourceType })}>
              {RESOURCE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <input className="cat-input" placeholder="URL (https://…)" value={r.url} onChange={(e) => patch(i, { url: e.target.value })} />
          <button type="button" className="cat-iconbtn" aria-label="Retirer la ressource" onClick={() => onChange(resources.filter((_, idx) => idx !== i))}>
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>
      ))}
      <button type="button" className="cat-btn cat-btn--ghost" onClick={add}><i className="bi bi-plus-lg" aria-hidden="true" /> Ajouter une ressource</button>
    </div>
  );
}

// ── Drawer d'édition d'une leçon ─────────────────────────────────────────────────
function LessonDrawer({ lesson, onClose, onSave, onDelete, busy }: {
  lesson: LearningLesson;
  onClose: () => void;
  onSave: (input: LearningLessonInput) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<LearningLesson>(lesson);
  const set = <K extends keyof LearningLesson>(k: K, v: LearningLesson[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const embedOk = !draft.videoUrl || isValidEmbed(draft.videoUrl);
  return (
    <>
      <div className="cat-overlay" onClick={onClose} aria-hidden="true" />
      <div className="cat-drawer" role="dialog" aria-modal="true" aria-label="Édition leçon" data-testid="lrn-lesson-drawer">
        <div className="cat-drawer__head">
          <span className="cat-drawer__title">Leçon</span>
          <button type="button" className="cat-iconbtn" onClick={onClose} aria-label="Fermer"><i className="bi bi-x-lg" aria-hidden="true" /></button>
        </div>
        <div className="cat-drawer__body">
          <CatField label="Titre" required>
            <input className="cat-input" value={draft.title} onChange={(e) => set('title', e.target.value)} />
          </CatField>
          <CatField label="Description">
            <textarea className="cat-textarea" rows={3} value={draft.description} onChange={(e) => set('description', e.target.value)} />
          </CatField>
          <CatField label="Vidéo (embed YouTube / Vimeo / Loom / Wistia)" error={!embedOk ? 'URL non reconnue.' : undefined}>
            <input className="cat-input" value={draft.videoUrl} onChange={(e) => set('videoUrl', e.target.value)} placeholder="https://youtu.be/…" />
          </CatField>
          {draft.videoUrl ? <LessonEmbed url={draft.videoUrl} title={draft.title} /> : null}
          <div className="cat-form__row">
            <CatField label="Durée estimée (min)">
              <input className="cat-input" type="number" min={0} value={draft.estimatedMinutes} onChange={(e) => set('estimatedMinutes', Number(e.target.value))} />
            </CatField>
          </div>
          <CatalogueVisibilityToggle checked={draft.visible} onChange={(v) => set('visible', v)} label="Leçon visible" />
          <CatalogueVisibilityToggle checked={draft.isFree} onChange={(v) => set('isFree', v)} label="Leçon offerte (aperçu gratuit)" />
          <h4 className="lrn-subtitle">Ressources</h4>
          <ResourceList resources={draft.resources} onChange={(r) => set('resources', r)} />
          <div className="lrn-draweractions">
            <button type="button" className="cat-btn cat-btn--ghost" onClick={onDelete}><i className="bi bi-trash" aria-hidden="true" /> Supprimer</button>
            <button type="button" className="cat-btn cat-btn--primary" disabled={busy || !draft.title.trim()} onClick={() => onSave({
              title: draft.title, description: draft.description, videoUrl: draft.videoUrl,
              estimatedMinutes: draft.estimatedMinutes, visible: draft.visible, isFree: draft.isFree, resources: draft.resources,
            })}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </div>
      </div>
    </>
  );
}

// Réordonne une liste d'ids en déplaçant l'élément `index` de `dir` (-1 haut, +1 bas).
function movedOrder(ids: string[], index: number, dir: number): string[] | null {
  const next = index + dir;
  if (next < 0 || next >= ids.length) return null;
  const copy = [...ids];
  [copy[index], copy[next]] = [copy[next], copy[index]];
  return copy;
}

// ── Éditeur principal : accordion de chapitres ───────────────────────────────────
export function ChapterEditor({ formationId }: { formationId: string }) {
  const tree = useLearningTree(formationId);
  const m = useLearningMutations(formationId);
  const [openChapter, setOpenChapter] = useState<string | null>(null);
  const [editingLesson, setEditingLesson] = useState<LearningLesson | null>(null);
  const [newChapterTitle, setNewChapterTitle] = useState('');

  if (tree.status === 'pending') return <CatalogueSkeleton rows={3} />;
  const chapters = [...(tree.data?.chapters ?? [])].sort((a, b) => a.order - b.order);
  const lessons = tree.data?.lessons ?? [];
  const lessonsOf = (chapterId: string) => lessons.filter((l) => l.chapterId === chapterId).sort((a, b) => a.order - b.order);
  const chapterIds = chapters.map((c) => c.id);

  function moveChapter(index: number, dir: number) {
    const next = movedOrder(chapterIds, index, dir);
    if (next) m.reorderChapters.mutate(next);
  }
  function moveLesson(chapterId: string, index: number, dir: number) {
    const ids = lessonsOf(chapterId).map((l) => l.id);
    const next = movedOrder(ids, index, dir);
    if (next) m.reorderLessons.mutate(next);
  }

  return (
    <div className="lrn-editor">
      <div className="lrn-addchapter">
        <input className="cat-input" placeholder="Nouveau chapitre…" value={newChapterTitle} onChange={(e) => setNewChapterTitle(e.target.value)} />
        <button type="button" className="cat-btn cat-btn--primary" disabled={!newChapterTitle.trim() || m.createChapter.isPending} onClick={() => {
          m.createChapter.mutate({ title: newChapterTitle.trim() });
          setNewChapterTitle('');
        }}><i className="bi bi-plus-lg" aria-hidden="true" /> Chapitre</button>
      </div>

      {chapters.length === 0 ? (
        <CatalogueEmptyState icon="bi-collection-play" title="Aucun chapitre" description="Ajoutez un premier chapitre pour structurer la formation." />
      ) : (
        <div className="lrn-chapters">
          {chapters.map((ch, chIndex) => {
            const open = openChapter === ch.id;
            const chLessons = lessonsOf(ch.id);
            return (
              <section key={ch.id} className="lrn-chapter">
                <button type="button" className="lrn-chapter__head" aria-expanded={open} onClick={() => setOpenChapter(open ? null : ch.id)}>
                  <i className={`bi ${open ? 'bi-chevron-down' : 'bi-chevron-right'}`} aria-hidden="true" />
                  <span className="lrn-chapter__title">{ch.title}</span>
                  <span className="lrn-chapter__count">{chLessons.length} leçon{chLessons.length > 1 ? 's' : ''}</span>
                  {!ch.visible ? <i className="bi bi-eye-slash lrn-chapter__hidden" aria-label="Chapitre masqué" /> : null}
                </button>
                {open ? (
                  <div className="lrn-chapter__body">
                    <div className="lrn-lessons">
                      {chLessons.map((l, lIndex) => (
                        <div key={l.id} className="lrn-lessonrow">
                          <button type="button" className="lrn-lessoncard" onClick={() => setEditingLesson(l)} data-testid="lrn-lessoncard">
                            <i className="bi bi-play-circle" aria-hidden="true" />
                            <span className="lrn-lessoncard__title">{l.title}</span>
                            {l.estimatedMinutes ? <span className="lrn-lessoncard__min">{l.estimatedMinutes} min</span> : null}
                            {l.isFree ? <span className="lrn-lessoncard__free">Offert</span> : null}
                          </button>
                          <span className="lrn-reorder">
                            <button type="button" className="cat-iconbtn" aria-label="Monter la leçon" disabled={lIndex === 0} onClick={() => moveLesson(ch.id, lIndex, -1)}><i className="bi bi-arrow-up" aria-hidden="true" /></button>
                            <button type="button" className="cat-iconbtn" aria-label="Descendre la leçon" disabled={lIndex === chLessons.length - 1} onClick={() => moveLesson(ch.id, lIndex, 1)}><i className="bi bi-arrow-down" aria-hidden="true" /></button>
                          </span>
                        </div>
                      ))}
                      <button type="button" className="cat-btn cat-btn--ghost" onClick={() => m.createLesson.mutate({ chapterId: ch.id, title: 'Nouvelle leçon' })}>
                        <i className="bi bi-plus-lg" aria-hidden="true" /> Ajouter une leçon
                      </button>
                    </div>
                    <div className="lrn-chapteractions">
                      <CatalogueVisibilityToggle checked={ch.visible} onChange={(v) => m.updateChapter.mutate({ id: ch.id, input: { visible: v } })} label="Chapitre visible" />
                      <span className="lrn-reorder">
                        <button type="button" className="cat-iconbtn" aria-label="Monter le chapitre" disabled={chIndex === 0} onClick={() => moveChapter(chIndex, -1)}><i className="bi bi-arrow-up" aria-hidden="true" /></button>
                        <button type="button" className="cat-iconbtn" aria-label="Descendre le chapitre" disabled={chIndex === chapters.length - 1} onClick={() => moveChapter(chIndex, 1)}><i className="bi bi-arrow-down" aria-hidden="true" /></button>
                        <button type="button" className="cat-iconbtn" aria-label="Supprimer le chapitre" onClick={() => m.deleteChapter.mutate(ch.id)}><i className="bi bi-trash" aria-hidden="true" /></button>
                      </span>
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      {editingLesson ? (
        <LessonDrawer
          lesson={editingLesson}
          busy={m.updateLesson.isPending}
          onClose={() => setEditingLesson(null)}
          onSave={(input) => { m.updateLesson.mutate({ id: editingLesson.id, input }); setEditingLesson(null); }}
          onDelete={() => { m.deleteLesson.mutate(editingLesson.id); setEditingLesson(null); }}
        />
      ) : null}
    </div>
  );
}
