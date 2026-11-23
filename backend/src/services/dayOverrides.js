/**
 * UNE JOURNÉE QUI SORT DE L'ORDINAIRE — ouverte un jour habituellement fermé
 * (« je prends exceptionnellement des clientes ce samedi »), ou fermée un jour
 * habituellement ouvert (congé, formation, rendez-vous personnel).
 *
 * Rangée dans `BookingSchedule.exceptions` : `{ date: 'AAAA-MM-JJ', closed,
 * ranges, reason }`. Une exception REMPLACE la règle de la semaine type pour
 * ce jour-là, et pour lui seul :
 *   · `closed: true`            aucun créneau en ligne ce jour ;
 *   · `closed: false` + plages  ces plages-là, quelles que soient les horaires
 *                               classiques du jour de la semaine.
 *
 * Le planning de l'institut n'en dépend pas : un rendez-vous saisi au Manager
 * peut toujours tomber un jour fermé. Seule la réservation EN LIGNE suit ces
 * règles.
 *
 * Module pur (aucune base) : le service des créneaux, les routes et les tests
 * lisent la même règle.
 */
import { ApiError } from '../utils/ApiError.js';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HEURE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_PLAGES = 4;

export const isoDay = (year, month, day) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const minutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** L'exception posée sur ce jour du calendrier, ou null. */
export function exceptionDuJour(schedule, year, month, day) {
  const key = isoDay(year, month, day);
  return (schedule?.exceptions || []).find((e) => e?.date === key) || null;
}

/**
 * La règle qui vaut pour ce jour : l'exception si elle existe, sinon la règle
 * de la semaine type (`weeklyRule`, déjà choisie selon l'alternance).
 */
export function regleEffective(schedule, year, month, day, weeklyRule) {
  const exception = exceptionDuJour(schedule, year, month, day);
  if (!exception) return weeklyRule || null;
  if (exception.closed) return { weekday: weeklyRule?.weekday, enabled: false, ranges: [] };
  return { weekday: weeklyRule?.weekday, enabled: true, ranges: (exception.ranges || []).map((r) => ({ start: r.start, end: r.end })) };
}

/** Vérifie et nettoie une exception envoyée par le Manager. */
export function normaliserException(date, payload = {}) {
  const m = DATE.exec(String(date || '').trim());
  if (!m) throw ApiError.badRequest('Date de la journée illisible (attendu AAAA-MM-JJ).');
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== m[0]) throw ApiError.badRequest('Cette date n’existe pas.');
  const closed = payload.closed === true;
  const reason = String(payload.reason || '').trim().slice(0, 120);
  if (closed) return { date: m[0], closed: true, ranges: [], reason };

  const ranges = (Array.isArray(payload.ranges) ? payload.ranges : [])
    .map((r) => ({ start: String(r?.start || '').trim(), end: String(r?.end || '').trim() }))
    .filter((r) => r.start || r.end);
  if (!ranges.length) throw ApiError.badRequest('Indiquez au moins une plage horaire pour ouvrir cette journée.');
  if (ranges.length > MAX_PLAGES) throw ApiError.badRequest(`${MAX_PLAGES} plages au plus dans une journée.`);
  for (const r of ranges) {
    if (!HEURE.test(r.start) || !HEURE.test(r.end)) throw ApiError.badRequest('Heures attendues au format HH:MM.');
    if (minutes(r.end) <= minutes(r.start)) throw ApiError.badRequest(`La plage ${r.start} – ${r.end} finit avant de commencer.`);
  }
  ranges.sort((a, b) => minutes(a.start) - minutes(b.start));
  for (let i = 1; i < ranges.length; i += 1) {
    if (minutes(ranges[i].start) < minutes(ranges[i - 1].end)) throw ApiError.badRequest('Deux plages de la journée se chevauchent.');
  }
  return { date: m[0], closed: false, ranges, reason };
}
