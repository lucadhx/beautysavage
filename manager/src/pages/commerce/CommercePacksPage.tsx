import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, GraduationCap, Info, Package } from 'lucide-react';
import { api } from '@/lib/api';
import { ImageUpload } from '@/components/fields/ImageUpload';
import { Button, Field, Input, SegmentedControl, Textarea } from '@/components/ui/primitives';
import { CardsSkeleton, FormSkeleton } from '@/components/ui/Skeleton';
import { FloatingSaveWidget } from '@/components/ui/FloatingSaveWidget';
import { useFloatingSave } from '@/hooks/useFloatingSave';
import { useGuardedNavigate } from '@/components/LeaveGuard';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { CommercePageFrame, Metric, Panel, ProductTable, cents, type CommerceProduct } from './CommerceShared';
import { ToneSection, toneTabClass, type EditorTone } from './editorTones';
import { SearchInput, matchesSearch } from './HomeFeaturedPanel';

type PackTab = 'infos' | 'selection';

/**
 * LES PACKS DE FORMATIONS EN LIGNE — plusieurs formations vendues ensemble.
 *
 * La cliente qui achète un pack accède à TOUTES les formations qu'il contient,
 * chacune dans son espace formation, comme si elle les avait achetées une à
 * une (voir backend trainingAccess.js). Le contenu du pack est photographié
 * à l'achat : retirer une formation du pack ne la retire pas à celles qui
 * l'ont déjà payé.
 *
 * Seules des formations EN LIGNE entrent dans un pack ; un pack publié en
 * réunit au moins deux, toutes publiées.
 */

