// RX2.5 — Composants Commissions premium (mobile-first, cards, accessibles). Tokens --bs-* via
// classes fin-comm-*, zéro hex, aucune <table>, cibles ≥44px. Backend = autorité (aucun calcul front).
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  type CommissionPaymentView, type CommissionBreakdownLine, type CommissionTerms, type CommissionLateStatus,
} from '@bs/api-client';
import { money } from './components';
import { usePayCommission } from './useCommissions';
import './commissions.css';

// Traduit toute erreur de paiement en message clair pour l'utilisateur. Le backend renvoie déjà des
// messages FR ({error} + {code}) : on les affiche tels quels, avec un repli par code puis générique.
const PAY_ERROR_BY_CODE: Record<string, string> = {
  PAYMENT_IN_PROGRESS: 'Un paiement est déjà en cours pour ce mois. Patientez quelques instants puis réessayez.',
  COMMISSION_ERROR: 'Le paiement n’a pas pu être initié. Réessayez dans un instant.',
};
function payErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // Message backend explicite prioritaire (ex. « Ce mois a déjà été réglé. »).
    if (error.message && !/^https?:/i.test(error.message)) return error.message;
    if (error.code && PAY_ERROR_BY_CODE[error.code]) return PAY_ERROR_BY_CODE[error.code];
    if (error.status === 404) return 'Paiement introuvable — rechargez la page.';
    if (error.status === 409) return 'Ce mois a déjà été réglé ou un paiement est en cours.';
    if (error.status >= 500) return 'Le service de paiement est momentanément indisponible. Réessayez plus tard.';
  }
  return 'Échec du paiement — vérifiez votre connexion et réessayez.';
}

function fmtDate(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}
function daysUntil(v: string | null): number | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

const LATE: Record<CommissionLateStatus, { label: string; tone: string; icon: string }> = {
  paid: { label: 'Payée', tone: 'success', icon: 'bi-check2-circle' },
  settled_zero: { label: 'Rien à payer', tone: 'neutral', icon: 'bi-dash-circle' },
  pending_due: { label: 'À venir', tone: 'neutral', icon: 'bi-hourglass' },
  due: { label: 'À payer', tone: 'warning', icon: 'bi-clock' },
  grace: { label: 'Délai de grâce', tone: 'warning', icon: 'bi-hourglass-split' },
  overdue: { label: 'En retard', tone: 'danger', icon: 'bi-exclamation-triangle' },
  suspension_risk: { label: 'Risque de suspension', tone: 'danger', icon: 'bi-shield-exclamation' },
};

export function CommissionLateStatusBadge({ lateStatus }: { lateStatus: CommissionLateStatus }) {
  const s = LATE[lateStatus] || LATE.pending_due;
  return <span className={`fin-comm-badge fin-comm-badge--${s.tone}`} data-testid="fin-comm-badge"><i className={s.icon} aria-hidden="true" /> {s.label}</span>;
}

// ── Lignes du calcul ──────────────────────────────────────────────────────────────
function signed(amount: number): string {
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
  return `${sign}${money(Math.abs(amount))}`;
}
export function CommissionBreakdownCard({ lines }: { lines: CommissionBreakdownLine[] }) {
  return (
    <div className="fin-comm-card" data-testid="fin-comm-breakdown">
      <span className="fin-comm-card__title"><i className="bi-calculator" aria-hidden="true" /> Détail du calcul</span>
      {lines.map((l, i) => (
        <div key={`${l.label}-${i}`} className={`fin-comm-line${l.kind === 'net' ? ' fin-comm-line--net' : ''}${l.info ? ' fin-comm-line--info' : ''}`}>
          <span>{l.label}</span>
          <span className={`fin-comm-line__amount fin-comm-line__amount--${l.kind}`}>{l.kind === 'net' ? money(l.amount) : signed(l.amount)}</span>
        </div>
      ))}
    </div>
  );
}

