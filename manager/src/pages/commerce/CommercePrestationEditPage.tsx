import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlignLeft, ArrowLeft, CalendarClock, CalendarDays, CalendarX, Clock, CreditCard, Euro, ImagePlus, Percent, Plus, RotateCcw, Settings2, Sparkles, Tag, Timer, Trash2, Users } from 'lucide-react';
import { DragHandle, SortableList } from '@/components/ui/Sortable';
import { api } from '@/lib/api';
import { ImageUpload } from '@/components/fields/ImageUpload';
import { Button, Field, Input, Switch } from '@/components/ui/primitives';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { CommercePageFrame, PromotionStateBadge, cents, type CommerceProduct } from './CommerceShared';
import { ToneSection, toneTabClass, type EditorTone } from './editorTones';
import { OptionsManager } from './OptionsManager';
import { ProductSeoSection } from './ProductSeoSection';
import { PublicationStatusWidget } from './PublicationStatusWidget';
import { FormSkeleton } from '@/components/ui/Skeleton';
import { FloatingSaveWidget } from '@/components/ui/FloatingSaveWidget';
import { useFloatingSave } from '@/hooks/useFloatingSave';
import { useGuardedNavigate } from '@/components/LeaveGuard';

type TabId = 'general' | 'payment' | 'promotion' | 'options' | 'photos' | 'advanced';

const EMPTY: Partial<CommerceProduct> = {
  title: '',
  slug: '',
  subtitle: '',
  description: '',
  kind: 'SERVICE',
  status: 'DRAFT',
  price: { amountCents: 0, currency: 'EUR' },
  durationMinutes: 60,
  gallery: [],
  options: [],
  service: { capacity: 1, validated: false, bufferAfterMinutes: 0, bookable: true, visible: true },
  paymentRules: { type: 'FULL', depositType: 'PERCENT', depositValue: 30, balanceMode: 'ON_SITE' },
  bookingRules: { minBookingHours: 24, freeCancelHours: 72, refundBeforePercent: 100, refundAfterPercent: 0, noShowPolicy: '' },
  promotion: { enabled: false, type: 'PERCENT', value: 0, startsAt: '', endsAt: '' },
};

function read<T>(source: unknown, path: string, fallback: T): T {
  let current: unknown = source;
  for (const key of path.split('.')) {
    if (!current || typeof current !== 'object' || !(key in current)) return fallback;
    current = (current as Record<string, unknown>)[key];
  }
  return (current ?? fallback) as T;
}

