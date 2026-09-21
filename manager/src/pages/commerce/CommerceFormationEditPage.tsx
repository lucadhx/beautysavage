import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CalendarDays, CheckCircle2, Clock, Euro, Eye, FastForward, FileText, GripVertical, Loader2, Maximize, MessageCircle, Minimize, Pause, Play, Plus, Rewind, Save, Shield, Trash2, Users, Video, Volume2, VolumeX } from 'lucide-react';
import { api, uploadCommerceTrainingFile } from '@/lib/api';
import { ImageUpload } from '@/components/fields/ImageUpload';
import { useCompany } from '@/context/CompanyContext';
import { Button, Card, CardContent, Field, Input, SegmentedControl, Switch, Textarea } from '@/components/ui/primitives';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Dropdown } from '@/components/base/dropdown/dropdown';
import { CommercePageFrame, KIND_LABEL, StatusBadge, cents, type CommerceProduct, type ProductKind } from './CommerceShared';

type TabId = 'infos' | 'modules' | 'sessions' | 'promotion' | 'boost' | 'options' | 'evaluation';

const EMPTY: Partial<CommerceProduct> = {
  title: '',
  slug: '',
  subtitle: '',
  description: '',
  kind: 'DISTANCE_TRAINING',
  status: 'DRAFT',
  price: { amountCents: 0, currency: 'EUR' },
  gallery: [],
  options: [],
  sessions: [],
  faq: [],
  modules: [],
  trailer: {},
  whatsappGroup: {},
  training: { durationDays: 1, formalities: '', cancellationPolicy: '', location: '', accessMode: 'IMMEDIATE' },
  promotion: { enabled: false, type: 'PERCENT', value: 0, startsAt: '', endsAt: '' },
  evaluation: { enabled: false, version: 1, showScoreToCustomer: false, sections: [], deliverables: [] },
};

function readPath<T>(source: unknown, path: string, fallback: T): T {
  let current: unknown = source;
  for (const key of path.split('.')) {
    if (!current || typeof current !== 'object' || !(key in current)) return fallback;
    current = (current as Record<string, unknown>)[key];
  }
  return (current ?? fallback) as T;
}

function writePath(source: Record<string, unknown>, path: string, value: unknown) {
  const clone = structuredClone(source);
  let current: Record<string, unknown> = clone;
  const parts = path.split('.');
  for (const key of parts.slice(0, -1)) {
    current[key] = current[key] && typeof current[key] === 'object' ? current[key] : {};
    current = current[key] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value;
  return clone;
}

function optionKey(label: unknown, index: number) {
  const slug = String(label || `option-${index + 1}`)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return slug || `option-${index + 1}`;
}

function normalizeCommerceOptions(rows: Record<string, unknown>[]) {
  return rows.map((row, index) => ({
    ...row,
    key: String(row.key || optionKey(row.label, index)),
    priceCents: Math.round(Number(row.priceCents || 0)),
    active: row.active !== false,
  }));
}

function linesToResources(text: unknown, kind: 'video' | 'file') {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [title, url] = line.split('|').map((part) => part.trim());
      return { id: uid(kind), title: title || `${kind === 'video' ? 'Video' : 'Fichier'} ${index + 1}`, description: '', url: url || title || '', sourceUrl: url || title || '', mp4Url: '', order: index + 1 };
    });
}

function normalizeModule(module: Record<string, unknown>, index: number) {
  return {
    id: module.id || uid('module'),
    title: module.title || `Module ${index + 1}`,
    description: module.description || '',
    order: Number(module.order || index + 1),
    videos: Array.isArray(module.videos) ? module.videos : linesToResources(module.videosText, 'video'),
    files: Array.isArray(module.files) ? module.files : linesToResources(module.filesText, 'file'),
  } as Record<string, unknown>;
}

function normalizeVideoResourceForSave(row: Record<string, unknown>, index: number) {
  const legacyMp4 = String(row.mp4Url || '');
  return {
    ...row,
    order: Number(row.order || index + 1),
    streamPath: '',
    streamUrl: '',
    playbackUrl: '',
    mp4Url: legacyMp4.includes('drive.usercontent.google.com') ? '' : legacyMp4,
  };
}

function normalizeModulesForSave(rows: Record<string, unknown>[]) {
  return rows.map(normalizeModule).map((module, index) => ({
    ...module,
    order: index + 1,
    videos: Array.isArray(module.videos)
      ? (module.videos as Record<string, unknown>[]).map(normalizeVideoResourceForSave)
      : [],
  }));
}

export default function CommerceFormationEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const creation = !id || id === 'nouveau';
  const [product, setProduct] = React.useState<Partial<CommerceProduct>>(EMPTY);
  const [tab, setTab] = React.useState<TabId>('infos');
  const [message, setMessage] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [pendingKind, setPendingKind] = React.useState<ProductKind | null>(null);

  React.useEffect(() => {
    if (creation) return;
    api.commerceProducts().then((items) => {
      const found = (items as CommerceProduct[]).find((item) => item._id === id);
      if (found) setProduct({ ...EMPTY, ...found });
      else setMessage('Formation introuvable.');
    }).catch((err) => setMessage(err instanceof Error ? err.message : 'Chargement impossible'));
  }, [creation, id]);

  const kind = (product.kind || 'DISTANCE_TRAINING') as ProductKind;
  const distanciel = kind === 'DISTANCE_TRAINING';
  const tabs = [
    { id: 'infos', label: 'Informations' },
    distanciel ? { id: 'modules', label: 'Modules pedagogiques' } : { id: 'sessions', label: 'Planning sessions' },
    { id: 'promotion', label: 'Promotion' },
    { id: 'boost', label: 'Boost' },
    { id: 'options', label: 'Options' },
    { id: 'evaluation', label: 'Evaluation finale' },
  ] satisfies { id: TabId; label: string }[];

  const patch = (path: string, value: unknown) => setProduct((p) => writePath(p as Record<string, unknown>, path, value) as Partial<CommerceProduct>);
  const array = (path: keyof CommerceProduct) => (product[path] as Record<string, unknown>[] | undefined) ?? [];
  const setArray = (path: keyof CommerceProduct, rows: Record<string, unknown>[]) => patch(String(path), rows);

  async function save() {
    setSaving(true);
    setMessage('');
    try {
      const saved = await api.saveCommerceProduct({
        ...product,
        options: normalizeCommerceOptions(array('options')),
        modules: normalizeModulesForSave(array('modules')),
        id: creation ? undefined : id,
        amountCents: product.price?.amountCents ?? 0,
        distanceDeliveryMode: distanciel ? readPath(product, 'training.accessMode', 'IMMEDIATE') : null,
        requiresLegalWaiver: distanciel,
      });
      setProduct({ ...EMPTY, ...(saved as CommerceProduct) });
      setMessage('Formation enregistree.');
      if (creation) navigate(`/commerce/formations/${(saved as CommerceProduct)._id}`, { replace: true });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Sauvegarde impossible');
    } finally {
      setSaving(false);
    }
  }

  return (
    <CommercePageFrame
      title={creation ? 'Nouvelle formation' : product.title || 'Formation'}
      description="Preparez la fiche vendue sur la vitrine : informations, contenu, dates, offres, options et evaluation."
      actions={(
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate('/commerce/formations')}><ArrowLeft className="h-4 w-4" /> Retour</Button>
          <Button onClick={save} loading={saving}><Save className="h-4 w-4" /> Enregistrer</Button>
        </div>
      )}
    >
      {message && <p className="rounded-md border p-3 text-sm text-muted-foreground">{message}</p>}
      <div className="flex gap-2 overflow-x-auto rounded-lg border bg-card p-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium ${tab === item.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'infos' && (
        <Card>
          <CardContent className="grid gap-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Nom de la formation"><Input value={product.title || ''} onChange={(e) => patch('title', e.target.value)} /></Field>
              <Field label="Type">
                <SegmentedControl
                  value={kind}
                  onChange={(v) => {
                    if (!creation) { setPendingKind(v as ProductKind); return; }
                    patch('kind', v);
                    setTab(v === 'IN_PERSON_TRAINING' ? 'sessions' : 'modules');
                  }}
                  options={[
                    { value: 'DISTANCE_TRAINING', label: 'Distanciel' },
                    { value: 'IN_PERSON_TRAINING', label: 'Presentiel' },
                  ]}
                />
              </Field>
              <Field label="Statut">
                <CustomSelect
                  value={String(product.status || 'DRAFT')}
                  onChange={(value) => patch('status', value)}
                  options={[
                    { value: 'DRAFT', label: 'Brouillon', description: 'Invisible tant que la fiche n est pas prete.' },
                    { value: 'PUBLISHED', label: 'Publiee', description: 'Visible sur la vitrine.' },
                    { value: 'DISABLED', label: 'Desactivee', description: 'Masquee temporairement.' },
                    { value: 'ARCHIVED', label: 'Archivee', description: 'Conservee pour historique.' },
                  ]}
                />
              </Field>
              <Field label="Prix TTC"><Input type="number" min="0" step="0.01" value={(product.price?.amountCents || 0) / 100} onChange={(e) => patch('price.amountCents', Math.round(Number(e.target.value || 0) * 100))} /></Field>
              <CoverImageField value={product.coverUrl || ''} onChange={(url) => patch('coverUrl', url)} />
            </div>
            <Field label="Description courte"><Input value={product.subtitle || ''} onChange={(e) => patch('subtitle', e.target.value)} /></Field>
            <RichTextLite label="Description longue" value={product.description || ''} onChange={(value) => patch('description', value)} />
            <div className="grid gap-4 md:grid-cols-2">
              <TrailerResourceCard
                titleValue={readPath(product, 'trailer.title', '')}
                sourceUrl={readPath(product, 'trailer.sourceUrl', readPath(product, 'trailer.url', ''))}
                shortcode={readPath(product, 'trailer.streamableShortcode', '')}
                onPatch={(value) => patch('trailer', { ...(product.trailer || {}), ...value })}
              />
              <ResourceLinkCard
                icon={<MessageCircle className="h-5 w-5" />}
                title="Groupe WhatsApp"
                description="Lien d accompagnement transmis aux clientes inscrites."
                titleValue={readPath(product, 'whatsappGroup.title', '')}
                urlValue={readPath(product, 'whatsappGroup.url', '')}
                onTitle={(value) => patch('whatsappGroup.title', value)}
                onUrl={(value) => patch('whatsappGroup.url', value)}
              />
            </div>
            {distanciel ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Mode de delivrance">
                  <CustomSelect
                    value={readPath(product, 'training.accessMode', 'IMMEDIATE')}
                    onChange={(value) => patch('training.accessMode', value)}
                    options={[
                      { value: 'IMMEDIATE', label: 'Acces immediat', description: 'La cliente accede au contenu apres paiement.' },
                      { value: 'MANUAL', label: 'Delivrance manuelle', description: 'L institut ouvre l acces apres verification.' },
                    ]}
                  />
                </Field>
                <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                  Les clientes savent clairement quand leur formation sera disponible apres achat.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Duree en jours"><Input type="number" min="1" value={readPath(product, 'training.durationDays', 1)} onChange={(e) => patch('training.durationDays', Number(e.target.value || 1))} /></Field>
                <Field label="Lieu"><Input value={readPath(product, 'training.location', '')} onChange={(e) => patch('training.location', e.target.value)} /></Field>
                <Field label="Formalites"><Textarea value={readPath(product, 'training.formalities', '')} onChange={(e) => patch('training.formalities', e.target.value)} /></Field>
                <Field label="Politique d'annulation"><Textarea value={readPath(product, 'training.cancellationPolicy', '')} onChange={(e) => patch('training.cancellationPolicy', e.target.value)} /></Field>
              </div>
            )}
            <Repeater title="FAQ" rows={array('faq')} onChange={(rows) => setArray('faq', rows)} empty={{ question: '', answer: '' }} fields={[['question', 'Question'], ['answer', 'Reponse']]} />
            <PreviewCard product={product} />
          </CardContent>
        </Card>
      )}

      {tab === 'modules' && distanciel && (
        <Card><CardContent>
          <ModulesEditor rows={array('modules')} onChange={(rows) => setArray('modules', rows)} />
        </CardContent></Card>
      )}

      {tab === 'sessions' && !distanciel && (
        <Card><CardContent>
          <TrainingSessionsPlanner rows={array('sessions')} onChange={(rows) => setArray('sessions', rows)} />
        </CardContent></Card>
      )}

      {tab === 'promotion' && <PromotionTab product={product} patch={patch} />}
      {tab === 'boost' && <BoostTab product={product} patch={patch} />}
      {tab === 'options' && (
        <Card><CardContent>
          <OptionsEditor rows={array('options')} onChange={(rows) => setArray('options', rows)} />
        </CardContent></Card>
      )}
      {tab === 'evaluation' && <EvaluationTabV2 product={product} patch={patch} />}
      <ConfirmDialog
        open={Boolean(pendingKind)}
        onClose={() => setPendingKind(null)}
        title="Changer le type de formation"
        description="Les contenus incompatibles peuvent être masqués ou archivés. Vérifiez les modules, sessions et règles de réservation après changement."
        confirmLabel="Changer le type"
        onConfirm={() => {
          if (!pendingKind) return;
          patch('kind', pendingKind);
          setTab(pendingKind === 'IN_PERSON_TRAINING' ? 'sessions' : 'modules');
          setPendingKind(null);
        }}
      />
    </CommercePageFrame>
  );
}

