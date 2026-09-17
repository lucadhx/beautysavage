import { Button, Badge } from '@bs/ui';
import { formatPrice, formatDuration, type PublicService } from '@bs/api-client';

// RX3 — Carte d'achat sticky (desktop) : prix vivant (base + options), durée, badge paiement, CTA réserver.
// Présentation pure ; l'état options/total vit dans la page (source unique).

export interface ServicePurchaseCardProps {
  service: PublicService;
  total: number;
  optionsTotal: number;
  onReserve: () => void;
  className?: string;
}

function paymentBadge(paymentType?: string) {
  if (paymentType === 'deposit') return <Badge tone="info">Acompte à la réservation</Badge>;
  if (paymentType === 'free') return <Badge tone="success">Gratuit</Badge>;
  return null;
}

export function ServicePurchaseCard({ service, total, optionsTotal, onReserve, className = '' }: ServicePurchaseCardProps) {
  const bookable = service.isBookable !== false;
  const base = service.effectivePrice ?? service.price;
  const hasPromo = Boolean(service.hasPromo) && optionsTotal === 0 && base < service.price;

  return (
    <div className={['bs-card', 'sd-buy', className].filter(Boolean).join(' ')}>
      <div className="sd-buy__price">
        <span className="sd-buy__amount">{formatPrice(total)}</span>
        {hasPromo ? <span className="sd-buy__original">{formatPrice(service.price)}</span> : null}
      </div>
      {optionsTotal > 0 ? <p className="sd-buy__options">dont options : + {formatPrice(optionsTotal)}</p> : null}

      <div className="sd-buy__meta">
        {service.duration ? (
          <span className="sd-buy__duration">
            <i className="bi bi-clock" aria-hidden="true" /> {formatDuration(service.duration)}
          </span>
        ) : null}
        {paymentBadge(service.paymentType)}
      </div>

      {bookable ? (
        <Button type="button" onClick={onReserve} className="sd-buy__cta">
          Réserver
        </Button>
      ) : (
        <Button type="button" disabled className="sd-buy__cta">
          Réservation indisponible
        </Button>
      )}
      <p className="bs-note sd-buy__note">Le créneau est confirmé après paiement.</p>
    </div>
  );
}
