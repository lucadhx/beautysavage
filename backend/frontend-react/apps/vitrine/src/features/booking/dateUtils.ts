// Utilitaires calendrier (sans dépendance externe). Dates au format "YYYY-MM-DD" / "YYYY-MM-DDTHH:mm".

export const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
export const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function dateStr(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Matrice de semaines (lundi en tête) pour un mois donné (month 1-12). Cellules vides = null. */
export function monthMatrix(year: number, month: number): Array<Array<string | null>> {
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7; // Lun=0
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: Array<string | null> = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(dateStr(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<string | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** "2026-07-01T14:00" → "14:00". */
export function formatSlotTime(iso: string): string {
  return typeof iso === 'string' && iso.length >= 16 ? iso.slice(11, 16) : iso;
}

/** "2026-07-01" → "01/07/2026". */
export function formatDayLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : day;
}

/** "2026-07-01T14:00" → "01/07/2026 à 14:00". */
export function formatSlotLabel(iso: string): string {
  if (typeof iso !== 'string' || iso.length < 16) return iso;
  return `${formatDayLabel(iso.slice(0, 10))} à ${formatSlotTime(iso)}`;
}
