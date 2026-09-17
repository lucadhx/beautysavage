import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, LoadingState } from '@bs/ui';
import { getPaymentResult, getCheckoutSessionStatus } from '@bs/api-client';
import { useCart } from '../features/cart/CartProvider';

type View = 'loading' | 'confirmed' | 'pending' | 'failed' | 'unknown';

// Retour de paiement. Gère free=1 | session_id=cs_… | payment_intent_id=pi_… | absence de params.
// Wording PRUDENT : jamais "confirmé" sans confirmation Stripe. Panier vidé UNIQUEMENT si confirmé.
export function PaymentSuccessPage() {
  const [params] = useSearchParams();
  const { clearCart } = useCart();
  const isFree = params.get('free') === '1';
  const sessionId = params.get('session_id') || '';
  const paymentIntentId = params.get('payment_intent_id') || params.get('payment_intent') || '';

  const [view, setView] = useState<View>(isFree ? 'confirmed' : 'loading');
  const [detail, setDetail] = useState<string>('');

  useEffect(() => {
    let active = true;
    // Flow gratuit déjà finalisé côté React (finalize-free) avant la redirection.
    if (isFree) {
      setView('confirmed');
      setDetail('Votre commande (gratuite) a été finalisée.');
      clearCart();
      return;
    }
    const resolve = async () => {
      try {
        if (paymentIntentId) {
          const r = await getPaymentResult(paymentIntentId);
          if (!active) return;
          if (r.status === 'succeeded') {
            setView('confirmed');
            setDetail(r.purchase?.itemTitle ? `Merci pour votre achat : ${r.purchase.itemTitle}.` : 'Merci pour votre achat.');
            clearCart();
          } else if (r.status === 'failed') {
            setView('failed');
            setDetail(r.errorMessage || 'Aucun montant n’a été débité. Vous pouvez réessayer.');
          } else {
            setView('pending');
          }
          return;
        }
        if (sessionId) {
          const s = await getCheckoutSessionStatus(sessionId);
          if (!active) return;
          if (s.status === 'succeeded') {
            setView('confirmed');
            setDetail('Merci pour votre achat.');
            clearCart();
          } else if (s.status === 'failed') {
            setView('failed');
            setDetail('Aucun montant n’a été débité. Vous pouvez réessayer.');
          } else {
            setView('pending');
          }
          return;
        }
        setView('unknown');
      } catch {
        if (active) setView('pending'); // lookup KO → on reste prudent (pas de panier vidé)
      }
    };
    void resolve();
    return () => { active = false; };
  }, [isFree, sessionId, paymentIntentId, clearCart]);

  if (view === 'loading') return <LoadingState label="Vérification du paiement…" />;

  const TITLES: Record<Exclude<View, 'loading'>, string> = {
    confirmed: 'Paiement confirmé.',
    pending: 'Paiement reçu, confirmation en cours.',
    failed: 'Le paiement a échoué.',
    unknown: 'Statut du paiement indisponible.',
  };
  const DEFAULT_DETAIL: Record<Exclude<View, 'loading'>, string> = {
    confirmed: 'Merci pour votre achat.',
    pending: 'La validation finale est en cours. Vous recevrez la confirmation par e-mail.',
    failed: 'Aucun montant n’a été débité. Vous pouvez réessayer.',
    unknown: 'Si un montant a été débité, contactez-nous : la confirmation suivra par e-mail.',
  };

  return (
    <section>
      <Card>
        <h1>{TITLES[view]}</h1>
        <p>{detail || DEFAULT_DETAIL[view]}</p>
        <p style={{ display: 'flex', gap: 'var(--bs-space-2)', flexWrap: 'wrap' }}>
          {view === 'confirmed' || view === 'pending' ? (
            <>
              <Link className="bs-btn" to="/mon-compte">Voir mon compte</Link>
              <Link className="bs-btn bs-btn--secondary" to="/mes-formations">Mes formations</Link>
            </>
          ) : null}
          {view === 'failed' ? <Link className="bs-btn" to="/checkout">Réessayer</Link> : null}
          <Link className="bs-btn bs-btn--secondary" to="/">Retour à l’accueil</Link>
        </p>
      </Card>
    </section>
  );
}
