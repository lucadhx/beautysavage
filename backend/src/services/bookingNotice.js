import { ApiError } from '../utils/ApiError.js';

/**
 * LE DÉLAI MINIMUM DE RÉSERVATION — « Réservation avant le rendez-vous » sur la
 * fiche prestation (`bookingRules.minBookingHours`).
 *
 * Le champ existait au Manager et aucune ligne du serveur ne le lisait : réglé
 * à 3 h, il laissait réserver à 1 h 30 du rendez-vous. La règle vit ici, et
 * s'applique aux seuls parcours CLIENTS :
 *   · les horaires proposés (route publique des disponibilités) ;
 *   · l'ajout au panier, l'achat rapide, le changement d'heure, l'enchaînement ;
 *   · le paiement — un créneau mis au panier hier peut être trop proche
 *     aujourd'hui.
 *
 * L'institut, lui, place ce qu'il veut depuis son planning : un rendez-vous de
 * dernière minute y reste possible.
 *
 * Module pur (aucune base) : les parcours et les tests lisent la même règle.
 */

/** Fiche sans valeur : la même que celle affichée par l'écran du Manager. */
export const DEFAULT_MIN_BOOKING_HOURS = 24;

/** Le délai de cette prestation, en heures. 0 = réservable jusqu'à la dernière minute. */
export function minBookingHours(product) {
  const raw = product?.bookingRules?.minBookingHours;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_MIN_BOOKING_HOURS;
  const hours = Number(raw);
  return Number.isFinite(hours) && hours >= 0 ? hours : DEFAULT_MIN_BOOKING_HOURS;
}

/** Le premier instant réservable en ligne pour cette prestation. */
export function bookableFrom(product, now = new Date()) {
  return new Date(now.getTime() + minBookingHours(product) * 3_600_000);
}

/**
 * Plusieurs prestations à la suite : chacune respecte SON délai à SA propre
 * heure de début. Rendu : le premier départ possible pour tout l'enchaînement.
 */
export function sequenceBookableFrom(sequence, now = new Date()) {
  let offsetMs = 0;
  let earliest = now.getTime();
  for (const item of sequence) {
    earliest = Math.max(earliest, bookableFrom(item.product, now).getTime() - offsetMs);
    offsetMs += Number(item.durationMinutes || 0) * 60_000;
  }
  return new Date(earliest);
}

const hoursLabel = (hours) => (hours === 1 ? '1 heure' : `${String(hours).replace('.', ',')} heures`);

/** Refuse un horaire passé, ou trop proche pour cette prestation (`BOOKING_TOO_LATE`). */
export function assertBookingNotice(product, startsAt, now = new Date(), extra = {}) {
  const start = new Date(startsAt);
  const hours = minBookingHours(product);
  if (start.getTime() <= now.getTime()) {
    throw ApiError.conflict('Cet horaire est déjà passé. Choisissez-en un autre.', { code: 'BOOKING_TOO_LATE', minBookingHours: hours, ...extra });
  }
  if (start.getTime() < bookableFrom(product, now).getTime()) {
    throw ApiError.conflict(
      `« ${product?.title || 'Cette prestation'} » se réserve en ligne au moins ${hoursLabel(hours)} à l’avance : cet horaire est trop proche. Choisissez-en un plus tard, ou contactez l’institut.`,
      { code: 'BOOKING_TOO_LATE', minBookingHours: hours, ...extra },
    );
  }
}