function write(source: Record<string, unknown>, path: string, value: unknown) {
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

function normalizeOptions(rows: Record<string, unknown>[]) {
  return rows.map((row, index) => ({
    ...row,
    key: String(row.key || optionKey(row.label, index)),
    priceCents: Math.round(Number(row.priceCents || 0)),
    active: row.active !== false,
  }));
}

export default function CommercePrestationEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const creation = !id || id === 'nouveau';
  const [product, setProduct] = React.useState<Partial<CommerceProduct>>(EMPTY);
  const [tab, setTab] = React.useState<TabId>('general');
  const [message, setMessage] = React.useState('');
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (creation) return;
    api.commerceProducts().then((items) => {
      const found = (items as CommerceProduct[]).find((item) => item._id === id);
      if (found) { setProduct({ ...EMPTY, ...found, kind: 'SERVICE' }); setLoaded(true); }
      else setMessage('Prestation introuvable.');
    }).catch((err) => setMessage(err instanceof Error ? err.message : 'Chargement impossible'));
  }, [creation, id]);

  const patch = (path: string, value: unknown) => setProduct((p) => write(p as Record<string, unknown>, path, value) as Partial<CommerceProduct>);
  const rows = (path: keyof CommerceProduct) => (product[path] as Record<string, unknown>[] | undefined) ?? [];
  const setRows = (path: keyof CommerceProduct, next: Record<string, unknown>[]) => patch(String(path), next);

  /** Enregistrement flottant + garde « Quitter sans enregistrer ? » (voir useFloatingSave). */
  const { state: saveState, save } = useFloatingSave<Partial<CommerceProduct>>(
    creation || loaded ? product : null,
    async () => {
      const saved = await api.saveCommerceProduct({
        ...product,
        options: normalizeOptions(rows('options')),
        id: creation ? undefined : id,
        kind: 'SERVICE',
        amountCents: product.price?.amountCents ?? 0,
      });
      const next = { ...EMPTY, ...(saved as CommerceProduct) };
      setProduct(next);
      setMessage('');
      if (creation) navigate(`/commerce/prestations/${(saved as CommerceProduct)._id}`, { replace: true });
      return next;
    },
  );
  const leave = useGuardedNavigate();

  const tabs = [
    ['general', 'Général', 'infos'],
    ['payment', 'Tarifs et paiement', 'payment'],
    ['promotion', 'Promotion', 'promotion'],
    ['options', 'Options', 'options'],
    ['photos', 'Photos', 'photos'],
    ['advanced', 'Avancé', 'advanced'],
  ] as const satisfies readonly (readonly [TabId, string, EditorTone])[];

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
      title={creation ? 'Nouvelle prestation' : product.title || 'Prestation'}
      description="Édition complète d'une prestation : général, paiement et acompte, options, photos, visibilité et règles avancées."
      actions={<Button variant="outline" onClick={() => leave('/commerce/prestations')}><ArrowLeft className="h-4 w-4" /> Retour</Button>}
    >
      {message && <p className="rounded-md border p-3 text-sm text-muted-foreground">{message}</p>}
      <div className="flex gap-2 overflow-x-auto rounded-lg border bg-card p-2">
        {tabs.map(([value, label, tone]) => <button key={value} onClick={() => setTab(value)} className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium ${toneTabClass(tone, tab === value)}`}>{label}</button>)}
      </div>

      {tab === 'general' && (
        <ToneSection tone="infos" title="Général" description="Nom, durée, capacité, visuel et description de la prestation.">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nom de la prestation" icon={<Tag />} className="md:col-span-2"><Input value={product.title || ''} onChange={(e) => patch('title', e.target.value)} /></Field>
            <Field label="Durée" unit="minutes" icon={<Clock />}><Input type="number" min="5" step="5" value={product.durationMinutes || 0} onChange={(e) => patch('durationMinutes', Number(e.target.value || 0))} /></Field>
            <Field label="Capacité" unit="clientes en même temps" icon={<Users />}><Input type="number" min="1" value={read(product, 'service.capacity', 1)} onChange={(e) => patch('service.capacity', Number(e.target.value || 1))} /></Field>
            <CoverImageField value={product.coverUrl || ''} onChange={(url) => patch('coverUrl', url)} />
          </div>
          <Field label="Description courte" icon={<AlignLeft />} hint="Une phrase, affichée sur les cartes du catalogue."><Input value={product.subtitle || ''} onChange={(e) => patch('subtitle', e.target.value)} /></Field>
          <RichTextLite label="Description complète" value={product.description || ''} onChange={(value) => patch('description', value)} />
          <div className="flex items-center gap-3"><Switch checked={read(product, 'service.validated', false)} onChange={(v) => patch('service.validated', v)} label="Validée" /><span className="text-sm">Prestation validée pour publication</span></div>
        </ToneSection>
      )}

      {tab === 'payment' && (
        <ToneSection tone="payment" icon={<Euro className="h-5 w-5" />} title="Prix et acompte" description="Définissez ce que la cliente paie en ligne et ce qui reste à régler à l'institut.">
          <PaymentConfigurator product={product} patch={patch} />
          <p className="rounded-md border bg-card p-3 text-sm">Prix affiché : {cents(product.price?.amountCents || 0)}.</p>
        </ToneSection>
      )}

      {tab === 'promotion' && (
        <ToneSection tone="promotion" icon={<Sparkles className="h-5 w-5" />} title="Offre promotionnelle" description="Préparez une remise visible sur la vitrine pendant une période précise.">
          <PromotionConfigurator product={product} patch={patch} />
        </ToneSection>
      )}

      {tab === 'options' && <OptionsManager rows={rows('options')} onChange={(r) => setRows('options', r)} subject="la prestation" />}
      {tab === 'photos' && <GalleryEditor items={product.gallery || []} onChange={(items) => patch('gallery', items)} />}
      {tab === 'advanced' && (
        <ToneSection tone="advanced" icon={<Settings2 className="h-5 w-5" />} title="Disponibilité et affichage" description="Réglez la visibilité, la réservation et les temps de battement autour de cette prestation.">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Temps de battement après la prestation" unit="minutes" icon={<Timer />} hint="Pause bloquée dans l'agenda après chaque rendez-vous."><Input type="number" min="0" step="5" value={read(product, 'service.bufferAfterMinutes', 0)} onChange={(e) => patch('service.bufferAfterMinutes', Number(e.target.value || 0))} /></Field>
          </div>
          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-sm"><Switch checked={read(product, 'service.visible', true)} onChange={(v) => patch('service.visible', v)} label="Visible" /> Visible sur la vitrine</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={read(product, 'service.bookable', true)} onChange={(v) => patch('service.bookable', v)} label="Réservable" /> Réservable en ligne</label>
          </div>
          <Rows title="FAQ de la prestation" rows={read<Record<string, unknown>[]>(product, 'faq', [])} onChange={(r) => patch('faq', r)} empty={{ question: '', answer: '' }} fields={['question', 'answer']} />
          <ProductSeoSection productId={creation ? null : id} seo={product.seo} onChange={(seo) => patch('seo', seo)} />
        </ToneSection>
      )}
      <FloatingSaveWidget state={saveState} onSave={save} before={creation || loaded ? <PublicationStatusWidget value={product.status} onChange={(status) => patch('status', status)} /> : null} />
    </CommercePageFrame>
  );
}

const ROW_FIELD_LABELS: Record<string, string> = { question: 'Question', answer: 'Réponse' };

function Rows({ title, rows, onChange, empty, fields }: { title: string; rows: Record<string, unknown>[]; onChange: (rows: Record<string, unknown>[]) => void; empty: Record<string, unknown>; fields: string[] }) {
  const set = (index: number, key: string, value: unknown) => {
    const next = [...rows];
    next[index] = { ...next[index], [key]: value };
    onChange(next);
  };
  return (
    <ToneSection
      tone="faq"
      level="nested"
      title={title}
      description="Affichée sur la fiche vitrine, dans « Questions fréquentes ». Faites glisser la poignée pour changer l'ordre."
      actions={<Button variant="outline" onClick={() => onChange([...rows, structuredClone(empty)])}><Plus className="h-4 w-4" /> Ajouter</Button>}
    >
      {rows.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucune question pour l'instant.</p>}
      <SortableList
        items={rows}
        onChange={onChange}
        renderItem={(row, { itemProps, handleProps, remove, index }) => (
          <div {...itemProps} className="grid gap-3 rounded-lg border bg-card p-4" data-testid="faq-row">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1"><DragHandle label={`Déplacer la question ${index + 1}`} {...handleProps} /><strong>#{index + 1}</strong></span>
              <Button size="sm" variant="ghost" onClick={remove}><Trash2 className="h-4 w-4" /> Retirer</Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {fields.map((key) => <Field key={key} label={ROW_FIELD_LABELS[key] || key}><Input value={String(row[key] ?? '')} onChange={(e) => set(index, key, key.toLowerCase().includes('cents') || key === 'order' ? Number(e.target.value || 0) : e.target.value)} /></Field>)}
            </div>
          </div>
        )}
      />
    </ToneSection>
  );
}


function GalleryEditor({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  const update = (index: number, value: string) => {
    const next = [...items];
    next[index] = value;
    onChange(next);
  };
  return (
    <ToneSection tone="photos" icon={<ImagePlus className="h-5 w-5" />} title="Galerie photos" description="Ajoutez des visuels depuis l'appareil, une URL ou la bibliothèque, puis faites glisser la poignée (souris ou doigt) pour définir l'ordre.">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <SortableList
          items={items}
          onChange={onChange}
          layout="grid"
          renderItem={(url, { itemProps, handleProps, remove, index }) => (
            <div {...itemProps} className="rounded-lg border bg-card p-3" data-testid="gallery-item">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1 text-sm font-semibold"><DragHandle label={`Déplacer l'image ${index + 1}`} {...handleProps} /> Image {index + 1}</span>
                <Button type="button" size="sm" variant="ghost" onClick={remove}><Trash2 className="h-4 w-4" /> Retirer</Button>
              </div>
              <ImageUpload value={url} mediaType="gallery-image" aspect="aspect-square" hint="Image de la galerie." onChange={(nextUrl) => update(index, nextUrl)} />
            </div>
          )}
        />
        <button
          type="button"
          onClick={() => onChange([...items, ''])}
          className="grid min-h-56 place-items-center rounded-lg border border-dashed bg-muted/20 p-4 text-sm font-semibold text-muted-foreground transition hover:border-primary hover:text-foreground"
        >
          <span className="inline-flex items-center gap-2"><Plus className="h-4 w-4" /> Ajouter une image</span>
        </button>
      </div>
    </ToneSection>
  );
}

