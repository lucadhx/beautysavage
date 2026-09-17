// FORMATION-EVALUATION — Console « Résultats » : liste + fiche (score, questionnaire, rendus, décision).
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LoadingState, ErrorState, Button, Badge } from '@bs/ui';
import { managerCertificateUrl } from '@bs/api-client';
import { useEvaluationResults, useEvaluationResult, useEvaluationDecision } from './useResults';
import './results.css';

const STATUS_LABEL: Record<string, string> = { submitted: 'À corriger', accepted: 'Validé', refused: 'Refusé' };
const STATUS_TONE: Record<string, 'warning' | 'success' | 'danger'> = { submitted: 'warning', accepted: 'success', refused: 'danger' };

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch { return '—'; }
}

export function ResultsListPage() {
  const [status, setStatus] = useState('');
  const query = useEvaluationResults(status ? { status } : {});
  const navigate = useNavigate();

  return (
    <div className="ev-results">
      <header className="ev-results__head">
        <h1 className="ev-results__title">Résultats</h1>
        <div className="ev-results__filters">
          {['', 'submitted', 'accepted', 'refused'].map((s) => (
            <button key={s || 'all'} type="button"
              className={`ev-chip ${status === s ? 'ev-chip--on' : ''}`}
              onClick={() => setStatus(s)}>
              {s ? STATUS_LABEL[s] : 'Tous'}
            </button>
          ))}
        </div>
      </header>

      {query.status === 'pending' ? <LoadingState label="Chargement des résultats…" /> : null}
      {query.status === 'error' ? <ErrorState title="Impossible de charger les résultats." /> : null}
      {query.status === 'success' ? (
        query.data.length === 0 ? (
          <p className="ev-empty">Aucun résultat pour ce filtre.</p>
        ) : (
          <div className="ev-results__scroll">
            <table className="ev-table">
              <thead><tr><th>Client</th><th>Formation</th><th>Date</th><th>Statut</th><th>Tentative</th><th></th></tr></thead>
              <tbody>
                {query.data.map((r) => (
                  <tr key={r.id} className="ev-table__row" onClick={() => navigate(`/resultats/${r.id}`)}>
                    <td>{r.client}</td>
                    <td>{r.formation}</td>
                    <td>{fmtDate(r.submittedAt)}</td>
                    <td><Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge></td>
                    <td>#{r.attemptNumber}</td>
                    <td><Link to={`/resultats/${r.id}`} onClick={(e) => e.stopPropagation()}>Voir</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </div>
  );
}

function PhotoDeliverable({ files }: { files: Array<{ kind: string; url: string }> }) {
  const before = files.find((f) => f.kind === 'before');
  const after = files.find((f) => f.kind === 'after');
  const [zoom, setZoom] = useState<string | null>(null);
  return (
    <div className="ev-photos">
      {before ? <figure className="ev-photo"><figcaption>Avant</figcaption><img src={before.url} alt="Avant" onClick={() => setZoom(before.url)} /></figure> : <p className="ev-muted">Avant manquant</p>}
      {after ? <figure className="ev-photo"><figcaption>Après</figcaption><img src={after.url} alt="Après" onClick={() => setZoom(after.url)} /></figure> : <p className="ev-muted">Après manquant</p>}
      {zoom ? <div className="ev-zoom" role="dialog" onClick={() => setZoom(null)}><img src={zoom} alt="Zoom" /></div> : null}
    </div>
  );
}

export function ResultDetailPage() {
  const { attemptId } = useParams();
  const query = useEvaluationResult(attemptId);
  const { accept, refuse } = useEvaluationDecision(attemptId as string);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState<string | null>(null);

  if (query.status === 'pending') return <LoadingState label="Chargement du résultat…" />;
  if (query.status === 'error') return <ErrorState title="Résultat introuvable." />;
  const r = query.data;
  const decided = r.status !== 'submitted';
  const pending = accept.isPending || refuse.isPending;

  const onAccept = () => {
    if (!comment.trim()) { setErr('Un commentaire est obligatoire.'); return; }
    setErr(null);
    accept.mutate(comment, { onError: () => setErr('Échec de la validation.') });
  };
  const onRefuse = () => {
    if (!comment.trim()) { setErr('Un commentaire est obligatoire.'); return; }
    setErr(null);
    refuse.mutate(comment, { onError: () => setErr('Échec du refus.') });
  };

  return (
    <div className="ev-detail">
      <header className="ev-detail__head">
        <Link to="/resultats" className="ev-back">← Résultats</Link>
        <h1 className="ev-detail__title">{r.client} — {r.formation}</h1>
        <div className="ev-detail__meta">
          <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
          <span>Tentative #{r.attemptNumber}</span>
          <span className="ev-score">Score {r.score.correct}/{r.score.total} ({r.score.percent}%)</span>
        </div>
      </header>

      <section className="ev-block">
        <h2 className="ev-block__title">Questionnaire</h2>
        {r.sections.length === 0 ? <p className="ev-muted">Pas de questionnaire.</p> : r.sections.map((s) => (
          <div key={s.id} className="ev-section">
            <h3>{s.title}</h3>
            {s.questions.map((q) => (
              <div key={q.id} className={`ev-q ${q.correct ? 'ev-q--ok' : 'ev-q--ko'}`}>
                <div className="ev-q__prompt">{q.prompt} {q.correct ? '✓' : '✗'}</div>
                {q.type === 'true_false' ? (
                  <div className="ev-q__ans">
                    <span>Réponse client : <strong>{q.clientAnswer?.booleanValue == null ? '—' : q.clientAnswer.booleanValue ? 'Vrai' : 'Faux'}</strong></span>
                    <span className="ev-q__correct">Bonne réponse : {q.correctBoolean ? 'Vrai' : 'Faux'}</span>
                  </div>
                ) : (
                  <ul className="ev-q__options">
                    {(q.answers || []).map((a) => {
                      const chosen = q.clientAnswer?.selectedAnswerIds?.includes(a.id);
                      return <li key={a.id} className={`${a.correct ? 'ev-opt--correct' : ''} ${chosen ? 'ev-opt--chosen' : ''}`}>
                        {chosen ? '● ' : '○ '}{a.text}{a.correct ? ' (bonne réponse)' : ''}
                      </li>;
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="ev-block">
        <h2 className="ev-block__title">Rendus</h2>
        {r.deliverables.length === 0 ? <p className="ev-muted">Pas de rendus.</p> : r.deliverables.map((d) => (
          <div key={d.id} className="ev-deliverable">
            <h3>{d.title}</h3>
            {d.type === 'photo_before_after'
              ? <PhotoDeliverable files={d.files} />
              : (d.files.find((f) => f.kind === 'video')
                  ? <video className="ev-video" src={d.files.find((f) => f.kind === 'video')!.url} controls />
                  : <p className="ev-muted">Vidéo manquante</p>)}
          </div>
        ))}
      </section>

      {r.decisions.length > 0 ? (
        <section className="ev-block">
          <h2 className="ev-block__title">Historique des décisions</h2>
          {r.decisions.map((d, i) => (
            <div key={i} className={`ev-decision ev-decision--${d.decision}`}>
              <strong>{d.decision === 'accepted' ? 'Validé' : 'Refusé'}</strong> — tentative #{d.attemptNumber} — {fmtDate(d.createdAt)}
              <p>{d.comment}</p>
            </div>
          ))}
        </section>
      ) : null}

      {!decided ? (
        <section className="ev-block ev-decision-panel">
          <h2 className="ev-block__title">Décision</h2>
          <textarea className="ev-comment" placeholder="Commentaire (obligatoire)…" value={comment} onChange={(e) => { setComment(e.target.value); setErr(null); }} rows={3} />
          <div className="ev-decision-panel__actions">
            <Button type="button" disabled={pending} onClick={onAccept}>{accept.isPending ? 'Validation…' : 'Valider le diplôme'}</Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={onRefuse}>{refuse.isPending ? 'Refus…' : 'Refuser'}</Button>
          </div>
          {err ? <p className="ev-error" role="alert">{err}</p> : null}
        </section>
      ) : r.certificate ? (
        <section className="ev-block">
          <p className="ev-success">Diplôme délivré : {r.certificate.certificateNumber}</p>
          <a className="ev-cert-link" href={managerCertificateUrl(r.certificate.id)} target="_blank" rel="noreferrer">Télécharger le diplôme</a>
        </section>
      ) : null}
    </div>
  );
}