export function CommissionPaymentStatusCard({ payment }: { payment: CommissionPaymentView }) {
  return (
    <div className="fin-comm-card" data-testid="fin-comm-status">
      <span className="fin-comm-card__title"><i className="bi-flag" aria-hidden="true" /> Statut</span>
      <div className="fin-comm-meta">
        <div className="fin-comm-meta__row"><span>État</span><CommissionLateStatusBadge lateStatus={payment.lateStatus} /></div>
        <div className="fin-comm-meta__row"><span>Échéance</span><span>{fmtDate(payment.dueAt)}</span></div>
        {payment.lateStatus === 'grace' ? <div className="fin-comm-meta__row"><span>Fin du délai de grâce</span><span>{fmtDate(payment.graceEndsAt)}</span></div> : null}
        {payment.paidAt ? <div className="fin-comm-meta__row"><span>Payée le</span><span>{fmtDate(payment.paidAt)}</span></div> : null}
      </div>
    </div>
  );
}

export function CommissionInvoiceCard({ invoice }: { invoice: CommissionPaymentView['invoice'] }) {
  if (!invoice.pdfUrl) return null;
  return (
    <div className="fin-comm-card" data-testid="fin-comm-invoice">
      <span className="fin-comm-card__title"><i className="bi-file-earmark-text" aria-hidden="true" /> Facture</span>
      <a className="fin-comm-btn" href={invoice.pdfUrl} target="_blank" rel="noreferrer"><i className="bi-download" aria-hidden="true" /> Télécharger la facture</a>
    </div>
  );
}

export function CommissionSettingsPreview({ terms }: { terms: CommissionTerms }) {
  const BLOCK: Record<string, string> = { none: 'Aucun', warning_only: 'Alerte seule', block_purchases: 'Blocage achats', block_manager: 'Blocage gestion' };
  return (
    <div className="fin-comm-card" data-testid="fin-comm-settings">
      <span className="fin-comm-card__title"><i className="bi-gear" aria-hidden="true" /> Règles de paiement</span>
      <div className="fin-comm-settings">
        <div className="fin-comm-setting"><span className="fin-comm-setting__value">{terms.paymentDueDays} j</span><span className="fin-comm-setting__label">Délai de paiement</span></div>
        <div className="fin-comm-setting"><span className="fin-comm-setting__value">{terms.gracePeriodDays} j</span><span className="fin-comm-setting__label">Délai de grâce</span></div>
        <div className="fin-comm-setting"><span className="fin-comm-setting__value">{BLOCK[terms.blockingMode] || terms.blockingMode}</span><span className="fin-comm-setting__label">Mode de blocage</span></div>
      </div>
    </div>
  );
}

// ── Action de paiement (Stripe Dev hébergé U3) ──────────────────────────────────────
export function CommissionPaymentAction({ payment, onRedirect }: {
  payment: CommissionPaymentView; onRedirect?: (url: string) => void;
}) {
  const mutation = usePayCommission();
  const [note, setNote] = useState<{ text: string; tone: 'info' | 'success' | 'error' } | null>(null);
  const payAction = payment.actions.find((a) => a.kind === 'commission_pay');
  if (!payAction?.enabled) {
    if (payment.status === 'settled_zero') return <span className="fin-comm-note" data-testid="fin-comm-settled">Aucune commission à payer ce mois-ci.</span>;
    if (payment.status === 'paid') return <span className="fin-comm-note fin-comm-note--success" data-testid="fin-comm-paid"><i className="bi-check2-circle" aria-hidden="true" /> Commission payée.</span>;
    return null;
  }
  const redirect = onRedirect || ((url: string) => { window.location.assign(url); });
  const onPay = () => {
    setNote(null);
    mutation.mutate(payment.id, {
      onSuccess: (res) => {
        if (res.url) { redirect(res.url); return; }
        if (res.settledZero) { setNote({ text: 'Aucune commission à payer ce mois-ci.', tone: 'info' }); return; }
        if (res.alreadySucceeded) { setNote({ text: 'Commission déjà payée.', tone: 'success' }); return; }
        // Réponse sans URL hébergée (checkout plateforme désactivé) : on l'explicite au lieu de rester muet.
        setNote({ text: 'Le paiement en ligne n’est pas encore activé (checkout plateforme désactivé). Contactez le support pour régler cette commission.', tone: 'error' });
      },
      onError: (error) => setNote({ text: payErrorMessage(error), tone: 'error' }),
    });
  };
  const toneIcon = note?.tone === 'success' ? 'bi-check2-circle' : note?.tone === 'error' ? 'bi-exclamation-triangle' : 'bi-info-circle';
  return (
    <div className="fin-comm-footer" data-testid="fin-comm-pay">
      <button type="button" className="fin-comm-btn fin-comm-btn--primary" disabled={mutation.isPending} onClick={onPay}>
        {mutation.isPending ? <><span className="fin-comm-spin" aria-hidden="true" /> Traitement…</> : `Payer la commission · ${money(payment.netAmountDue)}`}
      </button>
      {note ? (
        <span className={`fin-comm-note fin-comm-note--${note.tone}`} role={note.tone === 'error' ? 'alert' : undefined}>
          <i className={toneIcon} aria-hidden="true" /> {note.text}
        </span>
      ) : null}
    </div>
  );
}

