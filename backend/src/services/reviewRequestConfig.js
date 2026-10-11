/**
 * CONFIGURATION DE LA DEMANDE D'AVIS d'une fiche (prestation ou formation).
 *
 *   { enabled, delay: { value, unit }, reminders: [{ value, unit }, …] }
 *
 * `delay` court à partir de la fin de la prestation, de la fin de la session
 * présentielle, ou de la validation manuelle d'une formation à distance.
 * Chaque relance court à partir de l'envoi PRÉCÉDENT.
 *
 * Module pur (aucune base) : le Manager, le service d'envoi et les tests
 * lisent la même règle.
 */
export const REVIEW_UNITS = Object.freeze({ HOURS: 60, DAYS: 1440, WEEKS: 10080, MONTHS: 43200 });

/** Réglage d'usine : 2 h après, relance à 48 h, puis à 1 semaine. */
export const DEFAULT_REVIEW_REQUEST = Object.freeze({
  enabled: true,
  delay: { value: 2, unit: 'HOURS' },
  reminders: [{ value: 48, unit: 'HOURS' }, { value: 1, unit: 'WEEKS' }],
});

const MAX_REMINDERS = 10;

function normalizeStep(step, fallback = null) {
  const unit = Object.prototype.hasOwnProperty.call(REVIEW_UNITS, step?.unit) ? step.unit : null;
  const value = Math.round(Number(step?.value));
  if (!unit || !Number.isFinite(value) || value < 1) return fallback;
  // Une borne large mais finie : 365 jours au plus pour un même délai.
  const capped = Math.min(value, Math.floor((365 * 1440) / REVIEW_UNITS[unit]));
  return { value: capped, unit };
}

export function normalizeReviewRequestConfig(raw) {
  if (raw === null || raw === undefined) return null;
  const delay = normalizeStep(raw.delay, { ...DEFAULT_REVIEW_REQUEST.delay });
  const reminders = (Array.isArray(raw.reminders) ? raw.reminders : [])
    .map((r) => normalizeStep(r))
    .filter(Boolean)
    .slice(0, MAX_REMINDERS);
  return { enabled: raw.enabled !== false, delay, reminders };
}

/** La configuration effective : celle de la fiche, sinon le réglage d'usine. */
export function effectiveReviewRequestConfig(product) {
  return normalizeReviewRequestConfig(product?.reviewRequest) || {
    ...DEFAULT_REVIEW_REQUEST,
    delay: { ...DEFAULT_REVIEW_REQUEST.delay },
    reminders: DEFAULT_REVIEW_REQUEST.reminders.map((r) => ({ ...r })),
  };
}

export function stepMs(step) {
  return Number(step.value) * REVIEW_UNITS[step.unit] * 60_000;
}
