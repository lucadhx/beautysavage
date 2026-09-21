import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Euro, GripVertical, ImagePlus, Plus, Save, Settings2, Sparkles, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { ImageUpload } from '@/components/fields/ImageUpload';
import { Button, Card, CardContent, Field, Input, Switch } from '@/components/ui/primitives';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { CommercePageFrame, cents, type CommerceProduct } from './CommerceShared';

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

function moveTo<T>(rows: T[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return rows;
  const next = [...rows];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function CommercePrestationEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const creation = !id || id === 'nouveau';
  const [product, setProduct] = React.useState<Partial<CommerceProduct>>(EMPTY);
  const [tab, setTab] = React.useState<TabId>('general');
  const [message, setMessage] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (creation) return;
    api.commerceProducts().then((items) => {
      const found = (items as CommerceProduct[]).find((item) => item._id === id);
      if (found) setProduct({ ...EMPTY, ...found, kind: 'SERVICE' });
      else setMessage('Prestation introuvable.');
    }).catch((err) => setMessage(err instanceof Error ? err.message : 'Chargement impossible'));
  }, [creation, id]);

  const patch = (path: string, value: unknown) => setProduct((p) => write(p as Record<string, unknown>, path, value) as Partial<CommerceProduct>);
  const rows = (path: keyof CommerceProduct) => (product[path] as Record<string, unknown>[] | undefined) ?? [];
  const setRows = (path: keyof CommerceProduct, next: Record<string, unknown>[]) => patch(String(path), next);

  async function save() {
    setSaving(true);
    setMessage('');
    try {
      const saved = await api.saveCommerceProduct({
        ...product,
        options: normalizeOptions(rows('options')),
        id: creation ? undefined : id,
        kind: 'SERVICE',
        amountCents: product.price?.amountCents ?? 0,
      });
      setProduct({ ...EMPTY, ...(saved as CommerceProduct) });
      setMessage('Prestation enregistree.');
      if (creation) navigate(`/commerce/prestations/${(saved as CommerceProduct)._id}`, { replace: true });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Sauvegarde impossible');
    } finally {
      setSaving(false);
    }
  }

  const tabs = [
    ['general', 'General'],
    ['payment', 'Tarifs et paiement'],
    ['promotion', 'Promotion'],
    ['options', 'Options'],
    ['photos', 'Photos'],
    ['advanced', 'Avance'],
  ] as const;

  return (
    <CommercePageFrame
      title={creation ? 'Nouvelle prestation' : product.title || 'Prestation'}
      description="Edition complete d'une prestation : general, paiement/acompte, options, photos, visibilite et regles avancees."
      actions={<div className="flex gap-2"><Button variant="outline" onClick={() => navigate('/commerce/prestations')}><ArrowLeft className="h-4 w-4" /> Retour</Button><Button onClick={save} loading={saving}><Save className="h-4 w-4" /> Enregistrer</Button></div>}
    >
      {message && <p className="rounded-md border p-3 text-sm text-muted-foreground">{message}</p>}
      <div className="flex gap-2 overflow-x-auto rounded-lg border bg-card p-2">
        {tabs.map(([value, label]) => <button key={value} onClick={() => setTab(value)} className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium ${tab === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{label}</button>)}
      </div>

      {tab === 'general' && (
        <Card><CardContent className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nom"><Input value={product.title || ''} onChange={(e) => patch('title', e.target.value)} /></Field>
            <Field label="Slug"><Input value={product.slug || ''} onChange={(e) => patch('slug', e.target.value)} /></Field>
            <Field label="Duree minutes"><Input type="number" min="5" step="5" value={product.durationMinutes || 0} onChange={(e) => patch('durationMinutes', Number(e.target.value || 0))} /></Field>
            <Field label="Capacite"><Input type="number" min="1" value={read(product, 'service.capacity', 1)} onChange={(e) => patch('service.capacity', Number(e.target.value || 1))} /></Field>
            <CoverImageField value={product.coverUrl || ''} onChange={(url) => patch('coverUrl', url)} />
          </div>
          <Field label="Description courte"><Input value={product.subtitle || ''} onChange={(e) => patch('subtitle', e.target.value)} /></Field>
          <RichTextLite label="Description complete" value={product.description || ''} onChange={(value) => patch('description', value)} />
          <div className="flex items-center gap-3"><Switch checked={read(product, 'service.validated', false)} onChange={(v) => patch('service.validated', v)} label="Validee" /><span className="text-sm">Prestation validee pour publication</span></div>
        </CardContent></Card>
      )}

      {tab === 'payment' && (
        <Card><CardContent className="grid gap-4">
          <SectionIntro icon={<Euro className="h-5 w-5" />} title="Prix et acompte" text="Definissez ce que la cliente paie en ligne et ce qui reste a regler a l'institut." />
          <PaymentConfigurator product={product} patch={patch} />
          <p className="rounded-md border bg-muted/30 p-3 text-sm">Prix affiche {cents(product.price?.amountCents || 0)}.</p>
        </CardContent></Card>
      )}

      {tab === 'promotion' && (
        <Card><CardContent className="grid gap-4">
          <SectionIntro icon={<Sparkles className="h-5 w-5" />} title="Offre promotionnelle" text="Preparez une remise visible sur la vitrine pendant une periode precise." />
          <PromotionConfigurator product={product} patch={patch} />
        </CardContent></Card>
      )}

      {tab === 'options' && <OptionsEditor rows={rows('options')} onChange={(r) => setRows('options', r)} />}
      {tab === 'photos' && <GalleryEditor items={product.gallery || []} onChange={(items) => patch('gallery', items)} />}
      {tab === 'advanced' && (
        <Card><CardContent className="grid gap-4">
          <SectionIntro icon={<Settings2 className="h-5 w-5" />} title="Disponibilite et affichage" text="Reglez la visibilite, la reservation et les temps de battement autour de cette prestation." />
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Battement apres prestation (min)"><Input type="number" min="0" step="5" value={read(product, 'service.bufferAfterMinutes', 0)} onChange={(e) => patch('service.bufferAfterMinutes', Number(e.target.value || 0))} /></Field>
            <Field label="Boost vitrine"><Input type="number" min="1" max="3" value={product.boostRank ?? ''} onChange={(e) => patch('boostRank', e.target.value ? Number(e.target.value) : null)} /></Field>
            <Field label="Statut">
              <CustomSelect
                value={String(product.status || 'DRAFT')}
                onChange={(value) => patch('status', value)}
                options={[
                  { value: 'DRAFT', label: 'Brouillon' },
                  { value: 'PUBLISHED', label: 'Visible' },
                  { value: 'DISABLED', label: 'Desactivee' },
                  { value: 'ARCHIVED', label: 'Archivee' },
                ]}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-sm"><Switch checked={read(product, 'service.visible', true)} onChange={(v) => patch('service.visible', v)} label="Visible" /> Visible</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={read(product, 'service.bookable', true)} onChange={(v) => patch('service.bookable', v)} label="Reservable" /> Reservable</label>
          </div>
          <Rows title="FAQ prestation" rows={read<Record<string, unknown>[]>(product, 'faq', [])} onChange={(r) => patch('faq', r)} empty={{ question: '', answer: '' }} fields={['question', 'answer']} />
        </CardContent></Card>
      )}
    </CommercePageFrame>
  );
}

