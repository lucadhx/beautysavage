/**
 * Utilitaires monétaires. RÈGLE ABSOLUE : les montants sont stockés en CENTIMES
 * (entiers). Jamais de flottant pour un paiement. 99000 = 990,00 €.
 */

/** Convertit des euros (saisie Manager) en centimes entiers. */
export function eurosToCents(euros) {
  const n = Number(euros);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Montant en euros invalide : ${euros}`);
  }
  // Arrondi au centime pour éviter les artefacts flottants (ex. 19.99 * 100).
  return Math.round(n * 100);
}

/** Convertit des centimes en euros (nombre). */
export function centsToEuros(cents) {
  return Math.round(Number(cents)) / 100;
}

/**
 * Calcule un triplet HT / TVA / TTC de manière déterministe (tout en centimes).
 * @param {{ amountExcludingTax:number, taxRate:number, currency?:string }} input
 *   amountExcludingTax en CENTIMES, taxRate en POURCENTAGE (ex. 20).
 */
export function computePricing({ amountExcludingTax, taxRate, currency = 'EUR' }) {
  const ht = Math.round(Number(amountExcludingTax));
  const rate = Number(taxRate);
  if (!Number.isInteger(ht) || ht < 0) throw new Error(`HT invalide : ${amountExcludingTax}`);
  if (!Number.isFinite(rate) || rate < 0) throw new Error(`Taux TVA invalide : ${taxRate}`);
  const taxAmount = Math.round((ht * rate) / 100);
  return {
    amountExcludingTax: ht,
    taxRate: rate,
    taxAmount,
    amountIncludingTax: ht + taxAmount,
    currency,
  };
}

/** Formatage FR pour l'affichage (ex. 99000 -> "990,00 €"). */
export function formatCents(cents, currency = 'EUR') {
  const euros = centsToEuros(cents);
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(euros);
}

/**
 * ÉQUIVALENT MENSUEL INFORMATIF d'une échéance d'abonnement, en CENTIMES.
 *
 * ══ CE QU'IL EST, ET CE QU'IL N'EST SURTOUT PAS ═════════════════════════════
 *
 * Un REPÈRE DE COMPARAISON, et rien d'autre. Il ne modifie jamais le montant
 * contractuel, ne décrit aucun prélèvement, et ne se remultiplie jamais pour
 * reconstituer l'échéance — l'arrondi y perdrait des centimes.
 *
 * « 900 € tous les 3 mois » vaut 300 €/mois EN REPÈRE. Ce que le client paie
 * reste 900 €, trois fois moins souvent.
 *
 * ══ DEUX FORMES D'APPEL, UNE SEULE RÈGLE ════════════════════════════════════
 *
 * Le second paramètre accepte une récurrence `{ unit, interval }` — la forme
 * courante — ou l'ancienne CHAÎNE `'MONTH'`/`'YEAR'`. La seconde n'est pas une
 * commodité : `monthlyEquivalentCents(x, 'YEAR')` reste écrit dans des tests
 * qui décrivent un comportement toujours vrai, et les casser pour un
 * changement de signature n'aurait rien prouvé de plus.
 */
export function monthlyEquivalentCents(amountCents, recurrenceOrInterval) {
  const cents = Math.max(0, Math.round(Number(amountCents) || 0));

  const r = recurrenceOrInterval;
  const unit = String((typeof r === 'object' && r !== null ? r.unit : r) ?? '').toUpperCase();
  const pas = typeof r === 'object' && r !== null ? Number(r.interval) : 1;
  const interval = Number.isInteger(pas) && pas >= 1 ? pas : 1;

  const mois = unit === 'YEAR' ? interval * 12 : interval;
  return mois > 1 ? Math.round(cents / mois) : cents;
}
