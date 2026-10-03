import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, AlignLeft, ArrowLeft, CalendarDays, CalendarX, CheckCircle2, ClipboardList, Clock, Euro, Eye, FileText, Film, Layers, Link2, ListOrdered, Loader2, MapPin, MessageCircle, Plus, Tag, Timer, Trash2, Type, Unlock, Video } from 'lucide-react';
import { DragHandle, SortableList } from '@/components/ui/Sortable';
import { api, uploadCommerceTrainingFile } from '@/lib/api';
import { ImageUpload } from '@/components/fields/ImageUpload';
import { Button, Card, CardContent, Field, Input, SegmentedControl, Switch, Textarea } from '@/components/ui/primitives';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Dropdown } from '@/components/base/dropdown/dropdown';
import { CommercePageFrame, KIND_LABEL, PromotionStateBadge, cents, type CommerceProduct, type ProductKind } from './CommerceShared';
import { ToneSection, toneTabClass, type EditorTone } from './editorTones';
import { OptionsManager } from './OptionsManager';
import { ProductSeoSection } from './ProductSeoSection';
import { PublicationStatusWidget } from './PublicationStatusWidget';
import { FormSkeleton } from '@/components/ui/Skeleton';
import { CustomVideoPlayer } from '@/components/CustomVideoPlayer';
import { SessionsPlanner, type PlannerSession } from './SessionsPlanner';
import { FormationHoursTab, formationDayTemplate } from './FormationHoursTab';
import { FloatingSaveWidget } from '@/components/ui/FloatingSaveWidget';
import { useFloatingSave } from '@/hooks/useFloatingSave';
import { useGuardedNavigate } from '@/components/LeaveGuard';

