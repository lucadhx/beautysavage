import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { customerApi } from '@/lib/api';

/**
 * RETOUR « ANNULER » DEPUIS LA PAGE DE PAIEMENT STRIPE.
 *
 * L'adresse de retour porte `?paiement=annule&commande=<numéro>`. Le créneau
 * retenu pour ce paiement restait fermé 30 minutes à tout le monde ; on prévient
 * le serveur, qui ferme la page Stripe et le rend tout de suite. Si Stripe dit
 * que le paiement avait malgré tout abouti, la cliente le lit au lieu d'un
 * « paiement annulé » trompeur.
 */
export function useCheckoutAbandon(onMessage: (text: string) => void, cancelledText: string) {
  const [params, setParams] = useSearchParams();
  const notify = React.useRef(onMessage);
  notify.current = onMessage;
  React.useEffect(() => {
    if (params.get('paiement') !== 'annule') return;
    const saleNumber = params.get('commande') || '';
    params.delete('paiement');
    params.delete('commande');
    setParams(params, { replace: true });
    if (!saleNumber) { notify.current(cancelledText); return; }
    customerApi.abandonCheckout(saleNumber)
      .then((result) => notify.current(result.paid
        ? 'Votre paiement avait déjà abouti : votre réservation est confirmée. Retrouvez-la dans votre espace client.'
        : cancelledText))
      .catch(() => notify.current(cancelledText));
  }, [params, setParams, cancelledText]);
}
