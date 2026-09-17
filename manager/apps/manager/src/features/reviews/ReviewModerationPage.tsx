import { useEffect, useMemo, useState } from 'react';
import { Badge, Drawer, ErrorState, PawInput, PawRating, TextArea } from '@bs/ui';
import type { ManualReviewInput, ModerationReview, ReviewStatus, ReviewTargetType } from '@bs/api-client';
import {
  useCreateManualReview,
  useModerateReview,
  useReviewCatalog,
  useReviews,
} from './useReviewModeration';
import { CatalogueSkeleton } from '../catalogue/components';
import { Dropdown } from './Dropdown';
import './reviews.css';

const STATUS_FILTERS: { key: ReviewStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'pending', label: 'En attente' },
  { key: 'published', label: 'Publiés' },
  { key: 'rejected', label: 'Refusés' },
];

const TYPE_FILTERS: { key: ReviewTargetType | 'all'; label: string }[] = [
  { key: 'all', label: 'Tous les types' },
  { key: 'service', label: 'Prestations' },
  { key: 'formation', label: 'Formations' },
];

function StatusBadge({ status }: { status: ReviewStatus }) {
  if (status === 'published') return <Badge tone="success">Publié</Badge>;
  if (status === 'rejected') return <Badge tone="danger">Refusé</Badge>;
  return <Badge tone="warning">En attente</Badge>;
}