function Rows({ title, rows, onChange, empty, fields }: { title: string; rows: Record<string, unknown>[]; onChange: (rows: Record<string, unknown>[]) => void; empty: Record<string, unknown>; fields: string[] }) {
  const set = (index: number, key: string, value: unknown) => {
    const next = [...rows];
    next[index] = { ...next[index], [key]: value };
    onChange(next);
  };
  return (
    <Card><CardContent className="grid gap-3">
      <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2><Button variant="outline" onClick={() => onChange([...rows, structuredClone(empty)])}><Plus className="h-4 w-4" /> Ajouter</Button></div>
      {rows.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucune ligne.</p>}
      {rows.map((row, index) => (
        <div key={index} className="grid gap-3 rounded-lg border p-4">
          <div className="flex justify-between"><strong>#{index + 1}</strong><Button size="sm" variant="ghost" onClick={() => onChange(rows.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /> Retirer</Button></div>
          <div className="grid gap-3 md:grid-cols-2">
            {fields.map((key) => <Field key={key} label={key}><Input value={String(row[key] ?? '')} onChange={(e) => set(index, key, key.toLowerCase().includes('cents') || key === 'order' ? Number(e.target.value || 0) : e.target.value)} /></Field>)}
          </div>
        </div>
      ))}
    </CardContent></Card>
  );
}

