// FORMATION-EVALUATION — Éditeur inline (Questionnaire OU Rendus) d'une formation.
// Édition entièrement inline (pas de popup). Réordonnancement par boutons ↑/↓ (convention : pas de
// dépendance DnD lourde). Les deux onglets partagent le cache TanStack → un enregistrement depuis
// l'un préserve l'autre.
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { LoadingState, ErrorState, Button, FormField, TextInput, TextArea } from '@bs/ui';
import type { EvalSection, EvalQuestion, EvalDeliverable } from '@bs/api-client';
import { useEvaluationDefinition, useEvaluationDefinitionSave } from './useEvaluation';
import './evaluation.css';

let TMP = 0;
const tmpId = () => `tmp-${Date.now()}-${TMP++}`;

function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const copy = arr.slice();
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

/** Case à cocher custom animée (le tick se dessine). Tons : primary (défaut) / success. */
function EvCheck({
  checked,
  onChange,
  label,
  tone = 'primary',
  className = '',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  tone?: 'primary' | 'success';
  className?: string;
}) {
  return (
    <label className={['ev-check', `ev-check--${tone}`, checked ? 'ev-check--on' : '', className].filter(Boolean).join(' ')}>
      <input type="checkbox" className="ev-check__input" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="ev-check__box" aria-hidden="true">
        <svg className="ev-check__tick" viewBox="0 0 16 16" fill="none">
          <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="ev-check__text">{label}</span>
    </label>
  );
}

/** Contrôle segmenté (choix exclusif) avec icône optionnelle. */
function EvSeg<T extends string | boolean>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string; icon?: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="ev-seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={['ev-seg__btn', value === o.value ? 'ev-seg__btn--on' : ''].filter(Boolean).join(' ')}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.icon ? <i className={`bi ${o.icon}`} aria-hidden="true" /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Groupe de boutons-icônes réordonner / supprimer, partagé sections & questions. */
function EvControls({
  onUp,
  onDown,
  onDelete,
}: {
  onUp: () => void;
  onDown: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="ev-controls">
      <button type="button" className="ev-iconbtn" aria-label="Monter" onClick={onUp}>
        <i className="bi bi-chevron-up" aria-hidden="true" />
      </button>
      <button type="button" className="ev-iconbtn" aria-label="Descendre" onClick={onDown}>
        <i className="bi bi-chevron-down" aria-hidden="true" />
      </button>
      <button type="button" className="ev-iconbtn ev-iconbtn--danger" aria-label="Supprimer" onClick={onDelete}>
        <i className="bi bi-trash3" aria-hidden="true" />
      </button>
    </div>
  );
}

