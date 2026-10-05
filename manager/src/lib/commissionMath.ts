/**
 * LE CALCUL DE COMMISSION, CÔTÉ ÉCRAN — même formule que le serveur
 * (`backend/src/services/commissionRules.js`) pour que la simulation affichée
 * soit exactement ce qui sera facturé.
 *
 * « 7,5 % TTC » avec 20 % de TVA : commission + TVA = 7,5 % de l'assiette,
 * soit 6,25 % HT (6,25 × 1,2 = 7,5). Stripe facture le HT, la TVA s'y ajoute.
 */
export type RateType = 'HT' | 'TTC';

export interface CommissionInput {
  ratePercent: number;
  rateType: RateType;
  vatRate: number;
  basis: 'HT' | 'TTC';
  salesVatRate: number;
}

export function effectiveRates({ ratePercent, rateType, vatRate }: Pick<CommissionInput, 'ratePercent' | 'rateType' | 'vatRate'>) {
  const ht = rateType === 'TTC' ? ratePercent / (1 + vatRate / 100) : ratePercent;
  return { htPercent: ht, ttcPercent: ht * (1 + vatRate / 100) };
}

/** Commission d'une vente de `saleTtcCents` : assiette, HT, TVA, TTC (centimes). */
export function simulateCommission(saleTtcCents: number, c: CommissionInput) {
  const basisCents = c.basis === 'HT' ? Math.round(saleTtcCents / (1 + c.salesVatRate / 100)) : saleTtcCents;
  const htCents = c.rateType === 'TTC'
    ? Math.round(Math.round((basisCents * c.ratePercent) / 100) / (1 + c.vatRate / 100))
    : Math.round((basisCents * c.ratePercent) / 100);
  const vatCents = Math.round((htCents * c.vatRate) / 100);
  return { basisCents, htCents, vatCents, ttcCents: htCents + vatCents, ...effectiveRates(c) };
}

/** Un plafond saisi HT ou TTC, dans les deux unités. */
export function capBoth(capCents: number | null | undefined, capType: RateType, vatRate: number) {
  if (!capCents) return null;
  const ht = capType === 'TTC' ? Math.round(capCents / (1 + vatRate / 100)) : capCents;
  return { htCents: ht, ttcCents: capType === 'TTC' ? capCents : Math.round(ht * (1 + vatRate / 100)) };
}

export const pct = (v: number, digits = 2) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: digits })} %`;
export const eur = (cents: number | null | undefined) => (Number(cents || 0) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
