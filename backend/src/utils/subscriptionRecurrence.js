/**
 * LA RÉCURRENCE D'UN ABONNEMENT — « tous les N mois », « tous les N ans ».
 *
 * ══ POURQUOI CE MODULE EXISTE ═══════════════════════════════════════════════
 *
 * La périodicité d'un contrat était une CHAÎNE : `MONTH` ou `YEAR`. Deux
 * valeurs, donc deux offres possibles — et tout le reste du code s'était
 * organisé autour de ce binaire : un ternaire pour l'étiquette, une division
 * par douze pour l'équivalent mensuel, un `=== 'YEAR'` pour décider si le
 * montant était prélevé d'un coup. Vendre « 900 € tous les trois mois » ne
 * demandait pas un champ de plus : cela demandait que la périodicité cesse
 * d'être un choix entre deux mots.
 *
 * Elle se dit désormais en deux dimensions, et le module est la SEULE porte
 * d'entrée vers elles :
 *
 *     recurrence.unit     MONTH | YEAR
 *     recurrence.interval entier >= 1
 *
 * ══ LA PRIORITÉ DE LECTURE, ET POURQUOI ELLE EST ÉCRITE ICI ═════════════════
 *
 * Pendant la transition, un contrat peut porter les deux formes. `recurrenceOf`
 * tranche une fois pour toutes, et rien d'autre dans le code n'a le droit de
 * lire `pricing.subscription.interval` :
 *
 *     1. `recurrence` complet et valide          → il fait foi
 *     2. sinon, `interval` hérité (MONTH|YEAR)   → lu comme « tous les 1 <unité> »
 *     3. sinon                                   → tous les 1 mois
 *
 * Deux lectures concurrentes d'une même donnée financière finissent toujours
 * par diverger ; une seule fonction, elle, ne peut pas se contredire.
 *
 * ══ CE MODULE EST PUR ═══════════════════════════════════════════════════════
 *
 * Ni Mongo, ni Express, ni horloge. Il se teste directement sous Node, et c'est
 * volontaire : la récurrence décide de ce qu'un client paiera pendant des
 * années, elle mérite d'être éprouvée sans base de données.
 */
import ApiError from './ApiError.js';
import {
  SUBSCRIPTION_RECURRENCE_UNITS,
  SUBSCRIPTION_RECURRENCE_UNIT_VALUES,
  MAX_SUBSCRIPTION_INTERVAL_BY_UNIT,
  DEFAULT_SUBSCRIPTION_RECURRENCE,
} from './contractConstants.js';

/** Le plafond applicable à une unité — voir `MAX_SUBSCRIPTION_INTERVAL_BY_UNIT`. */
export function maxIntervalFor(unit) {
  return MAX_SUBSCRIPTION_INTERVAL_BY_UNIT[unit] ?? 1;
}

/**
 * VALIDE ET NORMALISE UNE RÉCURRENCE SAISIE.
 *
 * Refuse explicitement — et c'est le cœur du contrôle serveur :
 *   · `interval` à 0, négatif, décimal, textuel ou absent ;
 *   · `unit` inconnue (`WEEK`, `DAY`, n'importe quoi d'autre) ;
 *   · `interval` au-delà de ce que le fournisseur sait facturer.
 *
 * Ne fait JAMAIS confiance au formulaire : c'est ici que la règle vit, pas dans
 * le Manager.
 *
 * @param {{unit?:string, interval?:number}} input
 * @returns {{unit:string, interval:number}}
 */
export function normalizeSubscriptionRecurrence(input) {
  const unit = String(input?.unit ?? '').trim().toUpperCase();
  if (!SUBSCRIPTION_RECURRENCE_UNIT_VALUES.includes(unit)) {
    throw ApiError.badRequest(
      `Unité de récurrence inconnue : ${input?.unit}. Attendu : ${SUBSCRIPTION_RECURRENCE_UNIT_VALUES.join(' ou ')}.`,
      { code: 'SUBSCRIPTION_RECURRENCE_UNIT_UNKNOWN' }
    );
  }

  /**
   * `Number('')` vaut 0 et `Number(null)` vaut 0 : passer par `Number` seul
   * ferait accepter une saisie vide comme « tous les 0 mois ». On exige donc
   * un nombre AVANT de le convertir, et un ENTIER après.
   */
  const brut = input?.interval;
  const n = typeof brut === 'number' ? brut : Number(String(brut ?? '').trim());
  const plafond = maxIntervalFor(unit);
  if (!Number.isInteger(n) || n < 1 || n > plafond) {
    throw ApiError.badRequest(
      `L'intervalle de récurrence doit être un entier entre 1 et ${plafond} pour l'unité ${unit}.`,
      { code: 'SUBSCRIPTION_RECURRENCE_INTERVAL_INVALID' }
    );
  }

  return { unit, interval: n };
}

