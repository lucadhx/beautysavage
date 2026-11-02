/**
 * L'HEURE DE L'INSTITUT — toute date de rendez-vous s'affiche à l'heure de
 * Paris, jamais à celle du téléphone.
 *
 * Un rendez-vous a lieu à Nice : la grille affichait l'heure du TÉLÉPHONE, le
 * serveur et les e-mails celle de Paris. Une cliente dont le téléphone n'était
 * pas à l'heure française touchait « 10:00 » et réservait 11 h à l'institut.
 * Ni formater une date sans `timeZone`, ni lire `getHours()` / `getDate()` sur
 * un instant de rendez-vous : passer par ce module.
 */
export const INSTITUTE_TIME_ZONE = 'Europe/Paris';

/** Un formateur fr-FR à l'heure de l'institut (à garder en constante : ils coûtent cher). */
export function instituteFormat(options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: INSTITUTE_TIME_ZONE });
}

const hourFmt = instituteFormat({ hour: '2-digit', minute: '2-digit' });

/** « 10:00 », à l'heure de l'institut. */
export const instituteTime = (value: string | Date) => hourFmt.format(new Date(value));

const partsFmt = new Intl.DateTimeFormat('en-CA', { timeZone: INSTITUTE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Le jour du calendrier de l'institut pour cet instant : { year, month (1-12), day }. */
export function instituteDay(value: string | Date = new Date()) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(value)).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day) };
}

/** « 2026-11-13 » : la clé du jour à l'institut, quel que soit le réglage du téléphone. */
export function instituteDayKey(value: string | Date) {
  const d = instituteDay(value);
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

/** Le téléphone n'est-il pas à l'heure de l'institut en ce moment ? (pour le dire à la cliente) */
export function deviceOutsideInstituteTime(now = new Date()) {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(now) !== hourFmt.format(now);
}