type TabId = 'infos' | 'horaires' | 'modules' | 'sessions' | 'promotion' | 'options' | 'evaluation';

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
  const [loaded, setLoaded] = React.useState(false);
  const [pendingKind, setPendingKind] = React.useState<ProductKind | null>(null);

  React.useEffect(() => {
    if (creation) return;
    api.commerceProducts().then((items) => {
      const found = (items as CommerceProduct[]).find((item) => item._id === id);
      if (found) { setProduct({ ...EMPTY, ...found }); setLoaded(true); }
      else setMessage('Formation introuvable.');
    }).catch((err) => setMessage(err instanceof Error ? err.message : 'Chargement impossible'));
  }, [creation, id]);

  const kind = (product.kind || 'DISTANCE_TRAINING') as ProductKind;
  const distanciel = kind === 'DISTANCE_TRAINING';
  const tabs = [
    { id: 'infos', label: 'Informations', tone: 'infos' },
    ...(distanciel ? [] : [{ id: 'horaires' as const, label: 'Horaires', tone: 'sessions' as const }]),
    distanciel ? { id: 'modules', label: 'Modules pédagogiques', tone: 'modules' } : { id: 'sessions', label: 'Planning des sessions', tone: 'sessions' },
    { id: 'promotion', label: 'Promotion', tone: 'promotion' },
    { id: 'options', label: 'Options', tone: 'options' },
    { id: 'evaluation', label: 'Évaluation finale', tone: 'evaluation' },
  ] satisfies { id: TabId; label: string; tone: EditorTone }[];

  const patch = (path: string, value: unknown) => setProduct((p) => writePath(p as Record<string, unknown>, path, value) as Partial<CommerceProduct>);
  const array = (path: keyof CommerceProduct) => (product[path] as Record<string, unknown>[] | undefined) ?? [];
  const setArray = (path: keyof CommerceProduct, rows: Record<string, unknown>[]) => patch(String(path), rows);
  // Les sessions arrivent du serveur après chaque opération : on les pose sans toucher au reste.
  const onSessions = React.useCallback((rows: PlannerSession[]) => setProduct((p) => ({ ...p, sessions: rows })), []);

  /**
   * ENREGISTREMENT FLOTTANT — comme les autres écrans d'édition du Manager :
   * « Enregistré » tant que rien n'a bougé, « Enregistrer » dès la première
   * modification, et la garde « Quitter sans enregistrer ? » entre les deux.
   * Les sessions sont hors comparaison : elles s'enregistrent d'elles-mêmes.
   */
  const { state: saveState, save } = useFloatingSave<Partial<CommerceProduct>>(
    creation || loaded ? product : null,
    async () => {
      const { sessions: _sessions, ...rest } = product;
      void _sessions;
      const saved = await api.saveCommerceProduct({
        ...rest,
        options: normalizeCommerceOptions(array('options')),
        modules: normalizeModulesForSave(array('modules')),
        id: creation ? undefined : id,
        amountCents: product.price?.amountCents ?? 0,
        distanceDeliveryMode: distanciel ? readPath(product, 'training.accessMode', 'IMMEDIATE') : null,
        requiresLegalWaiver: distanciel,
      });
      const next = { ...EMPTY, ...(saved as CommerceProduct) };
      setProduct(next);
      setMessage('');
      if (creation) navigate(`/commerce/formations/${(saved as CommerceProduct)._id}`, { replace: true });
      return next;
    },
    (a, b) => JSON.stringify({ ...a, sessions: undefined }) === JSON.stringify({ ...b, sessions: undefined }),
  );
  const leave = useGuardedNavigate();

  // Fiche existante encore en chargement : contenu fantôme, pas un formulaire vide.
  if (!creation && !loaded && !message) {
    return (
      <CommercePageFrame title="Chargement de la fiche…" description="Récupération de la fiche et de ses réglages.">
        <FormSkeleton fields={6} />
      </CommercePageFrame>
    );
  }

  return (
    <CommercePageFrame
      title={creation ? 'Nouvelle formation' : product.title || 'Formation'}
      description="Préparez la fiche vendue sur la vitrine : informations, contenu, dates, offres, options et évaluation."
      actions={<Button variant="outline" onClick={() => leave('/commerce/formations')}><ArrowLeft className="h-4 w-4" /> Retour</Button>}
    >
      {message && <p className="rounded-md border p-3 text-sm text-muted-foreground">{message}</p>}
      <div className="flex gap-2 overflow-x-auto rounded-lg border bg-card p-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium ${toneTabClass(item.tone, tab === item.id)}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'infos' && (
        <ToneSection tone="infos" title="Informations" description="Ce que la vitrine affiche sur la fiche formation.">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Nom de la formation" icon={<Tag />}><Input value={product.title || ''} onChange={(e) => patch('title', e.target.value)} /></Field>
              <Field label="Type de formation" icon={<Layers />}>
                <SegmentedControl
                  value={kind}
                  onChange={(v) => {
                    if (!creation) { setPendingKind(v as ProductKind); return; }
                    patch('kind', v);
                    setTab(v === 'IN_PERSON_TRAINING' ? 'sessions' : 'modules');
                  }}
                  options={[
                    { value: 'DISTANCE_TRAINING', label: 'Distanciel' },
                    { value: 'IN_PERSON_TRAINING', label: 'Présentiel' },
                  ]}
                />
              </Field>
              <Field label="Prix TTC" unit="€" icon={<Euro />}><Input type="number" min="0" step="0.01" value={(product.price?.amountCents || 0) / 100} onChange={(e) => patch('price.amountCents', Math.round(Number(e.target.value || 0) * 100))} /></Field>
              <CoverImageField value={product.coverUrl || ''} onChange={(url) => patch('coverUrl', url)} />
            </div>
            <Field label="Description courte" icon={<AlignLeft />} hint="Une phrase, affichée sur les cartes du catalogue."><Input value={product.subtitle || ''} onChange={(e) => patch('subtitle', e.target.value)} /></Field>
            <RichTextLite label="Description détaillée" value={product.description || ''} onChange={(value) => patch('description', value)} />
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
                description="Lien d'accompagnement transmis aux clientes inscrites."
                titleValue={readPath(product, 'whatsappGroup.title', '')}
                urlValue={readPath(product, 'whatsappGroup.url', '')}
                onTitle={(value) => patch('whatsappGroup.title', value)}
                onUrl={(value) => patch('whatsappGroup.url', value)}
              />
            </div>
            {distanciel ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Mode de délivrance" icon={<Unlock />}>
                  <CustomSelect
                    value={readPath(product, 'training.accessMode', 'IMMEDIATE')}
                    onChange={(value) => patch('training.accessMode', value)}
                    options={[
                      { value: 'IMMEDIATE', label: 'Accès immédiat', description: 'La cliente accède au contenu après paiement.' },
                      { value: 'MANUAL', label: 'Délivrance manuelle', description: "L'institut ouvre l'accès après vérification." },
                    ]}
                  />
                </Field>
                <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                  Les clientes savent clairement quand leur formation sera disponible après l'achat.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Durée" unit="jours" icon={<Clock />}><Input type="number" min="1" value={readPath(product, 'training.durationDays', 1)} onChange={(e) => patch('training.durationDays', Number(e.target.value || 1))} /></Field>
                <Field label="Lieu" icon={<MapPin />} hint="Adresse affichée sur la fiche de la formation."><Input value={readPath(product, 'training.location', '')} onChange={(e) => patch('training.location', e.target.value)} /></Field>
                <Field label="Formalités" icon={<ClipboardList />} hint="Ce que la stagiaire doit prévoir ou apporter."><Textarea value={readPath(product, 'training.formalities', '')} onChange={(e) => patch('training.formalities', e.target.value)} /></Field>
                <Field label="Politique d'annulation" icon={<CalendarX />}><Textarea value={readPath(product, 'training.cancellationPolicy', '')} onChange={(e) => patch('training.cancellationPolicy', e.target.value)} /></Field>
              </div>
            )}
            <ToneSection tone="faq" level="nested" title="FAQ" description="Affichée sous la fiche, dans « Questions fréquentes ». Faites glisser la poignée pour changer l'ordre.">
              <Repeater title="Questions" rows={array('faq')} onChange={(rows) => setArray('faq', rows)} empty={{ question: '', answer: '' }} fields={[['question', 'Question'], ['answer', 'Réponse']]} multilineKeys={['answer']} />
            </ToneSection>
            <PreviewCard product={product} />
            <ProductSeoSection productId={creation ? null : id} seo={product.seo} onChange={(seo) => patch('seo', seo)} />
        </ToneSection>
      )}

      {tab === 'modules' && distanciel && (
        <ModulesEditor rows={array('modules')} onChange={(rows) => setArray('modules', rows)} />
      )}

      {tab === 'horaires' && !distanciel && (
        <FormationHoursTab
          training={product.training as Record<string, unknown> | undefined}
          onChange={({ durationDays, dayHours }) => setProduct((p) => ({ ...p, training: { ...((p.training as Record<string, unknown>) || {}), durationDays, dayHours } }) as Partial<CommerceProduct>)}
        />
      )}

      {tab === 'sessions' && !distanciel && (
        <ToneSection tone="sessions" title="Planning des sessions" description="Dates, horaires, places et inscrites de chaque session en présentiel.">
          <SessionsPlanner
            productId={creation ? null : id || null}
            sessions={array('sessions') as unknown as PlannerSession[]}
            dayTemplate={formationDayTemplate(product.training as Record<string, unknown> | undefined)}
            onSessions={onSessions}
          />
        </ToneSection>
      )}

      {tab === 'promotion' && <PromotionTab product={product} patch={patch} />}
      {tab === 'options' && (
        <OptionsManager rows={array('options')} onChange={(rows) => setArray('options', rows)} subject="la formation" />
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
      <FloatingSaveWidget state={saveState} onSave={save} before={creation || loaded ? <PublicationStatusWidget value={product.status} onChange={(status) => patch('status', status)} /> : null} />
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
      <SortableList
        items={rows}
        onChange={onChange}
        renderItem={(row, { itemProps, handleProps, remove, index }) => (
        <div {...itemProps} className="grid gap-3 rounded-lg border bg-card p-4" data-testid="repeater-row">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1 text-sm font-semibold"><DragHandle label={`Déplacer la ligne ${index + 1}`} {...handleProps} /> #{index + 1}</span>
            <Button type="button" size="sm" variant="ghost" onClick={remove}><Trash2 className="h-4 w-4" /> Retirer</Button>
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
        )}
      />
    </section>
  );
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
          data-placeholder="Rédigez la description…"
          className="min-h-44 px-4 py-3 text-sm leading-7 outline-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]"
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
        <p className="mt-1 text-xs text-muted-foreground">Visuel principal de la fiche. Le bouton ouvre le choix : appareil, URL ou bibliothèque.</p>
      </div>
      <ImageUpload
        value={value}
        mediaType="commerce-cover"
        aspect="aspect-[16/10]"
        hint="Couverture de la fiche dans le catalogue."
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
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Élément introuvable.</p>
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
              { label: resourceEdit.kind === 'video' ? 'Vidéos' : 'Fichiers', onClick: () => setResourceEdit(null) },
              { label: String(row.title || `${resourceEdit.kind === 'video' ? 'Vidéo' : 'Fichier'} ${resourceEdit.index + 1}`) },
            ]}
          />
          <Button type="button" variant="outline" className="justify-self-start" onClick={() => setResourceEdit(null)}><ArrowLeft className="h-4 w-4" /> Retour au module</Button>
          <ToneSection
            tone={resourceEdit.kind === 'video' ? 'video' : 'file'}
            icon={resourceEdit.kind === 'video' ? <Video className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
            title={String(row.title || `${resourceEdit.kind === 'video' ? 'Vidéo' : 'Fichier'} ${resourceEdit.index + 1}`)}
            description={resourceEdit.kind === 'video' ? `Vidéo du module « ${String(module.title || `Module ${moduleIndex + 1}`)} »` : `Fichier du module « ${String(module.title || `Module ${moduleIndex + 1}`)} »`}
          >
            {resourceEdit.kind === 'video' ? (
              <VideoResourceEditor row={row} index={resourceEdit.index} onChange={updateResource} onRemove={removeResource} />
            ) : (
              <FileResourceEditor row={row} index={resourceEdit.index} onChange={updateResource} onRemove={removeResource} />
            )}
          </ToneSection>
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
        <ToneSection tone="module" title={String(module.title || `Module ${moduleIndex + 1}`)} description="Titre, ordre et présentation du module.">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Titre du module" icon={<Tag />}><Input value={String(module.title || '')} onChange={(e) => updateModule(moduleIndex, { title: e.target.value })} /></Field>
            <Field label="Ordre d'affichage" icon={<ListOrdered />}><Input type="number" min="1" value={Number(module.order || moduleIndex + 1)} onChange={(e) => updateModule(moduleIndex, { order: Number(e.target.value || moduleIndex + 1) })} /></Field>
            <Field label="Description" icon={<AlignLeft />} className="md:col-span-2"><Textarea value={String(module.description || '')} onChange={(e) => updateModule(moduleIndex, { description: e.target.value })} /></Field>
          </div>
        </ToneSection>
        <ResourceList
          kind="video"
          title="Vidéos"
          rows={videos}
          empty={{ id: uid('video'), title: '', description: '', sourceUrl: '', mp4Url: '', resolvedAt: '', order: videos.length + 1 }}
          path={['Formation', 'Modules', String(module.title || `Module ${moduleIndex + 1}`), 'Vidéos']}
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
    <ToneSection
      tone="modules"
      title="Modules pédagogiques"
      description="Liste des modules. Entrez dans un module pour gérer ses vidéos et fichiers ; faites glisser la poignée pour changer l'ordre."
      actions={(
        <Button type="button" variant="outline" onClick={addModule}>
          <Plus className="h-4 w-4" /> Ajouter un module
        </Button>
      )}
    >
      {modules.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucun module. Ajoutez votre premier module pédagogique.</p>}
      {modules.length > 0 && (
        <div className="m-table max-w-full overflow-x-auto rounded-lg border bg-card">
          <table className="min-w-[720px] w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-12 px-2 py-3"><span className="sr-only">Déplacer</span></th>
                <th className="px-4 py-3">Module</th>
                <th className="m-hide px-4 py-3">Vidéos</th>
                <th className="m-hide px-4 py-3">Fichiers</th>
                <th className="m-hide px-4 py-3">Ordre</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <SortableList
                items={modules}
                onChange={(next) => onChange(next.map((m, i) => ({ ...m, order: i + 1 })))}
                renderItem={(item, { itemProps, handleProps, index }) => (
                <tr {...itemProps} className="border-t bg-card" data-testid="module-row">
                  <td className="w-px px-2 py-2"><DragHandle label={`Déplacer le module ${index + 1}`} {...handleProps} /></td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{String(item.title || `Module ${index + 1}`)}</div>
                    <div className="line-clamp-1 text-xs text-muted-foreground">{String(item.description || '')}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground sm:hidden">
                      {Array.isArray(item.videos) ? item.videos.length : 0} vidéo(s) · {Array.isArray(item.files) ? item.files.length : 0} fichier(s)
                    </div>
                  </td>
                  <td className="m-hide px-4 py-3">{Array.isArray(item.videos) ? item.videos.length : 0}</td>
                  <td className="m-hide px-4 py-3">{Array.isArray(item.files) ? item.files.length : 0}</td>
                  <td className="m-hide px-4 py-3">{Number(item.order || index + 1)}</td>
                  <td className="px-4 py-3 text-right">
                    <Dropdown.Root>
                      <Dropdown.DotsButton aria-label={`Actions module ${index + 1}`} />
                      <Dropdown.Popover className="w-48">
                        <Dropdown.Menu>
                          <Dropdown.Section>
                            <Dropdown.Item onAction={() => setModuleIndex(index)}>Modifier</Dropdown.Item>
                            <Dropdown.Item destructive onAction={() => onChange(modules.filter((_, i) => i !== index))}>Supprimer</Dropdown.Item>
                          </Dropdown.Section>
                        </Dropdown.Menu>
                      </Dropdown.Popover>
                    </Dropdown.Root>
                  </td>
                </tr>
                )}
              />
            </tbody>
          </table>
        </div>
      )}
    </ToneSection>
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
        <EditorBreadcrumb items={[...path.map((label) => ({ label })), { label: String(row.title || `${kind === 'video' ? 'Vidéo' : 'Fichier'} ${editingIndex + 1}`) }]} />
        <Button type="button" variant="outline" className="justify-self-start" onClick={() => setEditingIndex(null)}><ArrowLeft className="h-4 w-4" /> Retour à la liste</Button>
        {kind === 'video' ? (
          <VideoResourceEditor row={row} index={editingIndex} onChange={(patch) => update(editingIndex, patch)} onRemove={() => { onChange(rows.filter((_, i) => i !== editingIndex)); setEditingIndex(null); }} />
        ) : (
          <FileResourceEditor row={row} index={editingIndex} onChange={(patch) => update(editingIndex, patch)} onRemove={() => { onChange(rows.filter((_, i) => i !== editingIndex)); setEditingIndex(null); }} />
        )}
      </section>
    );
  }
  return (
    <ToneSection
      tone={kind === 'video' ? 'video' : 'file'}
      level="nested"
      icon={kind === 'video' ? <Video className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
      title={`${title} (${rows.length})`}
      actions={<Button type="button" size="sm" variant="outline" onClick={() => { onChange([...rows, structuredClone(empty)]); (onEdit || setEditingIndex)(rows.length); }}><Plus className="h-4 w-4" /> Ajouter</Button>}
    >
      {rows.length === 0 && <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Aucun élément pour le moment.</p>}
      {rows.length > 0 && (
        <div className="m-table max-w-full overflow-x-auto rounded-lg border bg-card">
          <table className="min-w-[620px] w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="w-12 px-2 py-3"><span className="sr-only">Déplacer</span></th><th className="px-4 py-3">Titre</th><th className="m-hide px-4 py-3">Source</th><th className="m-hide px-4 py-3">Ordre</th><th className="px-4 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody>
              <SortableList
                items={rows}
                onChange={(next) => onChange(next.map((r, i) => ({ ...r, order: i + 1 })))}
                renderItem={(row, { itemProps, handleProps, index }) => (
                <tr {...itemProps} className="border-t bg-card" data-testid="resource-row">
                  <td className="w-px px-2 py-2"><DragHandle label={`Déplacer ${kind === 'video' ? 'la vidéo' : 'le fichier'} ${index + 1}`} {...handleProps} /></td>
                  <td className="px-4 py-3 font-medium">{String(row.title || `${kind === 'video' ? 'Vidéo' : 'Fichier'} ${index + 1}`)}</td>
                  <td className="m-hide max-w-xs truncate px-4 py-3 text-muted-foreground">{String(row.sourceUrl || row.url || row.fileId || '')}</td>
                  <td className="m-hide px-4 py-3">{Number(row.order || index + 1)}</td>
                  <td className="px-4 py-3 text-right">
                    <Dropdown.Root>
                      <Dropdown.DotsButton aria-label={`Actions ${kind === 'video' ? 'vidéo' : 'fichier'} ${index + 1}`} />
                      <Dropdown.Popover className="w-48">
                        <Dropdown.Menu>
                          <Dropdown.Section>
                            <Dropdown.Item onAction={() => (onEdit || setEditingIndex)(index)}>Modifier</Dropdown.Item>
                            <Dropdown.Item destructive onAction={() => onChange(rows.filter((_, i) => i !== index))}>Supprimer</Dropdown.Item>
                          </Dropdown.Section>
                        </Dropdown.Menu>
                      </Dropdown.Popover>
                    </Dropdown.Root>
                  </td>
                </tr>
                )}
              />
            </tbody>
          </table>
        </div>
      )}
    </ToneSection>
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
      setError(err instanceof Error ? err.message : 'Validation de la vidéo impossible');
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-lg border bg-background p-4">
      <div className="flex items-center justify-between gap-3">
        <strong>Vidéo {index + 1}</strong>
        <Button type="button" size="sm" variant="ghost" onClick={onRemove}><Trash2 className="h-4 w-4" /> Retirer</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Titre de la vidéo" icon={<Type />}><Input value={String(row.title || '')} onChange={(e) => onChange({ title: e.target.value })} /></Field>
        <div className="flex items-end">
          <Button type="button" variant="outline" onClick={() => { setDraftUrl(String(row.sourceUrl || row.url || '')); setError(''); setImported(false); setVideoModal(true); }}>
            <Video className="h-4 w-4" /> {canPreview ? 'Remplacer la vidéo' : 'Ajouter la vidéo'}
          </Button>
        </div>
        <Field label="Description" icon={<AlignLeft />} className="md:col-span-2"><Textarea value={String(row.description || '')} onChange={(e) => onChange({ description: e.target.value })} /></Field>
        <div className="md:col-span-2">
          <CoverImageField value={String(row.coverUrl || '')} onChange={(url) => onChange({ coverUrl: url })} />
        </div>
      </div>
      {canPreview && <p className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Vidéo importée. Elle sera chargée au moment de la lecture.</p>}
      {canPreview && <CustomVideoPlayer shortcode={shortcode} title={String(row.title || `Vidéo ${index + 1}`)} />}
      <Modal
        open={videoModal}
        onClose={() => !resolving && setVideoModal(false)}
        title={canPreview ? 'Remplacer la vidéo' : 'Ajouter la vidéo'}
        description="Collez uniquement une URL Streamable publique."
        className="max-w-2xl"
        busy={resolving}
      >
        <div className="grid gap-4">
          {!resolving && !imported && (
            <Field label="URL Streamable" icon={<Link2 />}>
              <Input value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)} placeholder="https://streamable.com/mrr2f4" />
            </Field>
          )}
          {resolving && (
            <div className="rounded-lg border bg-muted/20 p-5">
              <div className="flex items-center gap-3 text-sm font-semibold">
                <Loader2 className="h-5 w-5 animate-spin" />
                Préparation de la vidéo
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
              </div>
            </div>
          )}
          {error && <p className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle className="h-4 w-4" /> {error}</p>}
          {imported && (
            <div className="grid gap-4">
              <p className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Vidéo importée</p>
              <CustomVideoPlayer shortcode={String(row.streamableShortcode || '')} title={String(row.title || `Vidéo ${index + 1}`)} />
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
        <Field label="Titre du fichier" icon={<Type />}><Input value={String(row.title || '')} onChange={(e) => onChange({ title: e.target.value })} /></Field>
        <div className="flex items-end">
          <Button type="button" variant="outline" onClick={() => { setError(''); setFile(null); setModalOpen(true); }}>
            <FileText className="h-4 w-4" /> {hasFile ? 'Remplacer le fichier' : 'Importer le fichier'}
          </Button>
        </div>
        <Field label="Description" icon={<AlignLeft />} className="md:col-span-2"><Textarea value={String(row.description || '')} onChange={(e) => onChange({ description: e.target.value })} /></Field>
      </div>
      {hasFile && (
        <div className="rounded-md border bg-muted/20 p-3 text-sm">
          <p className="font-semibold">{String(row.fileName || row.title || 'Fichier importé')}</p>
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
              <span className="mt-3 block font-semibold">{file ? file.name : 'Glissez un fichier ici ou importez-le'}</span>
              <span className="mt-1 block text-xs text-muted-foreground">PDF, image, vidéo ou document de support.</span>
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
    <ToneSection tone="social" level="nested" icon={icon} title={title} description={description}>
      <Field label="Titre affiché" icon={<Type />}><Input value={titleValue} onChange={(e) => onTitle(e.target.value)} /></Field>
      <Field label="Lien" icon={<Link2 />}><Input value={urlValue} onChange={(e) => onUrl(e.target.value)} placeholder="https://…" /></Field>
    </ToneSection>
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
    <ToneSection tone="video" level="nested" icon={<Video className="h-4 w-4" />} title="Bande-annonce" description="Vidéo Streamable visible sur la fiche formation.">
      <div className="grid gap-3">
        <Field label="Titre affiché" icon={<Film />}><Input value={titleValue} onChange={(e) => onPatch({ title: e.target.value })} /></Field>
        <Button type="button" variant="outline" onClick={() => { setDraftUrl(sourceUrl || ''); setError(''); setImported(false); setModalOpen(true); }}>
          <Video className="h-4 w-4" /> {shortcode ? 'Remplacer la bande-annonce' : 'Ajouter la bande-annonce'}
        </Button>
        {shortcode && <p className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Bande-annonce importée.</p>}
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
            <Field label="URL Streamable" icon={<Link2 />}>
              <Input value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)} placeholder="https://streamable.com/mrr2f4" />
            </Field>
          )}
          {resolving && (
            <div className="rounded-lg border bg-muted/20 p-5">
              <div className="flex items-center gap-3 text-sm font-semibold">
                <Loader2 className="h-5 w-5 animate-spin" />
                Préparation de la vidéo
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
              </div>
            </div>
          )}
          {error && <p className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle className="h-4 w-4" /> {error}</p>}
          {imported && <p className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Bande-annonce importée</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)} disabled={resolving}>{imported ? 'OK' : 'Annuler'}</Button>
            {!imported && <Button type="button" onClick={resolve} loading={resolving}>Valider</Button>}
          </div>
        </div>
      </Modal>
    </ToneSection>
  );
}