function SectionIntro({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">{icon}</span>
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{text}</p>
        </div>
      </div>
    </div>
  );
}

function GalleryEditor({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  const update = (index: number, value: string) => {
    const next = [...items];
    next[index] = value;
    onChange(next);
  };
  return (
    <Card><CardContent className="grid gap-4">
      <SectionIntro icon={<ImagePlus className="h-5 w-5" />} title="Galerie photos" text="Ajoutez des visuels depuis l'appareil, une URL ou la bibliotheque, puis glissez-les pour definir l'ordre." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((url, index) => (
          <div
            key={`${url}-${index}`}
            className="rounded-lg border bg-card p-3"
            draggable
            onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              onChange(moveTo(items, Number(event.dataTransfer.getData('text/plain')), index));
            }}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-sm font-semibold"><GripVertical className="h-4 w-4 text-muted-foreground" /> Image {index + 1}</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => onChange(items.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /> Retirer</Button>
            </div>
            <ImageUpload value={url} mediaType="gallery-image" aspect="aspect-square" hint="Image de galerie prestation." onChange={(nextUrl) => update(index, nextUrl)} />
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...items, ''])}
          className="grid min-h-56 place-items-center rounded-lg border border-dashed bg-muted/20 p-4 text-sm font-semibold text-muted-foreground transition hover:border-primary hover:text-foreground"
        >
          <span className="inline-flex items-center gap-2"><Plus className="h-4 w-4" /> Ajouter une image</span>
        </button>
      </div>
    </CardContent></Card>
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
        <Field label="Prix TTC">
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
        <Field label="Regle de paiement">
          <CustomSelect
            value={paymentType}
            onChange={(value) => patch('paymentRules.type', value)}
            options={[
              { value: 'FULL', label: 'Paiement complet', description: 'La cliente regle tout en ligne.' },
              { value: 'DEPOSIT', label: 'Acompte', description: 'La cliente reserve, le solde se regle ensuite.' },
              { value: 'FREE', label: 'Gratuit', description: 'Aucun paiement au checkout.' },
            ]}
          />
        </Field>
        {paymentType === 'DEPOSIT' && (
          <Field label="Solde">
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
          <Field label="Calcul de l acompte">
            <CustomSelect
              value={depositType}
              onChange={(value) => patch('paymentRules.depositType', value)}
              options={[
                { value: 'PERCENT', label: 'Pourcentage du prix' },
                { value: 'FIXED', label: 'Montant fixe' },
              ]}
            />
          </Field>
          <Field label={depositType === 'PERCENT' ? 'Pourcentage' : 'Montant'}>
            <div className="flex h-10 items-center rounded-md border bg-background px-3">
              <Input
                type="number"
                min="0"
                step={depositType === 'PERCENT' ? '1' : '0.01'}
                value={read<number>(product, 'paymentRules.depositValue', 0)}
                onChange={(e) => patch('paymentRules.depositValue', Number(e.target.value || 0))}
                className="h-8 border-0 px-0 focus-visible:ring-0"
              />
              <span className="text-sm text-muted-foreground">{depositType === 'PERCENT' ? '%' : 'EUR'}</span>
            </div>
          </Field>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Prix affiche</p>
          <p className="mt-2 text-2xl font-semibold">{cents(priceCents)}</p>
        </div>
        <div className="rounded-lg border bg-primary/5 p-4">
          <p className="text-sm text-muted-foreground">A payer maintenant</p>
          <p className="mt-2 text-2xl font-semibold">{cents(immediateCents)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Restant a regler</p>
          <p className="mt-2 text-2xl font-semibold">{cents(remainingCents)}</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Reservation avant le rendez-vous"><Input type="number" min="0" value={read(product, 'bookingRules.minBookingHours', 24)} onChange={(e) => patch('bookingRules.minBookingHours', Number(e.target.value || 0))} /></Field>
        <Field label="Annulation gratuite avant"><Input type="number" min="0" value={read(product, 'bookingRules.freeCancelHours', 72)} onChange={(e) => patch('bookingRules.freeCancelHours', Number(e.target.value || 0))} /></Field>
        <Field label="Remboursement avant %"><Input type="number" min="0" max="100" value={read(product, 'bookingRules.refundBeforePercent', 100)} onChange={(e) => patch('bookingRules.refundBeforePercent', Number(e.target.value || 0))} /></Field>
        <Field label="Remboursement apres %"><Input type="number" min="0" max="100" value={read(product, 'bookingRules.refundAfterPercent', 0)} onChange={(e) => patch('bookingRules.refundAfterPercent', Number(e.target.value || 0))} /></Field>
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
          <Field label="Type">
            <CustomSelect
              value={type}
              onChange={(next) => patch('promotion.type', next)}
              options={[{ value: 'PERCENT', label: 'Pourcentage' }, { value: 'FIXED', label: 'Montant fixe' }]}
            />
          </Field>
          <Field label={type === 'PERCENT' ? 'Pourcentage' : 'Montant EUR'}><Input type="number" min="0" value={value} onChange={(e) => patch('promotion.value', Number(e.target.value || 0))} /></Field>
          <Field label="Debut"><Input type="date" value={read(product, 'promotion.startsAt', '')} onChange={(e) => patch('promotion.startsAt', e.target.value)} /></Field>
          <Field label="Fin"><Input type="date" value={read(product, 'promotion.endsAt', '')} onChange={(e) => patch('promotion.endsAt', e.target.value)} /></Field>
        </div>
      )}
      <p className="rounded-md border bg-muted/30 p-3 text-sm">Prix catalogue {cents(base)} - reduction {cents(reduction)} - prix final {cents(base - reduction)}</p>
    </div>
  );
}