// ── Card principale « Commission ce mois » ──────────────────────────────────────────
export function CommissionCurrentCard({ current, onRedirect }: { current: CommissionPaymentView; onRedirect?: (url: string) => void }) {
  const due = daysUntil(current.dueAt);
  // Le backend (lateStatus) est l'autorité : on ne dit « en retard » que s'il le dit,
  // sinon le texte peut contredire le badge (ex. « À venir » + « En retard depuis… »).
  const isLate = current.lateStatus === 'overdue' || current.lateStatus === 'suspension_risk' || current.lateStatus === 'grace';
  const dueText = current.status === 'settled_zero' ? 'Rien à régler ce mois-ci'
    : current.status === 'paid' ? `Payée le ${fmtDate(current.paidAt)}`
    : isLate ? `En retard depuis le ${fmtDate(current.dueAt)}`
    : due !== null && due >= 0 ? `À payer avant le ${fmtDate(current.dueAt)} (${due} j)`
    : `Échéance : ${fmtDate(current.dueAt)}`;
  return (
    <div className="fin-comm-current" data-testid="fin-comm-current">
      <span className="fin-comm-current__label">Commission · {current.label}</span>
      <span className="fin-comm-current__amount">{money(current.netAmountDue)}</span>
      <div className="fin-comm-current__row">
        <CommissionLateStatusBadge lateStatus={current.lateStatus} />
        <span className="fin-comm-current__due">{dueText}</span>
      </div>
      <div className="fin-comm-current__row">
        <Link to={`/finance/commissions/${current.year}/${current.month + 1}`} className="fin-comm-btn"><i className="bi-list-ul" aria-hidden="true" /> Voir le détail</Link>
      </div>
      <CommissionPaymentAction payment={current} onRedirect={onRedirect} />
    </div>
  );
}

// ── Historique ──────────────────────────────────────────────────────────────────────
export function CommissionHistoryList({ items }: { items: CommissionPaymentView[] }) {
  if (!items.length) return <CommissionEmptyState label="Aucun historique" />;
  return (
    <div className="fin-comm-history" data-testid="fin-comm-history">
      {items.map((c) => (
        <Link key={c.id} to={`/finance/commissions/${c.year}/${c.month + 1}`} className="fin-comm-histitem">
          <span className="fin-comm-histitem__body">
            <span className="fin-comm-histitem__label">{c.label}</span>
            <CommissionLateStatusBadge lateStatus={c.lateStatus} />
          </span>
          <span className="fin-comm-histitem__amount">{money(c.netAmountDue)}</span>
          <i className="bi-chevron-right fin-comm-histitem__chev" aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}

// ── États ─────────────────────────────────────────────────────────────────────────
export function CommissionSkeleton(): ReactNode {
  return <div className="fin-comm-skeleton" aria-hidden="true" data-testid="fin-comm-skeleton"><div /><div /><div /></div>;
}
export function CommissionEmptyState({ label = 'Aucune commission', icon = 'bi-bank' }: { label?: string; icon?: string }) {
  return <div className="fin-comm-empty" data-testid="fin-comm-empty"><i className={icon} aria-hidden="true" /><span>{label}</span></div>;
}
