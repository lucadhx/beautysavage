// LOT2 §4 — Renvoi carte cadeau avec reset PIN. Le PIN actuel est sécurisé (hashé) et ne peut être
// récupéré : un NOUVEAU code est généré, l'ancien invalidé, le PDF régénéré et la carte renvoyée.
// Confirmation obligatoire + anti-double-clic (bouton désactivé pendant l'envoi).
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@bs/ui';
import { resetGiftCardPin, ApiError } from '@bs/api-client';

export function GiftCardResendControl({ giftCardId, status }: { giftCardId: string; status: string }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => resetGiftCardPin(giftCardId),
    onSuccess: () => {
      setError(null);
      setDone(true);
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ['finance-gift-card', giftCardId] });
    },
    onError: (e) => setError(e instanceof ApiError ? (e.message || 'Erreur.') : 'Une erreur est survenue.'),
  });

  if (status !== 'active') return null;

  return (
    <div className="fin-gc-block fin-gc-resend">
      <span className="fin-gc-block__title"><i className="bi-envelope-arrow-up" aria-hidden="true" /> Renvoyer la carte cadeau</span>
      {done ? (
        <p className="fin-gc-resend__ok" role="status">Un nouveau code a été généré et la carte a été renvoyée au bénéficiaire.</p>
      ) : confirming ? (
        <div className="fin-gc-resend__confirm">
          <p>
            Le PIN actuel est sécurisé et ne peut pas être récupéré. Un <strong>nouveau PIN</strong> sera
            généré et l'ancien deviendra <strong>invalide</strong>. Continuer&nbsp;?
          </p>
          <div className="fin-gc-resend__actions">
            <Button type="button" disabled={mut.isPending} onClick={() => mut.mutate()}>
              {mut.isPending ? 'Envoi…' : 'Confirmer et renvoyer'}
            </Button>
            <Button type="button" variant="secondary" disabled={mut.isPending} onClick={() => { setConfirming(false); setError(null); }}>
              Annuler
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
          Renvoyer (nouveau code)
        </Button>
      )}
      {error ? <p className="fin-gc-resend__error" role="alert">{error}</p> : null}
    </div>
  );
}
