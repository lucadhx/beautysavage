// RX2 — Composants de l'espace Finance (mobile-first, cards, accessibles).
// Aucune couleur hex en dur (tokens --bs-* via classes fin-*). Aucune <table>. Cibles ≥44px.
import type { ReactNode } from 'react';
import type { FinanceRange, FinanceBreakdown, FinanceActionMetric } from '@bs/api-client';

// ── Helpers ────────────────────────────────────────────────────────────────────
export function money(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return `${Number(n).toFixed(2).replace('.', ',')} €`;
}
// Montant signé pour le héros « +2 480 € ».
export function signedMoney(n: number | null | undefined): string {
  const value = Number(n);
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${money(value)}`;
}

// ── Sélecteur de période ─────────────────────────────────────────────────────────
const RANGES: { key: FinanceRange; label: string }[] = [
  { key: 'today', label: "Aujourd'hui" },
  { key: '7d', label: '7 jours' },
  { key: '30d', label: '30 jours' },
];
export function RangeSwitch({ value, onChange }: { value: FinanceRange; onChange: (r: FinanceRange) => void }) {
  return (
    <div className="fin-ranges" role="tablist" aria-label="Période" data-testid="fin-ranges">
      {RANGES.map((r) => (
        <button
          type="button"
          key={r.key}
          role="tab"
          aria-selected={value === r.key}
          className={`fin-range${value === r.key ? ' fin-range--active' : ''}`}
          onClick={() => onChange(r.key)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

// ── Héro : le chiffre qui résume tout (carte « solde » façon néobanque) ───────────────
export function FinanceHero({ label, revenue, salesCount }: { label: string; revenue: number; salesCount: number }) {
  return (
    <div className="fin-hero fin-card" data-testid="fin-hero">
      <span className="fin-hero__glow" aria-hidden="true" />
      <div className="fin-hero__top">
        <span className="fin-hero__label">{label}</span>
        <span className="fin-hero__chip"><i className="bi-wallet2" aria-hidden="true" /> Revenu net</span>
      </div>
      <span className="fin-hero__amount">{signedMoney(revenue)}</span>
      <span className="fin-hero__sub">
        <i className="bi-receipt" aria-hidden="true" />
        {salesCount} {salesCount > 1 ? 'ventes' : 'vente'}
      </span>
    </div>
  );
}

// ── Ventilation par type (chips) ─────────────────────────────────────────────────
export function BreakdownChips({ breakdown, giftCardConsumption }: { breakdown: FinanceBreakdown; giftCardConsumption: number }) {
  const chips = [
    { icon: 'bi-scissors', label: 'prestations', count: breakdown.prestations },
    { icon: 'bi-mortarboard', label: 'formations', count: breakdown.formations },
    { icon: 'bi-gift', label: 'cartes cadeaux', count: breakdown.giftCards },
    { icon: 'bi-box-seam', label: 'produits', count: breakdown.products },
  ].filter((c) => c.count > 0);

  if (!chips.length && giftCardConsumption <= 0) {
    return <FinanceEmpty label="Aucune vente sur la période" icon="bi-receipt" />;
  }
  return (
    <div className="fin-breakdown" data-testid="fin-breakdown">
      {chips.map((c) => (
        <span className="fin-chip" key={c.label}>
          <i className={c.icon} aria-hidden="true" />
          <span className="fin-chip__count">{c.count}</span> {c.label}
        </span>
      ))}
      {giftCardConsumption > 0 ? (
        <span className="fin-chip">
          <i className="bi-wallet2" aria-hidden="true" /> {money(giftCardConsumption)} cartes utilisées
        </span>
      ) : null}
    </div>
  );
}

// ── Carte d'action « à faire » ──────────────────────────────────────────────────
export function ActionCard({
  icon, label, metric, unit, warn, onClick,
}: {
  icon: string; label: string; metric: FinanceActionMetric; unit: string; warn?: boolean; onClick: () => void;
}) {
  const empty = metric.count === 0;
  return (
    <button
      type="button"
      className={`fin-card fin-actioncard${empty ? ' fin-actioncard--muted' : ''}`}
      onClick={onClick}
      data-testid="fin-actioncard"
    >
      <span className={`fin-actioncard__icon${warn && !empty ? ' fin-actioncard__icon--warn' : ''}`}>
        <i className={icon} aria-hidden="true" />
      </span>
      <span className="fin-actioncard__body">
        <span className="fin-actioncard__value">
          {metric.count} {metric.count > 1 ? `${unit}s` : unit}
        </span>
        <span className="fin-actioncard__label">{label} · {money(metric.total)}</span>
      </span>
      <i className="bi-chevron-right fin-actioncard__chev" aria-hidden="true" />
    </button>
  );
}

// ── États ─────────────────────────────────────────────────────────────────────
export function FinanceSkeleton(): ReactNode {
  return (
    <div className="fin-skeletonwrap" aria-hidden="true" data-testid="fin-skeleton">
      <div className="fin-skeleton fin-skeleton--hero" />
      <div className="fin-skeleton fin-skeleton--row" />
      <div className="fin-skeleton fin-skeleton--row" />
    </div>
  );
}
export function FinanceEmpty({ label, icon = 'bi-inbox' }: { label: string; icon?: string }) {
  return (
    <div className="fin-empty" data-testid="fin-empty">
      <i className={icon} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
export function FinanceError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="fin-card fin-error" role="alert" data-testid="fin-error">
      <i className="bi-exclamation-triangle" aria-hidden="true" />
      <span>Impossible de charger le tableau de bord financier.</span>
      <button type="button" className="bs-btn" onClick={onRetry}>Réessayer</button>
    </div>
  );
}