function PromotionTab({ product, patch }: { product: Partial<CommerceProduct>; patch: (path: string, value: unknown) => void }) {
  const enabled = readPath(product, 'promotion.enabled', false);
  const type = readPath(product, 'promotion.type', 'PERCENT');
  const value = Number(readPath(product, 'promotion.value', 0));
  const base = product.price?.amountCents || 0;
  const reduction = enabled ? Math.min(base, type === 'PERCENT' ? Math.round(base * value / 100) : Math.round(value * 100)) : 0;
  return (
    <ToneSection tone="promotion" title="Promotion" description="Remise visible sur la vitrine pendant une période précise." actions={<Switch checked={enabled} onChange={(v) => patch('promotion.enabled', v)} label="Activer la promotion" />}>
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Type de remise">
          <CustomSelect
            value={String(type)}
            onChange={(value) => patch('promotion.type', value)}
            options={[
              { value: 'PERCENT', label: 'Pourcentage' },
              { value: 'FIXED', label: 'Montant fixe' },
            ]}
          />
        </Field>
        <Field label="Remise" unit={type === 'PERCENT' ? '%' : '€'}><Input type="number" min="0" value={value} onChange={(e) => patch('promotion.value', Number(e.target.value || 0))} /></Field>
        <Field label="Début" icon={<CalendarDays />}><Input type="date" value={readPath(product, 'promotion.startsAt', '')} onChange={(e) => patch('promotion.startsAt', e.target.value)} /></Field>
        <Field label="Fin" icon={<CalendarDays />}><Input type="date" value={readPath(product, 'promotion.endsAt', '')} onChange={(e) => patch('promotion.endsAt', e.target.value)} /></Field>
      </div>
      <p className="rounded-md border bg-card p-3 text-sm">Prix catalogue {cents(base)} · réduction {cents(reduction)} · prix final {cents(base - reduction)}</p>
      <PromotionStateBadge promo={product.promotion} />
    </ToneSection>
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
    // « Ouverte / repliée » n'existe plus : c'était un état d'affichage de
    // l'éditeur, sans effet pour la cliente, et il ne faisait que brouiller.
    return {
      id: section.id || uid('sec'),
      title: section.title || `Section ${index + 1}`,
      description: section.description || '',
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

/** Les types de question — en français, et chacun sa couleur. */
const QUESTION_TYPES: Record<string, { label: string; hint: string; className: string }> = {
  TRUE_FALSE: { label: 'Vrai / Faux', hint: 'Une affirmation : la cliente répond vrai ou faux.', className: 'border-sky-300 bg-sky-100 text-sky-900' },
  SINGLE: { label: 'Une seule bonne réponse', hint: 'Plusieurs propositions, une seule est juste.', className: 'border-violet-300 bg-violet-100 text-violet-900' },
  MULTIPLE: { label: 'Plusieurs bonnes réponses', hint: 'Plusieurs propositions, il faut cocher toutes les justes.', className: 'border-amber-300 bg-amber-100 text-amber-900' },
};

function QuestionTypeBadge({ type }: { type: unknown }) {
  const meta = QUESTION_TYPES[String(type || 'SINGLE')] || QUESTION_TYPES.SINGLE;
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${meta.className}`} data-testid="question-type-badge">{meta.label}</span>;
}

/**
 * LE SCHÉMA DU QUESTIONNAIRE — ce qu'est une section, avant d'en créer une.
 * `current` met en relief l'étage où l'on se trouve.
 */
function QuestionnaireSchema({ current }: { current: 'sections' | 'questions' | 'answers' }) {
  const steps = [
    { key: 'root', title: 'Questionnaire', text: "L'évaluation finale de la formation" },
    { key: 'sections', title: 'Sections', text: 'Les thématiques : hygiène, technique, conseil…' },
    { key: 'questions', title: 'Questions', text: 'Ce qui est demandé dans chaque thématique' },
    { key: 'answers', title: 'Réponses', text: 'Les propositions, dont la ou les bonnes' },
  ];
  return (
    <ol className="grid gap-2 sm:grid-cols-4" aria-label="Structure du questionnaire" data-testid="questionnaire-schema">
      {steps.map((step, index) => {
        const active = step.key === current;
        return (
          <li key={step.key} className={`relative rounded-lg border p-3 ${active ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200 dark:bg-indigo-950/40' : 'bg-card'}`}>
            <span className={`mb-1 inline-grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${active ? 'bg-indigo-600 text-white' : 'bg-muted text-muted-foreground'}`}>{index + 1}</span>
            <p className="text-sm font-semibold">{step.title}</p>
            <p className="text-xs text-muted-foreground">{step.text}</p>
            {index < steps.length - 1 && <span className="absolute -right-2 top-1/2 hidden -translate-y-1/2 text-muted-foreground sm:block" aria-hidden="true">›</span>}
          </li>
        );
      })}
    </ol>
  );
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
    <ToneSection
      tone="evaluation"
      title="Évaluation finale"
      description="Questionnaire par sections et livrables demandés à la cliente."
      actions={<Switch checked={readPath(product, 'evaluation.enabled', false)} onChange={(v) => patch('evaluation.enabled', v)} label="Activer l'évaluation" />}
    >
      <div className="rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Résultat visible par la cliente</p>
            <p className="text-xs text-muted-foreground">Si actif, la cliente voit son score après l'envoi. Les corrections restent réservées au manager.</p>
          </div>
          <Switch checked={readPath(product, 'evaluation.showScoreToCustomer', false)} onChange={(v) => patch('evaluation.showScoreToCustomer', v)} label="Afficher le score à la cliente" />
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
        <ToneSection tone="deliverable" level="nested" title="Livrables demandés" description="Photos avant/après, vidéos et galeries attendues au final, avec des contraintes visibles côté cliente. Faites glisser la poignée pour changer l'ordre.">
          <DeliverablesEditor rows={deliverables} onChange={(rows) => patch('evaluation.deliverables', rows)} />
        </ToneSection>
      )}
      <p className="rounded-md border bg-card p-3 text-sm text-muted-foreground">
        Les bonnes réponses ne sont jamais envoyées à la cliente. Le score visible est optionnel et calculé sans exposer la correction.
      </p>
    </ToneSection>
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
  const updateItems = (index: number, items: Record<string, unknown>[]) => updateSection(index, { items });
  const addSection = () => {
    onChange([...sections, { id: uid('sec'), title: `Section ${sections.length + 1}`, description: '', items: [] }]);
    setSectionIndex(sections.length);
    setQuestionIndex(null);
  };
  const selectedSection = sectionIndex !== null ? sections[sectionIndex] : null;
  const selectedItems = selectedSection && Array.isArray(selectedSection.items) ? selectedSection.items as Record<string, unknown>[] : [];
  const selectedQuestion = questionIndex !== null ? selectedItems[questionIndex] : null;
  const pointsOf = (items: Record<string, unknown>[]) => items.reduce((sum, item) => sum + Number(item.points || 0), 0);

  if (selectedSection && selectedQuestion && sectionIndex !== null && questionIndex !== null) {
    return (
      <section className="grid gap-4">
        <EditorBreadcrumb
          items={[
            { label: 'Questionnaire', onClick: () => { setSectionIndex(null); setQuestionIndex(null); } },
            { label: String(selectedSection.title || `Section ${sectionIndex + 1}`), onClick: () => setQuestionIndex(null) },
            { label: `Question ${questionIndex + 1}` },
          ]}
        />
        <Button type="button" variant="outline" className="justify-self-start" onClick={() => setQuestionIndex(null)}>
          <ArrowLeft className="h-4 w-4" /> Retour à la section
        </Button>
        <QuestionItemEditor
          item={selectedQuestion}
          index={questionIndex}
          sectionTitle={String(selectedSection.title || `Section ${sectionIndex + 1}`)}
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
    const moveItem = (from: number, to: number) => updateItems(sectionIndex, moveTo(selectedItems, from, to));
    return (
      <section className="grid gap-4" data-testid="section-editor">
        <EditorBreadcrumb
          items={[
            { label: 'Questionnaire', onClick: () => { setSectionIndex(null); setQuestionIndex(null); } },
            { label: String(selectedSection.title || `Section ${sectionIndex + 1}`) },
          ]}
        />
        <Button type="button" variant="outline" className="justify-self-start" onClick={() => setSectionIndex(null)}>
          <ArrowLeft className="h-4 w-4" /> Retour aux sections
        </Button>
        <QuestionnaireSchema current="questions" />
        <ToneSection tone="infos" title="1. Informations de la section" description="Le titre et les consignes que la cliente lit avant de répondre.">
          <Field label="Titre de la section" unit="la thématique" icon={<Tag />}>
            <Input className="h-12 text-base font-semibold" value={String(selectedSection.title || '')} onChange={(event) => updateSection(sectionIndex, { title: event.target.value })} placeholder="Hygiène et préparation" />
          </Field>
          <Field label="Consignes affichées à la cliente" icon={<ClipboardList />}>
            <Textarea className="min-h-24" value={String(selectedSection.description || '')} onChange={(event) => updateSection(sectionIndex, { description: event.target.value })} placeholder="Répondez selon le protocole vu dans le module 1." />
          </Field>
        </ToneSection>
        <ToneSection
          tone="modules"
          title={`2. Contenu : ${selectedItems.length} question(s) · ${pointsOf(selectedItems)} point(s)`}
          description="Chaque question s'édite sur sa propre page. Faites glisser la poignée pour changer l'ordre : c'est celui que voit la cliente."
          actions={(
            <Button
              type="button"
              onClick={() => {
                updateItems(sectionIndex, [...selectedItems, { id: uid('q'), type: 'SINGLE', label: `Question ${selectedItems.length + 1}`, prompt: '', required: true, points: 1, options: [{ id: uid('a'), label: 'Réponse 1', correct: true }, { id: uid('a'), label: 'Réponse 2', correct: false }], correctOptionIds: [] }]);
                setQuestionIndex(selectedItems.length);
              }}
            >
              <Plus className="h-4 w-4" /> Ajouter une question
            </Button>
          )}
        >
          {selectedItems.length === 0 ? (
            <p className="rounded-md border border-dashed bg-card p-4 text-sm text-muted-foreground">Aucune question dans cette section.</p>
          ) : (
            <div className="m-table max-w-full overflow-x-auto rounded-lg border bg-card">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="w-20 px-2 py-3">#</th><th className="px-4 py-3">Question</th><th className="m-hide px-4 py-3">Type</th><th className="m-hide px-4 py-3">Points</th><th className="m-hide px-4 py-3">Statut</th><th className="px-4 py-3 text-right">Actions</th></tr>
                </thead>
                <tbody>
                  <SortableList
                    items={selectedItems}
                    onChange={(next) => updateItems(sectionIndex, next)}
                    renderItem={(item, { itemProps, handleProps, index }) => (
                    <tr {...itemProps} className="border-t bg-card" data-testid="question-row">
                      <td className="w-px whitespace-nowrap px-2 py-2 text-muted-foreground"><span className="inline-flex items-center gap-1"><DragHandle label={`Déplacer la question ${index + 1}`} {...handleProps} />{index + 1}</span></td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{String(item.label || `Question ${index + 1}`)}</div>
                        {Boolean(item.prompt) && <div className="max-w-sm truncate text-xs text-muted-foreground">{String(item.prompt)}</div>}
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:hidden">
                          <QuestionTypeBadge type={item.type} /> {Number(item.points || 0)} pt(s){item.required === false ? ' · facultative' : ''}
                        </div>
                      </td>
                      <td className="m-hide px-4 py-3"><QuestionTypeBadge type={item.type} /></td>
                      <td className="m-hide whitespace-nowrap px-4 py-3">{Number(item.points || 0)} pt(s)</td>
                      <td className="m-hide px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${item.required === false ? 'border-slate-300 bg-slate-100 text-slate-700' : 'border-rose-300 bg-rose-100 text-rose-900'}`}>
                          {item.required === false ? 'Facultative' : 'Obligatoire'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Dropdown.Root>
                          <Dropdown.DotsButton aria-label={`Actions question ${index + 1}`} />
                          <Dropdown.Popover className="w-48">
                            <Dropdown.Menu>
                              <Dropdown.Section>
                                <Dropdown.Item onAction={() => setQuestionIndex(index)}>Modifier</Dropdown.Item>
                                {index > 0 && <Dropdown.Item onAction={() => moveItem(index, index - 1)}>Monter</Dropdown.Item>}
                                {index < selectedItems.length - 1 && <Dropdown.Item onAction={() => moveItem(index, index + 1)}>Descendre</Dropdown.Item>}
                                <Dropdown.Item destructive onAction={() => updateItems(sectionIndex, selectedItems.filter((_, i) => i !== index))}>Supprimer</Dropdown.Item>
                              </Dropdown.Section>
                            </Dropdown.Menu>
                          </Dropdown.Popover>
                        </Dropdown.Root>
                      </td>
                    </tr>
                    )}
                  />
                </tbody>
              </table>
            </div>
          )}
        </ToneSection>
      </section>
    );
  }

  return (
    <section className="grid gap-4" data-testid="sections-list">
      <QuestionnaireSchema current="sections" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Une <strong>section</strong> regroupe les questions d'une même thématique. La cliente les parcourt dans cet ordre (faites glisser la poignée pour le changer), et le score est calculé sur l'ensemble.
        </p>
        <Button type="button" onClick={addSection}><Plus className="h-4 w-4" /> Ajouter une section</Button>
      </div>
      {sections.length === 0 ? (
        <p className="rounded-md border border-dashed bg-card p-4 text-sm text-muted-foreground">Aucune section. Ajoutez une première thématique, puis ses questions.</p>
      ) : (
        <div className="m-table max-w-full overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="w-20 px-2 py-3">#</th><th className="px-4 py-3">Section (thématique)</th><th className="m-hide px-4 py-3">Questions</th><th className="m-hide px-4 py-3">Points</th><th className="px-4 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody>
              <SortableList
                items={sections}
                onChange={onChange}
                renderItem={(section, { itemProps, handleProps, index }) => {
                const items = Array.isArray(section.items) ? section.items as Record<string, unknown>[] : [];
                return (
                  <tr {...itemProps} className="border-t bg-card" data-testid="section-row">
                    <td className="w-px whitespace-nowrap px-2 py-2 text-muted-foreground"><span className="inline-flex items-center gap-1"><DragHandle label={`Déplacer la section ${index + 1}`} {...handleProps} />{index + 1}</span></td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{String(section.title || `Section ${index + 1}`)}</div>
                      {Boolean(section.description) && <div className="max-w-md truncate text-xs text-muted-foreground">{String(section.description)}</div>}
                      <div className="mt-0.5 text-xs text-muted-foreground sm:hidden">{items.length} question(s) · {pointsOf(items)} pt(s)</div>
                    </td>
                    <td className="m-hide px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {items.length === 0 ? <span className="text-xs text-muted-foreground">Aucune</span> : items.slice(0, 3).map((item, i) => <QuestionTypeBadge key={i} type={item.type} />)}
                        {items.length > 3 && <span className="text-xs text-muted-foreground">+{items.length - 3}</span>}
                      </div>
                    </td>
                    <td className="m-hide whitespace-nowrap px-4 py-3">{pointsOf(items)} pt(s)</td>
                    <td className="px-4 py-3 text-right">
                      <Dropdown.Root>
                        <Dropdown.DotsButton aria-label={`Actions section ${index + 1}`} />
                        <Dropdown.Popover className="w-48">
                          <Dropdown.Menu>
                            <Dropdown.Section>
                              <Dropdown.Item onAction={() => { setSectionIndex(index); setQuestionIndex(null); }}>Modifier</Dropdown.Item>
                              {index > 0 && <Dropdown.Item onAction={() => onChange(moveTo(sections, index, index - 1))}>Monter</Dropdown.Item>}
                              {index < sections.length - 1 && <Dropdown.Item onAction={() => onChange(moveTo(sections, index, index + 1))}>Descendre</Dropdown.Item>}
                              <Dropdown.Item destructive onAction={() => onChange(sections.filter((_, i) => i !== index))}>Supprimer</Dropdown.Item>
                            </Dropdown.Section>
                          </Dropdown.Menu>
                        </Dropdown.Popover>
                      </Dropdown.Root>
                    </td>
                  </tr>
                );
                }}
              />
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * LA PAGE D'UNE QUESTION — quatre étapes, dans l'ordre où on la pense :
 * ce qu'on demande, sous quelle forme, quelles réponses (et la bonne), combien
 * elle rapporte.
 */
function QuestionItemEditor({
  item,
  index,
  sectionTitle,
  onChange,
  onRemove,
}: {
  item: Record<string, unknown>;
  index: number;
  sectionTitle: string;
  onChange: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const type = String(item.type || 'SINGLE');
  return (
    <div className="grid gap-4" data-testid="question-editor">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Section « {sectionTitle} » · Question {index + 1}</p>
          <h3 className="mt-1 text-xl font-semibold">{String(item.label || `Question ${index + 1}`)}</h3>
          <div className="mt-2 flex flex-wrap gap-2"><QuestionTypeBadge type={type} /><span className="inline-flex rounded-full border px-2.5 py-1 text-xs font-medium">{Number(item.points || 0)} point(s)</span></div>
        </div>
        <Button type="button" variant="destructive" onClick={onRemove}><Trash2 className="h-4 w-4" /> Supprimer la question</Button>
      </div>
      <QuestionnaireSchema current="answers" />

      <ToneSection tone="infos" title="1. Énoncé" description="Ce que la cliente lit.">
        <Field label="Intitulé court" unit="titre de la question" icon={<Tag />}>
          <Input className="h-12 text-base font-semibold" value={String(item.label || '')} onChange={(e) => onChange({ label: e.target.value })} placeholder="Désinfection du matériel" />
        </Field>
        <Field label="Question posée à la cliente" icon={<MessageCircle />}>
          <Textarea className="min-h-24 text-base" value={String(item.prompt || '')} onChange={(e) => onChange({ prompt: e.target.value })} placeholder="Le matériel doit-il être désinfecté entre deux clientes ?" />
        </Field>
      </ToneSection>

      <ToneSection tone="modules" title="2. Forme de la réponse" description="Comment la cliente répond.">
        <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Type de question">
          {Object.entries(QUESTION_TYPES).map(([value, meta]) => {
            const active = value === type;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => active || onChange({
                  type: value,
                  options: value === 'TRUE_FALSE' ? [] : questionOptions(item).filter((option) => !['true', 'false'].includes(String(option.id))),
                  correctOptionIds: value === 'TRUE_FALSE' ? ['true'] : [],
                })}
                className={`rounded-lg border p-3 text-left transition ${active ? 'border-violet-500 bg-white ring-2 ring-violet-200 dark:bg-violet-950/40' : 'bg-card hover:bg-muted/40'}`}
              >
                <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${meta.className}`}>{meta.label}</span>
                <span className="mt-2 block text-sm text-muted-foreground">{meta.hint}</span>
              </button>
            );
          })}
        </div>
      </ToneSection>

      <ToneSection tone="sessions" title="3. Réponses proposées" description={type === 'MULTIPLE' ? 'Cochez TOUTES les bonnes réponses. Faites glisser la poignée pour changer l’ordre.' : 'Cochez LA bonne réponse. Faites glisser la poignée pour changer l’ordre.'}>
        <AnswerOptionsEditor item={item} onChange={onChange} />
      </ToneSection>

      <ToneSection tone="promotion" title="4. Barème" description="Ce que rapporte une bonne réponse.">
        <div className="flex flex-wrap items-end gap-6">
          <Field label="Points" unit="par bonne réponse" className="w-56">
            <Input type="number" min="0" className="h-12 text-center text-lg font-semibold" value={Number(item.points || 0)} onChange={(e) => onChange({ points: Number(e.target.value || 0) })} />
          </Field>
          <div className="flex items-center gap-3 pb-3">
            <Switch checked={item.required !== false} onChange={(v) => onChange({ required: v })} label="Question obligatoire" />
            <span className="text-sm">{item.required === false ? 'Facultative : la cliente peut la passer' : 'Obligatoire pour envoyer le dossier'}</span>
          </div>
        </div>
      </ToneSection>
    </div>
  );
}

function AnswerOptionsEditor({ item, onChange }: { item: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void }) {
  const type = String(item.type || 'SINGLE');
  const options = questionOptions(item);
  const correctIds = new Set((Array.isArray(item.correctOptionIds) && (item.correctOptionIds as unknown[]).length ? item.correctOptionIds : options.filter((option) => option.correct).map((option) => String(option.id))) as string[]);
  const updateOptions = (next: Record<string, unknown>[]) => onChange({ options: next, correctOptionIds: next.filter((option) => option.correct).map((option) => String(option.id)) });
  const setCorrect = (id: string, checked: boolean) => {
    if (type === 'TRUE_FALSE') return onChange({ correctOptionIds: [id] });
    updateOptions(options.map((option) => ({
      ...option,
      correct: type === 'SINGLE' ? String(option.id) === id : String(option.id) === id ? checked : Boolean(option.correct),
    })));
  };
  return (
    <div className="grid gap-2">
      {type === 'TRUE_FALSE' ? options.map((option, index) => {
        const id = String(option.id || index);
        const checked = correctIds.has(id) || Boolean(option.correct);
        return (
          <div key={id} className={`flex items-center gap-3 rounded-lg border p-2 ${checked ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30' : 'bg-card'}`}>
            <label className="flex shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs font-semibold">
              <input type="radio" name={`correct-${String(item.id)}`} checked={checked} onChange={(event) => setCorrect(id, event.target.checked)} />
              {checked ? <span className="text-emerald-700">Bonne réponse</span> : <span className="text-muted-foreground">Fausse</span>}
            </label>
            <span className="flex-1 font-medium">{String(option.label)}</span>
          </div>
        );
      }) : (
      <SortableList
        items={options}
        onChange={updateOptions}
        renderItem={(option, { itemProps, handleProps, index }) => {
        const id = String(option.id || index);
        const checked = correctIds.has(id) || Boolean(option.correct);
        return (
          <div {...itemProps} className={`flex items-center gap-2 rounded-lg border p-2 ${checked ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30' : 'bg-card'}`} data-testid="answer-row">
            <DragHandle label={`Déplacer la réponse ${index + 1}`} {...handleProps} />
            <label className="flex shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs font-semibold">
              <input type={type === 'MULTIPLE' ? 'checkbox' : 'radio'} name={`correct-${String(item.id)}`} checked={checked} onChange={(event) => setCorrect(id, event.target.checked)} />
              {checked ? <span className="text-emerald-700">Bonne réponse</span> : <span className="text-muted-foreground">Fausse</span>}
            </label>
            <Input className="flex-1" value={String(option.label || '')} onChange={(event) => {
              const next = [...options];
              next[index] = { ...next[index], label: event.target.value };
              updateOptions(next);
            }} />
            <Button type="button" size="icon" variant="ghost" aria-label="Supprimer la réponse" onClick={() => updateOptions(options.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        );
        }}
      />
      )}
      {type !== 'TRUE_FALSE' && (
        <Button type="button" variant="outline" className="justify-self-start" onClick={() => updateOptions([...options, { id: uid('a'), label: `Réponse ${options.length + 1}`, correct: false }])}>
          <Plus className="h-4 w-4" /> Ajouter une réponse
        </Button>
      )}
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
        label: type === 'VIDEO' ? 'Vidéo de pratique' : type === 'PHOTO_GALLERY' ? 'Galerie photo finale' : 'Photo avant / après',
        description: '',
        required: true,
        maxDurationSeconds: type === 'VIDEO' ? 120 : 0,
        maxImages: type === 'PHOTO_GALLERY' ? 6 : 0,
      },
    ]);
  };
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-start justify-end gap-3">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => add('PHOTO_BEFORE_AFTER')}><FileText className="h-4 w-4" /> Photo avant/après</Button>
          <Button type="button" variant="outline" onClick={() => add('VIDEO')}><Video className="h-4 w-4" /> Vidéo</Button>
          <Button type="button" variant="outline" onClick={() => add('PHOTO_GALLERY')}><FileText className="h-4 w-4" /> Galerie photo</Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucun livrable. Ajoutez au moins une photo avant/après ou une vidéo si la certification le demande.</p>
      ) : (
        <div className="grid gap-3">
          <SortableList
            items={rows}
            onChange={onChange}
            renderItem={(row, { itemProps, handleProps, remove, index }) => {
            const type = String(row.type || 'PHOTO_BEFORE_AFTER') as 'PHOTO_BEFORE_AFTER' | 'VIDEO' | 'PHOTO_GALLERY';
            return (
              <div {...itemProps} className="rounded-lg border bg-background p-3" data-testid="deliverable-row">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-1 text-sm font-semibold">
                    <DragHandle label={`Déplacer le livrable ${index + 1}`} {...handleProps} />
                    Livrable {index + 1}
                    <span className="ml-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{type === 'VIDEO' ? 'Vidéo' : type === 'PHOTO_GALLERY' ? 'Galerie photo' : 'Avant / après'}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button type="button" size="icon" variant="ghost" aria-label="Supprimer le livrable" onClick={remove}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <Field label="Type de livrable" icon={<Layers />}>
                    <CustomSelect
                      value={type}
                      onChange={(value) => update(index, { type: value, maxDurationSeconds: value === 'VIDEO' ? Number(row.maxDurationSeconds || 120) : 0, maxImages: value === 'PHOTO_GALLERY' ? Number(row.maxImages || 6) : 0 })}
                      options={[
                        { value: 'PHOTO_BEFORE_AFTER', label: 'Photo avant / après' },
                        { value: 'VIDEO', label: 'Vidéo' },
                        { value: 'PHOTO_GALLERY', label: 'Galerie photo' },
                      ]}
                    />
                  </Field>
                  <Field label="Libellé" icon={<Tag />}>
                    <Input value={String(row.label || '')} onChange={(event) => update(index, { label: event.target.value })} />
                  </Field>
                  <Field label="Description ou consigne" icon={<ClipboardList />} className="lg:col-span-2">
                    <Textarea value={String(row.description || '')} onChange={(event) => update(index, { description: event.target.value })} />
                  </Field>
                  {type === 'VIDEO' && (
                    <Field label="Durée maximale de la vidéo" unit="secondes" icon={<Timer />}>
                      <Input type="number" min="1" value={Number(row.maxDurationSeconds || 120)} onChange={(event) => update(index, { maxDurationSeconds: Number(event.target.value || 0) })} />
                    </Field>
                  )}
                  {type === 'PHOTO_GALLERY' && (
                    <Field label="Nombre maximal de photos" unit="1 à 20">
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
            }}
          />
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
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Eye className="h-4 w-4" /> Aperçu de la fiche vitrine</div>
      <div className="rounded-lg border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{product.kind ? KIND_LABEL[product.kind] : 'Formation'}</p>
        <h3 className="mt-2 text-xl font-semibold">{product.title || 'Titre de la formation'}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{product.subtitle || product.description || 'Description visible par les clientes.'}</p>
        <p className="mt-4 font-semibold">{cents(product.price?.amountCents || 0)}</p>
      </div>
    </div>
  );
}