/**
 * LA RÉCURRENCE EFFECTIVE D'UNE LIGNE D'ABONNEMENT — la seule lecture licite.
 *
 * Tolérante par construction : elle ne lève jamais. Un contrat déjà enregistré
 * ne doit pas devenir illisible parce que sa périodicité est ancienne, absente
 * ou aberrante — l'écran qui l'affiche n'est pas le bon endroit pour découvrir
 * une donnée douteuse. La validation stricte, elle, se fait à l'ÉCRITURE.
 *
 * @param {object|null|undefined} line `contract.pricing.subscription`
 * @returns {{unit:string, interval:number}}
 */
export function recurrenceOf(line) {
  const r = line?.recurrence;
  const unit = String(r?.unit ?? '').trim().toUpperCase();
  const interval = Number(r?.interval);
  if (
    SUBSCRIPTION_RECURRENCE_UNIT_VALUES.includes(unit)
    && Number.isInteger(interval)
    && interval >= 1
  ) {
    return { unit, interval };
  }

  // Héritage : `interval` (chaîne) portait l'UNITÉ, et l'intervalle valait 1.
  const herite = String(line?.interval ?? '').trim().toUpperCase();
  if (SUBSCRIPTION_RECURRENCE_UNIT_VALUES.includes(herite)) {
    return { unit: herite, interval: 1 };
  }

  return { ...DEFAULT_SUBSCRIPTION_RECURRENCE };
}

/**
 * LE NOMBRE DE MOIS COUVERTS PAR UNE ÉCHÉANCE.
 *
 * Sert UNIQUEMENT aux repères de comparaison (l'équivalent mensuel). Jamais à
 * calculer une date : un mois n'est pas trente jours, et l'échéancier réel est
 * tenu par Stripe.
 */
export function monthsPerCycle(recurrence) {
  const { unit, interval } = recurrence?.unit ? recurrence : DEFAULT_SUBSCRIPTION_RECURRENCE;
  return unit === SUBSCRIPTION_RECURRENCE_UNITS.YEAR ? interval * 12 : interval;
}

/**
 * L'ÉCHÉANCE COUVRE-T-ELLE PLUS D'UN MOIS ?
 *
 * Remplace le `interval === 'YEAR'` qui traînait partout : ce qui distingue une
 * offre payée d'avance n'a jamais été l'unité « année », c'est le fait qu'une
 * seule facture couvre plusieurs mois. « Tous les 3 mois » est payé d'avance
 * exactement au même titre qu'un annuel.
 */
export function isPaidUpfront(recurrence) {
  return monthsPerCycle(recurrence) > 1;
}

/**
 * LA RÉCURRENCE, TELLE QUE STRIPE L'ATTEND.
 *
 * `MONTH + 3` → `{ interval: 'month', interval_count: 3 }`
 * `YEAR  + 2` → `{ interval: 'year',  interval_count: 2 }`
 *
 * Aucun plan prédéfini, aucune table de correspondance à deux entrées : la
 * traduction est mécanique, et c'est précisément ce qui permet de vendre
 * n'importe quelle périodicité sans toucher au transport.
 */
export function toStripeRecurring(recurrence) {
  const { unit, interval } = recurrence?.unit ? recurrence : DEFAULT_SUBSCRIPTION_RECURRENCE;
  return {
    interval: unit === SUBSCRIPTION_RECURRENCE_UNITS.YEAR ? 'year' : 'month',
    interval_count: interval,
  };
}

/**
 * L'ÉTIQUETTE FRANÇAISE D'UNE RÉCURRENCE — « Tous les 3 mois », « Tous les ans ».
 *
 * ══ POURQUOI LE SERVEUR SAIT LA DIRE ════════════════════════════════════════
 *
 * Parce que trois écrans la disent déjà (Manager DEV, Manager client, Panel) et
 * qu'une grammaire recopiée trois fois se contredit à la première correction.
 * Le libellé voyage donc avec la donnée, sans jamais la remplacer : la
 * structure reste la source de vérité, le texte n'en est que la lecture.
 *
 * ══ LA GRAMMAIRE ═══════════════════════════════════════════════════════════
 *
 *     1 MONTH → « Tous les mois »        (et non « tous les 1 mois »)
 *     3 MONTH → « Tous les 3 mois »
 *     1 YEAR  → « Tous les ans »
 *     3 YEAR  → « Tous les 3 ans »
 */
export function describeRecurrence(recurrence) {
  const { unit, interval } = recurrence?.unit ? recurrence : DEFAULT_SUBSCRIPTION_RECURRENCE;
  const annee = unit === SUBSCRIPTION_RECURRENCE_UNITS.YEAR;
  if (interval === 1) return annee ? 'Tous les ans' : 'Tous les mois';
  return annee ? `Tous les ${interval} ans` : `Tous les ${interval} mois`;
}

export default {
  maxIntervalFor,
  normalizeSubscriptionRecurrence,
  recurrenceOf,
  monthsPerCycle,
  isPaidUpfront,
  toStripeRecurring,
  describeRecurrence,
};
