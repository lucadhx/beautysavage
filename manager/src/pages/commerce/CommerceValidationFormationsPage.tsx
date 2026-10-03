import * as React from 'react';
import { CheckCircle2, Image, PlayCircle, Search, Send, XCircle } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { CustomVideoPlayer } from '@/components/CustomVideoPlayer';
import { Button, Field, Textarea } from '@/components/ui/primitives';
import { Dropdown } from '@/components/base/dropdown/dropdown';
import { CardsSkeleton, FormSkeleton, TableSkeleton } from '@/components/ui/Skeleton';
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
  const [loaded, setLoaded] = React.useState(false);
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
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Chargement impossible'))
      .finally(() => setLoaded(true));
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
        {!loaded ? (
          <FormSkeleton fields={6} />
        ) : !selected ? (
          <Panel title="Chargement">
            <p className="text-sm text-muted-foreground">Soumission introuvable.</p>
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
                {/* Les deux décisions portent leur couleur : vert = valider, rouge = refuser. */}
                <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => decide('VALIDATED')} data-testid="decision-validate"><CheckCircle2 className="h-4 w-4" /> Valider la formation</Button>
                <Button className="bg-red-600 text-white hover:bg-red-700" onClick={() => decide('REJECTED')} data-testid="decision-reject"><XCircle className="h-4 w-4" /> Refuser</Button>
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
      {!loaded ? <CardsSkeleton count={3} /> : (
        <div className="grid gap-4 md:grid-cols-3">
          <Metric label="En attente" value={items.filter((item) => item.status === 'PENDING').length} />
          <Metric label="Validees" value={items.filter((item) => item.status === 'VALIDATED').length} />
          <Metric label="Refusees" value={items.filter((item) => item.status === 'REJECTED').length} />
        </div>
      )}

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
          {!loaded ? <TableSkeleton rows={6} cols={6} /> : (
          <div className="m-table max-w-full overflow-x-auto rounded-lg border">
            {filteredItems.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucune demande ne correspond aux filtres.</p>}
            {filteredItems.length > 0 && (
              <table className="min-w-[760px] w-full text-left text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-4 py-3">Formation</th><th className="m-hide px-4 py-3">Cliente</th><th className="m-hide px-4 py-3">Date</th><th className="m-hide px-4 py-3">Tentative</th><th className="px-4 py-3">Statut</th><th className="px-4 py-3">Action</th></tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={item._id} className="border-t">
                      <td className="px-4 py-3 font-medium">
                        {product(item.productId)}
                        <div className="text-xs font-normal text-muted-foreground sm:hidden">{customer(item.customerId)} · {dateShort(item.createdAt)} · tentative #{item.attempt}</div>
                      </td>
                      <td className="m-hide px-4 py-3">{customer(item.customerId)}</td>
                      <td className="m-hide whitespace-nowrap px-4 py-3">{dateShort(item.createdAt)}</td>
                      <td className="m-hide px-4 py-3">#{item.attempt}</td>
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
          )}
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
        <h3 className="text-base font-semibold">Travaux rendus</h3>
        {deliverableRows(item, evaluation).length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucun livrable envoye.</p>}
        <div className="grid gap-4">
          {deliverableRows(item, evaluation).map((row) => (
            <DeliverableCard key={row.key} label={row.label} description={row.description} items={row.items} />
          ))}
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Livrables : ce que la cliente a envoyé, MONTRÉ — pas un nom de fichier    */
/* -------------------------------------------------------------------------- */

type MediaKind = 'image' | 'video' | 'streamable' | 'file';
interface MediaItem { url: string; name: string; kind: MediaKind; shortcode?: string; caption?: string }

const SLOT_LABELS: Record<string, string> = { before: 'Avant', after: 'Apres' };

function streamableCode(value: unknown) {
  const raw = String(value || '').trim();
  const match = raw.match(/^https?:\/\/(?:www\.)?streamable\.com\/(?:e\/)?([a-z0-9]{4,12})/i);
  return match ? match[1].toLowerCase() : '';
}

function mediaKind(url: string, mime: string, shortcode: string): MediaKind {
  if (shortcode) return 'streamable';
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif)(?:[?#].*)?$/i.test(url)) return 'image';
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|m4v)(?:[?#].*)?$/i.test(url)) return 'video';
  return 'file';
}

/**
 * Aplatit une valeur de livrable, quelle que soit sa forme : un fichier seul,
 * une galerie (tableau), un couple avant/après (objet à emplacements). C'est
 * la forme imbriquée qui s'affichait « [object Object] ».
 */
function mediaItems(value: unknown, caption?: string): MediaItem[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((entry, index) => mediaItems(entry, caption ? `${caption} ${index + 1}` : undefined));
  if (typeof value === 'string') {
    const shortcode = streamableCode(value);
    return [{ url: value, name: value.split('/').pop() || value, kind: mediaKind(value, '', shortcode), shortcode, caption }];
  }
  if (typeof value !== 'object') return [];
  const object = value as Record<string, unknown>;
  const url = String(object.url || object.sourceUrl || '');
  if (url || object.streamableShortcode) {
    const shortcode = String(object.streamableShortcode || '') || streamableCode(url);
    const mime = String(object.mimeType || object.type || '');
    return [{ url: resolvePreviewMediaUrl(url), name: String(object.name || url.split('/').pop() || 'Fichier'), kind: mediaKind(url, mime, shortcode), shortcode, caption }];
  }
  return Object.entries(object).flatMap(([slot, entry]) => mediaItems(entry, SLOT_LABELS[slot] || slot));
}

/** Livrables dans l'ordre de la consigne, avec LEUR libellé — puis tout reste envoyé. */
function deliverableRows(item: TrainingSubmission, evaluation: Record<string, any>) {
  const snapshot = (item.deliverablesSnapshot || {}) as Record<string, unknown>;
  const definitions = Array.isArray(evaluation.deliverables) ? evaluation.deliverables as Record<string, any>[] : [];
  const seen = new Set<string>();
  const rows = definitions
    .map((definition, index) => {
      const key = String(definition.id || definition.label || index);
      seen.add(key);
      return { key, label: String(definition.label || `Livrable ${index + 1}`), description: String(definition.description || ''), items: mediaItems(snapshot[key]) };
    })
    .filter((row) => row.items.length > 0);
  for (const [key, value] of Object.entries(snapshot)) {
    if (seen.has(key)) continue;
    const items = mediaItems(value);
    if (items.length) rows.push({ key, label: answerLabel(key.replace(/^liv_/, ''), rows.length), description: '', items });
  }
  return rows;
}

function DeliverableCard({ label, description, items }: { label: string; description: string; items: MediaItem[] }) {
  return (
    <article className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b bg-muted/30 px-4 py-3">
        <p className="font-semibold">{label}</p>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((media, index) => <MediaTile key={`${media.url}-${index}`} media={media} />)}
      </div>
    </article>
  );
}

function MediaTile({ media }: { media: MediaItem }) {
  const legend = (
    <figcaption className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
      {media.kind === 'image' ? <Image className="h-3.5 w-3.5" /> : media.kind === 'file' ? <Send className="h-3.5 w-3.5" /> : <PlayCircle className="h-3.5 w-3.5" />}
      {media.caption && <span className="font-semibold text-foreground">{media.caption}</span>}
      <span className="truncate">{media.name}</span>
    </figcaption>
  );
  if (media.kind === 'image') {
    return (
      <figure className="overflow-hidden rounded-md border bg-background" data-testid="deliverable-image">
        <a href={media.url} target="_blank" rel="noreferrer" title="Ouvrir en grand">
          <img src={media.url} alt={media.caption || media.name} className="aspect-square w-full bg-muted object-cover" loading="lazy" />
        </a>
        {legend}
      </figure>
    );
  }
  if (media.kind === 'video' || media.kind === 'streamable') {
    return (
      <figure className="overflow-hidden rounded-md border bg-background sm:col-span-2" data-testid="deliverable-video">
        <CustomVideoPlayer {...(media.kind === 'streamable' ? { shortcode: media.shortcode || '' } : { src: media.url })} title={media.caption || media.name} />
        {legend}
      </figure>
    );
  }
  return (
    <figure className="rounded-md border bg-background p-3">
      <a href={media.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold hover:underline"><Send className="h-4 w-4" /> Ouvrir {media.name}</a>
    </figure>
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

/** Les bonnes réponses d'une question — liste explicite si elle existe, sinon les options cochées « bonne ». */
function expectedIds(question: any, detail: any) {
  if (Array.isArray(detail?.correctOptionIds) && detail.correctOptionIds.length) return detail.correctOptionIds.map(String);
  if (Array.isArray(question.correctOptionIds) && question.correctOptionIds.length) return question.correctOptionIds.map(String);
  return optionRows(question, detail).filter((option: any) => option.correct).map((option: any) => String(option.id));
}

function QuestionCorrection({ question, answer, detail }: { question: any; answer: unknown; detail: any }) {
  const selectedList = answerArray(answer);
  const selected = new Set(selectedList);
  const expected = expectedIds(question, detail);
  const correctIds = new Set<string>(expected);
  const points = Number(detail?.points ?? question.points ?? 0);
  /**
   * Sans détail enregistré, la question est corrigée ICI, avec la même règle
   * que le serveur (mêmes réponses cochées, ni plus ni moins). Elle affichait
   * sinon « 0 / 4 » même sur une bonne réponse.
   */
  const computedOk = expected.length > 0 && selectedList.length > 0
    && [...selectedList].sort().join('|') === [...expected].sort().join('|');
  const ok = detail ? Boolean(detail.correct ?? Number(detail.earnedPoints || 0) >= points) : (expected.length > 0 ? computedOk : null);
  const earned = detail ? Number(detail.earnedPoints || 0) : ok ? points : 0;
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
          <span data-testid="question-points" className={`rounded-full px-2 py-1 text-xs font-semibold ${earned > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
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

