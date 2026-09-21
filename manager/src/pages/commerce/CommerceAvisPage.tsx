import * as React from 'react';
import { Check, PawPrint, Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Field, Input, Switch, Textarea } from '@/components/ui/primitives';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { Modal } from '@/components/ui/dialog';
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
  };
}

export default function CommerceAvisPage() {
  const [reviews, setReviews] = React.useState<CommerceReview[]>([]);
  const [products, setProducts] = React.useState<CommerceProduct[]>([]);
  const [moderation, setModeration] = React.useState<{ review: CommerceReview; status: 'PUBLISHED' | 'REJECTED'; comment: string } | null>(null);
  const [manualOpen, setManualOpen] = React.useState(false);
  const [manual, setManual] = React.useState(defaultManualForm);
  const [message, setMessage] = React.useState('');

  const refresh = React.useCallback(() => {
    Promise.all([api.commerceReviews(), api.commerceProducts()])
      .then(([list, productList]) => {
        setReviews(list as CommerceReview[]);
        setProducts(productList as CommerceProduct[]);
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Chargement impossible'));
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
      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="En attente" value={reviews.filter((item) => item.status === 'PENDING').length} />
        <Metric label="Publies" value={reviews.filter((item) => item.status === 'PUBLISHED').length} />
        <Metric label="Refuses" value={reviews.filter((item) => item.status === 'REJECTED').length} />
      </div>
      <Panel title="Moderation">
        <div className="grid gap-3">
          {reviews.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucun avis pour le moment.</p>}
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
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setManualOpen(false)}>Annuler</Button>
            <Button onClick={createManualReview}>Enregistrer l'avis</Button>
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
