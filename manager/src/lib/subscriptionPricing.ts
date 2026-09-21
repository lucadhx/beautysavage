/**
 * COÛT D'UN ABONNEMENT — ce qui est débité, et ce qui sert de repère.
 *
 * ── LA CONFUSION QU'IL SUPPRIME ─────────────────────────────────────────────
 * Un abonnement annuel s'affichait avec son montant d'échéance, sans dire qu'il
 * est prélevé EN UNE FOIS. Un client lisant « 1 200 € » pouvait comprendre
 * « par mois », et un DEV configurant l'offre n'avait aucun repère pour
 * comparer une formule mensuelle à une formule annuelle.
 *
 * Deux notions sont donc toujours distinguées, et jamais confondues :
 *   · l'ÉCHÉANCE — ce que Stripe débite réellement, à sa fréquence ;
 *   · l'ÉQUIVALENT MENSUEL — un repère de comparaison, jamais un montant
 *     débité.
 *
 * ── ARITHMÉTIQUE ────────────────────────────────────────────────────────────
 * Tout est en centimes entiers. Aucun flottant n'entre ici : `0.1 + 0.2` ne
 * fait pas `0.3`, et un centime perdu sur une facture est un centime de trop.
 * L'équivalent mensuel d'un montant annuel est arrondi au centime le plus
 * proche — c'est un repère, pas une somme à encaisser, et il n'est jamais
 * multiplié par douze pour reconstituer l'annuel.
 *
 * Module PUR (aucun React) : testable directement sous Node.
 */

export type BillingInterval = 'MONTH' | 'YEAR';

/** « tous les <interval> <unit> » — la périodicité, en deux dimensions. */
export interface Recurrence {
  unit: BillingInterval;
  interval: number;
}

export const DEFAULT_RECURRENCE: Recurrence = { unit: 'MONTH', interval: 1 };

/** Les bornes de saisie, miroir de `MAX_SUBSCRIPTION_INTERVAL_BY_UNIT`. */
export const MAX_INTERVAL_BY_UNIT: Record<BillingInterval, number> = { MONTH: 36, YEAR: 3 };

export interface SubscriptionLine {
  enabled?: boolean;
  amountExcludingTax?: number;
  taxAmount?: number;
  amountIncludingTax?: number;
  currency?: string;
  /** La périodicité qui fait foi. Le serveur la rend toujours résolue. */
  recurrence?: { unit?: string; interval?: number } | null;
  /** HÉRITAGE : l'UNITÉ seule, sous son ancien nom. */
  interval?: string;
}

export interface SubscriptionCost {
  /** Y a-t-il un abonnement à présenter ? */
  applicable: boolean;
  /** « tous les N mois/ans » — la périodicité complète. */
  recurrence: Recurrence;
  /** L'étiquette française : « Tous les 3 mois ». */
  recurrenceLabel: string;
  /** L'UNITÉ seule. Conservée pour les appelants non encore relus. */
  interval: BillingInterval;
  currency: string;
  /** Ce que Stripe débite, à la fréquence de l'abonnement. */
  perCharge: { excludingTax: number; tax: number; includingTax: number };
  /** Repère de comparaison — JAMAIS un montant débité. */
  monthlyEquivalent: { excludingTax: number; includingTax: number };
  /** Ce que l'abonnement coûte sur douze mois. */
  yearly: { excludingTax: number; includingTax: number };
  /** L'échéance couvre-t-elle plusieurs mois d'un coup ? */
  paidUpfront: boolean;
  /** Le nombre de mois couverts par une échéance — base des repères. */
  monthsPerCycle: number;
}

/**
 * LA RÉCURRENCE D'UNE LIGNE — même priorité de lecture que le serveur.
 *
 * Le serveur résout déjà `recurrence` avant de sérialiser : dans le parcours
 * normal, cette fonction ne fait que la relire. Le repli sur `interval` hérité
 * couvre la seule fenêtre où les deux peuvent diverger — un Manager rechargé
 * avant son backend. Sans lui, un contrat annuel s'afficherait mensuel pendant
 * cette fenêtre, et c'est le montant du client qui serait mal dit.
 */