function Repeater({
  title,
  rows,
  onChange,
  empty,
  fields,
  multilineKeys = [],
}: {
  title: string;
  rows: Record<string, unknown>[];
  onChange: (rows: Record<string, unknown>[]) => void;
  empty: Record<string, unknown>;
  fields: [string, string][];
  multilineKeys?: string[];
}) {
  const update = (index: number, key: string, value: unknown) => {
    const next = [...rows];
    next[index] = { ...next[index], [key]: value };
    onChange(next);
  };
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Button type="button" variant="outline" onClick={() => onChange([...rows, structuredClone(empty)])}><Plus className="h-4 w-4" /> Ajouter</Button>
      </div>
      {rows.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucune ligne pour le moment.</p>}
      {rows.map((row, index) => (
        <div key={index} className="grid gap-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-sm font-semibold"><GripVertical className="h-4 w-4 text-muted-foreground" /> #{index + 1}</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange(rows.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /> Retirer</Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {fields.map(([key, label]) => (
              <Field key={key} label={label}>
                {typeof row[key] === 'boolean' ? (
                  <Switch checked={Boolean(row[key])} onChange={(v) => update(index, key, v)} label={label} />
                ) : multilineKeys.includes(key) ? (
                  <Textarea value={String(row[key] ?? '')} onChange={(e) => update(index, key, e.target.value)} />
                ) : (
                  <Input value={String(row[key] ?? '')} onChange={(e) => update(index, key, key.toLowerCase().includes('cents') || key === 'capacity' || key === 'reservedCount' ? Number(e.target.value || 0) : e.target.value)} />
                )}
              </Field>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function TrainingSessionsPlanner({
  rows,
  onChange,
}: {
  rows: Record<string, unknown>[];
  onChange: (rows: Record<string, unknown>[]) => void;
}) {
  const sessions = rows.map(normalizeSessionRow);
  const [selectedIndex, setSelectedIndex] = React.useState<number | null>(sessions.length ? 0 : null);
  const selected = selectedIndex === null ? null : sessions[selectedIndex] || null;
  const update = (index: number, patch: Record<string, unknown>) => {
    const next = [...sessions];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };
  const add = () => {
    const start = nextRoundedDate();
    const session = {
      id: uid('session'),
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 7 * 60 * 60 * 1000).toISOString(),
      capacity: 6,
      reservedCount: 0,
      status: 'ACTIVE',
      cancellationReason: '',
      refundPolicy: 'Remboursement selon les conditions de la formation.',
    };
    onChange([...sessions, session]);
    setSelectedIndex(sessions.length);
  };
  const remove = (index: number) => {
    onChange(sessions.filter((_, i) => i !== index));
    setSelectedIndex(null);
  };
  const overlap = selectedIndex === null ? false : hasSessionOverlap(sessions, selectedIndex);
  return (
    <section className="grid gap-5">
      <div className="rounded-lg border bg-primary/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="inline-flex items-center gap-2 text-lg font-semibold"><CalendarDays className="h-5 w-5" /> Planning des sessions</h2>
            <p className="mt-1 text-sm text-muted-foreground">Cliquez une session, ajustez la date, les horaires et la capacite. Les chevauchements sont signales avant enregistrement.</p>
          </div>
          <Button type="button" variant="outline" onClick={add}><Plus className="h-4 w-4" /> Ajouter une session</Button>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <div className="rounded-lg border bg-card">
          <div className="border-b bg-muted/40 px-4 py-3">
            <h3 className="font-semibold">Calendrier</h3>
          </div>
          {sessions.length === 0 ? (
            <p className="m-4 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Aucune session planifiee.</p>
          ) : (
            <div className="grid gap-3 p-4 md:grid-cols-2">
              {sessions.map((session, index) => {
                const start = new Date(String(session.startsAt));
                const end = new Date(String(session.endsAt));
                const active = selectedIndex === index;
                const full = Number(session.capacity || 0) <= Number(session.reservedCount || 0);
                return (
                  <button
                    key={String(session.id || index)}
                    type="button"
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const from = Number(event.dataTransfer.getData('text/plain'));
                      onChange(moveTo(sessions, from, index));
                      setSelectedIndex(index);
                    }}
                    onClick={() => setSelectedIndex(index)}
                    className={`rounded-lg border p-4 text-left transition ${active ? 'border-primary bg-primary/10' : 'bg-background hover:bg-muted/40'}`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2 font-semibold"><GripVertical className="h-4 w-4 text-muted-foreground" /> {formatSessionDay(start)}</span>
                      <StatusBadge>{String(session.status || 'ACTIVE')}</StatusBadge>
                    </span>
                    <span className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Clock className="h-4 w-4" /> {formatTime(start)} - {formatTime(end)}</span>
                    <span className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Users className="h-4 w-4" /> {Number(session.reservedCount || 0)} / {Number(session.capacity || 0)} inscrites</span>
                    {full && <span className="mt-3 inline-flex rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">Complete</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="rounded-lg border bg-card">
          <div className="border-b bg-muted/40 px-4 py-3">
            <h3 className="font-semibold">Configuration</h3>
          </div>
          {!selected || selectedIndex === null ? (
            <p className="p-4 text-sm text-muted-foreground">Selectionnez une session pour la modifier.</p>
          ) : (
            <div className="grid gap-4 p-4">
              {overlap && (
                <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  Cette session chevauche une autre session. Ajustez les horaires avant de publier.
                </p>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Jour">
                  <Input
                    type="date"
                    value={toDateInput(selected.startsAt)}
                    onChange={(event) => update(selectedIndex, shiftSessionDate(selected, event.target.value))}
                  />
                </Field>
                <Field label="Statut">
                  <CustomSelect
                    value={String(selected.status || 'ACTIVE')}
                    onChange={(value) => update(selectedIndex, { status: value })}
                    options={[
                      { value: 'ACTIVE', label: 'Ouverte', description: 'Visible et reservable.' },
                      { value: 'FULL', label: 'Complete', description: 'Visible sans nouvelle reservation.' },
                      { value: 'CANCELLED', label: 'Annulee', description: 'Annulation avec suivi remboursement.' },
                      { value: 'BLOCKED', label: 'Bloquee', description: 'Non disponible temporairement.' },
                    ]}
                  />
                </Field>
                <Field label="Heure de debut">
                  <Input type="time" value={toTimeInput(selected.startsAt)} onChange={(event) => update(selectedIndex, shiftSessionStart(selected, event.target.value))} />
                </Field>
                <Field label="Heure de fin">
                  <Input type="time" value={toTimeInput(selected.endsAt)} onChange={(event) => update(selectedIndex, { endsAt: combineDateTime(selected.startsAt, event.target.value).toISOString() })} />
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
                {[3, 4, 7, 14].map((hours) => (
                  <Button key={hours} type="button" variant="outline" size="sm" onClick={() => update(selectedIndex, { endsAt: new Date(new Date(String(selected.startsAt)).getTime() + hours * 60 * 60 * 1000).toISOString() })}>
                    {hours}h
                  </Button>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Places disponibles">
                  <Input type="number" min="1" value={Number(selected.capacity || 1)} onChange={(event) => update(selectedIndex, { capacity: Number(event.target.value || 1) })} />
                </Field>
                <Field label="Deja inscrites">
                  <Input type="number" min="0" value={Number(selected.reservedCount || 0)} onChange={(event) => update(selectedIndex, { reservedCount: Number(event.target.value || 0) })} />
                </Field>
              </div>
              {String(selected.status || '') === 'CANCELLED' && (
                <div className="grid gap-3 rounded-lg border bg-red-50 p-4">
                  <Field label="Motif transmis aux clientes">
                    <Textarea value={String(selected.cancellationReason || '')} onChange={(event) => update(selectedIndex, { cancellationReason: event.target.value })} />
                  </Field>
                  <Field label="Remboursement / report">
                    <Textarea value={String(selected.refundPolicy || '')} onChange={(event) => update(selectedIndex, { refundPolicy: event.target.value })} />
                  </Field>
                </div>
              )}
              <Button type="button" variant="destructive" onClick={() => remove(selectedIndex)}><Trash2 className="h-4 w-4" /> Supprimer cette session</Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function normalizeSessionRow(row: Record<string, unknown>): Record<string, unknown> {
  const start = validDate(row.startsAt) || nextRoundedDate();
  const end = validDate(row.endsAt) || new Date(start.getTime() + 7 * 60 * 60 * 1000);
  return {
    id: String(row.id || uid('session')),
    ...row,
    startsAt: start.toISOString(),
    endsAt: end > start ? end.toISOString() : new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
    capacity: Number(row.capacity || 1),
    reservedCount: Number(row.reservedCount || 0),
    status: String(row.status || 'ACTIVE'),
  };
}

function validDate(value: unknown) {
  const date = value ? new Date(String(value)) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function nextRoundedDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  date.setHours(9, 0, 0, 0);
  return date;
}

function toDateInput(value: unknown) {
  const date = validDate(value) || new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toTimeInput(value: unknown) {
  const date = validDate(value) || new Date();
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function combineDateTime(anchor: unknown, time: string) {
  const date = validDate(anchor) || new Date();
  const [hours, minutes] = time.split(':').map((part) => Number(part || 0));
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date;
}

function shiftSessionDate(session: Record<string, unknown>, dateValue: string) {
  const start = validDate(session.startsAt) || new Date();
  const end = validDate(session.endsAt) || new Date(start.getTime() + 60 * 60 * 1000);
  const duration = end.getTime() - start.getTime();
  const [year, month, day] = dateValue.split('-').map(Number);
  start.setFullYear(year, (month || 1) - 1, day || 1);
  return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + duration).toISOString() };
}

function shiftSessionStart(session: Record<string, unknown>, time: string) {
  const previousStart = validDate(session.startsAt) || new Date();
  const previousEnd = validDate(session.endsAt) || new Date(previousStart.getTime() + 60 * 60 * 1000);
  const duration = previousEnd.getTime() - previousStart.getTime();
  const nextStart = combineDateTime(previousStart, time);
  return { startsAt: nextStart.toISOString(), endsAt: new Date(nextStart.getTime() + duration).toISOString() };
}

function formatSessionDay(date: Date) {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' }).format(date);
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function hasSessionOverlap(rows: Record<string, unknown>[], currentIndex: number) {
  const current = rows[currentIndex];
  const start = validDate(current?.startsAt)?.getTime() || 0;
  const end = validDate(current?.endsAt)?.getTime() || 0;
  return rows.some((row, index) => {
    if (index === currentIndex) return false;
    const otherStart = validDate(row.startsAt)?.getTime() || 0;
    const otherEnd = validDate(row.endsAt)?.getTime() || 0;
    return start < otherEnd && end > otherStart;
  });
}

function RichTextLite({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const editorRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value]);
  const command = (name: string, argument?: string) => {
    editorRef.current?.focus();
    document.execCommand(name, false, argument);
    onChange(editorRef.current?.innerHTML || '');
  };
  return (
    <Field label={label}>
      <div className="rounded-lg border bg-background">
        <div className="flex flex-wrap items-center gap-1 border-b p-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => command('bold')}>B</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => command('italic')}><span className="italic">I</span></Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => command('underline')}><span className="underline">U</span></Button>
          <span className="mx-1 h-5 w-px bg-border" />
          <Button type="button" size="sm" variant="ghost" onClick={() => command('insertUnorderedList')}>Liste</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => command('formatBlock', 'h3')}>Titre</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => command('removeFormat')}>Nettoyer</Button>
        </div>
        <div
          ref={editorRef}
          contentEditable
          role="textbox"
          aria-multiline="true"
          className="min-h-44 px-4 py-3 text-sm leading-7 outline-none empty:before:text-muted-foreground empty:before:content-['Write_something...']"
          onInput={() => onChange(editorRef.current?.innerHTML || '')}
        />
      </div>
    </Field>
  );
}

function CoverImageField({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  return (
    <div className="grid gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 md:col-span-2">
      <div>
        <LabelLike>Image de couverture</LabelLike>
        <p className="mt-1 text-xs text-muted-foreground">Visuel principal de la fiche. Les sources sont disponibles via le bouton de remplacement.</p>
      </div>
      <ImageUpload
        value={value}
        mediaType="commerce-cover"
        aspect="aspect-[16/10]"
        hint="Couverture catalogue formation/prestation."
        onChange={(url) => onChange(url)}
      />
      {value && (
        <button type="button" className="justify-self-start text-xs font-semibold text-muted-foreground" onClick={() => onChange('')}>
          Retirer l'image
        </button>
      )}
    </div>
  );
}

function LabelLike({ children }: { children: React.ReactNode }) {
  return <span className="text-sm font-medium text-foreground">{children}</span>;
}

function ModulesEditor({
  rows,
  onChange,
}: {
  rows: Record<string, unknown>[];
  onChange: (rows: Record<string, unknown>[]) => void;
}) {
  const modules = rows.map(normalizeModule);
  const [moduleIndex, setModuleIndex] = React.useState<number | null>(null);
  const [resourceEdit, setResourceEdit] = React.useState<{ kind: 'video' | 'file'; index: number } | null>(null);
  const module = moduleIndex === null ? null : modules[moduleIndex] || null;
  const updateModule = (index: number, patch: Record<string, unknown>) => {
    const next = [...modules];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };
  const addModule = () => {
    const next = [...modules, { id: uid('module'), title: `Module ${modules.length + 1}`, description: '', videos: [], files: [], order: modules.length + 1 }];
    onChange(next);
    setModuleIndex(next.length - 1);
  };
  if (module && moduleIndex !== null) {
    const videos = Array.isArray(module.videos) ? module.videos as Record<string, unknown>[] : [];
    const files = Array.isArray(module.files) ? module.files as Record<string, unknown>[] : [];
    if (resourceEdit) {
      const list = resourceEdit.kind === 'video' ? videos : files;
      const row = list[resourceEdit.index];
      const updateResource = (patch: Record<string, unknown>) => {
        const next = [...list];
        next[resourceEdit.index] = { ...next[resourceEdit.index], ...patch };
        updateModule(moduleIndex, { [resourceEdit.kind === 'video' ? 'videos' : 'files']: next });
      };
      const removeResource = () => {
        updateModule(moduleIndex, { [resourceEdit.kind === 'video' ? 'videos' : 'files']: list.filter((_, i) => i !== resourceEdit.index) });
        setResourceEdit(null);
      };
      if (!row) {
        return (
          <section className="grid gap-4">
            <EditorBreadcrumb items={[{ label: 'Formation', onClick: () => setModuleIndex(null) }, { label: 'Modules', onClick: () => setModuleIndex(null) }, { label: String(module.title || `Module ${moduleIndex + 1}`), onClick: () => setResourceEdit(null) }]} />
            <Button type="button" variant="outline" className="justify-self-start" onClick={() => setResourceEdit(null)}><ArrowLeft className="h-4 w-4" /> Retour au module</Button>
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Element introuvable.</p>
          </section>
        );
      }
      return (
        <section className="grid gap-4">
          <EditorBreadcrumb
            items={[
              { label: 'Formation', onClick: () => { setResourceEdit(null); setModuleIndex(null); } },
              { label: 'Modules', onClick: () => { setResourceEdit(null); setModuleIndex(null); } },
              { label: String(module.title || `Module ${moduleIndex + 1}`), onClick: () => setResourceEdit(null) },
              { label: resourceEdit.kind === 'video' ? 'Videos' : 'Fichiers', onClick: () => setResourceEdit(null) },
              { label: String(row.title || `${resourceEdit.kind === 'video' ? 'Video' : 'Fichier'} ${resourceEdit.index + 1}`) },
            ]}
          />
          <Button type="button" variant="outline" className="justify-self-start" onClick={() => setResourceEdit(null)}><ArrowLeft className="h-4 w-4" /> Retour au module</Button>
          <section className="grid gap-4 rounded-lg border bg-card p-4">
            {resourceEdit.kind === 'video' ? (
              <VideoResourceEditor row={row} index={resourceEdit.index} onChange={updateResource} onRemove={removeResource} />
            ) : (
              <FileResourceEditor row={row} index={resourceEdit.index} onChange={updateResource} onRemove={removeResource} />
            )}
          </section>
        </section>
      );
    }
    return (
      <section className="grid gap-4">
        <EditorBreadcrumb
          items={[
            { label: 'Formation', onClick: () => setModuleIndex(null) },
            { label: 'Modules', onClick: () => setModuleIndex(null) },
            { label: String(module.title || `Module ${moduleIndex + 1}`) },
          ]}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="outline" onClick={() => { setResourceEdit(null); setModuleIndex(null); }}><ArrowLeft className="h-4 w-4" /> Retour aux modules</Button>
        </div>
        <div className="grid gap-3 rounded-lg border bg-card p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Titre du module"><Input value={String(module.title || '')} onChange={(e) => updateModule(moduleIndex, { title: e.target.value })} /></Field>
            <Field label="Ordre"><Input type="number" min="1" value={Number(module.order || moduleIndex + 1)} onChange={(e) => updateModule(moduleIndex, { order: Number(e.target.value || moduleIndex + 1) })} /></Field>
            <Field label="Description" className="md:col-span-2"><Textarea value={String(module.description || '')} onChange={(e) => updateModule(moduleIndex, { description: e.target.value })} /></Field>
          </div>
        </div>
        <ResourceList
          kind="video"
          title="Videos"
          rows={videos}
          empty={{ id: uid('video'), title: '', description: '', sourceUrl: '', mp4Url: '', resolvedAt: '', order: videos.length + 1 }}
          path={['Formation', 'Modules', String(module.title || `Module ${moduleIndex + 1}`), 'Videos']}
          onChange={(next) => updateModule(moduleIndex, { videos: next })}
          onEdit={(index) => setResourceEdit({ kind: 'video', index })}
        />
        <ResourceList
          kind="file"
          title="Fichiers"
          rows={files}
          empty={{ id: uid('file'), title: '', description: '', url: '', order: files.length + 1 }}
          path={['Formation', 'Modules', String(module.title || `Module ${moduleIndex + 1}`), 'Fichiers']}
          onChange={(next) => updateModule(moduleIndex, { files: next })}
          onEdit={(index) => setResourceEdit({ kind: 'file', index })}
        />
      </section>
    );
  }
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Modules pedagogiques</h2>
          <p className="text-sm text-muted-foreground">Liste des modules. Entrez dans un module pour gerer ses videos et fichiers.</p>
        </div>
        <Button type="button" variant="outline" onClick={addModule}>
          <Plus className="h-4 w-4" /> Ajouter un module
        </Button>
      </div>
      {modules.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucun module. Ajoutez votre premier module pedagogique.</p>}
      {modules.length > 0 && (
        <div className="max-w-full overflow-x-auto rounded-lg border">
          <table className="min-w-[720px] w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Module</th>
                <th className="px-4 py-3">Videos</th>
                <th className="px-4 py-3">Fichiers</th>
                <th className="px-4 py-3">Ordre</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {modules.map((item, index) => (
                <tr
                  key={String(item.id || index)}
                  className="border-t"
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const from = Number(event.dataTransfer.getData('text/plain'));
                    onChange(moveTo(modules, from, index));
                  }}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-medium"><GripVertical className="h-4 w-4 text-muted-foreground" /> {String(item.title || `Module ${index + 1}`)}</div>
                    <div className="line-clamp-1 text-xs text-muted-foreground">{String(item.description || '')}</div>
                  </td>
                  <td className="px-4 py-3">{Array.isArray(item.videos) ? item.videos.length : 0}</td>
                  <td className="px-4 py-3">{Array.isArray(item.files) ? item.files.length : 0}</td>
                  <td className="px-4 py-3">{Number(item.order || index + 1)}</td>
                  <td className="px-4 py-3 text-right">
                    <Dropdown.Root>
                      <Dropdown.DotsButton aria-label={`Actions module ${index + 1}`} />
                      <Dropdown.Popover className="w-48">
                        <Dropdown.Menu>
                          <Dropdown.Section>
                            <Dropdown.Item onAction={() => setModuleIndex(index)}>Editer</Dropdown.Item>
                            <Dropdown.Item destructive onAction={() => onChange(modules.filter((_, i) => i !== index))}>Supprimer</Dropdown.Item>
                          </Dropdown.Section>
                        </Dropdown.Menu>
                      </Dropdown.Popover>
                    </Dropdown.Root>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EditorBreadcrumb({ items }: { items: { label: string; onClick?: () => void }[] }) {
  return (
    <nav className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-sm">
      {items.map((item, index) => (
        <React.Fragment key={`${item.label}-${index}`}>
          {index > 0 && <span className="text-muted-foreground">/</span>}
          {item.onClick ? (
            <button type="button" onClick={item.onClick} className="font-medium text-primary hover:underline">{item.label}</button>
          ) : (
            <span className="font-semibold">{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

function ResourceList({
  kind,
  title,
  rows,
  empty,
  path,
  onChange,
  onEdit,
}: {
  kind: 'video' | 'file';
  title: string;
  rows: Record<string, unknown>[];
  empty: Record<string, unknown>;
  path: string[];
  onChange: (rows: Record<string, unknown>[]) => void;
  onEdit?: (index: number) => void;
}) {
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const update = (index: number, patch: Record<string, unknown>) => {
    const next = [...rows];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };
  if (editingIndex !== null && rows[editingIndex]) {
    const row = rows[editingIndex];
    return (
      <section className="grid gap-4 rounded-lg border bg-card p-4">
        <EditorBreadcrumb items={[...path.map((label) => ({ label })), { label: String(row.title || `${kind === 'video' ? 'Video' : 'Fichier'} ${editingIndex + 1}`) }]} />
        <Button type="button" variant="outline" className="justify-self-start" onClick={() => setEditingIndex(null)}><ArrowLeft className="h-4 w-4" /> Retour a la liste</Button>
        {kind === 'video' ? (
          <VideoResourceEditor row={row} index={editingIndex} onChange={(patch) => update(editingIndex, patch)} onRemove={() => { onChange(rows.filter((_, i) => i !== editingIndex)); setEditingIndex(null); }} />
        ) : (
          <FileResourceEditor row={row} index={editingIndex} onChange={(patch) => update(editingIndex, patch)} onRemove={() => { onChange(rows.filter((_, i) => i !== editingIndex)); setEditingIndex(null); }} />
        )}
      </section>
    );
  }
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="inline-flex items-center gap-2 font-semibold">{kind === 'video' ? <Video className="h-4 w-4" /> : <FileText className="h-4 w-4" />} {title}</h3>
        <Button type="button" size="sm" variant="outline" onClick={() => { onChange([...rows, structuredClone(empty)]); (onEdit || setEditingIndex)(rows.length); }}><Plus className="h-4 w-4" /> Ajouter</Button>
      </div>
      {rows.length === 0 && <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Aucun item.</p>}
      {rows.length > 0 && (
        <div className="max-w-full overflow-x-auto rounded-lg border">
          <table className="min-w-[620px] w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-3">Titre</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Ordre</th><th className="px-4 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={String(row.id || index)}
                  className="border-t"
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const from = Number(event.dataTransfer.getData('text/plain'));
                    onChange(moveTo(rows, from, index));
                  }}
                >
                  <td className="px-4 py-3 font-medium"><span className="inline-flex items-center gap-2"><GripVertical className="h-4 w-4 text-muted-foreground" /> {String(row.title || `${kind === 'video' ? 'Video' : 'Fichier'} ${index + 1}`)}</span></td>
                  <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">{String(row.sourceUrl || row.url || row.fileId || '')}</td>
                  <td className="px-4 py-3">{Number(row.order || index + 1)}</td>
                  <td className="px-4 py-3 text-right">
                    <Dropdown.Root>
                      <Dropdown.DotsButton aria-label={`Actions ${kind === 'video' ? 'video' : 'fichier'} ${index + 1}`} />
                      <Dropdown.Popover className="w-48">
                        <Dropdown.Menu>
                          <Dropdown.Section>
                            <Dropdown.Item onAction={() => (onEdit || setEditingIndex)(index)}>Editer</Dropdown.Item>
                            <Dropdown.Item destructive onAction={() => onChange(rows.filter((_, i) => i !== index))}>Supprimer</Dropdown.Item>
                          </Dropdown.Section>
                        </Dropdown.Menu>
                      </Dropdown.Popover>
                    </Dropdown.Root>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function VideoResourceEditor({
  row,
  index,
  onChange,
  onRemove,
}: {
  row: Record<string, unknown>;
  index: number;
  onChange: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const [resolving, setResolving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [videoModal, setVideoModal] = React.useState(false);
  const [draftUrl, setDraftUrl] = React.useState(String(row.sourceUrl || row.url || ''));
  const [imported, setImported] = React.useState(false);
  const shortcode = String(row.streamableShortcode || '').trim();
  const canPreview = Boolean(shortcode);

  async function resolve() {
    setError('');
    setImported(false);
    setResolving(true);
    try {
      if (!/^https:\/\/(?:www\.)?streamable\.com\/[a-z0-9]{4,12}(?:[/?#].*)?$/i.test(draftUrl.trim())) {
        throw new Error('Collez une URL Streamable du type https://streamable.com/mrr2f4');
      }
      const resolved = await api.resolveStreamableVideo(draftUrl);
      onChange({
        provider: 'STREAMABLE',
        sourceUrl: resolved.sourceUrl,
        url: resolved.sourceUrl,
        streamUrl: '',
        streamPath: '',
        playbackUrl: '',
        mp4Url: '',
        fileId: '',
        streamableShortcode: resolved.shortcode,
        resolvedAt: resolved.resolvedAt,
        playbackUrlExpiresAt: '',
        qualityLabel: '',
        durationMs: 0,
        size: resolved.size,
      });
      setImported(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation de la video impossible');
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-lg border bg-background p-4">
      <div className="flex items-center justify-between gap-3">
        <strong>Video {index + 1}</strong>
        <Button type="button" size="sm" variant="ghost" onClick={onRemove}><Trash2 className="h-4 w-4" /> Retirer</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Titre"><Input value={String(row.title || '')} onChange={(e) => onChange({ title: e.target.value })} /></Field>
        <div className="flex items-end">
          <Button type="button" variant="outline" onClick={() => { setDraftUrl(String(row.sourceUrl || row.url || '')); setError(''); setImported(false); setVideoModal(true); }}>
            <Video className="h-4 w-4" /> {canPreview ? 'Remplacer la video' : 'Ajouter la video'}
          </Button>
        </div>
        <Field label="Description" className="md:col-span-2"><Textarea value={String(row.description || '')} onChange={(e) => onChange({ description: e.target.value })} /></Field>
        <div className="md:col-span-2">
          <CoverImageField value={String(row.coverUrl || '')} onChange={(url) => onChange({ coverUrl: url })} />
        </div>
      </div>
      {canPreview && <p className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Video importee. Elle sera chargee au moment de la lecture.</p>}
      {canPreview && <CustomVideoPlayer shortcode={shortcode} title={String(row.title || `Video ${index + 1}`)} />}
      <Modal
        open={videoModal}
        onClose={() => !resolving && setVideoModal(false)}
        title={canPreview ? 'Remplacer la video' : 'Ajouter la video'}
        description="Collez uniquement une URL Streamable publique."
        className="max-w-2xl"
        busy={resolving}
      >
        <div className="grid gap-4">
          {!resolving && !imported && (
            <Field label="URL Streamable">
              <Input value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)} placeholder="https://streamable.com/mrr2f4" />
            </Field>
          )}
          {resolving && (
            <div className="rounded-lg border bg-muted/20 p-5">
              <div className="flex items-center gap-3 text-sm font-semibold">
                <Loader2 className="h-5 w-5 animate-spin" />
                Preparation de la video
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
              </div>
            </div>
          )}
          {error && <p className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle className="h-4 w-4" /> {error}</p>}
          {imported && (
            <div className="grid gap-4">
              <p className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Video importee</p>
              <CustomVideoPlayer shortcode={String(row.streamableShortcode || '')} title={String(row.title || `Video ${index + 1}`)} />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setVideoModal(false)} disabled={resolving}>{imported ? 'OK' : 'Annuler'}</Button>
            {!imported && <Button type="button" onClick={resolve} loading={resolving}>Valider</Button>}
          </div>
        </div>
      </Modal>
    </div>
  );
}

function FileResourceEditor({
  row,
  index,
  onChange,
  onRemove,
}: {
  row: Record<string, unknown>;
  index: number;
  onChange: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const [modalOpen, setModalOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [error, setError] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const hasFile = Boolean(row.url);

  async function importFile() {
    if (!file) {
      setError('Choisissez un fichier avant de valider.');
      return;
    }
    setImporting(true);
    setError('');
    try {
      const uploaded = await uploadCommerceTrainingFile(file);
      onChange({
        url: uploaded.url,
        sourceUrl: uploaded.url,
        fileName: uploaded.name,
        mimeType: uploaded.mimeType,
        size: uploaded.size,
        uploadedAt: uploaded.uploadedAt,
      });
      setModalOpen(false);
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import impossible');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-lg border bg-background p-4">
      <div className="flex items-center justify-between gap-3">
        <strong>Fichier {index + 1}</strong>
        <Button type="button" size="sm" variant="ghost" onClick={onRemove}><Trash2 className="h-4 w-4" /> Retirer</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Titre"><Input value={String(row.title || '')} onChange={(e) => onChange({ title: e.target.value })} /></Field>
        <div className="flex items-end">
          <Button type="button" variant="outline" onClick={() => { setError(''); setFile(null); setModalOpen(true); }}>
            <FileText className="h-4 w-4" /> {hasFile ? 'Remplacer le fichier' : 'Importer le fichier'}
          </Button>
        </div>
        <Field label="Description" className="md:col-span-2"><Textarea value={String(row.description || '')} onChange={(e) => onChange({ description: e.target.value })} /></Field>
      </div>
      {hasFile && (
        <div className="rounded-md border bg-muted/20 p-3 text-sm">
          <p className="font-semibold">{String(row.fileName || row.title || 'Fichier importe')}</p>
          <a href={String(row.url)} target="_blank" rel="noreferrer" className="mt-1 inline-block break-all text-xs text-muted-foreground underline">
            Ouvrir le fichier
          </a>
        </div>
      )}
      <Modal
        open={modalOpen}
        onClose={() => !importing && setModalOpen(false)}
        title={hasFile ? 'Remplacer le fichier' : 'Importer le fichier'}
        description="Glissez un fichier ici ou choisissez-le depuis votre appareil."
        className="max-w-xl"
        busy={importing}
      >
        <div className="grid gap-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const dropped = event.dataTransfer.files?.[0];
              if (dropped) setFile(dropped);
            }}
            className="grid min-h-44 place-items-center rounded-lg border border-dashed bg-muted/20 p-6 text-center"
          >
            <span>
              <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
              <span className="mt-3 block font-semibold">{file ? file.name : 'Drag and drop or import'}</span>
              <span className="mt-1 block text-xs text-muted-foreground">PDF, image, video ou document de support.</span>
            </span>
          </button>
          <input ref={inputRef} type="file" className="hidden" onChange={(event) => setFile(event.target.files?.[0] || null)} />
          {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={importing} onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button type="button" loading={importing} onClick={importFile}>Valider</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function CustomVideoPlayer({ shortcode, title }: { shortcode?: string; title: string }) {
  const ref = React.useRef<HTMLVideoElement | null>(null);
  const shellRef = React.useRef<HTMLDivElement | null>(null);
  const { company } = useCompany();
  const [src, setSrc] = React.useState('');
  const [loadingSource, setLoadingSource] = React.useState(Boolean(shortcode));
  const [sourceError, setSourceError] = React.useState('');
  const [playing, setPlaying] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [current, setCurrent] = React.useState(0);
  const [volume, setVolume] = React.useState(0.9);
  const [muted, setMuted] = React.useState(false);
  const [speed, setSpeed] = React.useState('1');
  const [fullscreen, setFullscreen] = React.useState(false);
  const [volumeOpen, setVolumeOpen] = React.useState(false);
  const [speedOpen, setSpeedOpen] = React.useState(false);
  const companyName = company?.name?.trim() || 'BeautySavage';

  React.useEffect(() => {
    let alive = true;
    if (!shortcode) {
      setSrc('');
      setLoadingSource(false);
      return () => { alive = false; };
    }
    setLoadingSource(true);
    setSourceError('');
    api.streamablePlaybackUrl(shortcode)
      .then((resolved) => {
        if (!alive) return;
        setSrc(resolved.playbackUrl);
      })
      .catch((err) => {
        if (!alive) return;
        setSourceError(err instanceof Error ? err.message : 'Source video Streamable introuvable');
        setSrc('');
      })
      .finally(() => {
        if (alive) setLoadingSource(false);
    });
    return () => { alive = false; };
  }, [shortcode]);

  React.useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [muted, volume]);

  React.useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.playbackRate = Number(speed || 1);
  }, [speed, src]);

  React.useEffect(() => {
    let frame = 0;
    const tick = () => {
      const video = ref.current;
      if (video && !video.paused) {
        setCurrent(video.currentTime || 0);
        setProgress(video.duration ? (video.currentTime / video.duration) * 100 : 0);
        frame = window.requestAnimationFrame(tick);
      }
    };
    if (playing) frame = window.requestAnimationFrame(tick);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [playing]);

  React.useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  React.useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!shellRef.current?.contains(event.target as Node)) {
        setVolumeOpen(false);
        setSpeedOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const toggle = () => {
    const video = ref.current;
    if (!video || !src) return;
    if (video.paused) void video.play();
    else video.pause();
  };
  const seek = (delta: number) => {
    const video = ref.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta));
    setCurrent(video.currentTime || 0);
    setProgress(video.duration ? (video.currentTime / video.duration) * 100 : 0);
  };
  const toggleFullscreen = async () => {
    if (!shellRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    else await shellRef.current.requestFullscreen().catch(() => {});
  };
  const handleVideoError = React.useCallback(() => {
    setSourceError('Streamable a refuse ce flux temporaire. Cliquez sur recharger la source pour en demander une nouvelle.');
    setSrc('');
  }, []);
  const reloadTemporarySource = React.useCallback(() => {
    if (!shortcode) return;
    setLoadingSource(true);
    setSourceError('');
    api.streamablePlaybackUrl(shortcode)
      .then((resolved) => setSrc(resolved.playbackUrl))
      .catch((err) => {
        setSrc('');
        setSourceError(err instanceof Error ? err.message : 'Source video Streamable introuvable');
      })
      .finally(() => setLoadingSource(false));
  }, [shortcode]);
  const formatTime = (value: number) => {
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };
  return (
    <div
      ref={shellRef}
      className="overflow-hidden rounded-lg border bg-black text-white shadow-sm"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="relative aspect-video w-full bg-black">
        {loadingSource && <div className="absolute inset-0 grid place-items-center text-sm text-white/70"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Chargement de la video</div>}
        {!loadingSource && sourceError && !src && (
          <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-red-200">
            <div className="grid gap-3">
              <span>{sourceError}</span>
              {shortcode && (
                <button type="button" onClick={reloadTemporarySource} className="justify-self-center rounded-md border border-white/30 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10">
                  Recharger la video
                </button>
              )}
            </div>
          </div>
        )}
        {src && (
          <video
            ref={ref}
            src={src}
            className="h-full w-full bg-black object-contain"
            playsInline
            preload="metadata"
            controls={false}
            controlsList="nodownload noplaybackrate noremoteplayback"
            disablePictureInPicture
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
            onError={handleVideoError}
            onTimeUpdate={(event) => {
              const video = event.currentTarget;
              setCurrent(video.currentTime || 0);
              setProgress(video.duration ? (video.currentTime / video.duration) * 100 : 0);
            }}
          />
        )}
        {src && (
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? 'Mettre en pause' : 'Lire'}
            className="absolute inset-0 z-10 cursor-pointer bg-transparent"
          />
        )}
        <div className="pointer-events-none absolute left-3 top-3 z-20 inline-flex items-center gap-2 rounded-full bg-black/45 px-3 py-1 text-xs font-semibold text-white/85 backdrop-blur">
          <Shield className="h-3.5 w-3.5 text-primary" />
          <span>{companyName}</span>
        </div>
      </div>
      <div className="grid gap-3 border-t border-white/10 bg-gradient-to-r from-primary/35 via-black to-primary/20 p-3">
        <input
          type="range"
          min="0"
          max="1000"
          value={Math.round(progress * 10)}
          onChange={(event) => {
            const video = ref.current;
            const next = Number(event.target.value) / 10;
            setProgress(next);
            if (video && duration) {
              video.currentTime = (next / 100) * duration;
              setCurrent(video.currentTime || 0);
            }
          }}
          className="h-2 w-full cursor-pointer accent-primary"
          aria-label="Progression video"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" onClick={toggle} disabled={!src || loadingSource} className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow disabled:opacity-50" aria-label={playing ? 'Pause' : 'Lecture'}>
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
            <button type="button" onClick={() => seek(-10)} disabled={!src} className="hidden h-9 w-9 items-center justify-center rounded-md text-white/85 hover:bg-white/10 disabled:opacity-40 sm:inline-flex" aria-label="Reculer de 10 secondes">
              <Rewind className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => seek(10)} disabled={!src} className="hidden h-9 w-9 items-center justify-center rounded-md text-white/85 hover:bg-white/10 disabled:opacity-40 sm:inline-flex" aria-label="Avancer de 10 secondes">
              <FastForward className="h-4 w-4" />
            </button>
            <span className="hidden text-xs tabular-nums text-white/75 sm:inline">{formatTime(current)} / {formatTime(duration)}</span>
          </div>
          <p className="min-w-0 flex-1 truncate px-1 text-xs font-semibold sm:text-sm">{title}</p>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <div className="relative">
              <button type="button" onClick={() => { setVolumeOpen((value) => !value); setSpeedOpen(false); }} disabled={!src} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-white/85 hover:bg-white/10 disabled:opacity-40" aria-label={muted ? 'Activer le son' : 'Regler le son'}>
              {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
              {volumeOpen && (
                <div className="absolute bottom-11 right-0 z-30 rounded-lg border border-white/15 bg-black/90 p-3 shadow-xl">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(volume * 100)}
                    onChange={(event) => {
                      const next = Number(event.target.value) / 100;
                      setVolume(next);
                      setMuted(next === 0);
                    }}
                    className="w-28 accent-primary"
                    aria-label="Volume"
                  />
                  <button type="button" className="mt-2 w-full rounded px-2 py-1 text-xs hover:bg-white/10" onClick={() => setMuted((value) => !value)}>
                    {muted ? 'Activer' : 'Couper'}
                  </button>
                </div>
              )}
            </div>
            <div className="relative">
              <button type="button" onClick={() => { setSpeedOpen((value) => !value); setVolumeOpen(false); }} disabled={!src} className="inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-xs font-semibold text-white/85 hover:bg-white/10 disabled:opacity-40" aria-label="Vitesse">
                {speed}x
              </button>
              {speedOpen && (
                <div className="absolute bottom-11 right-0 z-30 min-w-28 rounded-lg border border-white/15 bg-black/90 p-1 shadow-xl">
                  {['0.75', '1', '1.25', '1.5', '2'].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className="flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-xs hover:bg-white/10"
                      onClick={() => {
                        setSpeed(value);
                        setSpeedOpen(false);
                      }}
                    >
                      <span>{value}x</span>
                      {speed === value && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={toggleFullscreen} disabled={!src} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-white/85 hover:bg-white/10 disabled:opacity-40" aria-label={fullscreen ? 'Quitter le plein ecran' : 'Plein ecran'}>
              {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResourceLinkCard({
  icon,
  title,
  description,
  titleValue,
  urlValue,
  onTitle,
  onUrl,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  titleValue: string;
  urlValue: string;
  onTitle: (value: string) => void;
  onUrl: (value: string) => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</div>
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="grid gap-3">
        <Field label="Titre affiche"><Input value={titleValue} onChange={(e) => onTitle(e.target.value)} /></Field>
        <Field label="Lien"><Input value={urlValue} onChange={(e) => onUrl(e.target.value)} placeholder="https://..." /></Field>
      </div>
    </div>
  );
}

function TrailerResourceCard({
  titleValue,
  sourceUrl,
  shortcode,
  onPatch,
}: {
  titleValue: string;
  sourceUrl: string;
  shortcode: string;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const [modalOpen, setModalOpen] = React.useState(false);
  const [draftUrl, setDraftUrl] = React.useState(sourceUrl || '');
  const [resolving, setResolving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [imported, setImported] = React.useState(false);

  async function resolve() {
    setError('');
    setImported(false);
    setResolving(true);
    try {
      if (!/^https:\/\/(?:www\.)?streamable\.com\/[a-z0-9]{4,12}(?:[/?#].*)?$/i.test(draftUrl.trim())) {
        throw new Error('Collez une URL Streamable du type https://streamable.com/mrr2f4');
      }
      const resolved = await api.resolveStreamableVideo(draftUrl);
      onPatch({
        sourceUrl: resolved.sourceUrl,
        url: '',
        streamableShortcode: resolved.shortcode,
        provider: 'STREAMABLE',
        resolvedAt: resolved.resolvedAt,
      });
      setImported(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation de la bande-annonce impossible');
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Video className="h-5 w-5" /></div>
        <div>
          <h3 className="font-semibold">Bande-annonce</h3>
          <p className="text-sm text-muted-foreground">Video Streamable visible sur la fiche formation.</p>
        </div>
      </div>
      <div className="grid gap-3">
        <Field label="Titre affiche"><Input value={titleValue} onChange={(e) => onPatch({ title: e.target.value })} /></Field>
        <Button type="button" variant="outline" onClick={() => { setDraftUrl(sourceUrl || ''); setError(''); setImported(false); setModalOpen(true); }}>
          <Video className="h-4 w-4" /> {shortcode ? 'Remplacer la bande-annonce' : 'Ajouter la bande-annonce'}
        </Button>
        {shortcode && <p className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Bande-annonce importee.</p>}
        {shortcode && <CustomVideoPlayer shortcode={shortcode} title={titleValue || 'Bande-annonce'} />}
      </div>
      <Modal
        open={modalOpen}
        onClose={() => !resolving && setModalOpen(false)}
        title={shortcode ? 'Remplacer la bande-annonce' : 'Ajouter la bande-annonce'}
        description="Collez uniquement une URL Streamable publique."
        className="max-w-2xl"
        busy={resolving}
      >
        <div className="grid gap-4">
          {!resolving && !imported && (
            <Field label="URL Streamable">
              <Input value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)} placeholder="https://streamable.com/mrr2f4" />
            </Field>
          )}
          {resolving && (
            <div className="rounded-lg border bg-muted/20 p-5">
              <div className="flex items-center gap-3 text-sm font-semibold">
                <Loader2 className="h-5 w-5 animate-spin" />
                Preparation de la video
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
              </div>
            </div>
          )}
          {error && <p className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle className="h-4 w-4" /> {error}</p>}
          {imported && <p className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Bande-annonce importee</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)} disabled={resolving}>{imported ? 'OK' : 'Annuler'}</Button>
            {!imported && <Button type="button" onClick={resolve} loading={resolving}>Valider</Button>}
          </div>
        </div>
      </Modal>
    </div>
  );
}

function OptionsEditor({
  rows,
  onChange,
}: {
  rows: Record<string, unknown>[];
  onChange: (rows: Record<string, unknown>[]) => void;
}) {
  const update = (index: number, patch: Record<string, unknown>) => {
    const next = [...rows];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Options vendables</h2>
          <p className="text-sm text-muted-foreground">Ajoutez seulement ce que la cliente comprend : nom, supplement, description.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => onChange([...rows, { label: '', description: '', priceCents: 0, active: true }])}>
          <Plus className="h-4 w-4" /> Ajouter une option
        </Button>
      </div>
      {rows.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucune option pour le moment.</p>}
      {rows.map((row, index) => (
        <div key={index} className="grid gap-4 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <strong>Option {index + 1}</strong>
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange(rows.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /> Retirer</Button>
          </div>
          <div className="grid gap-3 lg:grid-cols-[1fr_150px_auto]">
            <Field label="Nom">
              <Input value={String(row.label ?? '')} onChange={(e) => update(index, { label: e.target.value })} placeholder="Kit support, coaching, materiel..." />
            </Field>
            <Field label="Prix">
              <div className="flex h-10 items-center rounded-md border bg-background px-3">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={Number(row.priceCents || 0) / 100}
                  onChange={(e) => update(index, { priceCents: Math.round(Number(e.target.value || 0) * 100) })}
                  className="h-8 border-0 px-0 focus-visible:ring-0"
                />
                <Euro className="h-4 w-4 text-muted-foreground" />
              </div>
            </Field>
            <div className="flex items-end pb-2">
              <Switch checked={row.active !== false} onChange={(active) => update(index, { active })} label="Option active" />
            </div>
            <Field label="Description" className="lg:col-span-3">
              <Textarea value={String(row.description ?? '')} onChange={(e) => update(index, { description: e.target.value })} />
            </Field>
          </div>
        </div>
      ))}
    </section>
  );
}

function PromotionTab({ product, patch }: { product: Partial<CommerceProduct>; patch: (path: string, value: unknown) => void }) {
  const enabled = readPath(product, 'promotion.enabled', false);
  const type = readPath(product, 'promotion.type', 'PERCENT');
  const value = Number(readPath(product, 'promotion.value', 0));
  const base = product.price?.amountCents || 0;
  const reduction = enabled ? Math.min(base, type === 'PERCENT' ? Math.round(base * value / 100) : Math.round(value * 100)) : 0;
  return (
    <Card><CardContent className="grid gap-4">
      <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Promotion</h2><Switch checked={enabled} onChange={(v) => patch('promotion.enabled', v)} label="Activer la promotion" /></div>
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Type">
          <CustomSelect
            value={String(type)}
            onChange={(value) => patch('promotion.type', value)}
            options={[
              { value: 'PERCENT', label: 'Pourcentage' },
              { value: 'FIXED', label: 'Montant fixe' },
            ]}
          />
        </Field>
        <Field label={type === 'PERCENT' ? 'Pourcentage' : 'Montant EUR'}><Input type="number" min="0" value={value} onChange={(e) => patch('promotion.value', Number(e.target.value || 0))} /></Field>
        <Field label="Debut"><Input type="date" value={readPath(product, 'promotion.startsAt', '')} onChange={(e) => patch('promotion.startsAt', e.target.value)} /></Field>
        <Field label="Fin"><Input type="date" value={readPath(product, 'promotion.endsAt', '')} onChange={(e) => patch('promotion.endsAt', e.target.value)} /></Field>
      </div>
      <p className="rounded-md border bg-muted/30 p-3 text-sm">Prix catalogue {cents(base)} · reduction {cents(reduction)} · prix final {cents(base - reduction)}</p>
    </CardContent></Card>
  );
}

function BoostTab({ product, patch }: { product: Partial<CommerceProduct>; patch: (path: string, value: unknown) => void }) {
  return (
    <Card><CardContent className="grid gap-4">
      <Field label="Rang de mise en avant (1 a 3)">
        <Input type="number" min="1" max="3" value={product.boostRank ?? ''} onChange={(e) => patch('boostRank', e.target.value ? Number(e.target.value) : null)} />
      </Field>
      <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
        Le manager empêche les doublons lors du classement global : maximum trois formations mises en avant. Les ventes conservent leur snapshot meme si le boost change.
      </p>
      <PreviewCard product={product} />
    </CardContent></Card>
  );
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function moveTo<T>(rows: T[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return rows;
  const next = [...rows];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function normalizeEvaluationSections(rows: Record<string, unknown>[]) {
  return rows.map((section, index) => {
    const legacyQuestion = section.questionType || section.answersText;
    const items = Array.isArray(section.items)
      ? section.items as Record<string, unknown>[]
      : legacyQuestion
        ? [{
          id: uid('q'),
          label: section.title || `Question ${index + 1}`,
          prompt: section.description || '',
          type: section.questionType || 'SINGLE',
          required: section.required ?? true,
          options: String(section.answersText || '').split('\n').filter(Boolean).map((label) => ({ id: uid('a'), label, correct: false })),
          correctAnswerText: '',
          points: 1,
        }]
        : [];
    return {
      id: section.id || uid('sec'),
      title: section.title || `Section ${index + 1}`,
      description: section.description || '',
      collapsed: Boolean(section.collapsed),
      items,
    };
  });
}

function questionOptions(item: Record<string, unknown>) {
  const type = String(item.type || 'SINGLE');
  if (type === 'TRUE_FALSE') {
    const correct = Array.isArray(item.correctOptionIds) ? item.correctOptionIds as string[] : [];
    return [
      { id: 'true', label: 'Vrai', correct: correct.includes('true') },
      { id: 'false', label: 'Faux', correct: correct.includes('false') },
    ];
  }
  if (Array.isArray(item.options)) return item.options as Record<string, unknown>[];
  return String(item.optionsText || '')
    .split('\n')
    .map((label) => label.trim())
    .filter(Boolean)
    .map((label) => ({ id: uid('a'), label, correct: false }));
}

function EvaluationTabV2({
  product,
  patch,
}: {
  product: Partial<CommerceProduct>;
  patch: (path: string, value: unknown) => void;
}) {
  const [subtab, setSubtab] = React.useState<'questionnaire' | 'deliverables'>('questionnaire');
  const sections = normalizeEvaluationSections(readPath<Record<string, unknown>[]>(product, 'evaluation.sections', []));
  const deliverables = readPath<Record<string, unknown>[]>(product, 'evaluation.deliverables', []);
  return (
    <Card><CardContent className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Evaluation finale</h2>
          <p className="mt-1 text-sm text-muted-foreground">Definition versionnee avec livrables et questionnaire par sections.</p>
        </div>
        <Switch checked={readPath(product, 'evaluation.enabled', false)} onChange={(v) => patch('evaluation.enabled', v)} label="Activer l'evaluation" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <Field label="Version">
          <Input type="number" min="1" value={readPath(product, 'evaluation.version', 1)} onChange={(e) => patch('evaluation.version', Number(e.target.value || 1))} />
        </Field>
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Resultat visible cliente</p>
              <p className="text-xs text-muted-foreground">Si actif, la cliente voit son score apres soumission. Les corrections restent reservees au manager.</p>
            </div>
            <Switch checked={readPath(product, 'evaluation.showScoreToCustomer', false)} onChange={(v) => patch('evaluation.showScoreToCustomer', v)} label="Afficher le score au client" />
          </div>
        </div>
      </div>
      <SegmentedControl
        value={subtab}
        onChange={setSubtab}
        options={[
          { value: 'questionnaire', label: 'Questionnaire' },
          { value: 'deliverables', label: 'Livrables' },
        ]}
      />
      {subtab === 'questionnaire' ? (
        <QuestionnaireEditor sections={sections} onChange={(rows) => patch('evaluation.sections', rows)} />
      ) : (
        <DeliverablesEditor rows={deliverables} onChange={(rows) => patch('evaluation.deliverables', rows)} />
      )}
      <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
        Les bonnes reponses ne sont jamais envoyees au client. Le score visible est optionnel et calcule sans exposer la correction.
      </p>
    </CardContent></Card>
  );
}

function QuestionnaireEditor({
  sections,
  onChange,
}: {
  sections: Record<string, unknown>[];
  onChange: (rows: Record<string, unknown>[]) => void;
}) {
  const [sectionIndex, setSectionIndex] = React.useState<number | null>(null);
  const [questionIndex, setQuestionIndex] = React.useState<number | null>(null);
  const updateSection = (index: number, patch: Record<string, unknown>) => {
    const next = [...sections];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };
  const updateItems = (sectionIndex: number, items: Record<string, unknown>[]) => updateSection(sectionIndex, { items });
  const addSection = () => {
    onChange([...sections, { id: uid('sec'), title: `Section ${sections.length + 1}`, description: '', collapsed: false, items: [] }]);
    setSectionIndex(sections.length);
    setQuestionIndex(null);
  };
  const selectedSection = sectionIndex !== null ? sections[sectionIndex] : null;
  const selectedItems = selectedSection && Array.isArray(selectedSection.items) ? selectedSection.items as Record<string, unknown>[] : [];
  const selectedQuestion = questionIndex !== null ? selectedItems[questionIndex] : null;

  if (selectedSection && selectedQuestion && sectionIndex !== null && questionIndex !== null) {
    return (
      <section className="grid gap-4">
        <EditorBreadcrumb
          items={[
            { label: 'Evaluation', onClick: () => { setSectionIndex(null); setQuestionIndex(null); } },
            { label: String(selectedSection.title || `Section ${sectionIndex + 1}`), onClick: () => setQuestionIndex(null) },
            { label: String(selectedQuestion.label || `Question ${questionIndex + 1}`) },
          ]}
        />
        <Button type="button" variant="outline" className="justify-self-start" onClick={() => setQuestionIndex(null)}>
          <ArrowLeft className="h-4 w-4" /> Retour aux questions
        </Button>
        <QuestionItemEditor
          item={selectedQuestion}
          index={questionIndex}
          onRemove={() => {
            updateItems(sectionIndex, selectedItems.filter((_, i) => i !== questionIndex));
            setQuestionIndex(null);
          }}
          onChange={(patch) => {
            const next = [...selectedItems];
            next[questionIndex] = { ...next[questionIndex], ...patch };
            updateItems(sectionIndex, next);
          }}
        />
      </section>
    );
  }

  if (selectedSection && sectionIndex !== null) {
    return (
      <section className="grid gap-4">
        <EditorBreadcrumb
          items={[
            { label: 'Evaluation', onClick: () => { setSectionIndex(null); setQuestionIndex(null); } },
            { label: String(selectedSection.title || `Section ${sectionIndex + 1}`) },
          ]}
        />
        <Button type="button" variant="outline" className="justify-self-start" onClick={() => setSectionIndex(null)}>
          <ArrowLeft className="h-4 w-4" /> Retour aux sections
        </Button>
        <div className="rounded-lg border bg-card p-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="Titre de section">
              <Input value={String(selectedSection.title || '')} onChange={(event) => updateSection(sectionIndex, { title: event.target.value })} />
            </Field>
            <div className="flex items-end gap-3">
              <Switch checked={!Boolean(selectedSection.collapsed)} onChange={(value) => updateSection(sectionIndex, { collapsed: !value })} label="Section ouverte" />
              <span className="pb-1 text-sm text-muted-foreground">Ouverte dans l'editeur</span>
            </div>
            <Field label="Description / consignes" className="lg:col-span-2">
              <Textarea value={String(selectedSection.description || '')} onChange={(event) => updateSection(sectionIndex, { description: event.target.value })} />
            </Field>
          </div>
        </div>
        <div className="rounded-lg border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div>
              <h3 className="text-base font-semibold">Questions</h3>
              <p className="text-sm text-muted-foreground">Chaque question s'edite sur son propre etage.</p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                updateItems(sectionIndex, [...selectedItems, { id: uid('q'), type: 'SINGLE', label: `Question ${selectedItems.length + 1}`, prompt: '', required: true, points: 1, options: [{ id: uid('a'), label: 'Reponse 1', correct: true }, { id: uid('a'), label: 'Reponse 2', correct: false }], correctOptionIds: [] }]);
                setQuestionIndex(selectedItems.length);
              }}
            >
              <Plus className="h-4 w-4" /> Ajouter une question
            </Button>
          </div>
          {selectedItems.length === 0 ? (
            <p className="m-4 rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucune question dans cette section.</p>
          ) : (
            <div className="max-w-full overflow-x-auto">
              <table className="min-w-[760px] w-full text-left text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-4 py-3">Question</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Points</th><th className="px-4 py-3">Obligatoire</th><th className="px-4 py-3">Actions</th></tr>
                </thead>
                <tbody>
                  {selectedItems.map((item, index) => (
                    <tr key={String(item.id || index)} className="border-t">
                      <td className="px-4 py-3 font-medium">{String(item.label || `Question ${index + 1}`)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{String(item.type || 'SINGLE')}</td>
                      <td className="px-4 py-3">{Number(item.points || 0)}</td>
                      <td className="px-4 py-3">{item.required === false ? 'Non' : 'Oui'}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Button type="button" size="sm" variant="outline" onClick={() => setQuestionIndex(index)}>Editer</Button>
                        <Button type="button" size="icon" variant="ghost" aria-label="Supprimer" onClick={() => updateItems(sectionIndex, selectedItems.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Questionnaire final</h3>
          <p className="text-sm text-muted-foreground">Structure a etages : sections, puis questions, puis reponses.</p>
        </div>
        <Button type="button" variant="outline" onClick={addSection}>
          <Plus className="h-4 w-4" /> Ajouter une section
        </Button>
      </div>
      {sections.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucune section. Ajoutez une premiere section puis ses questions.</p>}
      {sections.length > 0 && (
        <div className="max-w-full overflow-x-auto rounded-lg border">
          <table className="min-w-[760px] w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-3">Section</th><th className="px-4 py-3">Questions</th><th className="px-4 py-3">Etat</th><th className="px-4 py-3">Actions</th></tr>
            </thead>
            <tbody>
              {sections.map((section, index) => {
        const items = Array.isArray(section.items) ? section.items as Record<string, unknown>[] : [];
        return (
                  <tr key={String(section.id || index)} className="border-t">
                    <td className="px-4 py-3">
                      <div className="font-medium">{String(section.title || `Section ${index + 1}`)}</div>
                      {Boolean(section.description) && <div className="max-w-md truncate text-xs text-muted-foreground">{String(section.description)}</div>}
                    </td>
                    <td className="px-4 py-3">{items.length}</td>
                    <td className="px-4 py-3">{section.collapsed ? 'Repliee' : 'Ouverte'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <Button type="button" size="sm" variant="outline" onClick={() => { setSectionIndex(index); setQuestionIndex(null); }}>Editer</Button>
                        <Button type="button" size="icon" variant="ghost" aria-label="Supprimer" onClick={() => onChange(sections.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </td>
                  </tr>
        );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function QuestionItemEditor({
  item,
  index,
  onChange,
  onRemove,
}: {
  item: Record<string, unknown>;
  index: number;
  onChange: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-sm font-semibold"><GripVertical className="h-4 w-4 text-muted-foreground" /> Question {index + 1}</span>
        <div className="flex gap-1">
          <Button type="button" size="icon" variant="ghost" aria-label="Supprimer la question" onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Field label="Intitule"><Input value={String(item.label || '')} onChange={(e) => onChange({ label: e.target.value })} /></Field>
        <Field label="Type">
          <CustomSelect
            value={String(item.type || 'SINGLE')}
            onChange={(value) => onChange({
              type: value,
              options: value === 'TRUE_FALSE' ? [] : questionOptions(item).filter((option) => !['true', 'false'].includes(String(option.id))),
              correctOptionIds: value === 'TRUE_FALSE' ? ['true'] : [],
            })}
            options={[
              { value: 'TRUE_FALSE', label: 'Vrai / faux' },
              { value: 'SINGLE', label: '1 bonne reponse' },
              { value: 'MULTIPLE', label: 'Choix multiple' },
            ]}
          />
        </Field>
        <Field label="Question / consigne" className="lg:col-span-2"><Textarea value={String(item.prompt || '')} onChange={(e) => onChange({ prompt: e.target.value })} /></Field>
        <div className="lg:col-span-2">
          <AnswerOptionsEditor item={item} onChange={onChange} />
        </div>
        <Field label="Points"><Input type="number" min="0" value={Number(item.points || 0)} onChange={(e) => onChange({ points: Number(e.target.value || 0) })} /></Field>
        <div className="flex items-end gap-3">
          <Switch checked={Boolean(item.required)} onChange={(v) => onChange({ required: v })} label="Question obligatoire" />
          <span className="pb-1 text-sm text-muted-foreground">Obligatoire</span>
        </div>
      </div>
    </div>
  );
}

function AnswerOptionsEditor({ item, onChange }: { item: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void }) {
  const type = String(item.type || 'SINGLE');
  const options = questionOptions(item);
  const correctIds = new Set((Array.isArray(item.correctOptionIds) ? item.correctOptionIds : options.filter((option) => option.correct).map((option) => String(option.id))) as string[]);
  const updateOptions = (next: Record<string, unknown>[]) => onChange({ options: next, correctOptionIds: next.filter((option) => option.correct).map((option) => String(option.id)) });
  const setCorrect = (id: string, checked: boolean) => {
    if (type === 'TRUE_FALSE') return onChange({ correctOptionIds: [id] });
    const next = options.map((option) => ({
      ...option,
      correct: type === 'SINGLE' ? String(option.id) === id : String(option.id) === id ? checked : Boolean(option.correct),
    }));
    updateOptions(next);
  };
  return (
    <div className="grid gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">Reponses</p>
        {type !== 'TRUE_FALSE' && (
          <Button type="button" size="sm" variant="outline" onClick={() => updateOptions([...options, { id: uid('a'), label: `Reponse ${options.length + 1}`, correct: false }])}>
            <Plus className="h-4 w-4" /> Ajouter
          </Button>
        )}
      </div>
      <div className="max-w-full overflow-x-auto rounded-md border bg-card">
        <table className="min-w-[560px] w-full text-left text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr><th className="px-3 py-2">Bonne</th><th className="px-3 py-2">Reponse</th><th className="px-3 py-2">Actions</th></tr>
          </thead>
          <tbody>
            {options.map((option, index) => {
              const id = String(option.id || index);
              const checked = correctIds.has(id) || Boolean(option.correct);
              return (
                <tr key={id} className="border-t">
                  <td className="px-3 py-2">
                    <input type={type === 'MULTIPLE' ? 'checkbox' : 'radio'} checked={checked} onChange={(event) => setCorrect(id, event.target.checked)} />
                  </td>
                  <td className="px-3 py-2">
                    {type === 'TRUE_FALSE' ? (
                      <span className="font-medium">{String(option.label)}</span>
                    ) : (
                      <Input value={String(option.label || '')} onChange={(event) => {
                        const next = [...options];
                        next[index] = { ...next[index], label: event.target.value };
                        updateOptions(next);
                      }} />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {type !== 'TRUE_FALSE' && (
                      <div className="flex gap-1">
                        <Button type="button" size="icon" variant="ghost" aria-label="Supprimer" onClick={() => updateOptions(options.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeliverablesEditor({ rows, onChange }: { rows: Record<string, unknown>[]; onChange: (rows: Record<string, unknown>[]) => void }) {
  const update = (index: number, patch: Record<string, unknown>) => {
    const next = [...rows];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };
  const add = (type: 'PHOTO_BEFORE_AFTER' | 'VIDEO' | 'PHOTO_GALLERY') => {
    onChange([
      ...rows,
      {
        id: uid('liv'),
        type,
        label: type === 'VIDEO' ? 'Video de pratique' : type === 'PHOTO_GALLERY' ? 'Galerie photo finale' : 'Photo avant / apres',
        description: '',
        required: true,
        maxDurationSeconds: type === 'VIDEO' ? 120 : 0,
        maxImages: type === 'PHOTO_GALLERY' ? 6 : 0,
      },
    ]);
  };
  return (
    <section className="grid gap-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Livrables demandes</h3>
          <p className="text-sm text-muted-foreground">Les livrables attendus au final : photos avant/apres et videos, avec contraintes visibles cote cliente.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => add('PHOTO_BEFORE_AFTER')}><FileText className="h-4 w-4" /> Photo avant/apres</Button>
          <Button type="button" variant="outline" onClick={() => add('VIDEO')}><Video className="h-4 w-4" /> Video</Button>
          <Button type="button" variant="outline" onClick={() => add('PHOTO_GALLERY')}><FileText className="h-4 w-4" /> Galerie photo</Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucun livrable. Ajoutez au moins une photo avant/apres ou une video si la certification le demande.</p>
      ) : (
        <div className="grid gap-3">
          {rows.map((row, index) => {
            const type = String(row.type || 'PHOTO_BEFORE_AFTER') as 'PHOTO_BEFORE_AFTER' | 'VIDEO' | 'PHOTO_GALLERY';
            return (
              <div key={String(row.id || index)} className="rounded-lg border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                    Livrable {index + 1}
                    <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{type === 'VIDEO' ? 'Video' : type === 'PHOTO_GALLERY' ? 'Galerie photo' : 'Avant / apres'}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button type="button" size="icon" variant="ghost" aria-label="Supprimer" onClick={() => onChange(rows.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <Field label="Type">
                    <CustomSelect
                      value={type}
                      onChange={(value) => update(index, { type: value, maxDurationSeconds: value === 'VIDEO' ? Number(row.maxDurationSeconds || 120) : 0, maxImages: value === 'PHOTO_GALLERY' ? Number(row.maxImages || 6) : 0 })}
                      options={[
                        { value: 'PHOTO_BEFORE_AFTER', label: 'Photo avant / apres' },
                        { value: 'VIDEO', label: 'Video' },
                        { value: 'PHOTO_GALLERY', label: 'Galerie photo' },
                      ]}
                    />
                  </Field>
                  <Field label="Libelle">
                    <Input value={String(row.label || '')} onChange={(event) => update(index, { label: event.target.value })} />
                  </Field>
                  <Field label="Description / consigne" className="lg:col-span-2">
                    <Textarea value={String(row.description || '')} onChange={(event) => update(index, { description: event.target.value })} />
                  </Field>
                  {type === 'VIDEO' && (
                    <Field label="Duree max video (secondes)">
                      <Input type="number" min="1" value={Number(row.maxDurationSeconds || 120)} onChange={(event) => update(index, { maxDurationSeconds: Number(event.target.value || 0) })} />
                    </Field>
                  )}
                  {type === 'PHOTO_GALLERY' && (
                    <Field label="Nombre max de photos">
                      <Input type="number" min="1" max="20" value={Number(row.maxImages || 6)} onChange={(event) => update(index, { maxImages: Number(event.target.value || 1) })} />
                    </Field>
                  )}
                  <div className="flex items-end gap-3">
                    <Switch checked={row.required !== false} onChange={(value) => update(index, { required: value })} label="Livrable obligatoire" />
                    <span className="pb-1 text-sm text-muted-foreground">{row.required === false ? 'Facultatif' : 'Obligatoire'}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function EvaluationTab({
  product,
  patch,
}: {
  product: Partial<CommerceProduct>;
  patch: (path: string, value: unknown) => void;
}) {
  const sections = readPath<Record<string, unknown>[]>(product, 'evaluation.sections', []);
  return (
    <Card><CardContent className="grid gap-4">
      <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Evaluation finale</h2><Switch checked={readPath(product, 'evaluation.enabled', false)} onChange={(v) => patch('evaluation.enabled', v)} label="Activer l'evaluation" /></div>
      <Field label="Version"><Input type="number" min="1" value={readPath(product, 'evaluation.version', 1)} onChange={(e) => patch('evaluation.version', Number(e.target.value || 1))} /></Field>
      <Repeater
        title="Sections et questions"
        rows={sections}
        onChange={(rows) => patch('evaluation.sections', rows)}
        empty={{ title: '', description: '', questionType: 'SINGLE', required: true, answersText: '' }}
        fields={[['title', 'Section'], ['description', 'Description'], ['questionType', 'Type question'], ['answersText', 'Reponses / corrections'], ['required', 'Obligatoire']]}
        multilineKeys={['description', 'answersText']}
      />
      <Repeater
        title="Livrables"
        rows={readPath<Record<string, unknown>[]>(product, 'evaluation.deliverables', [])}
        onChange={(rows) => patch('evaluation.deliverables', rows)}
        empty={{ type: 'PHOTO_BEFORE_AFTER', label: '', required: true, maxDurationSeconds: 0 }}
        fields={[['type', 'Type'], ['label', 'Libelle'], ['required', 'Obligatoire'], ['maxDurationSeconds', 'Duree max video secondes']]}
      />
      <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
        L'aperçu client ne doit jamais afficher les bonnes réponses ni le score. La validation finale se traite dans la page Validation formations.
      </p>
    </CardContent></Card>
  );
}

void EvaluationTab;

function PreviewCard({ product }: { product: Partial<CommerceProduct> }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Eye className="h-4 w-4" /> Apercu fiche vitrine</div>
      <div className="rounded-lg border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{product.kind ? KIND_LABEL[product.kind] : 'Formation'}</p>
        <h3 className="mt-2 text-xl font-semibold">{product.title || 'Titre de la formation'}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{product.subtitle || product.description || 'Description visible par les clientes.'}</p>
        <p className="mt-4 font-semibold">{cents(product.price?.amountCents || 0)}</p>
      </div>
    </div>
  );
}
