// RX2.6 — Composants Gift Card Finance (mobile-first, cards/timeline, accessibles). Tokens --bs-* via
// classes fin-gc-*, zéro hex, aucune <table>, ≥44px. JAMAIS le code/token complet. AUCUNE mention d'expiration.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type {
  FinanceGiftCardCard, FinanceGiftCardSummary, GiftCardLifecycleItem, GiftCardFinanceTransaction,
  GiftCardRefundTimelineItem, GiftCardPaymentSource, GiftCardFinanceActor, FinanceMovementAction,
} from '@bs/api-client';
import { money } from './components';

function fmtDate(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
function signed(amount: number | null): string {
  if (amount === null || amount === undefined) return '';
  const v = Number(amount);
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${money(Math.abs(v))}`;
}

// ── Badges ──────────────────────────────────────────────────────────────────────────
export function GiftCardStatusBadge({ status }: { status: string }) {
  const active = status === 'active';
  return <span className={`fin-gc-badge fin-gc-badge--${active ? 'success' : 'neutral'}`}>{active ? 'Active' : 'Épuisée'}</span>;
}
export function GiftCardPaymentModeBadge({ mode, label }: { mode: string; label?: string }) {
  const onSite = mode === 'on_site';
  return (
    <span className={`fin-gc-badge fin-gc-badge--${onSite ? 'warning' : 'neutral'}`}>
      <i className={onSite ? 'bi-cash' : 'bi-credit-card'} aria-hidden="true" /> {label || (onSite ? 'Paiement sur place' : 'Stripe')}
    </span>
  );
}

// ── Résumé ──────────────────────────────────────────────────────────────────────────
export function GiftCardFinanceSummary({ summary }: { summary: FinanceGiftCardSummary }) {
  const kpis = [
    { label: 'Solde actif', value: money(summary.activeBalanceAmount) },
    { label: 'Émis', value: money(summary.issuedAmount) },
    { label: 'Utilisé', value: money(summary.usedAmount) },
    { label: 'Cartes', value: String(summary.count) },
  ];
  return (
    <div className="fin-gc-summary" data-testid="fin-gc-summary">
      {kpis.map((k) => (
        <div className="fin-gc-kpi" key={k.label}><span className="fin-gc-kpi__value">{k.value}</span><span className="fin-gc-kpi__label">{k.label}</span></div>
      ))}
    </div>
  );
}

// ── Filtres ─────────────────────────────────────────────────────────────────────────
const CREATION: { key: '' | 'online' | 'manual_institute'; label: string }[] = [
  { key: '', label: 'Toutes' }, { key: 'online', label: 'En ligne' }, { key: 'manual_institute', label: 'Sur place' },
];
const STATUS: { key: '' | 'active' | 'redeemed'; label: string }[] = [
  { key: '', label: 'Tous statuts' }, { key: 'active', label: 'Actives' }, { key: 'redeemed', label: 'Épuisées' },
];
export function GiftCardFinanceFilters({ creationMode, status, onCreation, onStatus }: {
  creationMode: string; status: string;
  onCreation: (v: '' | 'online' | 'manual_institute') => void; onStatus: (v: '' | 'active' | 'redeemed') => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--bs-space-2)' }}>
      <div className="fin-gc-chips" role="tablist" aria-label="Circuit" data-testid="fin-gc-filter-creation">
        {CREATION.map((c) => (
          <button type="button" key={c.key || 'all'} role="tab" aria-selected={creationMode === c.key}
            className={`fin-gc-chip${creationMode === c.key ? ' fin-gc-chip--active' : ''}`} onClick={() => onCreation(c.key)}>{c.label}</button>
        ))}
      </div>
      <div className="fin-gc-chips" role="tablist" aria-label="Statut">
        {STATUS.map((s) => (
          <button type="button" key={s.key || 'all'} role="tab" aria-selected={status === s.key}
            className={`fin-gc-chip${status === s.key ? ' fin-gc-chip--active' : ''}`} onClick={() => onStatus(s.key)}>{s.label}</button>
        ))}
      </div>
    </div>
  );
}

// ── Liste ───────────────────────────────────────────────────────────────────────────
export function GiftCardFinanceCard({ card }: { card: FinanceGiftCardCard }) {
  const who = card.recipientName || card.purchaserName || 'Titulaire';
  return (
    <Link to={`/finance/cartes-cadeaux/${card.id}`} className="fin-gc-card" data-testid="fin-gc-card">
      <span className="fin-gc-card__icon"><i className="bi-gift" aria-hidden="true" /></span>
      <span className="fin-gc-card__body">
        <span className="fin-gc-card__code">{card.maskedCode}</span>
        <span className="fin-gc-card__sub">{who} · {fmtDate(card.purchasedAt)}</span>
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <GiftCardStatusBadge status={card.status} />
          <GiftCardPaymentModeBadge mode={card.paymentMode} label={card.paymentLabel} />
        </span>
      </span>
      <span className="fin-gc-card__right">
        <span className="fin-gc-card__balance">{money(card.balance)}</span>
        <span className="fin-gc-card__initial">/ {money(card.amount)}</span>
      </span>
    </Link>
  );
}
export function GiftCardFinanceList({ cards }: { cards: FinanceGiftCardCard[] }) {
  if (!cards.length) return <GiftCardEmptyState label="Aucune carte cadeau" />;
  return <div className="fin-gc-list" data-testid="fin-gc-list">{cards.map((c) => <GiftCardFinanceCard key={c.id} card={c} />)}</div>;
}

// ── Détail : solde, acteurs, source, QR ──────────────────────────────────────────────
export function GiftCardBalanceCard({ balance }: { balance: { amount: number; balance: number; reserved: number; available: number; status: string } }) {
  return (
    <div className="fin-gc-block" data-testid="fin-gc-balance">
      <div className="fin-gc-balance">
        <span className="fin-gc-balance__amount">{money(balance.balance)}</span>
        <span className="fin-gc-balance__label">Solde actuel · sur {money(balance.amount)} émis</span>
      </div>
      {balance.reserved > 0 ? <div className="fin-gc-row"><span>Réservé (paiement en cours)</span><span>{money(balance.reserved)}</span></div> : null}
      <div className="fin-gc-row"><span>Disponible</span><span>{money(balance.available)}</span></div>
    </div>
  );
}
export function GiftCardActorsCard({ actors }: { actors: { purchaser: GiftCardFinanceActor; recipient: GiftCardFinanceActor } }) {
  return (
    <div className="fin-gc-block" data-testid="fin-gc-actors">
      <span className="fin-gc-block__title"><i className="bi-people" aria-hidden="true" /> Acheteur & bénéficiaire</span>
      <div className="fin-gc-row"><span>Acheteur</span><span>{actors.purchaser.id ? <Link to={`/clients/${actors.purchaser.id}`}>{actors.purchaser.name}</Link> : actors.purchaser.name}</span></div>
      <div className="fin-gc-row"><span>Bénéficiaire</span><span>{actors.recipient.id ? <Link to={`/clients/${actors.recipient.id}`}>{actors.recipient.name}</Link> : actors.recipient.name}</span></div>
    </div>
  );
}
export function GiftCardPaymentSourceCard({ paymentSource }: { paymentSource: GiftCardPaymentSource }) {
  return (
    <div className="fin-gc-block" data-testid="fin-gc-source">
      <span className="fin-gc-block__title"><i className="bi-wallet2" aria-hidden="true" /> Source de paiement</span>
      <div className="fin-gc-row"><span>Mode</span><span><GiftCardPaymentModeBadge mode={paymentSource.mode} label={paymentSource.label} /></span></div>
      {paymentSource.invoice?.pdfUrl ? (
        <div className="fin-gc-row"><span>Facture</span><span><a href={paymentSource.invoice.pdfUrl} target="_blank" rel="noreferrer">Télécharger</a></span></div>
      ) : null}
    </div>
  );
}
export function GiftCardQrCard({ qr, debitTo }: { qr: { available: boolean; maskedToken: string | null }; debitTo?: string | null }) {
  if (!qr.available) return null;
  return (
    <div className="fin-gc-block" data-testid="fin-gc-qr">
      <span className="fin-gc-block__title"><i className="bi-qr-code" aria-hidden="true" /> QR code</span>
      <div className="fin-gc-qr">
        <span className="fin-gc-qr__icon"><i className="bi-qr-code" aria-hidden="true" /></span>
        <span className="fin-gc-qr__token">{qr.maskedToken}</span>
      </div>
      {debitTo ? <Link to={debitTo} className="fin-gc-btn">Débiter via QR</Link> : null}
    </div>
  );
}

// ── Lifecycle timeline ────────────────────────────────────────────────────────────────
const LIFECYCLE_ICON: Record<string, string> = {
  created: 'bi-gift', offered: 'bi-envelope-heart', used: 'bi-bag', manual_debit: 'bi-dash-circle',
  refund_recredit: 'bi-arrow-counterclockwise', rollback_needed: 'bi-exclamation-triangle',
  refund_recredit_failed: 'bi-x-octagon', qr_generated: 'bi-qr-code', pdf_generated: 'bi-file-earmark-pdf',
  balance_changed: 'bi-wallet2', email_sent: 'bi-envelope',
};
export function GiftCardLifecycleTimeline({ items }: { items: GiftCardLifecycleItem[] }) {
  if (!items.length) return <GiftCardEmptyState label="Aucun événement" />;
  return (
    <div className="fin-gc-tl" data-testid="fin-gc-lifecycle">
      {items.map((it, i) => (
        <div className="fin-gc-tlitem" key={`${it.type}-${i}`}>
          <span className={`fin-gc-tldot fin-gc-tldot--${it.status}`} aria-hidden="true" />
          <span className="fin-gc-tlbody">
            <span className="fin-gc-tltitle"><i className={LIFECYCLE_ICON[it.type] || 'bi-dot'} aria-hidden="true" /> {it.title}</span>
            {it.subtitle ? <span className="fin-gc-tlsub">{it.subtitle}</span> : null}
            <span className="fin-gc-tlmeta">
              <span>{fmtDate(it.occurredAt)}</span>
              {it.amount !== null ? <span className={`fin-gc-tlamount ${Number(it.amount) >= 0 ? 'fin-gc-tlamount--pos' : 'fin-gc-tlamount--neg'}`}>{signed(it.amount)}</span> : null}
              {it.balanceAfter !== null ? <span>Solde {money(it.balanceAfter)}</span> : null}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Transactions ──────────────────────────────────────────────────────────────────────
export function GiftCardTransactionTimeline({ transactions }: { transactions: GiftCardFinanceTransaction[] }) {
  if (!transactions.length) return null;
  return (
    <div className="fin-gc-block" data-testid="fin-gc-transactions">
      <span className="fin-gc-block__title"><i className="bi-list-ul" aria-hidden="true" /> Transactions</span>
      {transactions.map((t) => (
        <div className="fin-gc-row" key={t.id}>
          <span>{t.title}{t.note ? ` · ${t.note}` : ''}</span>
          <span className={Number(t.amount) >= 0 ? 'fin-gc-tlamount--pos' : 'fin-gc-tlamount--neg'}>{signed(t.amount)} · solde {money(t.balanceAfter)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Remboursements splittés ─────────────────────────────────────────────────────────────
const REFUND_TONE: Record<string, string> = { succeeded: 'success', pending: 'warning', failed: 'danger', rollback_needed: 'danger', not_applicable: 'neutral' };
export function GiftCardRefundSplitCard({ refunds }: { refunds: GiftCardRefundTimelineItem[] }) {
  if (!refunds.length) return null;
  return (
    <div className="fin-gc-block" data-testid="fin-gc-refunds">
      <span className="fin-gc-block__title"><i className="bi-arrow-counterclockwise" aria-hidden="true" /> Remboursements</span>
      {refunds.map((r) => (
        <div className="fin-gc-split" key={r.refundId} data-testid="fin-gc-refund-item">
          <div className="fin-gc-split__head">
            <span>{r.refundId}</span>
            <span className={`fin-gc-badge fin-gc-badge--${REFUND_TONE[r.giftCardRefundStatus] || 'neutral'}`}>
              {r.giftCardRefundStatus === 'rollback_needed' ? 'À traiter' : r.recovered ? 'Récupéré' : r.status}
            </span>
          </div>
          <div className="fin-gc-split__part"><span>Remboursement total</span><span>{money(r.amount)}</span></div>
          {r.stripeRefundAmount > 0 ? <div className="fin-gc-split__part"><span>Part Stripe</span><span>{money(r.stripeRefundAmount)}</span></div> : null}
          {r.giftCardRefundAmount > 0 ? <div className="fin-gc-split__part"><span>Recrédit carte cadeau</span><span>{money(r.giftCardRefundAmount)}</span></div> : null}
        </div>
      ))}
    </div>
  );
}

// ── Actions ───────────────────────────────────────────────────────────────────────────
const ACTION_LABEL: Record<string, string> = { customer_view: 'Voir le client', gift_card_debit: 'Débit manuel', invoice_view: 'Voir la facture' };
export function GiftCardFinanceActions({ actions }: { actions: FinanceMovementAction[] }) {
  const visible = actions.filter((a) => ['customer_view', 'gift_card_debit', 'invoice_view'].includes(a.kind));
  if (!visible.length) return null;
  return (
    <div className="fin-gc-actions" data-testid="fin-gc-actions">
      {visible.map((a, i) => {
        const label = ACTION_LABEL[a.kind] || a.kind;
        const primary = a.kind === 'gift_card_debit';
        const cls = `fin-gc-btn${primary ? ' fin-gc-btn--primary' : ''}`;
        if (!a.enabled) return <button key={i} type="button" className={cls} disabled aria-disabled="true">{label}</button>;
        if (a.url) return <a key={i} className={cls} href={a.url} target="_blank" rel="noreferrer">{label}</a>;
        if (a.to) return <Link key={i} className={cls} to={a.to}>{label}</Link>;
        return <button key={i} type="button" className={cls} disabled aria-disabled="true">{label}</button>;
      })}
    </div>
  );
}

// ── États ─────────────────────────────────────────────────────────────────────────────
export function GiftCardSkeleton(): ReactNode {
  return <div className="fin-gc-skeleton" aria-hidden="true" data-testid="fin-gc-skeleton"><div /><div /><div /></div>;
}
export function GiftCardEmptyState({ label = 'Aucune carte cadeau', icon = 'bi-gift' }: { label?: string; icon?: string }) {
  return <div className="fin-gc-empty" data-testid="fin-gc-empty"><i className={icon} aria-hidden="true" /><span>{label}</span></div>;
}
