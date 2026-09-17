import {
  formatPrice,
  type PublicTraining,
  type PublicProduct,
  type PublicService,
} from '@bs/api-client';
import type { PriceLabelProps } from '@bs/ui';

// Dérive les props PriceLabel (prix serveur fait foi : on n'additionne rien, on formate seulement).

export function trainingPriceProps(t: PublicTraining): PriceLabelProps {
  const final = t.finalPrice ?? t.price;
  return {
    current: formatPrice(final),
    original: final < t.price ? formatPrice(t.price) : undefined,
    promoLabel: t.activePromotion?.label,
  };
}

export function productPriceProps(p: PublicProduct): PriceLabelProps {
  const final = p.finalPrice ?? p.price;
  return {
    current: formatPrice(final),
    original: final < p.price ? formatPrice(p.price) : undefined,
    promoLabel: p.activePromotion?.label,
  };
}

export function servicePriceProps(s: PublicService): PriceLabelProps {
  const final = s.effectivePrice ?? s.price;
  return {
    current: formatPrice(final),
    original: final < s.price ? formatPrice(s.price) : undefined,
    promoLabel: s.promotionLabel ?? undefined,
  };
}
