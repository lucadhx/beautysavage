// RX2.2 — Composants de la Financial Timeline (mobile-first, cards/drawer, accessibles).
// Aucune couleur hex en dur (tokens --bs-* via classes fin-tl-*). Aucune <table>. Cibles ≥44px.
// Le backend fait autorité : le front n'effectue AUCUN calcul de montant.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type {
  FinanceTimelineItem, FinanceTimelineSummary, FinanceMovementBadge, FinanceMovementAction,
  FinanceMovementDirection, FinanceMovementType, FinanceTimelinePeriod, FinanceTimelineTypeFilter,
} from '@bs/api-client';
import { money } from './components';

// ── Helpers ────────────────────────────────────────────────────────────────────
function signedAmount(direction: FinanceMovementDirection, amount: number): string {
  if (direction === 'in') return `+${money(amount)}`;
  if (direction === 'out') return `−${money(amount)}`;
  return money(amount);
}
function fmtDate(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

const TYPE_ICON: Record<FinanceMovementType, string> = {
  sale: 'bi-cash-coin', deposit: 'bi-wallet2',
  balance_due: 'bi-hourglass-split', balance_paid: 'bi-cash-stack',
  refund: 'bi-arrow-counterclockwise',
  gift_card_issue: 'bi-gift', gift_card_usage: 'bi-gift', gift_card_manual_debit: 'bi-gift',
  gift_card_refund_recredit: 'bi-gift', gift_card_recredit_failed: 'bi-exclamation-triangle',
  invoice: 'bi-file-earmark-text', commission: 'bi-bank',
};
function iconFor(type: FinanceMovementType): string { return TYPE_ICON[type] || 'bi-dot'; }

const ACTION_LABEL: Record<string, string> = {
  customer_view: 'Voir le client',
  invoice_view: 'Voir la facture',
  sale_view: 'Voir la vente',
  refund_process: 'Traiter le remboursement',
  balance_collect: 'Encaisser le solde',
  commission_view: 'Voir la commission',
};

// ── Montant signé ─────────────────────────────────────────────────────────────────
export function FinanceMovementAmount({ direction, amount }: { direction: FinanceMovementDirection; amount: number }) {
  return <span className={`fin-tl-amount fin-tl-amount--${direction}`}>{signedAmount(direction, amount)}</span>;
}

// ── Badges ────────────────────────────────────────────────────────────────────────
export function FinanceMovementBadges({ badges, max }: { badges: FinanceMovementBadge[]; max?: number }) {
  if (!badges?.length) return null;
  // RX2.3 — sur la card, max 2 badges visibles ; le reste dans le drawer.
  const shown = typeof max === 'number' ? badges.slice(0, max) : badges;
  return (
    <span className="fin-tl-badges">
      {shown.map((b, i) => <span key={`${b.label}-${i}`} className={`fin-tl-badge fin-tl-badge--${b.tone}`}>{b.label}</span>)}
    </span>
  );
}

// ── Résumé sticky ──────────────────────────────────────────────────────────────────
export function FinanceTimelineSummary({ summary }: { summary: FinanceTimelineSummary }) {
  const net = summary.netAmount;
  const netClass = net > 0 ? 'fin-tl-amount--in' : net < 0 ? 'fin-tl-amount--out' : 'fin-tl-amount--neutral';
  return (
    <div className="fin-tl-summary" data-testid="fin-tl-summary">
      <div className="fin-tl-summary__net">
        <span className="fin-tl-summary__net-label">Solde net</span>
        <span className={`fin-tl-summary__net-value ${netClass}`}>{net > 0 ? '+' : net < 0 ? '−' : ''}{money(Math.abs(net))}</span>
      </div>
      <div className="fin-tl-summary__metrics">
        <div className="fin-tl-metric fin-tl-metric--in"><span className="fin-tl-metric__value">+{money(summary.grossIn)}</span><span className="fin-tl-metric__label">Entrées</span></div>
        <div className="fin-tl-metric fin-tl-metric--out"><span className="fin-tl-metric__value">−{money(summary.grossOut)}</span><span className="fin-tl-metric__label">Sorties</span></div>
        <div className="fin-tl-metric"><span className="fin-tl-metric__value">{money(summary.balanceDueAmount)}</span><span className="fin-tl-metric__label">À encaisser</span></div>
        <div className="fin-tl-metric"><span className="fin-tl-metric__value">{summary.count}</span><span className="fin-tl-metric__label">Mouvements</span></div>
        <div className="fin-tl-metric"><span className="fin-tl-metric__value">{summary.refundCount}</span><span className="fin-tl-metric__label">Remb.</span></div>
      </div>
    </div>
  );
}

// ── Chips période / type ────────────────────────────────────────────────────────────
const PERIODS: { key: FinanceTimelinePeriod; label: string }[] = [
  { key: 'today', label: "Aujourd'hui" }, { key: 'week', label: '7 jours' },
  { key: 'month', label: '30 jours' }, { key: 'all', label: 'Tout' },
];
export function FinancePeriodChips({ value, onChange }: { value: FinanceTimelinePeriod; onChange: (p: FinanceTimelinePeriod) => void }) {
  return (
    <div className="fin-tl-chips" role="tablist" aria-label="Période" data-testid="fin-tl-periods">
      {PERIODS.map((p) => (
        <button type="button" key={p.key} role="tab" aria-selected={value === p.key}
          className={`fin-tl-chip${value === p.key ? ' fin-tl-chip--active' : ''}`} onClick={() => onChange(p.key)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

const TYPES: { key: FinanceTimelineTypeFilter; label: string; icon: string }[] = [
  { key: 'all', label: 'Tout', icon: 'bi-grid' },
  { key: 'sale', label: 'Ventes', icon: 'bi-cash-coin' },
  { key: 'balance', label: 'Soldes', icon: 'bi-hourglass-split' },
  { key: 'gift_card', label: 'Cartes cadeaux', icon: 'bi-gift' },
  { key: 'refund', label: 'Remboursements', icon: 'bi-arrow-counterclockwise' },
  { key: 'commission', label: 'Commissions', icon: 'bi-bank' },
  { key: 'invoice', label: 'Factures', icon: 'bi-file-earmark-text' },
];
export function FinanceTypeChips({ value, onChange }: { value: FinanceTimelineTypeFilter; onChange: (t: FinanceTimelineTypeFilter) => void }) {
  return (
    <div className="fin-tl-chips" role="tablist" aria-label="Type" data-testid="fin-tl-types">
      {TYPES.map((t) => (
        <button type="button" key={t.key} role="tab" aria-selected={value === t.key}
          className={`fin-tl-chip${value === t.key ? ' fin-tl-chip--active' : ''}`} onClick={() => onChange(t.key)}>
          <i className={t.icon} aria-hidden="true" /> {t.label}
        </button>
      ))}
    </div>
  );
}

export function FinanceTimelineFilters({ period, type, onPeriod, onType }: {
  period: FinanceTimelinePeriod; type: FinanceTimelineTypeFilter;
  onPeriod: (p: FinanceTimelinePeriod) => void; onType: (t: FinanceTimelineTypeFilter) => void;
}) {
  return (
    <div className="fin-tl-filters">
      <FinancePeriodChips value={period} onChange={onPeriod} />
      <FinanceTypeChips value={type} onChange={onType} />
    </div>
  );
}

// ── Card mouvement ──────────────────────────────────────────────────────────────────
export function FinanceTimelineCard({ item, onSelect }: { item: FinanceTimelineItem; onSelect: (i: FinanceTimelineItem) => void }) {
  return (
    <button type="button" className="fin-tl-card" onClick={() => onSelect(item)} data-testid="fin-tl-card">
      <span className="fin-tl-card__icon"><i className={iconFor(item.type)} aria-hidden="true" /></span>
      <span className="fin-tl-card__body">
        <span className="fin-tl-card__title">{item.title}</span>
        <span className="fin-tl-card__sub">{item.subtitle}</span>
        <FinanceMovementBadges badges={item.badges} max={2} />
      </span>
      <span className="fin-tl-card__right">
        <FinanceMovementAmount direction={item.direction} amount={item.amount} />
        <span className="fin-tl-card__date">{fmtDate(item.occurredAt)}</span>
      </span>
    </button>
  );
}

export function FinanceTimelineList({ items, onSelect }: { items: FinanceTimelineItem[]; onSelect: (i: FinanceTimelineItem) => void }) {
  return (
    <div className="fin-tl-list" data-testid="fin-tl-list">
      {items.map((it) => <FinanceTimelineCard key={it.id} item={it} onSelect={onSelect} />)}
    </div>
  );
}

// ── Actions du drawer (liens existants ou boutons préparés RX2.3) ─────────────────────
export function FinanceMovementActions({ actions }: { actions: FinanceMovementAction[] }) {
  const visible = actions.filter((a) => a.kind !== 'sale_view' && a.kind !== 'commission_view');
  if (!visible.length) return null;
  return (
    <div className="fin-tl-drawer__actions" data-testid="fin-tl-actions">
      {visible.map((a, i) => {
        const label = ACTION_LABEL[a.kind] || a.kind;
        const primary = a.kind === 'refund_process' || a.kind === 'balance_collect';
        const cls = `fin-tl-actionbtn${primary ? ' fin-tl-actionbtn--primary' : ''}`;
        if (!a.enabled) {
          return <button key={`${a.kind}-${i}`} type="button" className={cls} disabled aria-disabled="true">{label}</button>;
        }
        if (a.url) {
          return <a key={`${a.kind}-${i}`} className={cls} href={a.url} target="_blank" rel="noreferrer">{label}</a>;
        }
        if (a.to) {
          return <Link key={`${a.kind}-${i}`} className={cls} to={a.to}>{label}</Link>;
        }
        return <button key={`${a.kind}-${i}`} type="button" className={cls} disabled aria-disabled="true">{label}</button>;
      })}
    </div>
  );
}

// Le drawer détail premium (avec breakdown paiement + profit net + actions) est dans movementDrawer.tsx (RX2.3).

// ── États (réexport légers pour cohérence d'API de la feature) ─────────────────────────
export function FinanceTimelineEmpty({ label = 'Aucun mouvement sur la période' }: { label?: string }): ReactNode {
  return (
    <div className="fin-empty" data-testid="fin-tl-empty">
      <i className="bi-graph-up-arrow" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
