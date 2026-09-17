// RX4 S2 — Parcours avis (formation) : note (PawInput) + commentaire → prévisualisation → envoi → confirmation.
// Backend : formations only, un seul avis/user (409 si doublon). Aucune lecture de statut (modération C3
// opaque) → message honnête après envoi. Jamais de popup native (Drawer).
import { useState } from 'react';
import { Button, Drawer, ErrorState, FormField, PawInput, PawRating, TextArea } from '@bs/ui';
import { ApiError } from '@bs/api-client';
import { useSubmitReview } from './hooks';

export function ReviewDrawer({
  formationId,
  formationName,
  onClose,
}: {
  formationId: string;
  formationName: string;
  onClose: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(false);
  const submit = useSubmitReview();

  const alreadyReviewed = submit.error instanceof ApiError && submit.error.status === 409;

  function onSubmit() {
    if (rating < 1) return;
    submit.mutate(
      { formationId, rating, comment: comment.trim() },
      { onSuccess: () => setDone(true) },
    );
  }

  return (
    <Drawer
      open
      title={done ? 'Merci !' : 'Laisser un avis'}
      onClose={onClose}
      footer={
        done || alreadyReviewed ? (
          <Button onClick={onClose}>Fermer</Button>
        ) : (
          <div className="bs-bk-actions">
            <Button variant="secondary" onClick={onClose} disabled={submit.isPending}>Annuler</Button>
            <Button onClick={onSubmit} disabled={rating < 1 || submit.isPending}>
              {submit.isPending ? 'Envoi…' : 'Envoyer mon avis'}
            </Button>
          </div>
        )
      }
    >
      {done ? (
        <div className="bs-hub__section" role="status">
          <div className="bs-bk-consequence bs-bk-consequence--ok">
            <i className="bi bi-check2-circle" aria-hidden="true" />
            <div>
              <strong>Votre avis a bien été envoyé.</strong>
              <p className="bs-row__meta" style={{ margin: '4px 0 0' }}>
                Il sera publié après vérification. Merci pour votre retour !
              </p>
            </div>
          </div>
        </div>
      ) : alreadyReviewed ? (
        <div className="bs-hub__section" role="status">
          <div className="bs-bk-consequence bs-bk-consequence--none">
            <i className="bi bi-info-circle" aria-hidden="true" />
            <div><strong>Vous avez déjà laissé un avis pour cette formation.</strong></div>
          </div>
        </div>
      ) : (
        <div className="bs-acc-form">
          <p style={{ margin: 0 }}>Votre avis sur <strong>{formationName}</strong>.</p>
          <FormField label="Votre note" required>
            <PawInput value={rating} onChange={setRating} />
          </FormField>
          <FormField label="Commentaire" hint="Facultatif — partagez votre expérience.">
            <TextArea value={comment} maxLength={1000} rows={4}
              onChange={(e) => setComment(e.target.value)} placeholder="Votre retour…" />
          </FormField>
          {rating > 0 ? (
            <div>
              <span className="bs-hub__section-title" style={{ display: 'block', marginBottom: 4 }}>Prévisualisation</span>
              <div className="bs-row">
                <span className="bs-row__body">
                  <PawRating value={rating} />
                  {comment.trim() ? <span className="bs-row__meta">{comment.trim()}</span> : null}
                </span>
              </div>
            </div>
          ) : null}
          {submit.isError && !alreadyReviewed ? <ErrorState title="Envoi impossible. Réessayez." /> : null}
        </div>
      )}
    </Drawer>
  );
}
