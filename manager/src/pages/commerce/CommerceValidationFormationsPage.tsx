import * as React from 'react';
import { CheckCircle2, Image, PlayCircle, Search, Send, XCircle } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { Button, Field, Textarea } from '@/components/ui/primitives';
import { Dropdown } from '@/components/base/dropdown/dropdown';
import { CommercePageFrame, Metric, Panel, StatusBadge, dateShort, type TrainingSubmission } from './CommerceShared';

function customer(value: TrainingSubmission['customerId']) {
  if (typeof value === 'object' && value) return [value.firstName, value.lastName].filter(Boolean).join(' ') || value.email || 'Client';
  return 'Client';
}

function product(value: TrainingSubmission['productId']) {
  return typeof value === 'object' && value ? value.title || 'Formation' : 'Formation';
}

function customerId(value: TrainingSubmission['customerId']) {
  return typeof value === 'object' && value ? value._id : null;
}

function entries(value: unknown) {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>);
}

function answerLabel(key: string, index: number) {
  return key.replace(/^q_/, '').replace(/[-_]/g, ' ').trim() || `Reponse ${index + 1}`;
}

function renderValue(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (value === null || value === undefined || value === '') return 'Non renseigne';
  return String(value);
}

function scoreOf(item: TrainingSubmission) {
  const score = item.scoreSnapshot as { percent?: number | null; earnedPoints?: number; totalPoints?: number; details?: { questionId?: string; label?: string; earnedPoints?: number; points?: number; options?: unknown[]; correctOptionIds?: string[]; selectedOptionIds?: string[]; correct?: boolean; type?: string }[] } | undefined;
  return {
    percent: typeof score?.percent === 'number' ? score.percent : null,
    earned: score?.earnedPoints ?? 0,
    total: score?.totalPoints ?? 0,
    details: Array.isArray(score?.details) ? score.details : [],
  };
}

