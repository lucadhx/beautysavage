import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ImageOff, Layers, Plus } from 'lucide-react';
import { api, type ServiceCollection } from '@/lib/api';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { Dropdown } from '@/components/base/dropdown/dropdown';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DragHandle, SortableList } from '@/components/ui/Sortable';
import { CardsSkeleton, TableSkeleton } from '@/components/ui/Skeleton';
import { CommercePageFrame, Metric, Panel } from './CommerceShared';
import { SearchInput } from './HomeFeaturedPanel';

/**
 * COLLECTIONS DE PRESTATIONS — les rayons de la page « Prestations ».
 *
 * La vitrine affiche d'abord ces collections, dans l'ordre de ce tableau ;
 * un clic y ouvre les prestations de la collection. On réordonne en faisant
 * glisser la poignée (souris ou doigt) : l'ordre est enregistré aussitôt.
 */
export default function CommerceCollectionsPage() {
  const navigate = useNavigate();
  const [collections, setCollections] = React.useState<ServiceCollection[]>([]);
  const [serviceCount, setServiceCount] = React.useState(0);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [toDelete, setToDelete] = React.useState<ServiceCollection | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const refresh = React.useCallback(() => {
    Promise.all([api.serviceCollections(), api.commerceProducts()])
      .then(([list, products]) => {
        setCollections(list);
        setServiceCount((products as { kind: string }[]).filter((p) => p.kind === 'SERVICE').length);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Chargement impossible'))
      .finally(() => setLoaded(true));
  }, []);
  React.useEffect(refresh, [refresh]);

  const norm = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const filtered = query.trim() ? collections.filter((c) => norm(`${c.title} ${c.description}`).includes(norm(query.trim()))) : collections;
  const grouped = new Set(collections.flatMap((c) => c.productIds)).size;

  async function reorder(next: ServiceCollection[]) {
    const previous = collections;
    setCollections(next);
    setMessage('');
    try {
      await api.reorderServiceCollections(next.map((c) => c._id));
      setMessage('Ordre des collections enregistré.');
    } catch (err) {
      setCollections(previous);
      setError(err instanceof Error ? err.message : 'Ordre non enregistré');
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.deleteServiceCollection(toDelete._id);
      setCollections((list) => list.filter((c) => c._id !== toDelete._id));
      setMessage(`Collection « ${toDelete.title} » supprimée. Ses prestations restent au catalogue.`);
      setToDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression impossible');
    } finally {
      setDeleting(false);
    }
  }

  const openRow = (event: React.MouseEvent | React.KeyboardEvent, c: ServiceCollection) => {
    if ((event.target as HTMLElement).closest('button, a, input, [role="menu"], [role="menuitem"], [role="dialog"]')) return;
    navigate(`/commerce/collections/${c._id}`);
  };

  return (
    <CommercePageFrame
      title="Collections de prestations"
      description="Les rayons de la page « Prestations » de la vitrine : chaque collection regroupe des prestations. L’ordre de ce tableau est celui de la vitrine."
      actions={<Link to="/commerce/collections/nouveau" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" /> Nouvelle collection</Link>}
    >
      {error && <p className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
      {!loaded ? <CardsSkeleton /> : (
        <div className="grid gap-4 md:grid-cols-3">
          <Metric label="Collections" value={collections.length} />
          <Metric label="Prestations rangées" value={`${grouped} / ${serviceCount}`} />
          <Metric label="Hors collection" value={Math.max(0, serviceCount - grouped)} detail="Affichées dans « Autres prestations »" />
        </div>
      )}
      <Panel title="Collections">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Rechercher une collection…" testId="collections-search" />
          {message && <p className="text-sm text-emerald-700" role="status">{message}</p>}
        </div>
        {!loaded ? <TableSkeleton rows={4} cols={4} /> : collections.length === 0 ? (
          <div className="grid place-items-center gap-3 rounded-lg border border-dashed p-8 text-center">
            <Layers className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Aucune collection. Tant qu’il n’y en a pas, la vitrine affiche toutes les prestations en une seule liste.</p>
            <Link to="/commerce/collections/nouveau" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" /> Créer la première collection</Link>
          </div>
        ) : filtered.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucun résultat pour cette recherche.</p>
        ) : (
          <div className="m-table max-w-full overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[620px] text-left text-sm" data-testid="collections-table">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-12 px-2 py-3"><span className="sr-only">Déplacer</span></th>
                  <th className="px-4 py-3">Collection</th>
                  <th className="m-hide px-4 py-3">Prestations</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                <SortableList
                  items={filtered}
                  onChange={(next) => (query.trim() ? undefined : void reorder(next))}
                  renderItem={(c, { itemProps, handleProps, index }) => {
                    const cover = resolvePreviewMediaUrl(c.coverUrl);
                    return (
                      <tr
                        {...itemProps}
                        className="cursor-pointer border-t bg-card transition-colors hover:bg-muted/40"
                        onClick={(event) => openRow(event, c)}
                        onKeyDown={(event) => { if (event.key === 'Enter') openRow(event, c); }}
                        tabIndex={0}
                        data-testid="collection-row"
                      >
                        <td className="w-px px-2 py-2">{query.trim() ? null : <DragHandle label={`Déplacer la collection ${index + 1}`} {...handleProps} />}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="relative hidden h-12 w-16 shrink-0 overflow-hidden rounded-md bg-muted sm:block">
                              {cover ? <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <ImageOff className="absolute inset-0 m-auto h-4 w-4 text-muted-foreground" />}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium">{c.title}</div>
                              <div className="line-clamp-1 max-w-md text-xs text-muted-foreground">{c.description || 'Sans description.'}</div>
                              <div className="mt-0.5 text-xs font-medium text-muted-foreground sm:hidden">{c.productIds.length} prestation{c.productIds.length > 1 ? 's' : ''}</div>
                            </div>
                          </div>
                        </td>
                        <td className="m-hide whitespace-nowrap px-4 py-3">{c.productIds.length} prestation{c.productIds.length > 1 ? 's' : ''}</td>
                        <td className="px-4 py-3 text-right">
                          <Dropdown.Root>
                            <Dropdown.DotsButton aria-label={`Actions ${c.title}`} />
                            <Dropdown.Popover className="w-48">
                              <Dropdown.Menu>
                                <Dropdown.Section>
                                  <Dropdown.Item onAction={() => navigate(`/commerce/collections/${c._id}`)}>Modifier</Dropdown.Item>
                                  <Dropdown.Item destructive onAction={() => setToDelete(c)}>Supprimer</Dropdown.Item>
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
        {query.trim() && collections.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Videz la recherche pour réordonner les collections.</p>}
      </Panel>
      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => !deleting && setToDelete(null)}
        onConfirm={confirmDelete}
        title="Supprimer cette collection ?"
        description={toDelete ? `« ${toDelete.title} » disparaîtra de la vitrine. Ses ${toDelete.productIds.length} prestation(s) restent au catalogue.` : undefined}
        confirmLabel="Supprimer"
        destructive
        loading={deleting}
      />
    </CommercePageFrame>
  );
}
