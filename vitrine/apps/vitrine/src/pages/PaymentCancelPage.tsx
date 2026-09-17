import { Link } from 'react-router-dom';
import { Card } from '@bs/ui';

// Retour annulation. Le panier N'EST PAS vidé (l'utilisateur peut reprendre son achat).
export function PaymentCancelPage() {
  return (
    <section>
      <Card>
        <h1>Paiement annulé.</h1>
        <p>Aucun montant n’a été débité. Votre panier a été conservé.</p>
        <p style={{ display: 'flex', gap: 'var(--bs-space-2)', flexWrap: 'wrap' }}>
          <Link className="bs-btn" to="/checkout">Reprendre le paiement</Link>
          <Link className="bs-btn bs-btn--secondary" to="/panier">Voir le panier</Link>
        </p>
      </Card>
    </section>
  );
}
