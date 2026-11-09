import * as React from 'react';
import { Camera, Check, Loader2, PawPrint, Plus, Trash2, X } from 'lucide-react';
import { api, uploadReviewPhoto } from '@/lib/api';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { Button, Field, Input, Switch, Textarea } from '@/components/ui/primitives';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { Modal } from '@/components/ui/dialog';
import { CardsSkeleton, Skeleton } from '@/components/ui/Skeleton';
import {
  CommercePageFrame,
  Metric,
  Panel,
  StatusBadge,
  dateShort,
  type CommerceProduct,
  type CommerceReview,
} from './CommerceShared';

function name(value: CommerceReview['customerId']) {
  if (typeof value === 'object' && value) return [value.firstName, value.lastName].filter(Boolean).join(' ') || value.email || 'Client';
  return 'Client';
}

function product(value: CommerceReview['productId']) {
  return typeof value === 'object' && value ? value.title || 'Produit' : 'Avis global institut';
}

function defaultManualForm() {
  return {
    displayName: '',
    rating: '5',
    comment: '',
    productId: '',
    productUnspecified: true,
    createdAt: new Date().toISOString().slice(0, 10),
    status: 'PUBLISHED',
    photos: [] as string[],
  };
}

const PHOTO_MAX = 3;

export default function CommerceAvisPage() {
  const [reviews, setReviews] = React.useState<CommerceReview[]>([]);
  const [products, setProducts] = React.useState<CommerceProduct[]>([]);
  const [moderation, setModeration] = React.useState<{ review: CommerceReview; status: 'PUBLISHED' | 'REJECTED'; comment: string } | null>(null);
  const [manualOpen, setManualOpen] = React.useState(false);
  const [manual, setManual] = React.useState(defaultManualForm);
  const [message, setMessage] = React.useState('');
  const [loaded, setLoaded] = React.useState(false);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const photoInput = React.useRef<HTMLInputElement>(null);

  async function addPhotos(files: FileList | null) {
    const room = PHOTO_MAX - manual.photos.length;
    const chosen = Array.from(files || []).filter((f) => f.type.startsWith('image/')).slice(0, Math.max(0, room));
    if (!chosen.length) return;
    setPhotoBusy(true);
    try {
      const added: string[] = [];
      for (const file of chosen) added.push((await uploadReviewPhoto(file)).url);
      setManual((current) => ({ ...current, photos: [...current.photos, ...added].slice(0, PHOTO_MAX) }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Envoi de la photo impossible');
    } finally {
      setPhotoBusy(false);
      if (photoInput.current) photoInput.current.value = '';
    }
  }

  async function removePhoto(review: CommerceReview, url: string) {
    if (!window.confirm('Retirer cette photo de l’avis ?')) return;
    await api.removeCommerceReviewPhoto(review._id, url);
    refresh();
  }

  const refresh = React.useCallback(() => {
    Promise.all([api.commerceReviews(), api.commerceProducts()])
      .then(([list, productList]) => {
        setReviews(list as CommerceReview[]);
        setProducts(productList as CommerceProduct[]);
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Chargement impossible'))
      .finally(() => setLoaded(true));
  }, []);
  React.useEffect(refresh, [refresh]);

  async function moderate() {
    if (!moderation) return;
    await api.moderateCommerceReview(moderation.review._id, { status: moderation.status, moderationComment: moderation.comment });
    setModeration(null);
    setMessage(moderation.status === 'PUBLISHED' ? 'Avis publie.' : 'Avis refuse.');
    refresh();
  }

  async function createManualReview() {
    await api.createManualCommerceReview({
      ...manual,
      rating: Number(manual.rating),
      productId: manual.productUnspecified ? undefined : manual.productId || undefined,
      createdAt: manual.createdAt ? new Date(manual.createdAt).toISOString() : undefined,
    });
    setManualOpen(false);
    setManual(defaultManualForm());
    setMessage('Avis manuel ajoute.');
    refresh();
  }

  return (
    <CommercePageFrame
      title="Avis"
      description="Moderation des avis clients verifies par achat et publication d'avis manuels institut."
      actions={<Button onClick={() => setManualOpen(true)}><Plus className="h-4 w-4" /> Avis manuel</Button>}
    >
      {message && <p className="rounded-md border p-3 text-sm text-muted-foreground">{message}</p>}
      {!loaded ? <CardsSkeleton count={3} /> : (
        <div className="grid gap-4 md:grid-cols-3">
          <Metric label="En attente" value={reviews.filter((item) => item.status === 'PENDING').length} />
          <Metric label="Publies" value={reviews.filter((item) => item.status === 'PUBLISHED').length} />
          <Metric label="Refuses" value={reviews.filter((item) => item.status === 'REJECTED').length} />
        </div>
      )}
      <Panel title="Moderation">
        <div className="grid gap-3">
          {!loaded && [0, 1, 2].map((i) => <Skeleton key={i} className="h-36 w-full rounded-lg" />)}
          {loaded && reviews.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucun avis pour le moment.</p>}
          {reviews.map((review) => (
            <div key={review._id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{product(review.productId)} - note {review.rating}/5</p>
                  <p className="text-sm text-muted-foreground">{review.displayName || name(review.customerId)} - {dateShort(review.createdAt)}</p>
                </div>
                <StatusBadge>{review.status}</StatusBadge>
              </div>
              <p className="mt-3 text-sm">{review.comment || 'Sans commentaire.'}</p>
              {(review.photos?.length ?? 0) > 0 && (
                <div className="mt-3 flex flex-wrap gap-2" data-testid="review-photos">
                  {review.photos!.map((photo) => (
                    <div key={photo.url} className="relative h-20 w-20 overflow-hidden rounded-md border">
                      <a href={resolvePreviewMediaUrl(photo.url)} target="_blank" rel="noreferrer"><img src={resolvePreviewMediaUrl(photo.url)} alt="" className="h-full w-full object-cover" /></a>
                      <button type="button" onClick={() => removePhoto(review, photo.url)} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white" aria-label="Retirer cette photo" title="Retirer cette photo">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {review.moderationComment && <p className="mt-2 text-xs text-muted-foreground">Motif : {review.moderationComment}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setModeration({ review, status: 'PUBLISHED', comment: review.moderationComment || '' })}><Check className="h-4 w-4" /> Publier</Button>
                <Button size="sm" variant="outline" onClick={() => setModeration({ review, status: 'REJECTED', comment: review.moderationComment || '' })}><X className="h-4 w-4" /> Refuser</Button>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <Modal
        open={Boolean(moderation)}
        onClose={() => setModeration(null)}
        title={moderation?.status === 'REJECTED' ? "Refuser l'avis" : "Publier l'avis"}
        className="max-w-md"
      >
        {moderation && (
          <div className="grid gap-4">
            <Field label={moderation.status === 'REJECTED' ? 'Motif interne du refus' : 'Commentaire interne'}>
              <Textarea value={moderation.comment} onChange={(event) => setModeration({ ...moderation, comment: event.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setModeration(null)}>Annuler</Button>
              <Button variant={moderation.status === 'REJECTED' ? 'destructive' : 'default'} onClick={moderate}>Valider</Button>
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        title="Ajouter un avis manuel"
        description="Avis saisi par l'institut, publiable sur la vitrine."
        className="max-w-lg"
      >
        <div className="grid gap-4">
          <Field label="Nom affiche">
            <Input value={manual.displayName} onChange={(event) => setManual({ ...manual, displayName: event.target.value })} placeholder="Cliente BeautySavage" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Note">
              <PawRating value={Number(manual.rating)} onChange={(rating) => setManual({ ...manual, rating: String(rating) })} />
            </Field>
            <Field label="Date">
              <Input type="date" value={manual.createdAt} onChange={(event) => setManual({ ...manual, createdAt: event.target.value })} />
            </Field>
          </div>
          <div className="grid gap-3 rounded-lg border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Produit rattache</p>
                <p className="text-xs text-muted-foreground">Laissez non specifie pour un avis global ou si la prestation/formation n'existe plus.</p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={manual.productUnspecified} onChange={(checked) => setManual({ ...manual, productUnspecified: checked, productId: checked ? '' : manual.productId })} label="Produit non specifie" />
                Non specifie
              </label>
            </div>
            <div className={manual.productUnspecified ? 'pointer-events-none opacity-45' : ''}>
              <CustomSelect
                value={manual.productId}
                onChange={(value) => setManual({ ...manual, productId: value })}
                options={[
                  { value: '', label: 'Choisir une prestation ou formation' },
                  ...products.map((item) => ({ value: item._id, label: item.title })),
                ]}
              />
            </div>
          </div>
          <Field label="Statut">
            <CustomSelect
              value={manual.status}
              onChange={(value) => setManual({ ...manual, status: value })}
              options={[
                { value: 'PUBLISHED', label: 'Publie' },
                { value: 'PENDING', label: 'En attente' },
                { value: 'REJECTED', label: 'Refuse' },
              ]}
            />
          </Field>
          <Field label="Commentaire">
            <Textarea value={manual.comment} onChange={(event) => setManual({ ...manual, comment: event.target.value })} />
          </Field>
          <Field label={`Photos (${PHOTO_MAX} au plus, facultatif)`}>
            <div className="flex flex-wrap gap-2" data-testid="manual-review-photos">
              {manual.photos.map((url) => (
                <div key={url} className="relative h-20 w-20 overflow-hidden rounded-md border">
                  <img src={resolvePreviewMediaUrl(url)} alt="" className="h-full w-full object-cover" />
                  <button type="button" onClick={() => setManual((current) => ({ ...current, photos: current.photos.filter((u) => u !== url) }))} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white" aria-label="Retirer cette photo">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {manual.photos.length < PHOTO_MAX && (
                <button type="button" onClick={() => photoInput.current?.click()} disabled={photoBusy} className="grid h-20 w-20 place-items-center rounded-md border border-dashed text-xs text-muted-foreground" data-testid="manual-review-photo-add">
                  {photoBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <span className="grid justify-items-center gap-1"><Camera className="h-5 w-5" />Ajouter</span>}
                </button>
              )}
            </div>
            <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(event) => addPhotos(event.target.files)} data-testid="manual-review-photo-input" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setManualOpen(false)}>Annuler</Button>
            <Button onClick={createManualReview} disabled={photoBusy}>Enregistrer l'avis</Button>
          </div>
        </div>
      </Modal>
    </CommercePageFrame>
  );
}

function PawRating({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const active = hover ?? value;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1" onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((rating) => (
          <button
            key={rating}
            type="button"
            aria-label={`${rating} pattes sur 5`}
            onMouseEnter={() => setHover(rating)}
            onClick={() => onChange(rating)}
            className="rounded-md p-1 transition-transform hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <PawPrint
              className="h-6 w-6 transition-colors"
              style={{
                color: rating <= active ? 'var(--m-primary)' : 'var(--m-muted-foreground)',
                fill: rating <= active ? 'var(--m-primary)' : 'transparent',
              }}
            />
          </button>
        ))}
      </div>
      <span className="text-sm font-semibold">{value}/5 pattes</span>
    </div>
  );
}
