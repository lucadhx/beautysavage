// FORMATION-EVALUATION — Parcours client : questionnaire → rendus → récapitulatif → soumission.
// Le client ne voit aucun score ni bonne réponse. États : diplôme obtenu / transmis / à recommencer.
import { useEffect, useMemo, useState } from 'react';
import { LoadingState, ErrorState, Button } from '@bs/ui';
import { clientCertificateUrl, type ClientEvalDefinition, type ClientAttempt } from '@bs/api-client';
import { useClientEvaluation, useEvaluationActions } from './hooks';
import './evaluation.css';

type Step = 'questionnaire' | 'deliverables' | 'summary';
type AnswerMap = Record<string, { booleanValue: boolean | null; selectedAnswerIds: string[] }>;

function initAnswers(attempt: ClientAttempt | null): AnswerMap {
  const map: AnswerMap = {};
  for (const a of attempt?.answers || []) map[a.questionId] = { booleanValue: a.booleanValue, selectedAnswerIds: a.selectedAnswerIds || [] };
  return map;
}

export function EvaluationFlow({ formationId }: { formationId: string }) {
  const query = useClientEvaluation(formationId);
  const actions = useEvaluationActions(formationId);
  const [step, setStep] = useState<Step>('questionnaire');
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const state = query.data;
  const attempt = state?.attempt ?? null;
  useEffect(() => { if (attempt) setAnswers(initAnswers(attempt)); }, [attempt?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastDecision = useMemo(() => (state?.decisions?.length ? state.decisions[state.decisions.length - 1] : null), [state]);

  if (query.status === 'pending') return <LoadingState label="Chargement de l'évaluation…" />;
  if (query.status === 'error') return <ErrorState title="Évaluation indisponible." />;
  if (!state?.hasEvaluation) return null;
  if (!state.completed) return <p className="cev-msg">Terminez d'abord la formation pour accéder à l'évaluation.</p>;

  // Diplôme obtenu
  if (state.certificate) {
    return (
      <div className="cev cev--done" data-testid="evaluation-diploma">
        <h3>🎓 Diplôme obtenu</h3>
        <p>Félicitations ! Votre travail a été validé.</p>
        <a className="cev-btn" href={clientCertificateUrl(state.certificate.id)} target="_blank" rel="noreferrer">Télécharger mon diplôme</a>
      </div>
    );
  }

  // Soumis, en attente de correction
  if (attempt?.status === 'submitted') {
    return (
      <div className="cev cev--sent" data-testid="evaluation-sent">
        <h3>Vos résultats ont été transmis</h3>
        <p>Votre formatrice analysera votre travail. Vous recevrez un retour prochainement.</p>
      </div>
    );
  }

  const def = state.definition as ClientEvalDefinition;
  const refusedBanner = lastDecision?.decision === 'refused'
    ? <div className="cev-banner" data-testid="evaluation-refused"><strong>Votre formatrice vous demande de recommencer.</strong><p>Motif : {lastDecision.comment}</p></div>
    : null;

  // Pas de tentative → démarrer
  if (!attempt) {
    return (
      <div className="cev">
        {refusedBanner}
        <h3>Évaluation de la formation</h3>
        <p>Répondez au questionnaire puis transmettez vos rendus.</p>
        <Button type="button" disabled={actions.start.isPending} onClick={() => actions.start.mutate()}>
          {actions.start.isPending ? 'Démarrage…' : (lastDecision?.decision === 'refused' ? 'Recommencer' : 'Commencer')}
        </Button>
      </div>
    );
  }

  const setBool = (qid: string, v: boolean) => setAnswers((m) => ({ ...m, [qid]: { booleanValue: v, selectedAnswerIds: [] } }));
  const setSingle = (qid: string, aid: string) => setAnswers((m) => ({ ...m, [qid]: { booleanValue: null, selectedAnswerIds: [aid] } }));
  const toggleMulti = (qid: string, aid: string) => setAnswers((m) => {
    const cur = m[qid]?.selectedAnswerIds || [];
    const next = cur.includes(aid) ? cur.filter((x) => x !== aid) : [...cur, aid];
    return { ...m, [qid]: { booleanValue: null, selectedAnswerIds: next } };
  });

  const onQuestionnaireNext = () => {
    const payload = Object.entries(answers).map(([questionId, v]) => ({
      questionId,
      type: def.sections.flatMap((s) => s.questions).find((q) => q.id === questionId)?.type || '',
      booleanValue: v.booleanValue,
      selectedAnswerIds: v.selectedAnswerIds
    }));
    actions.saveAnswers.mutate({ attemptId: attempt.id, answers: payload }, {
      onSuccess: () => setStep(def.deliverables.length ? 'deliverables' : 'summary')
    });
  };

  const uploadedKinds = (deliverableId: string): Set<string> => {
    const entry = attempt.deliverables.find((d) => d.deliverableId === deliverableId);
    return new Set((entry?.files || []).map((f) => f.kind));
  };

  const onSubmit = () => {
    setSubmitErr(null);
    actions.submit.mutate(attempt.id, {
      onSuccess: (r) => { if (!r.ok) setSubmitErr('Évaluation incomplète : complétez toutes les questions et rendus obligatoires.'); },
      onError: () => setSubmitErr('Évaluation incomplète : complétez toutes les questions et rendus obligatoires.')
    });
  };

  return (
    <div className="cev" data-testid="evaluation-flow">
      {refusedBanner}
      <ol className="cev-steps">
        <li className={step === 'questionnaire' ? 'on' : ''}>Questionnaire</li>
        {def.deliverables.length ? <li className={step === 'deliverables' ? 'on' : ''}>Rendus</li> : null}
        <li className={step === 'summary' ? 'on' : ''}>Validation</li>
      </ol>

      {step === 'questionnaire' ? (
        <div className="cev-section">
          {def.sections.map((s) => (
            <div key={s.id} className="cev-card">
              <h4>{s.title}</h4>
              {s.description ? <p className="cev-desc">{s.description}</p> : null}
              {s.questions.map((q) => (
                <fieldset key={q.id} className="cev-q">
                  <legend>{q.prompt}{q.required ? ' *' : ''}</legend>
                  {q.type === 'true_false' ? (
                    <div className="cev-choices">
                      <label><input type="radio" name={q.id} checked={answers[q.id]?.booleanValue === true} onChange={() => setBool(q.id, true)} /> Vrai</label>
                      <label><input type="radio" name={q.id} checked={answers[q.id]?.booleanValue === false} onChange={() => setBool(q.id, false)} /> Faux</label>
                    </div>
                  ) : (
                    <div className="cev-choices cev-choices--col">
                      {(q.answers || []).map((a) => (
                        <label key={a.id}>
                          <input
                            type={q.mode === 'multiple' ? 'checkbox' : 'radio'} name={q.id}
                            checked={(answers[q.id]?.selectedAnswerIds || []).includes(a.id)}
                            onChange={() => (q.mode === 'multiple' ? toggleMulti(q.id, a.id) : setSingle(q.id, a.id))}
                          /> {a.text}
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
              ))}
            </div>
          ))}
          <Button type="button" disabled={actions.saveAnswers.isPending} onClick={onQuestionnaireNext}>Continuer</Button>
        </div>
      ) : null}

      {step === 'deliverables' ? (
        <div className="cev-section">
          {def.deliverables.map((d) => {
            const kinds = uploadedKinds(d.id);
            return (
              <div key={d.id} className="cev-card">
                <h4>{d.title}{d.required ? ' *' : ''}</h4>
                {d.description ? <p className="cev-desc">{d.description}</p> : null}
                {d.type === 'photo_before_after' ? (
                  <div className="cev-uploads">
                    {(['before', 'after'] as const).map((k) => (
                      <label key={k} className={`cev-upload ${kinds.has(k) ? 'cev-upload--done' : ''}`}>
                        {k === 'before' ? 'Avant' : 'Après'} {kinds.has(k) ? '✓' : ''}
                        <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) actions.upload.mutate({ attemptId: attempt.id, deliverableId: d.id, kind: k, file: f }); }} />
                      </label>
                    ))}
                  </div>
                ) : (
                  <label className={`cev-upload ${kinds.has('video') ? 'cev-upload--done' : ''}`}>
                    Vidéo {d.maxDurationSeconds ? `(max ${d.maxDurationSeconds}s)` : ''} {kinds.has('video') ? '✓' : ''}
                    <input type="file" accept="video/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) actions.upload.mutate({ attemptId: attempt.id, deliverableId: d.id, kind: 'video', file: f }); }} />
                  </label>
                )}
              </div>
            );
          })}
          <div className="cev-actions">
            <Button type="button" variant="secondary" onClick={() => setStep('questionnaire')}>Retour</Button>
            <Button type="button" onClick={() => setStep('summary')}>Continuer</Button>
          </div>
        </div>
      ) : null}

      {step === 'summary' ? (
        <div className="cev-section">
          <div className="cev-card">
            <h4>Récapitulatif</h4>
            <p>Vous avez répondu au questionnaire{def.deliverables.length ? ' et transmis vos rendus' : ''}. Vous pourrez modifier avant de valider.</p>
          </div>
          {submitErr ? <p className="cev-error" role="alert">{submitErr}</p> : null}
          <div className="cev-actions">
            <Button type="button" variant="secondary" onClick={() => setStep('questionnaire')}>Modifier</Button>
            <Button type="button" disabled={actions.submit.isPending} onClick={onSubmit}>{actions.submit.isPending ? 'Envoi…' : 'Valider et transmettre'}</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
