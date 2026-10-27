/**
 * CONFIGURATION DES RAPPELS AVANT RENDEZ-VOUS d'une fiche prestation.
 *
 *   { enabled, reminders: [{ value, unit }, …] }
 *
 * Chaque rappel est un délai AVANT le début du rendez-vous : « 1 jour avant »,
 * « 2 heures avant ». Même vocabulaire d'unités que la demande d'avis, pour
 * que l'institut retrouve le même geste dans le même onglet.
 *
 * Module pur (aucune base) : le Manager, le service d'envoi et les tests
 * lisent la même règle.
 */
import { REVIEW_UNITS } from './reviewRequestConfig.js';

/** Les unités utiles avant un rendez-vous : pas de « mois avant ». */
export const REMINDER_UNITS = Object.freeze({ HOURS: REVIEW_UNITS.HOURS, DAYS: REVIEW_UNITS.DAYS, WEEKS: REVIEW_UNITS.WEEKS });

/** Réglage d'usine : un rappel la veille (24 h avant). */
export const DEFAULT_APPOINTMENT_REMINDER = Object.freeze({
  enabled: true,
  reminders: [{ value: 24, unit: 'HOURS' }],
});

const MAX_REMINDERS = 5;
/** Au plus 30 jours avant : au-delà, un rappel n'a plus rien d'un rappel. */
const MAX_OFFSET_MINUTES = 30 * 1440;

function normalizeStep(step) {
  const unit = Object.prototype.hasOwnProperty.call(REMINDER_UNITS, step?.unit) ? step.unit : null;
  const value = Math.round(Number(step?.value));
  if (!unit || !Number.isFinite(value) || value < 1) return null;
  return { value: Math.min(value, Math.floor(MAX_OFFSET_MINUTES / REMINDER_UNITS[unit])), unit };
}

export function normalizeAppointmentReminderConfig(raw) {
  if (raw === null || raw === undefined) return null;
  const seen = new Set();
  const reminders = (Array.isArray(raw.reminders) ? raw.reminders : [])
    .map(normalizeStep)
    .filter(Boolean)
    // Deux rappels au même instant n'en font qu'un.
    .filter((r) => { const m = offsetMinutes(r); if (seen.has(m)) return false; seen.add(m); return true; })
    .sort((a, b) => offsetMinutes(b) - offsetMinutes(a))
    .slice(0, MAX_REMINDERS);
  return { enabled: raw.enabled !== false, reminders };
}

/** La configuration effective : celle de la fiche, sinon le réglage d'usine. */
export function effectiveAppointmentReminderConfig(product) {
  return normalizeAppointmentReminderConfig(product?.appointmentReminder) || {
    enabled: DEFAULT_APPOINTMENT_REMINDER.enabled,
    reminders: DEFAULT_APPOINTMENT_REMINDER.reminders.map((r) => ({ ...r })),
  };
}

export function offsetMinutes(step) {
  return Number(step.value) * REMINDER_UNITS[step.unit];
}

/** « demain », « dans 2 heures », « dans 3 jours » — pour l'objet de l'e-mail. */
export function whenLabel(startsAt, now = new Date()) {
  const minutes = Math.max(0, Math.round((new Date(startsAt).getTime() - now.getTime()) / 60_000));
  if (minutes < 90) return 'dans moins de 2 heures';
  if (minutes < 24 * 60) {
    const sameDay = new Date(startsAt).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }) === now.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
    return sameDay ? 'aujourd’hui' : 'demain';
  }
  const days = Math.round(minutes / 1440);
  return days <= 1 ? 'demain' : `dans ${days} jours`;
}
