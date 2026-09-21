import * as React from 'react';
import { Copy, Image, RefreshCw, Search, Trash2 } from 'lucide-react';
import { api, deleteMediaFile, type MediaLibraryItem } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge, Button, Card, CardContent, Field, Input } from '@/components/ui/primitives';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { ConfirmDialog } from '@/components/ui/dialog';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { toast } from 'sonner';
import { messageUtilisateur } from '@/lib/erreurs';

function formatBytes(value: number) {
  if (!value) return '0 Ko';
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`;
  return `${(value / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function MediaLibraryPage() {
  const [items, setItems] = React.useState<MediaLibraryItem[]>([]);
  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<MediaLibraryItem | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<MediaLibraryItem | null>(null);

  const refresh = React.useCallback(() => {
    setLoading(true);
    api.mediaLibrary({ q: query || undefined, limit: 200 })
      .then((list) => {
        setItems(list);
        setSelected((current) => current ? list.find((item) => item.id === current.id) ?? null : list[0] ?? null);
      })
      .catch((err) => toast.error(messageUtilisateur(err, 'Mediatheque indisponible')))
      .finally(() => setLoading(false));
  }, [query]);

  React.useEffect(refresh, [refresh]);

  async function copyPath(value: string) {
    await navigator.clipboard.writeText(value);
    toast.success('Chemin copie');
  }

  async function remove() {
    if (!deleteTarget) return;
    try {
      await deleteMediaFile(deleteTarget.objectKey);
      toast.success('Media supprime');
      setDeleteTarget(null);
      refresh();
    } catch (err) {
      toast.error(messageUtilisateur(err, 'Suppression refusee'));
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-full gap-6 p-4 md:p-6">
      <PageHeader
        title="Mediatheque"
        description="Bibliotheque centrale des images BeautySavage. Un depot simple : recherche, selection, copie ou suppression."
        action={<Button variant="outline" onClick={refresh}><RefreshCw className="h-4 w-4" /> Actualiser</Button>}
      />

      <Card>
        <CardContent className="grid gap-4">
          <div className="space-y-4">
            <Field label="Recherche">
              <div className="flex h-10 items-center gap-2 rounded-md border px-3">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
                  placeholder="Nom, type, auteur"
                />
              </div>
            </Field>
          </div>

          {loading ? (
            <BrandLoader />
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-w-0">
                {items.length === 0 ? (
                  <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed">
                    <div className="text-center text-sm text-muted-foreground">
                      <Image className="mx-auto mb-3 h-8 w-8" />
                      Aucun media trouve.
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelected(item)}
                        className={`overflow-hidden rounded-lg border bg-card text-left transition hover:border-primary hover:shadow-md ${selected?.id === item.id ? 'border-primary ring-2 ring-primary/20' : ''}`}
                      >
                        <div className="aspect-video bg-muted">
                          <img src={resolvePreviewMediaUrl(item.publicUrl ?? item.path)} alt="" className="h-full w-full object-cover" loading="lazy" />
                        </div>
                        <div className="space-y-1 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <Badge>{item.mediaType}</Badge>
                            <span className="text-[11px] text-muted-foreground">{formatBytes(item.size)}</span>
                          </div>
                          <p className="truncate text-xs font-medium">{item.objectKey}</p>
                          <p className="text-[11px] text-muted-foreground">{item.width ?? '?'} x {item.height ?? '?'}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <aside className="min-w-0 rounded-lg border bg-muted/20 p-4">
                {selected ? (
                  <div className="grid gap-4">
                    <img src={resolvePreviewMediaUrl(selected.publicUrl ?? selected.path)} alt="" className="aspect-video w-full rounded-md object-cover" />
                    <div>
                      <h2 className="truncate text-sm font-semibold">{selected.objectKey}</h2>
                      <p className="text-xs text-muted-foreground">{selected.mediaType} - {selected.publicationState || 'LOCAL_ONLY'}</p>
                    </div>
                    <div className="grid gap-2 text-sm">
                      <Field label="Chemin stocke">
                        <Input readOnly value={selected.path} />
                      </Field>
                      <Field label="URL preview">
                        <Input readOnly value={selected.publicUrl ?? selected.path} />
                      </Field>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => copyPath(selected.path)}><Copy className="h-4 w-4" /> Copier</Button>
                      <Button variant="destructive" onClick={() => setDeleteTarget(selected)}><Trash2 className="h-4 w-4" /> Supprimer</Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Selectionnez une image.</p>
                )}
              </aside>
            </div>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        title="Supprimer ce media"
        description="Le backend refusera la suppression si le media est encore utilise."
        confirmLabel="Supprimer"
        destructive
      />
    </div>
  );
}