export default function CommercePacksPage() {
  const [products, setProducts] = React.useState<CommerceProduct[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    api.commerceProducts()
      .then((list) => { setProducts(list as CommerceProduct[]); setLoaded(true); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Chargement impossible'));
  }, []);
  const packs = products.filter((p) => p.kind === 'TRAINING_PACK');
  return (
    <CommercePageFrame
      title="Packs de formations"
      description="Réunissez plusieurs formations en ligne à un prix avantageux. La cliente accède à toutes les formations du pack depuis son espace formation."
      actions={<Link to="/commerce/packs/nouveau" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" data-testid="pack-new">Nouveau pack</Link>}
    >
      {error && <p className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
      {!loaded && !error ? <CardsSkeleton count={2} /> : (
        <div className="grid gap-4 md:grid-cols-2">
          <Metric label="Packs" value={packs.length} />
          <Metric label="Publiés" value={packs.filter((p) => p.status === 'PUBLISHED').length} />
        </div>
      )}
      <Panel title="Packs">
        <ProductTable products={packs} loading={!loaded && !error} editBase="/commerce/packs" emptyText="Aucun pack pour l’instant. Créez-en un pour vendre plusieurs formations ensemble." />
      </Panel>
    </CommercePageFrame>
  );
}

const EMPTY: Partial<CommerceProduct> = {
  title: '', slug: '', subtitle: '', description: '', kind: 'TRAINING_PACK', status: 'DRAFT',
  price: { amountCents: 0, currency: 'EUR' }, coverUrl: '', gallery: [], options: [], pack: { productIds: [] },
};

export function CommercePackEditPage() {
  const { id } = useParams<{ id: string }>();
  const creation = !id || id === 'nouveau';
  const navigate = useNavigate();
  const leave = useGuardedNavigate();
  const [pack, setPack] = React.useState<Partial<CommerceProduct>>(EMPTY);
  const [trainings, setTrainings] = React.useState<CommerceProduct[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [tab, setTab] = React.useState<PackTab>('infos');
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    api.commerceProducts().then((list) => {
      const all = list as CommerceProduct[];
      setTrainings(all.filter((p) => p.kind === 'DISTANCE_TRAINING' && p.status !== 'ARCHIVED'));
      if (!creation) {
        const found = all.find((p) => p._id === id);
        if (found) setPack({ ...EMPTY, ...found, pack: { productIds: (found.pack?.productIds || []).map(String) } });
        else setMessage('Pack introuvable.');
      }
      setLoaded(true);
    }).catch((err) => setMessage(err instanceof Error ? err.message : 'Chargement impossible'));
  }, [creation, id]);

  const selected = new Set(pack.pack?.productIds || []);
  const chosen = trainings.filter((t) => selected.has(t._id));
  const valueCents = chosen.reduce((sum, t) => sum + (t.price?.amountCents || 0), 0);
  const priceCents = pack.price?.amountCents || 0;
  const savingCents = Math.max(0, valueCents - priceCents);
  const unpublished = chosen.filter((t) => t.status !== 'PUBLISHED');
  const blockers = [
    ...(chosen.length < 2 ? ['Choisissez au moins deux formations.'] : []),
    ...(unpublished.length ? [`« ${unpublished[0].title} » n’est pas publiée.`] : []),
    ...(priceCents <= 0 ? ['Indiquez le prix du pack.'] : []),
    ...(!String(pack.title || '').trim() ? ['Donnez un nom au pack.'] : []),
  ];

  const toggle = (trainingId: string) => {
    const next = new Set(selected);
    if (next.has(trainingId)) next.delete(trainingId); else next.add(trainingId);
    setPack((p) => ({ ...p, pack: { productIds: trainings.filter((t) => next.has(t._id)).map((t) => t._id) } }));
  };

  const { state, save } = useFloatingSave<Partial<CommerceProduct>>(creation || loaded ? pack : null, async () => {
    setMessage('');
    if (pack.status === 'PUBLISHED' && blockers.length) {
      setMessage(`Publication impossible : ${blockers.join(' ')}`);
      setTab(chosen.length < 2 || unpublished.length ? 'selection' : 'infos');
      throw new Error(blockers[0]);
    }
    try {
      const saved = await api.saveCommerceProduct({
        ...pack,
        id: creation ? undefined : id,
        kind: 'TRAINING_PACK',
        amountCents: priceCents,
        pack: { productIds: pack.pack?.productIds || [] },
      });
      const next = { ...EMPTY, ...(saved as CommerceProduct), pack: { productIds: ((saved as CommerceProduct).pack?.productIds || []).map(String) } };
      setPack(next);
      if (creation) navigate(`/commerce/packs/${(saved as CommerceProduct)._id}`, { replace: true });
      return next;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Enregistrement impossible');
      throw err;
    }
  });

  if (!creation && !loaded && !message) {
    return <CommercePageFrame title="Chargement du pack…" description="Récupération du pack et des formations."><FormSkeleton fields={5} /></CommercePageFrame>;
  }

  const visible = trainings.filter((t) => matchesSearch(t, query));
  const tabs = [
    ['infos', 'Informations', 'infos'],
    ['selection', `Sélection (${chosen.length})`, 'modules'],
  ] as const satisfies readonly (readonly [PackTab, string, EditorTone])[];

  return (
    <CommercePageFrame
      title={creation ? 'Nouveau pack' : pack.title || 'Pack'}
      description="Un nom, une couverture, un prix, et les formations en ligne réunies."
      actions={<Button variant="outline" onClick={() => leave('/commerce/packs')}><ArrowLeft className="h-4 w-4" /> Retour</Button>}
    >
      {message && <p className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert"><AlertCircle className="h-4 w-4 shrink-0" /> {message}</p>}

      <div className="flex gap-2 overflow-x-auto rounded-lg border bg-card p-2" role="tablist" aria-label="Fiche du pack">
        {tabs.map(([value, label, tone]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
            className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium ${toneTabClass(tone, tab === value)}`} data-testid={`tab-${value}`}>{label}</button>
        ))}
      </div>

      {tab === 'infos' && (
      <ToneSection tone="infos" title="Le pack" description="Ce que la vitrine affiche sur la page du pack." icon={<Package className="h-4 w-4" />}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nom du pack"><Input value={pack.title || ''} maxLength={120} onChange={(e) => setPack({ ...pack, title: e.target.value })} placeholder="Ex : Pack ongles complet" data-testid="pack-title" /></Field>
          <Field label="Accroche" hint="Une ligne sous le nom."><Input value={pack.subtitle || ''} maxLength={160} onChange={(e) => setPack({ ...pack, subtitle: e.target.value })} placeholder="Ex : Les deux formations en ligne, à prix réduit" /></Field>
          <Field label="Description" className="md:col-span-2">
            <Textarea rows={5} value={pack.description || ''} onChange={(e) => setPack({ ...pack, description: e.target.value })} placeholder="Ce que la cliente saura faire, pour qui, ce qui est inclus…" />
          </Field>
          <Field label="Couverture">
            <ImageUpload value={pack.coverUrl || ''} mediaType="commerce-cover" onChange={(url) => setPack({ ...pack, coverUrl: url })} aspect="aspect-[4/3]" />
          </Field>
          <div className="grid content-start gap-4">
            <Field label="Prix du pack" unit="€">
              <Input type="number" min={0} step="1" value={priceCents ? priceCents / 100 : ''} onChange={(e) => setPack({ ...pack, price: { amountCents: Math.max(0, Math.round(Number(e.target.value || 0) * 100)), currency: 'EUR' } })} data-testid="pack-price" />
            </Field>
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="flex justify-between"><span className="text-muted-foreground">Valeur des formations à l’unité</span><span>{cents(valueCents)}</span></p>
              <p className="mt-1 flex justify-between font-medium"><span>Économie pour la cliente</span><span className={savingCents > 0 ? 'text-emerald-700' : ''}>{savingCents > 0 ? `${cents(savingCents)} (−${Math.round((savingCents / Math.max(1, valueCents)) * 100)} %)` : '—'}</span></p>
              {chosen.length >= 2 && priceCents >= valueCents && <p className="mt-2 text-xs text-amber-700">Le pack ne coûte pas moins cher que les formations à l’unité.</p>}
            </div>
            <Field label="Statut">
              <SegmentedControl size="sm" label="Statut du pack" value={(pack.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT') as 'PUBLISHED' | 'DRAFT'} onChange={(status) => setPack({ ...pack, status })}
                options={[{ value: 'DRAFT', label: 'Brouillon' }, { value: 'PUBLISHED', label: 'Publié' }]} />
            </Field>
          </div>
        </div>
      </ToneSection>
      )}

      {tab === 'selection' && (
      <ToneSection tone="modules" title="Formations du pack" description="Cochez les formations réunies dans ce pack. La cliente y accède dès le paiement." icon={<GraduationCap className="h-4 w-4" />}>
        {/* min-w-0 : le corps de ToneSection est une grille ; sans lui, un titre tronqué élargirait tout le bloc sur téléphone. */}
        <div className="min-w-0">
        <p className="mb-4 flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900" data-testid="pack-distanciel-only">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Seules les <strong>formations en ligne (distanciel)</strong> peuvent entrer dans un pack. Les formations en présentiel n’apparaissent pas ici.</span>
        </p>
        {trainings.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucune formation en ligne. Créez d’abord des formations à distance.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <SearchInput value={query} onChange={setQuery} placeholder="Rechercher une formation" testId="pack-search" />
              <span className="text-sm text-muted-foreground">{chosen.length} sélectionnée{chosen.length > 1 ? 's' : ''} sur {trainings.length}</span>
            </div>
            {visible.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucune formation ne correspond à « {query} ».</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {visible.map((t) => {
                  const on = selected.has(t._id);
                  const modules = (t.modules || []).length;
                  return (
                    <li key={t._id}>
                      <label className={`flex cursor-pointer items-center gap-3 p-3 transition ${on ? 'bg-primary/5' : 'hover:bg-muted/40'}`} data-testid="pack-training">
                        <input type="checkbox" checked={on} onChange={() => toggle(t._id)} className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" aria-label={`Inclure ${t.title}`} />
                        {t.coverUrl ? <img src={resolvePreviewMediaUrl(t.coverUrl)} alt="" className="h-12 w-12 shrink-0 rounded object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded bg-muted"><GraduationCap className="h-5 w-5 text-muted-foreground" /></span>}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{t.title}</span>
                          <span className="block text-xs text-muted-foreground">{modules} module{modules > 1 ? 's' : ''}{t.status !== 'PUBLISHED' ? ' · non publiée' : ''}</span>
                        </span>
                        <span className="shrink-0 text-sm font-medium tabular-nums">{cents(t.price?.amountCents)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
        {pack.status === 'PUBLISHED' && blockers.length > 0 && <p className="mt-3 text-sm text-amber-700">{blockers.join(' ')}</p>}
        </div>
      </ToneSection>
      )}
      <FloatingSaveWidget state={state} onSave={() => void save()} anchor="sticky" shortcut />
    </CommercePageFrame>
  );
}
