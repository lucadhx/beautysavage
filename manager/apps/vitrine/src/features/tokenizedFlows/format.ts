// RX4 S3 — Helpers purs des parcours tokenisés (mapping statuts, libellés, waiver). Aucun calcul métier
// autoritaire : le serveur valide (éligibilité, exécution refund, texte de renonciation exact).
import { ApiError } from '@bs/api-client';
import type { RefundStatus, RefundSplitStatus, DecisionFlow, DecisionFormationSession } from '@bs/api-client';

/** État d'accès à un flux/suivi tokenisé, dérivé du code d'erreur backend. */
export type TokenState = 'ok' | 'invalid' | 'expired' | 'error';

export function tokenStateFromError(error: unknown): TokenState {
  if (!(error instanceof ApiError)) return 'error';
  const code = error.code || '';
  if (['FLOW_TOKEN_INVALID', 'FLOW_NOT_FOUND', 'FLOW_ID_REQUIRED'].includes(code)) return 'invalid';
  if (['FLOW_TOKEN_EXPIRED', 'FLOW_ALREADY_USED', 'FLOW_TOKEN_REQUIRED'].includes(code)) return 'expired';
  if (error.status === 404) return 'invalid';
  if (error.status === 409) return 'expired';
  return 'error';
}

// ── Remboursement ─────────────────────────────────────────────────────────────
const REFUND_STATUS_LABEL: Record<RefundStatus, string> = {
  requested: 'Demande enregistrée',
  pending: 'En cours de traitement',
  succeeded: 'Remboursement effectué',
  failed: 'Traitement en échec',
  canceled: 'Demande annulée',
};
export function refundStatusLabel(status: RefundStatus): string {
  return REFUND_STATUS_LABEL[status] ?? 'Remboursement';
}
export function refundStatusTone(status: RefundStatus): 'success' | 'info' | 'danger' | 'muted' {
  if (status === 'succeeded') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'canceled') return 'muted';
  return 'info';
}

const SPLIT_STATUS_LABEL: Record<RefundSplitStatus, string> = {
  not_applicable: '',
  pending: 'En cours',
  succeeded: 'Validé',
  failed: 'Échec',
  rollback_needed: 'À corriger',
};
export function splitStatusLabel(status: RefundSplitStatus): string {
  return SPLIT_STATUS_LABEL[status] ?? '';
}
export function splitStatusTone(status: RefundSplitStatus): 'success' | 'info' | 'danger' | 'warning' | 'muted' {
  if (status === 'succeeded') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'rollback_needed') return 'warning';
  if (status === 'pending') return 'info';
  return 'muted';
}

// ── Décision ──────────────────────────────────────────────────────────────────
export interface DecisionOptionView {
  key: 'reschedule' | 'refund' | 'gift_card' | 'confirm';
  icon: string;
  label: string;
  desc: string;
}

/** Liste des options RÉELLEMENT disponibles (jamais de bouton fantôme). */
export function availableDecisionOptions(flow: DecisionFlow): DecisionOptionView[] {
  const o = flow.options;
  const out: DecisionOptionView[] = [];
  if (o.canConfirm) out.push({ key: 'confirm', icon: 'bi-check2-circle', label: 'Confirmer ma présence', desc: 'Conserver la session modifiée.' });
  if (o.canReschedule && (flow.kind === 'formation' ? (flow.availableSessions?.length ?? 0) > 0 : o.serviceRescheduleAvailable)) {
    out.push({ key: 'reschedule', icon: 'bi-calendar2-plus', label: 'Reporter mon rendez-vous', desc: 'Choisir une nouvelle date.' });
  }
  if (o.canGiftCard) out.push({ key: 'gift_card', icon: 'bi-gift', label: 'Recevoir une carte cadeau', desc: 'Un avoir du montant payé.' });
  if (o.canRefund) out.push({ key: 'refund', icon: 'bi-arrow-counterclockwise', label: 'Demander un remboursement', desc: 'Le suivi arrive par e-mail.' });
  return out;
}

const DATE_LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export function formatSessionDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : DATE_LONG.format(d);
}

export function sessionLabel(s: DecisionFormationSession): string {
  const start = formatSessionDate(s.startDate);
  return s.durationDays > 1 ? `${start} · ${s.durationDays} jours` : start;
}

/**
 * Texte de renonciation à envoyer pour un report de formation, choisi selon la proximité de la session.
 * ⚠️ Le backend reste autoritaire (match exact) : en cas de mismatch, le 400 est affiché.
 */
export function pickRenunciationText(flow: DecisionFlow, session: DecisionFormationSession, now: number = Date.now()): string {
  const legal = flow.legal;
  if (!legal) return '';
  const start = new Date(session.startDate).getTime();
  if (Number.isNaN(start)) return '';
  const daysUntil = (start - now) / 86_400_000;
  const refundDays = legal.refundDays || flow.formation?.refundDays || 7;
  if (daysUntil <= refundDays) return legal.presentielWaiverWithin7 || '';
  if (daysUntil <= 14) return legal.presentielWaiverBetween7And14 || '';
  return '';
}