function OptionsEditor({ rows, onChange }: { rows: Record<string, unknown>[]; onChange: (rows: Record<string, unknown>[]) => void }) {
  const update = (index: number, patch: Record<string, unknown>) => {
    const next = [...rows];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };
  return (
    <Card><CardContent className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Options</h2>
          <p className="text-sm text-muted-foreground">Interface simplifiee : pas de cle technique, elle est generee automatiquement.</p>
        </div>
        <Button variant="outline" onClick={() => onChange([...rows, { label: '', description: '', priceCents: 0, active: true }])}><Plus className="h-4 w-4" /> Ajouter</Button>
      </div>
      {rows.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucune option.</p>}
      {rows.map((row, index) => (
        <div key={index} className="grid gap-3 rounded-lg border p-4">
          <div className="flex justify-between gap-3"><strong>Option {index + 1}</strong><Button size="sm" variant="ghost" onClick={() => onChange(rows.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /> Retirer</Button></div>
          <div className="grid gap-3 md:grid-cols-[1fr_150px_auto]">
            <Field label="Nom"><Input value={String(row.label ?? '')} onChange={(e) => update(index, { label: e.target.value })} /></Field>
            <Field label="Prix">
              <div className="flex h-10 items-center rounded-md border bg-background px-3">
                <Input type="number" min="0" step="0.01" value={Number(row.priceCents || 0) / 100} onChange={(e) => update(index, { priceCents: Math.round(Number(e.target.value || 0) * 100) })} className="h-8 border-0 px-0 focus-visible:ring-0" />
                <Euro className="h-4 w-4 text-muted-foreground" />
              </div>
            </Field>
            <div className="flex items-end pb-2"><Switch checked={row.active !== false} onChange={(active) => update(index, { active })} label="Option active" /></div>
            <Field label="Description" className="md:col-span-3"><Input value={String(row.description ?? '')} onChange={(e) => update(index, { description: e.target.value })} /></Field>
          </div>
        </div>
      ))}
    </CardContent></Card>
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
        <p className="mt-1 text-xs text-muted-foreground">Le bouton ouvre le choix appareil, URL ou bibliotheque.</p>
      </div>
      <ImageUpload value={value} mediaType="commerce-cover" aspect="aspect-[16/10]" hint="Couverture catalogue prestation." onChange={(url) => onChange(url)} />
      {value && <button type="button" className="justify-self-start text-xs font-semibold text-muted-foreground" onClick={() => onChange('')}>Retirer l'image</button>}
    </div>
  );
}
