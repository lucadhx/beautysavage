import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(value: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

/**
 * Une durée est-elle renseignée ?
 *
 * Elle est FACULTATIVE côté manager : `null` / `undefined` / `0` signifient
 * « non renseignée » et ne doivent RIEN afficher. Les documents créés avant
 * l'ajout du champ n'ont pas la clé du tout, d'où le test permissif.
 *
 * Dupliqué depuis `manager/src/lib/duration.ts`, comme `formatPrice` : les deux
 * applications ne partagent pas de paquet.
 */
export function hasDuration(minutes?: number | null): boolean {
  return typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0;
}

/**
 * Rend une durée lisible : « 45 min », « 1h », « 2h30 ».
 * Rend `''` si elle n'est pas renseignée — l'appelant n'affiche rien.
 */
export function formatDuration(minutes?: number | null): string {
  if (!hasDuration(minutes)) return '';
  const total = Math.round(minutes as number);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

/** Build a usable href for a media item depending on its kind. */
export function mediaHref(kind: string, value: string): string {
  const v = value.trim();
  switch (kind) {
    case 'tel':
      return `tel:${v.replace(/\s/g, '')}`;
    case 'email':
      return `mailto:${v}`;
    case 'url':
      return v.startsWith('http') ? v : `https://${v}`;
    case 'handle':
      return v.startsWith('http') ? v : `#`;
    default:
      return '#';
  }
}

/** WhatsApp deep link from a phone number. */
export function whatsappHref(value: string): string {
  return `https://wa.me/${value.replace(/[^0-9]/g, '')}`;
}
