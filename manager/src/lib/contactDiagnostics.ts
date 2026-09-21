/**
 * Diagnostics DEV des soumissions de contact (module PUR).
 *
 * Projette la décision prise pour chaque tentative (ACCEPTED / DUPLICATE /
 * REJECTED_AS_SPAM) afin que la recette VOIE ce que la réponse neutre cache au
 * visiteur. Aucune donnée sensible : e-mail masqué, jamais le message.
 */

import type { ContactDecision, ContactDiagnosticEntry } from '@/types';
export type { ContactDecision, ContactDiagnosticEntry };

export const DECISION_META: Record<ContactDecision, { label: string; cls: string }> = {
  ACCEPTED: { label: 'Acceptée', cls: 'bg-emerald-100 text-emerald-700' },
  DUPLICATE: { label: 'Doublon (idempotent)', cls: 'bg-slate-100 text-slate-600' },
  REJECTED_AS_SPAM: { label: 'Rejetée (anti-abus)', cls: 'bg-red-100 text-red-700' },
};

export function decisionMeta(decision: ContactDecision) {
  return DECISION_META[decision] ?? { label: decision, cls: 'bg-slate-100 text-slate-600' };
}

/** Motif d'un rejet anti-abus, en clair. */
export const ABUSE_REASON_LABEL: Record<string, string> = {
  HONEYPOT: 'Champ piège rempli (souvent l’autofill du navigateur)',
  TOO_FAST: 'Formulaire soumis trop vite',
  TOO_MANY_URLS: 'Trop de liens dans le message',
  GLOBAL_RATE: 'Débit global dépassé (trop de soumissions récentes)',
};

export function abuseReasonLabel(reason: string | null): string {
  if (!reason) return '';
  return ABUSE_REASON_LABEL[reason] || reason;
}

/** Y a-t-il des rejets récents à signaler à la recette ? */
export function hasRecentRejections(entries: ContactDiagnosticEntry[]): boolean {
  return entries.some((e) => e.decision === 'REJECTED_AS_SPAM');
}
