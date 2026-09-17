// M13 — Librairie de templates carte cadeau (admin/dev). Liste les modèles VISIBLES en cards avec
// aperçu (iframe sandbox), badge/bordure "Actif" sur l'actif, et bouton "Choisir ce template" qui
// ouvre une modale de confirmation puis active. L'admin NE peut PAS éditer le HTML. Le backend
// garantit toujours exactement un actif.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoadingState, ErrorState, Button } from '@bs/ui';
import {
  listGiftCardLibrary,
  previewGiftCardLibraryTemplate,
  activateGiftCardLibraryTemplate,
  type GiftCardTemplate,
} from '@bs/api-client';
import './giftCardLibrary.css';

function TemplatePreviewFrame({ id }: { id: string }) {
  const { data, status } = useQuery({
    queryKey: ['gift-card-library-preview', id],
    queryFn: () => previewGiftCardLibraryTemplate(id),
    retry: false,
    staleTime: 60_000,
  });
  return (
    <div className="gcl-card__preview">
      {status === 'pending' ? <div className="gcl-card__preview-loading">Aperçu…</div> : null}
      {status === 'error' ? <div className="gcl-card__preview-loading">Aperçu indisponible</div> : null}
      {status === 'success' ? (
        <iframe title="Aperçu carte cadeau" data-testid="gcl-preview-frame" className="gcl-card__frame" sandbox="" srcDoc={data || '<p>(aperçu vide)</p>'} />
      ) : null}
    </div>
  );
}

function ConfirmModal({ template, busy, onCancel, onConfirm }: {
  template: GiftCardTemplate; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <>
      <div className="gcl-overlay" aria-hidden="true" onClick={onCancel} />
      <div className="gcl-modal" role="dialog" aria-modal="true" aria-label="Confirmer le template" data-testid="gcl-confirm">
        <strong>Choisir ce template ?</strong>
        <p className="gcl-note">« {template.name} » deviendra le modèle utilisé pour toutes les nouvelles cartes cadeaux.</p>
        <div className="gcl-modal__actions">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>Annuler</Button>
          <Button type="button" onClick={onConfirm} disabled={busy} data-testid="gcl-confirm-btn">{busy ? 'Activation…' : 'Confirmer'}</Button>
        </div>
      </div>
    </>
  );
}

export function GiftCardLibraryPage() {
  const qc = useQueryClient();
  const { data, status } = useQuery({ queryKey: ['gift-card-library'], queryFn: listGiftCardLibrary, retry: false });
  const [pending, setPending] = useState<GiftCardTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activateMut = useMutation({
    mutationFn: (id: string) => activateGiftCardLibraryTemplate(id),
    onSuccess: () => { setPending(null); setError(null); void qc.invalidateQueries({ queryKey: ['gift-card-library'] }); },
    onError: () => setError('Impossible de changer le template actif.'),
  });

  if (status === 'pending') return <LoadingState label="Chargement de la librairie…" />;
  if (status === 'error') return <ErrorState title="Impossible de charger la librairie." />;

  const templates = data ?? [];

  return (
    <section className="gcl-page">
      <div className="gcl-head">
        <h1 className="gcl-head__title">Modèles de carte cadeau</h1>
        <p className="gcl-head__subtitle">Choisissez le modèle appliqué à toutes les nouvelles cartes cadeaux. Un seul modèle est actif à la fois.</p>
      </div>
      {error ? <p className="gcl-error" role="alert">{error}</p> : null}
      {templates.length === 0 ? <div className="gcl-empty">Aucun modèle disponible.</div> : (
        <div className="gcl-grid" data-testid="gcl-grid">
          {templates.map((t) => (
            <div className={`gcl-card${t.active ? ' gcl-card--active' : ''}`} key={t.id} data-testid="gcl-card">
              <div className="gcl-card__head">
                <span className="gcl-card__name">{t.name}</span>
                {t.active ? <span className="gcl-badge gcl-badge--active" data-testid="gcl-active-badge">Actif</span> : null}
              </div>
              <TemplatePreviewFrame id={t.id} />
              <div className="gcl-card__foot">
                {t.active ? (
                  <span className="gcl-current">Modèle actuel</span>
                ) : (
                  <Button type="button" variant="secondary" onClick={() => setPending(t)} data-testid="gcl-choose">Choisir ce template</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {pending ? (
        <ConfirmModal template={pending} busy={activateMut.isPending} onCancel={() => setPending(null)} onConfirm={() => activateMut.mutate(pending.id)} />
      ) : null}
    </section>
  );
}