function ReviewCard({
  review,
  onModerate,
  busy,
}: {
  review: ModerationReview;
  onModerate: (status: ReviewStatus) => void;
  busy: boolean;
}) {
  return (
    <article className="rvm-card" data-testid="rvm-card">
      <div className="rvm-card__top">
        <div className="rvm-card__who">
          <span className="rvm-card__author">{review.authorName}</span>
          <span className="rvm-card__target">
            {review.targetType === 'service' ? 'Prestation' : 'Formation'} · {review.targetName}
          </span>
        </div>
        <PawRating value={review.rating} compact />
      </div>

      {review.comment ? (
        <p className="rvm-card__comment">“{review.comment}”</p>
      ) : (
        <p className="rvm-card__comment rvm-card__comment--empty">Sans commentaire</p>
      )}

      <div className="rvm-card__foot">
        <div className="rvm-card__tags">
          <StatusBadge status={review.status} />
          {review.isManual ? <Badge tone="accent">Manuel</Badge> : null}
          <span className="rvm-card__source">{review.sourceLabel}</span>
        </div>
        <div className="rvm-card__actions">
          <button
            type="button"
            className="rvm-iconbtn rvm-iconbtn--ok"
            title="Publier"
            aria-label="Publier"
            disabled={busy || review.status === 'published'}
            onClick={() => onModerate('published')}
          >
            <i className="bi bi-check-lg" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="rvm-iconbtn rvm-iconbtn--no"
            title="Refuser"
            aria-label="Refuser"
            disabled={busy || review.status === 'rejected'}
            onClick={() => onModerate('rejected')}
          >
            <i className="bi bi-eye-slash" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="rvm-iconbtn"
            title="Remettre en attente"
            aria-label="Remettre en attente"
            disabled={busy || review.status === 'pending'}
            onClick={() => onModerate('pending')}
          >
            <i className="bi bi-hourglass-split" aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}

// Date du jour au format yyyy-mm-dd (pour l'input date + valeur par défaut).
function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Statut d'office « publié » à la création manuelle (plus de sélecteur de statut).
const INITIAL_MANUAL_REVIEW: ManualReviewInput = {
  targetType: 'service',
  targetId: '',
  displayName: '',
  rating: 0,
  comment: '',
  status: 'published',
  reviewDate: '',
};

export function ReviewModerationPage() {
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<ReviewTargetType | 'all'>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [manual, setManual] = useState<ManualReviewInput>(() => ({ ...INITIAL_MANUAL_REVIEW, reviewDate: todayIso() }));

  const query = useReviews({
    status: statusFilter === 'all' ? undefined : statusFilter,
    type: typeFilter === 'all' ? undefined : typeFilter,
  });
  const catalog = useReviewCatalog();
  const moderate = useModerateReview();
  const createManual = useCreateManualReview();

  const currentOptions = useMemo(
    () => (manual.targetType === 'service' ? catalog.data?.services ?? [] : catalog.data?.formations ?? []),
    [catalog.data, manual.targetType],
  );

  useEffect(() => {
    if (!currentOptions.length) {
      if (manual.targetId) setManual((prev) => ({ ...prev, targetId: '' }));
      return;
    }
    const exists = currentOptions.some((entry) => entry.id === manual.targetId);
    if (!exists) setManual((prev) => ({ ...prev, targetId: currentOptions[0]?.id ?? '' }));
  }, [currentOptions, manual.targetId]);

  function updateManual<K extends keyof ManualReviewInput>(key: K, value: ManualReviewInput[K]) {
    setManual((prev) => ({ ...prev, [key]: value }));
  }

  function submitManualReview() {
    createManual.mutate(manual, {
      onSuccess: () => {
        setManual((prev) => ({ ...INITIAL_MANUAL_REVIEW, targetType: prev.targetType, targetId: '', reviewDate: todayIso() }));
        setFormOpen(false);
      },
    });
  }

  const canSubmit =
    !createManual.isPending && Boolean(manual.targetId) && Boolean(manual.displayName.trim()) && manual.rating >= 1;

  return (
    <section className="rvm-page">
      <header className="rvm-head">
        <div className="rvm-head__titles">
          <h1 className="rvm-title">Avis</h1>
          <p className="rvm-subtitle">Prestations &amp; formations — modération et ajout manuel.</p>
        </div>
        <button type="button" className="rvm-addbtn" onClick={() => setFormOpen(true)}>
          <i className="bi bi-plus-lg" aria-hidden="true" /> Ajouter un avis
        </button>
      </header>

      <div className="rvm-toolbar">
        <div className="rvm-filter">
          <span className="rvm-filter__label">Statut</span>
          <Dropdown
            ariaLabel="Filtrer par statut"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as ReviewStatus | 'all')}
            options={STATUS_FILTERS.map((f) => ({ value: f.key, label: f.label }))}
          />
        </div>
        <div className="rvm-filter">
          <span className="rvm-filter__label">Type</span>
          <Dropdown
            ariaLabel="Filtrer par type"
            value={typeFilter}
            onChange={(v) => setTypeFilter(v as ReviewTargetType | 'all')}
            options={TYPE_FILTERS.map((f) => ({ value: f.key, label: f.label }))}
          />
        </div>
      </div>

      {query.isPending ? (
        <CatalogueSkeleton rows={4} />
      ) : query.isError ? (
        <ErrorState title="Impossible de charger les avis." detail="Réessayez plus tard." />
      ) : query.data && query.data.reviews.length > 0 ? (
        <div className="rvm-list">
          {query.data.reviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              busy={moderate.isPending}
              onModerate={(status) => moderate.mutate({ id: review.id, status })}
            />
          ))}
        </div>
      ) : (
        <div className="rvm-empty">
          <i className="bi bi-chat-square-heart" aria-hidden="true" />
          <p className="rvm-empty__title">Aucun avis</p>
          {/* Le CTA d'ajout n'apparaît dans le corps vide que pour le statut « Publiés »
              (un avis créé est publié d'office : inutile de le proposer sur En attente / Refusés / Tous). */}
          {statusFilter === 'published' ? (
            <button type="button" className="rvm-addbtn rvm-addbtn--ghost" onClick={() => setFormOpen(true)}>
              <i className="bi bi-plus-lg" aria-hidden="true" /> Ajouter un avis
            </button>
          ) : null}
        </div>
      )}

      <Drawer
        open={formOpen}
        title="Ajouter un avis"
        onClose={() => setFormOpen(false)}
        footer={
          <div className="rvm-form__foot">
            {createManual.isError ? (
              <span className="rvm-error">
                {(createManual.error as { message?: string })?.message || 'Création impossible.'}
              </span>
            ) : null}
            <button type="button" className="rvm-submit" onClick={submitManualReview} disabled={!canSubmit}>
              {createManual.isPending ? 'Création…' : 'Créer l’avis'}
            </button>
          </div>
        }
      >
        <div className="rvm-form" data-testid="rvm-manual-form">
          <p className="rvm-form__hint">
            Aucun faux client : le nom affiché est saisi par l’institut. L’avis est publié immédiatement.
          </p>

          <label className="rvm-form__field">
            <span className="rvm-form__label">Type</span>
            <Dropdown
              ariaLabel="Type"
              value={manual.targetType}
              onChange={(v) => updateManual('targetType', v as ReviewTargetType)}
              options={[
                { value: 'service', label: 'Prestation' },
                { value: 'formation', label: 'Formation' },
              ]}
            />
          </label>

          <label className="rvm-form__field">
            <span className="rvm-form__label">Élément concerné</span>
            <Dropdown
              ariaLabel="Élément concerné"
              value={manual.targetId}
              onChange={(v) => updateManual('targetId', v)}
              disabled={catalog.isPending || currentOptions.length === 0}
              placeholder={currentOptions.length === 0 ? 'Aucun élément disponible' : 'Sélectionner'}
              options={currentOptions.map((entry) => ({ value: entry.id, label: entry.name }))}
            />
          </label>

          <label className="rvm-form__field">
            <span className="rvm-form__label">Nom affiché</span>
            <input
              className="rvm-input"
              value={manual.displayName}
              onChange={(event) => updateManual('displayName', event.target.value)}
              placeholder="Ex. Camille M."
            />
          </label>

          <label className="rvm-form__field">
            <span className="rvm-form__label">Date de l’avis</span>
            <input
              className="rvm-input"
              type="date"
              max={todayIso()}
              value={manual.reviewDate ?? ''}
              onChange={(event) => updateManual('reviewDate', event.target.value)}
            />
          </label>

          <div className="rvm-form__field">
            <span className="rvm-form__label">Note</span>
            <PawInput value={manual.rating} onChange={(value) => updateManual('rating', value)} />
          </div>

          <label className="rvm-form__field">
            <span className="rvm-form__label">Commentaire</span>
            <TextArea
              rows={4}
              maxLength={1000}
              value={manual.comment ?? ''}
              onChange={(event) => updateManual('comment', event.target.value)}
              placeholder="Retour client, détail de prestation, expérience formation…"
            />
          </label>
        </div>
      </Drawer>
    </section>
  );
}