export default function CommerceValidationFormationsPage() {
  const [items, setItems] = React.useState<TrainingSubmission[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [statusFilter, setStatusFilter] = React.useState('ALL');
  const [formationFilter, setFormationFilter] = React.useState('ALL');
  const [query, setQuery] = React.useState('');
  const [comment, setComment] = React.useState('');
  const [message, setMessage] = React.useState('');
  const { submissionId } = useParams();
  const navigate = useNavigate();
  const selected = submissionId ? items.find((item) => item._id === submissionId) ?? null : items.find((item) => item._id === selectedId) ?? null;

  const refresh = React.useCallback(() => {
    api.commerceTrainingSubmissions()
      .then((list) => {
        const next = list as TrainingSubmission[];
        setItems(next);
        setSelectedId((current) => current ?? next[0]?._id ?? null);
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Chargement impossible'));
  }, []);
  React.useEffect(refresh, [refresh]);

  const filteredItems = React.useMemo(() => items.filter((item) => {
    if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
    if (formationFilter !== 'ALL' && product(item.productId) !== formationFilter) return false;
    const haystack = `${product(item.productId)} ${customer(item.customerId)} ${item.status}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [formationFilter, items, query, statusFilter]);
  const formationOptions = React.useMemo(() => [...new Set(items.map((item) => product(item.productId)))].sort(), [items]);

  async function decide(status: 'VALIDATED' | 'REJECTED') {
    if (!selected) return;
    if (status === 'REJECTED' && !comment.trim()) {
      setMessage('Un commentaire est obligatoire pour refuser une formation.');
      return;
    }
    await api.decideCommerceTrainingSubmission(selected._id, { status, comment, scoreSnapshot: { ...selected.scoreSnapshot, checkedAt: new Date().toISOString() } });
    setMessage(status === 'VALIDATED' ? 'Formation validee.' : 'Soumission refusee.');
    setComment('');
    refresh();
  }

  if (submissionId) {
    return (
      <CommercePageFrame
        title={selected ? `Validation ${product(selected.productId)}` : 'Validation formation'}
        description="Fiche de correction dediee : score, reponses, livrables, historique et decision."
        actions={<Button variant="outline" onClick={() => navigate('/commerce/validation-formations')}>Retour aux validations</Button>}
      >
        {message && <p className="rounded-md border p-3 text-sm text-muted-foreground">{message}</p>}
        {!selected ? (
          <Panel title="Chargement">
            <p className="text-sm text-muted-foreground">{items.length === 0 ? 'Chargement de la soumission...' : 'Soumission introuvable.'}</p>
          </Panel>
        ) : (
          <Panel title="Correction">
            <SubmissionReview item={selected} />
            {selected.decision?.comment && <p className="mt-4 rounded-md border bg-muted/30 p-3 text-sm">Decision precedente : {selected.decision.comment}</p>}
            <div className="mt-5 grid gap-3 rounded-lg border p-4">
              <Field label="Commentaire client">
                <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Expliquez la validation ou le refus. Obligatoire en cas de refus." />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => decide('VALIDATED')}><CheckCircle2 className="h-4 w-4" /> Valider la formation</Button>
                <Button variant="destructive" onClick={() => decide('REJECTED')}><XCircle className="h-4 w-4" /> Refuser</Button>
              </div>
            </div>
          </Panel>
        )}
      </CommercePageFrame>
    );
  }

  return (
    <CommercePageFrame title="Validation formations" description="Correction ergonomique des evaluations finales, livrables et decisions client.">
      {message && <p className="rounded-md border p-3 text-sm text-muted-foreground">{message}</p>}
      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="En attente" value={items.filter((item) => item.status === 'PENDING').length} />
        <Metric label="Validees" value={items.filter((item) => item.status === 'VALIDATED').length} />
        <Metric label="Refusees" value={items.filter((item) => item.status === 'REJECTED').length} />
      </div>

      <div className="grid gap-4">
        <Panel title="Soumissions">
          <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
            <label className="flex min-w-0 items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher cliente ou formation" className="min-w-0 flex-1 bg-transparent outline-none" />
            </label>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm">
              <option value="ALL">Tous les statuts</option>
              <option value="PENDING">En attente</option>
              <option value="VALIDATED">Validee</option>
              <option value="REJECTED">Refusee</option>
            </select>
            <select value={formationFilter} onChange={(event) => setFormationFilter(event.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm">
              <option value="ALL">Toutes les formations</option>
              {formationOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div className="max-w-full overflow-x-auto rounded-lg border">
            {filteredItems.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucune demande ne correspond aux filtres.</p>}
            {filteredItems.length > 0 && (
              <table className="min-w-[760px] w-full text-left text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-4 py-3">Formation</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Tentative</th><th className="px-4 py-3">Statut</th><th className="px-4 py-3">Action</th></tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={item._id} className="border-t">
                      <td className="px-4 py-3 font-medium">{product(item.productId)}</td>
                      <td className="px-4 py-3">{customer(item.customerId)}</td>
                      <td className="px-4 py-3">{dateShort(item.createdAt)}</td>
                      <td className="px-4 py-3">#{item.attempt} - v{item.evaluationVersion || 1}</td>
                      <td className="px-4 py-3"><StatusBadge>{item.status}</StatusBadge></td>
                      <td className="px-4 py-3">
                        <Dropdown.Root>
                          <Dropdown.DotsButton aria-label="Actions soumission" />
                          <Dropdown.Popover className="w-48">
                            <Dropdown.Menu>
                              <Dropdown.Section>
                                <Dropdown.Item onAction={() => navigate(`/commerce/validation-formations/${item._id}`)}>Ouvrir la fiche</Dropdown.Item>
                              </Dropdown.Section>
                            </Dropdown.Menu>
                          </Dropdown.Popover>
                        </Dropdown.Root>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Panel>
      </div>
    </CommercePageFrame>
  );
}

function SubmissionReview({ item }: { item: TrainingSubmission }) {
  const score = scoreOf(item);
  const detailById = new Map(score.details.map((detail) => [detail.questionId || detail.label || '', detail]));
  const evaluation = typeof item.productId === 'object' && item.productId ? (item.productId as any).evaluation || {} : {};
  const sections = Array.isArray(evaluation.sections) ? evaluation.sections : [];
  return (
    <div className="grid gap-5">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Score</p>
          <p className="mt-2 text-3xl font-semibold">{score.percent === null ? 'N/A' : `${score.percent}%`}</p>
          <p className="text-xs text-muted-foreground">{score.earned} / {score.total} points</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Cliente</p>
          <p className="mt-2 font-semibold">{customer(item.customerId)}</p>
          {customerId(item.customerId) && (
            <Link
              to={`/commerce/clients/${customerId(item.customerId)}`}
              className="mt-3 inline-flex rounded-md border px-3 py-2 text-xs font-semibold hover:bg-muted"
            >
              Voir la fiche client
            </Link>
          )}
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Formation</p>
          <p className="mt-2 font-semibold">{product(item.productId)}</p>
        </div>
      </div>

      <section className="grid gap-3">
        <h3 className="text-base font-semibold">Reponses du formulaire</h3>
        {sections.length === 0 && entries(item.answersSnapshot).length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucune reponse texte.</p>}
        {sections.length > 0 ? sections.map((section: any, sectionIndex: number) => (
          <div key={section.id || sectionIndex} className="rounded-lg border bg-card">
            <div className="border-b bg-muted/30 p-4">
              <h4 className="font-semibold">{section.title || `Section ${sectionIndex + 1}`}</h4>
              {section.description && <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>}
            </div>
            <div className="grid gap-3 p-4">
              {(Array.isArray(section.items) ? section.items : []).map((question: any, index: number) => {
                const qid = String(question.id || question.label || index);
                const detail = detailById.get(qid) ?? detailById.get(question.label || '');
                return <QuestionCorrection key={qid} question={question} answer={(item.answersSnapshot as any)?.[qid] ?? (item.answersSnapshot as any)?.[question.label]} detail={detail} />;
              })}
            </div>
          </div>
        )) : entries(item.answersSnapshot).map(([key, value], index) => {
          const detail = detailById.get(key) ?? detailById.get(answerLabel(key, index));
          return <QuestionCorrection key={key} question={{ id: key, label: detail?.label || answerLabel(key, index), options: detail?.options || [] }} answer={value} detail={detail} />;
        })}
      </section>

      <section className="grid gap-3">
        <h3 className="text-base font-semibold">Livrables</h3>
        {entries(item.deliverablesSnapshot).length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucun livrable envoye.</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {entries(item.deliverablesSnapshot).map(([key, value], index) => (
            <DeliverableCard key={key} label={answerLabel(key, index)} value={value} />
          ))}
        </div>
      </section>
    </div>
  );
}

function optionRows(question: any, detail: any) {
  if (Array.isArray(detail?.options) && detail.options.length) return detail.options;
  if (question.type === 'TRUE_FALSE') return [{ id: 'true', label: 'Vrai' }, { id: 'false', label: 'Faux' }];
  return Array.isArray(question.options) ? question.options : [];
}

function answerArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'boolean') return [value ? 'true' : 'false'];
  if (value === null || value === undefined || value === '') return [];
  return [String(value)];
}

function QuestionCorrection({ question, answer, detail }: { question: any; answer: unknown; detail: any }) {
  const selected = new Set(answerArray(answer));
  const correctIds = new Set((detail?.correctOptionIds || question.correctOptionIds || optionRows(question, detail).filter((option: any) => option.correct).map((option: any) => String(option.id))).map(String));
  const ok = detail ? Boolean(detail.correct ?? Number(detail.earnedPoints || 0) >= Number(detail.points || 0)) : null;
  const earned = Number(detail?.earnedPoints || 0);
  const points = Number(detail?.points || question.points || 0);
  return (
    <article className={`rounded-lg border p-4 ${ok === true ? 'border-emerald-200 bg-emerald-50' : ok === false ? 'border-red-200 bg-red-50' : 'bg-background'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{question.label || 'Question'}</p>
          {question.prompt && <p className="mt-1 text-sm text-muted-foreground">{question.prompt}</p>}
        </div>
        <div className="flex items-center gap-2">
          {ok === true && <span className="rounded-full bg-emerald-600 px-2 py-1 text-xs font-semibold text-white">Correcte</span>}
          {ok === false && <span className="rounded-full bg-red-600 px-2 py-1 text-xs font-semibold text-white">Fausse</span>}
          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${earned > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {earned} / {points} pts
          </span>
        </div>
      </div>
      <div className="mt-3 grid gap-2">
        {optionRows(question, detail).length > 0 ? optionRows(question, detail).map((option: any) => {
          const id = String(option.id);
          const isSelected = selected.has(id);
          const isCorrect = correctIds.has(id) || Boolean(option.correct);
          const selectedWrong = isSelected && !isCorrect;
          return (
            <div key={id} className={`flex items-center gap-3 rounded-md border p-3 text-sm ${isCorrect ? 'border-emerald-300 bg-emerald-100 text-emerald-900' : selectedWrong ? 'border-red-300 bg-red-100 text-red-900' : 'bg-white/60'}`}>
              <input type={question.type === 'MULTIPLE' ? 'checkbox' : 'radio'} checked={isSelected} readOnly />
              <span className="flex-1">{option.label}</span>
              {isCorrect && !isSelected && <span className="text-xs font-semibold">Bonne reponse</span>}
              {isSelected && <span className="text-xs font-semibold">Choisie</span>}
            </div>
          );
        }) : (
          <p className="rounded-md border bg-white/70 p-3 text-sm">{renderValue(answer)}</p>
        )}
      </div>
    </article>
  );
}

function DeliverableCard({ label, value }: { label: string; value: unknown }) {
  const first = Array.isArray(value) ? value[0] : value;
  const object = first && typeof first === 'object' ? first as any : null;
  const text = object?.url || renderValue(first ?? value);
  const title = object?.name || label;
  const isImage = /^https?:\/\/.+\.(png|jpe?g|webp|gif)$/i.test(text) || text.startsWith('/uploads/');
  const isVideo = /^https?:\/\/.+\.(mp4|webm|mov)$/i.test(text) || /\.(mp4|webm|mov)$/i.test(text) || object?.mimeType?.startsWith?.('video/');
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b p-3 text-sm font-semibold">
        {isImage ? <Image className="h-4 w-4" /> : isVideo ? <PlayCircle className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        {title}
      </div>
      {isImage ? (
        <img src={text} alt="" className="aspect-video w-full object-cover" />
      ) : isVideo ? (
        <video src={text} controls className="aspect-video w-full bg-black object-contain" />
      ) : (
        <p className="break-words p-4 text-sm">{text}</p>
      )}
    </div>
  );
}