export function EvaluationEditor({ formationId, part }: { formationId: string; part: 'questionnaire' | 'deliverables' }) {
  const query = useEvaluationDefinition(formationId);
  const save = useEvaluationDefinitionSave(formationId);

  const [active, setActive] = useState(false);
  const [sections, setSections] = useState<EvalSection[]>([]);
  const [deliverables, setDeliverables] = useState<EvalDeliverable[]>([]);
  const [savedAt, setSavedAt] = useState(0);

  useEffect(() => {
    if (query.data) {
      setActive(query.data.active);
      setSections(query.data.sections || []);
      setDeliverables(query.data.deliverables || []);
    }
  }, [query.data]);

  const onSave = () => {
    // Fusionne avec la partie non éditée (cache partagé garantit la cohérence).
    save.mutate(
      { active, sections, deliverables },
      { onSuccess: () => setSavedAt(Date.now()) }
    );
  };

  const dirty = useMemo(() => {
    if (!query.data) return false;
    return JSON.stringify({ active, sections, deliverables }) !== JSON.stringify({ active: query.data.active, sections: query.data.sections, deliverables: query.data.deliverables });
  }, [active, sections, deliverables, query.data]);

  if (query.status === 'pending') return <LoadingState label="Chargement…" />;
  if (query.status === 'error') return <ErrorState title="Impossible de charger l'évaluation." />;

  const questionCount = sections.reduce((n, s) => n + (s.questions?.length || 0), 0);

  return (
    <div className="ev-editor">
      {part === 'questionnaire' ? (
        <>
          <label className={['ev-activate', active ? 'ev-activate--on' : ''].filter(Boolean).join(' ')}>
            <span className="ev-activate__ic" aria-hidden="true">
              <i className={`bi ${active ? 'bi-eye' : 'bi-eye-slash'}`} />
            </span>
            <span className="ev-activate__body">
              <span className="ev-activate__title">Évaluation active</span>
              <span className="ev-activate__hint">
                {active ? 'Le questionnaire est visible et soumissible par le client.' : 'Masquée : le parcours saute l’évaluation.'}
              </span>
            </span>
            <input
              type="checkbox"
              className="ev-switch"
              role="switch"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              aria-label="Évaluation active (visible par le client)"
            />
          </label>

          <QuestionnaireEditor sections={sections} onChange={setSections} />
        </>
      ) : (
        <DeliverablesEditor deliverables={deliverables} onChange={setDeliverables} />
      )}

      <div className="ev-bar">
        {part === 'questionnaire' ? (
          <span className="ev-bar__count">
            <i className="bi bi-card-checklist" aria-hidden="true" />
            {sections.length} section{sections.length > 1 ? 's' : ''} · {questionCount} question{questionCount > 1 ? 's' : ''}
          </span>
        ) : (
          <span className="ev-bar__count">
            <i className="bi bi-collection" aria-hidden="true" />
            {deliverables.length} rendu{deliverables.length > 1 ? 's' : ''}
          </span>
        )}
        <span className="ev-bar__spacer" />
        {savedAt > 0 && !dirty ? (
          <span className="ev-bar__saved">
            <i className="bi bi-check-circle-fill" aria-hidden="true" /> Enregistré
          </span>
        ) : null}
        {save.isError ? (
          <span className="ev-bar__error" role="alert">
            <i className="bi bi-exclamation-triangle-fill" aria-hidden="true" /> Échec de l'enregistrement.
          </span>
        ) : null}
        <Button type="button" disabled={!dirty || save.isPending} onClick={onSave}>
          {save.isPending ? (
            <>
              <span className="bs-spinner" aria-hidden="true" /> Enregistrement…
            </>
          ) : (
            <>
              <i className="bi bi-save" aria-hidden="true" /> Enregistrer
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function QuestionnaireEditor({ sections, onChange }: { sections: EvalSection[]; onChange: (s: EvalSection[]) => void }) {
  const patch = (i: number, next: Partial<EvalSection>) => onChange(sections.map((s, k) => (k === i ? { ...s, ...next } : s)));
  const addSection = () => onChange([...sections, { _id: tmpId(), title: 'Nouvelle section', description: '', order: sections.length, questions: [] }]);

  if (sections.length === 0) {
    return (
      <div className="ev-sections">
        <div className="ev-empty">
          <span className="ev-empty__ic" aria-hidden="true">
            <i className="bi bi-ui-checks" />
          </span>
          <p className="ev-empty__title">Aucune question pour l'instant</p>
          <p className="ev-empty__hint">Créez une première section pour regrouper vos questions par thème (théorie, hygiène, gestes techniques…).</p>
          <Button type="button" onClick={addSection}>
            <i className="bi bi-plus-lg" aria-hidden="true" /> Ajouter une section
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="ev-sections">
      {sections.map((section, si) => (
        <section key={section._id || si} className="ev-card bs-anim-entrance">
          <header className="ev-card__head">
            <span className="ev-card__ic" aria-hidden="true">
              <i className="bi bi-collection" />
            </span>
            <input
              className="ev-title-input"
              value={section.title}
              onChange={(e) => patch(si, { title: e.target.value })}
              placeholder="Titre de la section"
              aria-label="Titre de la section"
            />
            <EvControls
              onUp={() => onChange(move(sections, si, -1))}
              onDown={() => onChange(move(sections, si, 1))}
              onDelete={() => onChange(sections.filter((_, k) => k !== si))}
            />
          </header>
          <input
            className="ev-subtle-input"
            value={section.description || ''}
            onChange={(e) => patch(si, { description: e.target.value })}
            placeholder="Description de la section (optionnelle)"
            aria-label="Description de la section"
          />
          <QuestionsEditor questions={section.questions} onChange={(q) => patch(si, { questions: q })} />
        </section>
      ))}
      <button type="button" className="ev-add ev-add--block" onClick={addSection}>
        <i className="bi bi-plus-lg" aria-hidden="true" /> Ajouter une section
      </button>
    </div>
  );
}

function QuestionsEditor({ questions, onChange }: { questions: EvalQuestion[]; onChange: (q: EvalQuestion[]) => void }) {
  const patch = (i: number, next: Partial<EvalQuestion>) => onChange(questions.map((q, k) => (k === i ? { ...q, ...next } : q)));
  const addTF = () => onChange([...questions, { _id: tmpId(), type: 'true_false', prompt: '', required: true, correctBoolean: true, order: questions.length }]);
  const addQuiz = () => onChange([...questions, { _id: tmpId(), type: 'quiz', prompt: '', required: true, mode: 'single', order: questions.length, answers: [{ _id: tmpId(), text: '', correct: true, order: 0 }, { _id: tmpId(), text: '', correct: false, order: 1 }] }]);

  return (
    <div className="ev-questions">
      {questions.map((q, qi) => (
        <article key={q._id || qi} className="ev-q bs-anim-entrance">
          <div className="ev-q__head">
            <span className="ev-q__index">{qi + 1}</span>
            <span className={['ev-q__type', q.type === 'true_false' ? 'ev-q__type--tf' : 'ev-q__type--quiz'].join(' ')}>
              <i className={`bi ${q.type === 'true_false' ? 'bi-toggle-on' : 'bi-list-check'}`} aria-hidden="true" />
              {q.type === 'true_false' ? 'Vrai/Faux' : `Quiz ${q.mode === 'multiple' ? 'multi' : 'mono'}`}
            </span>
            <span className="ev-q__spacer" />
            <EvControls
              onUp={() => onChange(move(questions, qi, -1))}
              onDown={() => onChange(move(questions, qi, 1))}
              onDelete={() => onChange(questions.filter((_, k) => k !== qi))}
            />
          </div>

          <TextInput
            className="ev-q__prompt"
            value={q.prompt}
            onChange={(e) => patch(qi, { prompt: e.target.value })}
            placeholder="Énoncé de la question"
            aria-label="Énoncé de la question"
          />

          {q.type === 'true_false' ? (
            <div className="ev-field">
              <span className="ev-field__label">Bonne réponse</span>
              <EvSeg
                ariaLabel="Bonne réponse"
                value={Boolean(q.correctBoolean)}
                onChange={(v) => patch(qi, { correctBoolean: v })}
                options={[
                  { value: true, label: 'Vrai', icon: 'bi-check-lg' },
                  { value: false, label: 'Faux', icon: 'bi-x-lg' },
                ]}
              />
            </div>
          ) : (
            <>
              <div className="ev-field">
                <span className="ev-field__label">Type de réponse</span>
                <EvSeg
                  ariaLabel="Type de réponse"
                  value={q.mode === 'multiple' ? 'multiple' : 'single'}
                  onChange={(v) => patch(qi, { mode: v as 'single' | 'multiple' })}
                  options={[
                    { value: 'single', label: 'Une seule', icon: 'bi-record-circle' },
                    { value: 'multiple', label: 'Plusieurs', icon: 'bi-check2-square' },
                  ]}
                />
                <span className="ev-field__hint">Cochez la ou les réponses correctes ci-dessous.</span>
              </div>
              <div className="ev-answers">
                {(q.answers || []).map((a, ai) => (
                  <div key={a._id || ai} className={['ev-answer', a.correct ? 'ev-answer--ok' : ''].filter(Boolean).join(' ')}>
                    <EvCheck
                      tone="success"
                      className="ev-answer__check"
                      checked={a.correct}
                      onChange={(v) => patch(qi, { answers: (q.answers || []).map((x, k) => (k === ai ? { ...x, correct: v } : x)) })}
                      label={<span className="ev-answer__ok-label">{a.correct ? 'Correcte' : 'Marquer correcte'}</span>}
                    />
                    <input
                      className="ev-answer__text"
                      value={a.text}
                      onChange={(e) => patch(qi, { answers: (q.answers || []).map((x, k) => (k === ai ? { ...x, text: e.target.value } : x)) })}
                      placeholder={`Réponse ${ai + 1}`}
                      aria-label={`Réponse ${ai + 1}`}
                    />
                    <button
                      type="button"
                      className="ev-iconbtn ev-iconbtn--danger"
                      aria-label="Supprimer la réponse"
                      onClick={() => patch(qi, { answers: (q.answers || []).filter((_, k) => k !== ai) })}
                    >
                      <i className="bi bi-x-lg" aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="ev-add"
                  onClick={() => patch(qi, { answers: [...(q.answers || []), { _id: tmpId(), text: '', correct: false, order: (q.answers || []).length }] })}
                >
                  <i className="bi bi-plus-lg" aria-hidden="true" /> réponse
                </button>
              </div>
            </>
          )}

          <div className="ev-q__foot">
            <EvCheck
              checked={q.required}
              onChange={(v) => patch(qi, { required: v })}
              label="Réponse obligatoire"
            />
          </div>
        </article>
      ))}
      <div className="ev-q-add">
        <button type="button" className="ev-add" aria-label="Ajouter une question Vrai/Faux" onClick={addTF}>
          <i className="bi bi-plus-lg" aria-hidden="true" /> Vrai/Faux
        </button>
        <button type="button" className="ev-add" aria-label="Ajouter une question Quiz" onClick={addQuiz}>
          <i className="bi bi-plus-lg" aria-hidden="true" /> Quiz
        </button>
      </div>
    </div>
  );
}

function DeliverablesEditor({ deliverables, onChange }: { deliverables: EvalDeliverable[]; onChange: (d: EvalDeliverable[]) => void }) {
  const patch = (i: number, next: Partial<EvalDeliverable>) => onChange(deliverables.map((d, k) => (k === i ? { ...d, ...next } : d)));
  const addPhoto = () => onChange([...deliverables, { _id: tmpId(), type: 'photo_before_after', title: 'Photo avant / après', description: '', required: true, order: deliverables.length }]);
  const addVideo = () => onChange([...deliverables, { _id: tmpId(), type: 'video', title: 'Vidéo', description: '', required: true, order: deliverables.length, maxDurationSeconds: 120 }]);

  return (
    <div className="ev-sections">
      {deliverables.length === 0 ? (
        <div className="ev-empty">
          <span className="ev-empty__ic" aria-hidden="true">
            <i className="bi bi-camera" />
          </span>
          <p className="ev-empty__title">Aucun rendu demandé</p>
          <p className="ev-empty__hint">Demandez au client une preuve de sa pratique : photo avant/après ou courte vidéo du geste réalisé.</p>
        </div>
      ) : null}
      {deliverables.map((d, di) => (
        <section key={d._id || di} className="ev-card bs-anim-entrance">
          <header className="ev-card__head">
            <span className="ev-card__ic" aria-hidden="true">
              <i className={`bi ${d.type === 'photo_before_after' ? 'bi-images' : 'bi-camera-video'}`} />
            </span>
            <span className="ev-q__type ev-q__type--quiz">
              {d.type === 'photo_before_after' ? 'Photo avant/après' : 'Vidéo'}
            </span>
            <span className="ev-q__spacer" />
            <EvControls
              onUp={() => onChange(move(deliverables, di, -1))}
              onDown={() => onChange(move(deliverables, di, 1))}
              onDelete={() => onChange(deliverables.filter((_, k) => k !== di))}
            />
          </header>
          <TextInput value={d.title} onChange={(e) => patch(di, { title: e.target.value })} placeholder="Titre du rendu" aria-label="Titre du rendu" />
          <TextArea value={d.description || ''} onChange={(e) => patch(di, { description: e.target.value })} placeholder="Consigne pour le client (optionnelle)" rows={2} aria-label="Consigne" />
          {d.type === 'video' ? (
            <FormField label="Durée maximale (secondes)" hint="Laissez vide pour ne pas limiter la durée.">
              <TextInput type="number" min={0} value={String(d.maxDurationSeconds ?? '')} onChange={(e) => patch(di, { maxDurationSeconds: e.target.value ? Number(e.target.value) : null })} />
            </FormField>
          ) : null}
          <div className="ev-q__foot">
            <EvCheck checked={d.required} onChange={(v) => patch(di, { required: v })} label="Rendu obligatoire" />
          </div>
        </section>
      ))}
      <div className="ev-q-add">
        <button type="button" className="ev-add" onClick={addPhoto}>
          <i className="bi bi-plus-lg" aria-hidden="true" /> Photo avant/après
        </button>
        <button type="button" className="ev-add" onClick={addVideo}>
          <i className="bi bi-plus-lg" aria-hidden="true" /> Vidéo
        </button>
      </div>
    </div>
  );
}
