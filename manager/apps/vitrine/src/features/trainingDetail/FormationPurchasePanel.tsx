import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, StickyBar } from '@bs/ui';
import { formatPrice, type PublicTraining, type PublicFormationSession } from '@bs/api-client';
import { useCart } from '../cart';
import { FormationSessions } from './FormationSessions';

// RX3 S3 — Achat formation depuis la fiche. Présentiel : session OBLIGATOIRE avant ajout. Distanciel :
// ajout direct (le checkout exige la renonciation accès immédiat). Aucun prix inventé (backend fait foi).

export function FormationPurchasePanel({ training }: { training: PublicTraining }) {
  const { addFormation } = useCart();
  const distanciel = training.type === 'distanciel';
  const price = training.finalPrice ?? training.price;
  const [session, setSession] = useState<PublicFormationSession | null>(null);
  const [added, setAdded] = useState(false);

  const canAdd = distanciel || Boolean(session);

  const onAdd = () => {
    if (distanciel) {
      addFormation({ refId: training.id, name: training.name, indicativePrice: price, formationType: 'distanciel' });
    } else {
      if (!session) return;
      addFormation({
        refId: training.id,
        name: training.name,
        indicativePrice: price,
        formationType: 'presentiel',
        sessionId: session.id,
        sessionStartAt: session.startDate ?? undefined,
        refundDays: training.refundDays,
      });
    }
    setAdded(true);
  };

  return (
    <div className="td-purchase">
      {!distanciel ? (
        <FormationSessions
          formationId={training.id}
          selectable
          selectedId={session?.id ?? null}
          onSelect={(s) => {
            setSession(s);
            setAdded(false);
          }}
        />
      ) : null}

      <StickyBar className="td-buybar" desktopInline={false}>
        <span className="td-buybar__price">{formatPrice(price)}</span>
        {added ? (
          <Link className="bs-btn" to="/panier">
            Voir le panier
          </Link>
        ) : (
          <Button type="button" onClick={onAdd} disabled={!canAdd} className="td-buybar__cta">
            {distanciel ? 'Ajouter au panier' : session ? 'Ajouter au panier' : 'Choisissez une session'}
          </Button>
        )}
      </StickyBar>
    </div>
  );
}
