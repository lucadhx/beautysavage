// constants/tax.js
// Pré-React B1 — Contrat fiscal V1 : franchise en base de TVA (TVA non applicable).
//
// DÉCISION PRODUIT V1 : aucune TVA n'est calculée ni facturée. L'institut opère sous
// le régime de la franchise en base (art. 293 B du CGI). En V1, HT = TTC et le montant
// de TVA est toujours 0. Ce module est la SOURCE UNIQUE du contrat fiscal : aucun autre
// fichier ne doit coder en dur un taux ou une mention.
//
// Évolution future (assujettissement) : NE PAS implémenter ici. Le chemin documenté est
//   1) introduire un taux par ligne (Service/Formation/Product) + champ vatRate ;
//   2) calculer HT/TVA/TTC dans checkoutPricingService ;
//   3) ventiler la TVA sur factures internes + Stripe (tax_rates) + avoirs ;
//   4) versionner taxMode (ce module) pour distinguer les ventes 293B des ventes assujetties.
// Tant que TAX_MODE === 'vat_exempt_franchise_base', le moteur reste à taux zéro.

export const TAX_MODE = 'vat_exempt_franchise_base';
export const VAT_RATE = 0; // V1 : aucun taux appliqué
export const VAT_LEGAL_LABEL = 'TVA non applicable, art. 293 B du CGI';
export const TAX_SNAPSHOT_VERSION = '1.0-v1';

function roundToCents(value) {
  const n = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.round(n * 100) / 100;
}

/**
 * Construit le snapshot fiscal immuable d'une vente/facture en V1 (sans TVA).
 * En V1 : totalExcludingTax === totalIncludingTax, vatAmount === 0.
 * @param {number} totalIncludingTax montant TTC (= montant catalogue payé)
 * @returns {{taxMode, vatRate, vatLegalLabel, totalExcludingTax, vatAmount, totalIncludingTax, version}}
 */
export function buildTaxSnapshot(totalIncludingTax) {
  const ttc = roundToCents(totalIncludingTax);
  return {
    taxMode: TAX_MODE,
    vatRate: VAT_RATE,
    vatLegalLabel: VAT_LEGAL_LABEL,
    totalExcludingTax: ttc, // V1 : HT = TTC
    vatAmount: 0,
    totalIncludingTax: ttc,
    version: TAX_SNAPSHOT_VERSION
  };
}

export default {
  TAX_MODE,
  VAT_RATE,
  VAT_LEGAL_LABEL,
  TAX_SNAPSHOT_VERSION,
  buildTaxSnapshot
};