export function recurrenceOf(line: SubscriptionLine | null | undefined): Recurrence {
  const unit = String(line?.recurrence?.unit ?? '').toUpperCase();
  const interval = Number(line?.recurrence?.interval);
  if ((unit === 'MONTH' || unit === 'YEAR') && Number.isInteger(interval) && interval >= 1) {
    return { unit, interval };
  }

  const herite = String(line?.interval ?? '').toUpperCase();
  if (herite === 'MONTH' || herite === 'YEAR') return { unit: herite, interval: 1 };

  return { ...DEFAULT_RECURRENCE };
}

/**
 * L'ÉTIQUETTE FRANÇAISE — miroir de `describeRecurrence` côté serveur.
 *
 *     1 MONTH → « Tous les mois »   (et non « tous les 1 mois »)
 *     3 MONTH → « Tous les 3 mois »
 *     1 YEAR  → « Tous les ans »
 *     3 YEAR  → « Tous les 3 ans »
 */
export function describeRecurrence({ unit, interval }: Recurrence): string {
  const annee = unit === 'YEAR';
  if (interval === 1) return annee ? 'Tous les ans' : 'Tous les mois';
  return annee ? `Tous les ${interval} ans` : `Tous les ${interval} mois`;
}

/** Le nombre de mois couverts par une échéance. Repères uniquement. */
export function monthsPerCycle({ unit, interval }: Recurrence): number {
  return unit === 'YEAR' ? interval * 12 : interval;
}

/** Arrondi au centime le plus proche, sur des entiers uniquement. */
function centimes(valeur: unknown): number {
  const n = Number(valeur);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/**
 * L'équivalent mensuel d'une échéance.
 *
 * Miroir exact de `monthlyEquivalentCents` côté serveur : une divergence entre
 * les deux ferait afficher au client un repère que la facturation contredit.
 *
 * « 900 € tous les 3 mois » vaut 300 €/mois EN REPÈRE. Ce que le client paie
 * reste 900 €, trois fois moins souvent — et ce repère n'est jamais remultiplié
 * pour reconstituer l'échéance : l'arrondi y perdrait des centimes.
 */
export function monthlyEquivalent(amountCents: number, recurrence: Recurrence): number {
  const cents = centimes(amountCents);
  const mois = monthsPerCycle(recurrence);
  return mois > 1 ? Math.round(cents / mois) : cents;
}

export function deriveSubscriptionCost(line: SubscriptionLine | null | undefined): SubscriptionCost {
  const recurrence = recurrenceOf(line);
  const mois = monthsPerCycle(recurrence);
  const ht = centimes(line?.amountExcludingTax);
  const tva = centimes(line?.taxAmount);
  // Le TTC publié fait foi quand il existe : il vient du même calcul que la
  // facture. On ne le recompose que s'il manque.
  const ttc = centimes(line?.amountIncludingTax) || ht + tva;

  return {
    // Un abonnement désactivé, ou à zéro, n'a rien à présenter : un contrat
    // gratuit est légitime, et afficher « 0 € / mois » ferait chercher une
    // ligne de facturation qui n'existera jamais.
    applicable: Boolean(line?.enabled) && ttc > 0,
    recurrence,
    recurrenceLabel: describeRecurrence(recurrence),
    interval: recurrence.unit,
    currency: (line?.currency || 'EUR').toUpperCase(),
    perCharge: { excludingTax: ht, tax: tva, includingTax: ttc },
    monthlyEquivalent: {
      excludingTax: monthlyEquivalent(ht, recurrence),
      includingTax: monthlyEquivalent(ttc, recurrence),
    },
    /**
     * LE COÛT SUR DOUZE MOIS — un repère de comparaison, lui aussi.
     *
     * Il valait « l'échéance » en annuel et « douze fois l'échéance » en
     * mensuel : deux branches pour deux offres. La règle générale est plus
     * simple, et vraie pour toutes : douze mois valent `12 / mois-par-cycle`
     * échéances. Un trimestriel en compte quatre, un triennal un tiers.
     *
     * L'arrondi porte sur le montant, jamais sur le nombre d'échéances — et on
     * ne repasse jamais par l'équivalent mensuel, qui a déjà arrondi une fois.
     */
    yearly: mois === 12
      ? { excludingTax: ht, includingTax: ttc }
      : { excludingTax: Math.round((ht * 12) / mois), includingTax: Math.round((ttc * 12) / mois) },
    paidUpfront: mois > 1,
    monthsPerCycle: mois,
  };
}

export default deriveSubscriptionCost;
