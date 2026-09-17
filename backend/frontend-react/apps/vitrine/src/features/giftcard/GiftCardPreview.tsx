import { formatPrice } from '@bs/api-client';

// RX3 S4 — Aperçu premium de la carte cadeau (cosmétique front ; le rendu réel/PDF est backend).
// Donne envie : dégradé de marque, montant, bénéficiaire mis en avant, message.

export function GiftCardPreview({
  amount,
  recipientName,
  message,
  brand = 'Beauty Savage',
}: {
  amount: number;
  recipientName?: string;
  message?: string;
  brand?: string;
}) {
  return (
    <div className="gc-preview" aria-label="Aperçu de la carte cadeau">
      <div className="gc-preview__top">
        <span className="gc-preview__brand">{brand}</span>
        <span className="gc-preview__tag">Carte cadeau</span>
      </div>
      <div className="gc-preview__amount">{amount > 0 ? formatPrice(amount) : '—'}</div>
      <div className="gc-preview__to">{recipientName ? `Pour ${recipientName}` : 'Pour un être cher'}</div>
      {message ? <p className="gc-preview__msg">« {message} »</p> : null}
    </div>
  );
}
