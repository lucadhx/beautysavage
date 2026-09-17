import { SectionHeader, Card, LoadingState, ErrorState } from '@bs/ui';
import { usePublicGiftCards } from '../features/catalog/hooks/usePublicGiftCards';
import { GiftCardPurchasePanel } from '../features/giftcard/GiftCardPurchasePanel';
import '../features/giftcard/giftcard.css';

// RX3 S4 — Achat carte cadeau (parcours complet). Le backend crée la carte à la finalisation du paiement.
export function GiftCardsPage() {
  const { data, isPending, isError } = usePublicGiftCards();

  return (
    <section className="vitrine-page">
      <SectionHeader title="Offrir une carte cadeau" subtitle="Le cadeau qui fait toujours plaisir — utilisable sur nos prestations et formations." />
      {isPending ? <LoadingState label="Chargement…" /> : null}
      {isError || (!isPending && !data) ? <ErrorState title="Cartes cadeaux indisponibles pour le moment." /> : null}
      {!isPending && data ? (
        <>
          {data.description ? (
            <Card>
              <p className="bs-note">{data.description}</p>
            </Card>
          ) : null}
          <GiftCardPurchasePanel config={data} />
        </>
      ) : null}
    </section>
  );
}
