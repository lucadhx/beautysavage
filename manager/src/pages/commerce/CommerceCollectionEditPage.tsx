import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlignLeft, ArrowLeft, ImageOff, Layers, Minus, Plus, Tag } from 'lucide-react';
import { api, type ServiceCollection } from '@/lib/api';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { ImageUpload } from '@/components/fields/ImageUpload';
import { Button, Field, Input, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { DragHandle, SortableList } from '@/components/ui/Sortable';
import { FormSkeleton } from '@/components/ui/Skeleton';
import { FloatingSaveWidget } from '@/components/ui/FloatingSaveWidget';
import { useFloatingSave } from '@/hooks/useFloatingSave';
import { useGuardedNavigate } from '@/components/LeaveGuard';
import { CommercePageFrame, cents, type CommerceProduct } from './CommerceShared';
import { ToneSection, toneTabClass, type EditorTone } from './editorTones';
import { ProductStatusBadge } from './productStatus';
import { SearchInput, matchesSearch } from './HomeFeaturedPanel';

type TabId = 'infos' | 'services';
type Draft = Pick<ServiceCollection, 'title' | 'description' | 'coverUrl' | 'productIds'>;
const EMPTY: Draft = { title: '', description: '', coverUrl: '', productIds: [] };

/**
 * FICHE D'UNE COLLECTION — deux onglets seulement.
 *
 *   Informations générales  titre, description, couverture ;
 *   Prestations             celles de la collection, dans l'ordre de la vitrine
 *                           (poignée à faire glisser, souris ou doigt), avec
 *                           « Retirer » (confirmé) et « Ajouter des prestations ».
 *
 * Tout passe par le bouton flottant « Enregistrer », comme les autres fiches.
 */
export default function CommerceCollectionEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const creation = !id || id === 'nouveau';
  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  const [services, setServices] = React.useState<CommerceProduct[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [tab, setTab] = React.useState<TabId>('infos');
  const [toRemove, setToRemove] = React.useState<CommerceProduct | null>(null);
  const [picking, setPicking] = React.useState(false);

  React.useEffect(() => {
    Promise.all([creation ? Promise.resolve(null) : api.serviceCollection(id!), api.commerceProducts()])
      .then(([collection, products]) => {
        setServices((products as CommerceProduct[]).filter((p) => p.kind === 'SERVICE'));
        if (collection) setDraft({ title: collection.title, description: collection.description, coverUrl: collection.coverUrl, productIds: collection.productIds });
        setLoaded(true);
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Chargement impossible'));
  }, [creation, id]);

  const { state: saveState, save } = useFloatingSave<Draft>(creation || loaded ? draft : null, async () => {
    if (!draft.title.trim()) {
      setTab('infos');
      setMessage('Donnez un titre à la collection avant d’enregistrer.');
      throw new Error('Titre requis');
    }
    const saved = await api.saveServiceCollection(draft, creation ? undefined : id);
    const next = { title: saved.title, description: saved.description, coverUrl: saved.coverUrl, productIds: saved.productIds };
    setDraft(next);
    setMessage('');
    if (creation) navigate(`/commerce/collections/${saved._id}`, { replace: true });
    return next;
  });
  const leave = useGuardedNavigate();

  const byId = new Map(services.map((s) => [s._id, s]));
  const inCollection = draft.productIds.map((pid) => byId.get(pid)).filter(Boolean) as CommerceProduct[];
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  if (!creation && !loaded && !message) {
    return (
      <CommercePageFrame title="Chargement de la collection…" description="Récupération de la collection et de ses prestations.">
        <FormSkeleton fields={4} />
      </CommercePageFrame>
    );
  }

  const tabs = [
    ['infos', 'Informations générales', 'infos'],
    ['services', `Prestations (${inCollection.length})`, 'options'],
  ] as const satisfies readonly (readonly [TabId, string, EditorTone])[];

  return (
    <CommercePageFrame
      title={creation ? 'Nouvelle collection' : draft.title || 'Collection'}
      description="Un rayon de la page « Prestations » : son titre, sa description, sa couverture et les prestations qu’il contient."
      actions={<Button variant="outline" onClick={() => leave('/commerce/collections')}><ArrowLeft className="h-4 w-4" /> Retour aux collections</Button>}
    >
      {message && <p className="rounded-md border p-3 text-sm text-muted-foreground" role="status">{message}</p>}
      <div className="flex gap-2 overflow-x-auto rounded-lg border bg-card p-2">
        {tabs.map(([value, label, tone]) => (
          <button key={value} type="button" onClick={() => setTab(value)} className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium ${toneTabClass(tone, tab === value)}`} data-testid={`tab-${value}`}>{label}</button>
        ))}
      </div>

      {tab === 'infos' && (
        <ToneSection tone="infos" icon={<Layers className="h-5 w-5" />} title="Informations générales" description="Ce que la vitrine affiche sur la carte de la collection.">
          <Field label="Titre de la collection" icon={<Tag />}>
            <Input value={draft.title} maxLength={120} onChange={(e) => set('title', e.target.value)} placeholder="Extensions de cils" />
          </Field>
          <Field label="Description" icon={<AlignLeft />} hint="Une ou deux phrases, affichées sous le titre.">
            <Textarea value={draft.description} maxLength={1000} onChange={(e) => set('description', e.target.value)} placeholder="Poses cil à cil, volume russe, effets plume…" />
          </Field>
          <div className="grid gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div>
              <span className="text-sm font-medium">Image de couverture</span>
              <p className="mt-1 text-xs text-muted-foreground">Affichée sur la carte de la collection. Le bouton ouvre le choix : appareil, URL ou bibliothèque.</p>
            </div>
            <ImageUpload value={draft.coverUrl} mediaType="commerce-cover" aspect="aspect-[16/10]" hint="Couverture de la collection." onChange={(url) => set('coverUrl', url)} />
            {draft.coverUrl && <button type="button" className="justify-self-start text-xs font-semibold text-muted-foreground" onClick={() => set('coverUrl', '')}>Retirer l’image</button>}
          </div>
        </ToneSection>
      )}

      {tab === 'services' && (
        <ToneSection
          tone="options"
          title="Prestations de la collection"
          description="Dans l’ordre de la vitrine : faites glisser la poignée (souris ou doigt) pour le changer."
          actions={<Button type="button" onClick={() => setPicking(true)} data-testid="add-services"><Plus className="h-4 w-4" /> Ajouter des prestations</Button>}
        >
          {inCollection.length === 0 ? (
            <p className="rounded-md border border-dashed bg-card p-4 text-sm text-muted-foreground">Aucune prestation dans cette collection. Ajoutez-en avec le bouton ci-dessus.</p>
          ) : (
            <div className="m-table max-w-full overflow-x-auto rounded-lg border bg-card">
              <table className="w-full min-w-[640px] text-left text-sm" data-testid="collection-services">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-20 px-2 py-3">#</th>
                    <th className="px-4 py-3">Prestation</th>
                    <th className="m-hide px-4 py-3">Prix</th>
                    <th className="m-hide px-4 py-3">Statut</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  <SortableList
                    items={inCollection}
                    onChange={(next) => set('productIds', next.map((p) => p._id))}
                    renderItem={(p, { itemProps, handleProps, index }) => {
                      const cover = resolvePreviewMediaUrl(p.coverUrl || p.gallery?.[0] || '');
                      return (
                        <tr {...itemProps} className="border-t bg-card" data-testid="collection-service-row">
                          <td className="w-px whitespace-nowrap px-2 py-2 text-muted-foreground"><span className="inline-flex items-center gap-1"><DragHandle label={`Déplacer la prestation ${index + 1}`} {...handleProps} />{index + 1}</span></td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="relative hidden h-10 w-12 shrink-0 overflow-hidden rounded-md bg-muted sm:block">
                                {cover ? <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <ImageOff className="absolute inset-0 m-auto h-4 w-4 text-muted-foreground" />}
                              </div>
                              <div className="min-w-0">
                                <span className="font-medium">{p.title}</span>
                                {/* Téléphone : prix et statut repris sous le titre. */}
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:hidden">
                                  <span className="whitespace-nowrap">{cents(p.price?.amountCents)}</span>
                                  <ProductStatusBadge status={p.status} />
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="m-hide whitespace-nowrap px-4 py-3">{cents(p.price?.amountCents)}</td>
                          <td className="m-hide px-4 py-3"><ProductStatusBadge status={p.status} /></td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => setToRemove(p)}
                              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-rose-600 px-3 text-xs font-semibold text-white transition hover:bg-rose-700"
                              data-testid="remove-service"
                            >
                              <Minus className="h-3.5 w-3.5" /> Retirer
                            </button>
                          </td>
                        </tr>
                      );
                    }}
                  />
                </tbody>
              </table>
            </div>
          )}
        </ToneSection>
      )}

      <ConfirmDialog
        open={Boolean(toRemove)}
        onClose={() => setToRemove(null)}
        onConfirm={() => {
          if (toRemove) set('productIds', draft.productIds.filter((pid) => pid !== toRemove._id));
          setToRemove(null);
        }}
        title="Retirer cette prestation de la collection ?"
        description={toRemove ? `« ${toRemove.title} » ne sera plus rangée dans cette collection. Elle reste au catalogue.` : undefined}
        confirmLabel="Retirer"
        destructive
      />
      <ServicePicker
        open={picking}
        onClose={() => setPicking(false)}
        services={services.filter((s) => !draft.productIds.includes(s._id))}
        onAdd={(s) => set('productIds', [...draft.productIds, s._id])}
      />
      <FloatingSaveWidget state={saveState} onSave={save} />
    </CommercePageFrame>
  );
}

function ServicePicker({ open, onClose, services, onAdd }: { open: boolean; onClose: () => void; services: CommerceProduct[]; onAdd: (s: CommerceProduct) => void }) {
  const [query, setQuery] = React.useState('');
  const list = services.filter((s) => matchesSearch(s, query));
  return (
    <Modal open={open} onClose={onClose} title="Ajouter des prestations" description="Les prestations ajoutées se placent à la fin de la collection." className="max-w-2xl">
      <div className="grid gap-3" data-testid="service-picker">
        <SearchInput value={query} onChange={setQuery} placeholder="Rechercher une prestation…" testId="picker-search" />
        <div className="max-h-[calc(var(--m-viewport-h)*0.55)] overflow-y-auto overscroll-contain rounded-lg border">
          {list.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{query ? 'Aucun résultat pour cette recherche.' : 'Toutes les prestations sont déjà dans cette collection.'}</p>
          ) : list.map((s) => (
            <div key={s._id} className="flex items-center justify-between gap-3 border-b p-3 last:border-b-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{s.title}</p>
                <p className="text-xs text-muted-foreground">{cents(s.price?.amountCents)}</p>
              </div>
              <button type="button" onClick={() => onAdd(s)} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white transition hover:bg-emerald-700" data-testid="picker-add">
                <Plus className="h-3.5 w-3.5" /> Ajouter
              </button>
            </div>
          ))}
        </div>
        <div className="flex justify-end"><Button type="button" variant="outline" onClick={onClose}>Terminé</Button></div>
      </div>
    </Modal>
  );
}
