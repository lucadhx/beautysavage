import type { CommerceProduct } from '@/lib/api';

/**
 * À PAYER MAINTENANT / SUR PLACE — le même calcul que le serveur
 * (`commercePaymentRules.paymentSplit`) : acompte sur le prix de la ligne,
 * options comprises ; un acompte fixe ne dépasse jamais ce prix.
 */
export function paySplit(product: CommerceProduct, totalCents: number) {
  const rule = product.paymentRule;
  if (product.kind !== 'SERVICE' || !rule || rule.type === 'FULL') return { payNowCents: totalCents, balanceDueCents: 0, rule: 'FULL' as const };
  if (rule.type === 'FREE') return { payNowCents: 0, balanceDueCents: totalCents, rule: 'FREE' as const };
  const value = Math.max(0, Number(rule.depositValue) || 0);
  const deposit = rule.depositType === 'FIXED' ? Math.round(value * 100) : Math.round((totalCents * Math.min(100, value)) / 100);
  const payNow = Math.min(totalCents, deposit);
  return { payNowCents: payNow, balanceDueCents: totalCents - payNow, rule: 'DEPOSIT' as const };
}
