// RX4 — Helpers purs de l'espace client (testables sans réseau). Aucun calcul métier : uniquement de
// l'affichage et de la sélection. Le serveur fait foi sur les montants et statuts.
import type { ClientBooking, ClientGiftCard } from '@bs/api-client';

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const DATE_SHORT_FMT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const TIME_FMT = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

function toDate(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date longue « mercredi 15 janvier 2026 ». '' si absente/invalide. */
export function formatLongDate(iso?: string | null): string {
  const d = toDate(iso);
  return d ? DATE_FMT.format(d) : '';
}

/** Date courte « 15 janvier 2026 ». '' si absente/invalide. */
export function formatShortDate(iso?: string | null): string {
  const d = toDate(iso);
  return d ? DATE_SHORT_FMT.format(d) : '';
}

/** Heure « 14:30 ». '' si absente/invalide. */
export function formatTime(iso?: string | null): string {
  const d = toDate(iso);
  return d ? TIME_FMT.format(d) : '';
}

/** Plage horaire « 14:30 → 15:30 ». '' si départ absent. */
export function formatTimeRange(startIso?: string | null, endIso?: string | null): string {
  const start = formatTime(startIso);
  if (!start) return '';
  const end = formatTime(endIso);
  return end ? `${start} → ${end}` : start;
}

/** true si la date est dans le futur (strict). */
export function isFuture(iso?: string | null, now: number = Date.now()): boolean {
  const d = toDate(iso);
  return d ? d.getTime() > now : false;
}

const CANCELLED_STATUSES = new Set(['cancelled', 'canceled', 'refunded', 'annulee', 'annulée']);

/** Une réservation est « active à venir » si non annulée et à venir. */
export function isUpcomingBooking(b: ClientBooking, now: number = Date.now()): boolean {
  if (CANCELLED_STATUSES.has(String(b.status || '').toLowerCase())) return false;
  return isFuture(b.startAt, now);
}

/**
 * Prochain rendez-vous : la réservation à venir la plus proche (non annulée). null si aucune.
 * Le backend trie par date décroissante ; on sélectionne donc le minimum des dates futures.
 */
export function pickNextBooking(bookings: ClientBooking[], now: number = Date.now()): ClientBooking | null {
  const upcoming = bookings
    .filter((b) => isUpcomingBooking(b, now))
    .sort((a, b) => (toDate(a.startAt)?.getTime() ?? 0) - (toDate(b.startAt)?.getTime() ?? 0));
  return upcoming[0] ?? null;
}

/** Reste à payer d'une réservation (total − acompte), borné à 0. Purement indicatif (serveur = autorité). */
export function bookingBalanceDue(b: ClientBooking): number {
  const total = Number(b.totalPrice || 0);
  const deposit = Number(b.depositAmount || 0);
  const due = Math.round((total - deposit) * 100) / 100;
  return due > 0 ? due : 0;
}

const BOOKING_STATUS_LABELS: Record<string, string> = {
  confirmed: 'Confirmé',
  pending: 'En attente',
  completed: 'Terminé',
  cancelled: 'Annulé',
  canceled: 'Annulé',
  refunded: 'Remboursé',
};

export function bookingStatusLabel(status: string): string {
  return BOOKING_STATUS_LABELS[String(status || '').toLowerCase()] || 'Réservation';
}

/** Ton de badge pour un statut de réservation. */
export function bookingStatusTone(status: string, startIso?: string | null): 'success' | 'muted' | 'danger' | 'info' {
  const s = String(status || '').toLowerCase();
  if (CANCELLED_STATUSES.has(s)) return 'danger';
  if (s === 'completed') return 'muted';
  if (isFuture(startIso)) return 'success';
  return 'info';
}

/** Durée d'une réservation en minutes (endAt − startAt), 0 si indéterminable. */
export function bookingDurationMinutes(startIso?: string | null, endIso?: string | null): number {
  const start = toDate(startIso);
  const end = toDate(endIso);
  if (!start || !end) return 0;
  const mins = Math.round((end.getTime() - start.getTime()) / 60000);
  return mins > 0 ? mins : 0;
}

/** Libellé lisible d'un motif d'éligibilité au remboursement (serveur = autorité sur la valeur). */
export function refundReasonLabel(reason: string, eligible: boolean): string {
  if (reason === 'retractation') return 'Droit de rétractation légal (14 jours)';
  if (reason === 'institut') return "Dans le délai d'annulation de l'institut";
  return eligible ? 'Remboursable' : "Non remboursable (délai dépassé ou renonciation signée)";
}

/** Masque un code de carte cadeau : ne révèle que les 4 derniers caractères (« •••• 1A2B »). */
export function maskGiftCardCode(code?: string | null): string {
  const raw = String(code || '').replace(/\s+/g, '');
  if (!raw) return '';
  const last4 = raw.slice(-4);
  return `•••• ${last4}`;
}

/** Somme des soldes disponibles des cartes actives. */
export function totalGiftCardBalance(cards: ClientGiftCard[]): number {
  const total = cards
    .filter((c) => String(c.status || '').toLowerCase() === 'active')
    .reduce((sum, c) => sum + Number(c.availableBalance || 0), 0);
  return Math.round(total * 100) / 100;
}

/**
 * Prénom d'accueil. `/auth/me` n'expose pas le prénom (audit §0.1) : on préfère le prénom édité en session,
 * sinon on déduit un libellé lisible depuis la partie locale de l'e-mail. Renvoie '' si rien d'exploitable.
 */
export function greetingName(firstName?: string | null, email?: string | null): string {
  const fn = String(firstName || '').trim();
  if (fn) return fn;
  const local = String(email || '').split('@')[0] || '';
  const cleaned = local.replace(/[._-]+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