function PaymentConfigurator({
  product,
  patch,
}: {
  product: Partial<CommerceProduct>;
  patch: (path: string, value: unknown) => void;
}) {
  const paymentType = read<string>(product, 'paymentRules.type', 'FULL');
  const depositType = read<string>(product, 'paymentRules.depositType', 'PERCENT');
  const priceCents = product.price?.amountCents || 0;
  const depositValue = read<number>(product, 'paymentRules.depositValue', 0);
  const immediateCents = paymentType === 'FREE'
    ? 0
    : paymentType === 'DEPOSIT'
      ? Math.min(priceCents, Math.max(0, Math.round(depositType === 'PERCENT' ? (priceCents * depositValue) / 100 : depositValue * 100)))
      : priceCents;
  const remainingCents = Math.max(0, priceCents - immediateCents);
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Prix TTC" icon={<Tag />}>
          <div className="flex h-10 items-center rounded-md border bg-background px-3">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={(product.price?.amountCents || 0) / 100}
              onChange={(e) => patch('price.amountCents', Math.round(Number(e.target.value || 0) * 100))}
              className="h-8 border-0 px-0 focus-visible:ring-0"
            />
            <Euro className="h-4 w-4 text-muted-foreground" />
          </div>
        </Field>
        <Field label="Règle de paiement" icon={<CreditCard />}>
          <CustomSelect
            value={paymentType}
            onChange={(value) => patch('paymentRules.type', value)}
            options={[
              { value: 'FULL', label: 'Paiement complet', description: 'La cliente règle tout en ligne.' },
              { value: 'DEPOSIT', label: 'Acompte', description: 'La cliente réserve, le solde se règle ensuite.' },
              { value: 'FREE', label: 'Gratuit', description: 'Aucun paiement lors de la commande.' },
            ]}
          />
        </Field>
        {paymentType === 'DEPOSIT' && (
          <Field label="Règlement du solde">
            <CustomSelect
              value={read<string>(product, 'paymentRules.balanceMode', 'ON_SITE')}
              onChange={(value) => patch('paymentRules.balanceMode', value)}
              options={[{ value: 'ON_SITE', label: 'Sur place', description: 'Encaissement depuis le calendrier ou au comptoir.' }]}
            />
          </Field>
        )}
      </div>
      {paymentType === 'DEPOSIT' && (
        <div className="grid gap-4 rounded-lg border bg-muted/20 p-4 md:grid-cols-2">
          <Field label="Calcul de l'acompte" icon={<Percent />}>
            <CustomSelect
              value={depositType}
              onChange={(value) => patch('paymentRules.depositType', value)}
              options={[
                { value: 'PERCENT', label: 'Pourcentage du prix' },
                { value: 'FIXED', label: 'Montant fixe' },
              ]}
            />
          </Field>
          <Field label={depositType === 'PERCENT' ? "Pourcentage de l'acompte" : "Montant de l'acompte"} unit={depositType === 'PERCENT' ? '%' : '€'}>
            <div className="flex h-10 items-center rounded-md border bg-background px-3">
              <Input
                type="number"
                min="0"
                step={depositType === 'PERCENT' ? '1' : '0.01'}
                value={read<number>(product, 'paymentRules.depositValue', 0)}
                onChange={(e) => patch('paymentRules.depositValue', Number(e.target.value || 0))}
                className="h-8 border-0 px-0 focus-visible:ring-0"
              />
              <span className="text-sm text-muted-foreground">{depositType === 'PERCENT' ? '%' : '€'}</span>
            </div>
          </Field>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Prix affiché</p>
          <p className="mt-2 text-2xl font-semibold">{cents(priceCents)}</p>
        </div>
        <div className="rounded-lg border bg-primary/5 p-4">
          <p className="text-sm text-muted-foreground">À payer maintenant</p>
          <p className="mt-2 text-2xl font-semibold">{cents(immediateCents)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Restant à régler</p>
          <p className="mt-2 text-2xl font-semibold">{cents(remainingCents)}</p>
        </div>
      </div>
      <h3 className="inline-flex items-center gap-2 pt-2 text-sm font-semibold"><CalendarClock className="h-4 w-4 text-muted-foreground" /> Réservation et annulation</h3>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Réservation avant le rendez-vous" unit="heures" icon={<CalendarClock />} hint="Délai minimum pour réserver en ligne."><Input type="number" min="0" value={read(product, 'bookingRules.minBookingHours', 24)} onChange={(e) => patch('bookingRules.minBookingHours', Number(e.target.value || 0))} /></Field>
        <Field label="Annulation gratuite avant" unit="heures" icon={<CalendarX />} hint="Au-delà, l'annulation devient tardive."><Input type="number" min="0" value={read(product, 'bookingRules.freeCancelHours', 72)} onChange={(e) => patch('bookingRules.freeCancelHours', Number(e.target.value || 0))} /></Field>
        <Field label="Remboursement si annulation à temps" unit="%" icon={<RotateCcw />}><Input type="number" min="0" max="100" value={read(product, 'bookingRules.refundBeforePercent', 100)} onChange={(e) => patch('bookingRules.refundBeforePercent', Number(e.target.value || 0))} /></Field>
        <Field label="Remboursement si annulation tardive" unit="%" icon={<RotateCcw />}><Input type="number" min="0" max="100" value={read(product, 'bookingRules.refundAfterPercent', 0)} onChange={(e) => patch('bookingRules.refundAfterPercent', Number(e.target.value || 0))} /></Field>
      </div>
    </div>
  );
}

function PromotionConfigurator({ product, patch }: { product: Partial<CommerceProduct>; patch: (path: string, value: unknown) => void }) {
  const enabled = read<boolean>(product, 'promotion.enabled', false);
  const type = read<string>(product, 'promotion.type', 'PERCENT');
  const value = Number(read(product, 'promotion.value', 0));
  const base = product.price?.amountCents || 0;
  const reduction = enabled ? Math.min(base, type === 'PERCENT' ? Math.round(base * value / 100) : Math.round(value * 100)) : 0;
  return (
    <div className="grid gap-4 rounded-lg border p-4">
      <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Promotion</h2><Switch checked={enabled} onChange={(v) => patch('promotion.enabled', v)} label="Activer la promotion" /></div>
      {enabled && (
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Type de remise">
            <CustomSelect
              value={type}
              onChange={(next) => patch('promotion.type', next)}
              options={[{ value: 'PERCENT', label: 'Pourcentage' }, { value: 'FIXED', label: 'Montant fixe' }]}
            />
          </Field>
          <Field label="Remise" unit={type === 'PERCENT' ? '%' : '€'}><Input type="number" min="0" value={value} onChange={(e) => patch('promotion.value', Number(e.target.value || 0))} /></Field>
          <Field label="Début" icon={<CalendarDays />}><Input type="date" value={read(product, 'promotion.startsAt', '')} onChange={(e) => patch('promotion.startsAt', e.target.value)} /></Field>
          <Field label="Fin" icon={<CalendarDays />}><Input type="date" value={read(product, 'promotion.endsAt', '')} onChange={(e) => patch('promotion.endsAt', e.target.value)} /></Field>
        </div>
      )}
      <p className="rounded-md border bg-muted/30 p-3 text-sm">Prix catalogue {cents(base)} · réduction {cents(reduction)} · prix final {cents(base - reduction)}</p>
      <PromotionStateBadge promo={product.promotion} />
    </div>
  );
}

function RichTextLite({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value || '';
  }, [value]);
  const command = (name: string, argument?: string) => {
    ref.current?.focus();
    document.execCommand(name, false, argument);
    onChange(ref.current?.innerHTML || '');
  };
  return (
    <Field label={label}>
      <div className="rounded-lg border bg-background">
        <div className="flex flex-wrap items-center gap-1 border-b p-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => command('bold')}>B</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => command('italic')}><span className="italic">I</span></Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => command('underline')}><span className="underline">U</span></Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => command('insertUnorderedList')}>Liste</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => command('removeFormat')}>Nettoyer</Button>
        </div>
        <div
          ref={ref}
          contentEditable
          role="textbox"
          aria-multiline="true"
          className="min-h-44 px-4 py-3 text-sm leading-7 outline-none"
          onInput={() => onChange(ref.current?.innerHTML || '')}
        />
      </div>
    </Field>
  );
}

function CoverImageField({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  return (
    <div className="grid gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 md:col-span-2">
      <div>
        <span className="text-sm font-medium">Image de couverture</span>
        <p className="mt-1 text-xs text-muted-foreground">Le bouton ouvre le choix : appareil, URL ou bibliothèque.</p>
      </div>
      <ImageUpload value={value} mediaType="commerce-cover" aspect="aspect-[16/10]" hint="Couverture de la prestation dans le catalogue." onChange={(url) => onChange(url)} />
      {value && <button type="button" className="justify-self-start text-xs font-semibold text-muted-foreground" onClick={() => onChange('')}>Retirer l'image</button>}
    </div>
  );
}
