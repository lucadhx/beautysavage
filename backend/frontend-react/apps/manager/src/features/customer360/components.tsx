// M12 — Composants présentiels Customer 360 (mobile-first, cards, animés, accessibles).
// Aucune couleur hex en dur (tokens --bs-* via classes c3-*). Aucune <table>. Cibles ≥44px.
import { useEffect, useState, type ReactNode } from 'react';
import { managerAttestationUrl } from '@bs/api-client';
import type {
  CustomerSearchCard, TimelineItem, CustomerBooking, CustomerSale,
  CustomerFormation, CustomerProduct, CustomerGiftCard, CustomerRefund, CustomerDocument,
  CustomerCommunication, CustomerNotification, Customer360Summary, CustomerFinancial,
} from '@bs/api-client';

// ── Helpers ────────────────────────────────────────────────────────────────────
export function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${Number(n).toFixed(2).replace('.', ',')} €`;
}
export function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}
export function initials(first: string, last: string, fallback = '?'): string {
  const a = (first || '').trim()[0] || '';
  const b = (last || '').trim()[0] || '';
  return (a + b).toUpperCase() || fallback;
}

const STATUS_LABEL: Record<string, string> = { active: 'Actif', suspended: 'Suspendu', inactive: 'Inactif' };
export function StatusBadge({ status }: { status: string }) {
  return <span className={`c3-badge c3-badge--${status}`}>{STATUS_LABEL[status] || status}</span>;
}

// ── États ───────────────────────────────────────────────────────────────────────
export function CustomerSkeleton(): ReactNode {
  return (
    <div className="c3-skeletonwrap" aria-hidden="true" data-testid="c3-skeleton">
      <div className="c3-skeleton c3-skeleton--hero" />
      <div className="c3-skeleton c3-skeleton--row" />
      <div className="c3-skeleton c3-skeleton--row" />
      <div className="c3-skeleton c3-skeleton--block" />
    </div>
  );
}
export function CustomerEmptyState({ label = 'Aucun élément', icon = 'bi-inbox' }: { label?: string; icon?: string }) {
  return (
    <div className="c3-empty" data-testid="c3-empty">
      <i className={icon} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

// ── Header (sticky) ───────────────────────────────────────────────────────────
export function CustomerHeader({ summary, onBack }: { summary: Customer360Summary; onBack: () => void }) {
  return (
    <div className="c3-header" data-testid="c3-header">
      <button type="button" className="c3-iconbtn" aria-label="Retour" onClick={onBack}><i className="bi-chevron-left" aria-hidden="true" /></button>
      <span className="c3-header__title">{summary.displayName}</span>
      <StatusBadge status={summary.status} />
    </div>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────
export function CustomerHeroCard({ summary }: { summary: Customer360Summary }) {
  return (
    <div className="c3-hero c3-card" data-testid="c3-hero">
      <div className="c3-hero__avatar" aria-hidden="true">
        {summary.photo ? <img src={summary.photo} alt="" /> : <span>{initials(summary.firstName, summary.lastName, '🙂')}</span>}
      </div>
      <div className="c3-hero__body">
        <div className="c3-hero__name">{summary.displayName}</div>
        <div className="c3-hero__meta">
          <span><i className="bi-envelope" aria-hidden="true" /> {summary.email || '—'}</span>
          <span><i className="bi-telephone" aria-hidden="true" /> {summary.phone || 'Non renseigné'}</span>
        </div>
        <div className="c3-hero__meta c3-hero__meta--muted">
          <span><i className="bi-calendar3" aria-hidden="true" /> Client depuis {fmtDate(summary.createdAt)}</span>
          <span><i className="bi-clock-history" aria-hidden="true" /> Activité {fmtDate(summary.lastActivity)}</span>
        </div>
        {summary.nextBooking ? (
          <div className="c3-hero__next"><i className="bi-calendar-check" aria-hidden="true" /> Prochain : {summary.nextBooking.serviceName} · {fmtDateTime(summary.nextBooking.startAt)}</div>
        ) : null}
      </div>
    </div>
  );
}

// ── KPIs ─────────────────────────────────────────────────────────────────────
export function CustomerSummaryCards({ summary }: { summary: Customer360Summary }) {
  const k = summary.kpis;
  const cards = [
    { icon: 'bi-cash-coin', label: 'Total dépensé', value: money(k.totalSpent) },
    { icon: 'bi-bag-check', label: 'Achats', value: k.salesCount },
    { icon: 'bi-calendar-check', label: 'Prestations', value: k.servicesCount },
    { icon: 'bi-mortarboard', label: 'Formations', value: k.formationsCount },
    { icon: 'bi-box-seam', label: 'Produits', value: k.productsCount },
    { icon: 'bi-gift', label: 'Cartes cadeaux', value: k.giftCardsCount },
    { icon: 'bi-arrow-counterclockwise', label: 'Remboursements', value: k.refundsCount },
    { icon: 'bi-calendar-event', label: 'À venir', value: k.upcomingBookingsCount },
  ];
  return (
    <div className="c3-kpis" data-testid="c3-kpis">
      {cards.map((c) => (
        <div className="c3-kpi c3-card" key={c.label}>
          <i className={c.icon} aria-hidden="true" />
          <span className="c3-kpi__value">{c.value}</span>
          <span className="c3-kpi__label">{c.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Quick Actions ──────────────────────────────────────────────────────────────
export interface QuickAction { key: string; icon: string; label: string; onClick: () => void; disabled?: boolean; }
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <div className="c3-quick" data-testid="c3-quick">
      {actions.map((a) => (
        <button type="button" key={a.key} className="c3-quickbtn" onClick={a.onClick} disabled={a.disabled}>
          <i className={a.icon} aria-hidden="true" />
          <span>{a.label}</span>
        </button>
      ))}
    </div>
  );
}
export function MobileBottomActions({ actions }: { actions: QuickAction[] }) {
  return (
    <div className="c3-bottombar" data-testid="c3-bottombar">
      {actions.slice(0, 4).map((a) => (
        <button type="button" key={a.key} className="c3-bottombar__btn" aria-label={a.label} onClick={a.onClick} disabled={a.disabled}>
          <i className={a.icon} aria-hidden="true" />
          <span>{a.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Financial ────────────────────────────────────────────────────────────────
export function CustomerFinancialCard({ financial }: { financial: CustomerFinancial }) {
  const rows = [
    { icon: 'bi-cash-stack', label: 'Total dépensé', value: money(financial.totalSpent) },
    { icon: 'bi-wallet2', label: 'Acomptes versés', value: money(financial.depositsPaid) },
    { icon: 'bi-hourglass-split', label: 'Soldes restants', value: money(financial.balanceDue) },
    { icon: 'bi-gift', label: 'Cartes cadeaux (solde)', value: money(financial.giftCardsBalance) },
    { icon: 'bi-arrow-counterclockwise', label: 'Remboursements', value: money(financial.refundsTotal) },
  ];
  return (
    <div className="c3-financial" data-testid="c3-financial">
      <div className="c3-financial__grid">
        {rows.map((r) => (
          <div className="c3-fincard c3-card" key={r.label}>
            <i className={r.icon} aria-hidden="true" />
            <span className="c3-fincard__value">{r.value}</span>
            <span className="c3-fincard__label">{r.label}</span>
          </div>
        ))}
      </div>
      <div className="c3-card c3-finmeta">
        <div className="c3-row"><span>Dernière facture</span><strong>{financial.lastInvoice ? `${financial.lastInvoice.invoiceId || '—'} · ${money(financial.lastInvoice.totalAmount)}` : '—'}</strong></div>
        <div className="c3-row"><span>Factures impayées</span><strong data-testid="c3-unpaid">{financial.unpaidInvoicesCount}</strong></div>
      </div>
      {financial.pendingBalances.length ? (
        <div className="c3-card">
          <span className="c3-section__title">Soldes à régler sur place</span>
          {financial.pendingBalances.map((b) => (
            <div className="c3-row" key={b.bookingId}><span>{b.serviceName}</span><strong>{money(b.balanceDueAmount)}</strong></div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────────
export function TimelineCard({ item, onSelect }: { item: TimelineItem; onSelect?: (i: TimelineItem) => void }) {
  return (
    <button type="button" className={`c3-tl__item c3-tl__item--${item.type}`} onClick={() => onSelect?.(item)} data-testid="c3-tl-item">
      <span className="c3-tl__icon"><i className={item.icon} aria-hidden="true" /></span>
      <span className="c3-tl__body">
        <span className="c3-tl__title">{item.title}</span>
        {item.subtitle ? <span className="c3-tl__sub">{item.subtitle}</span> : null}
      </span>
      <span className="c3-tl__date">{fmtDate(item.date)}</span>
    </button>
  );
}
export function CustomerTimeline({ items, onSelect }: { items: TimelineItem[]; onSelect?: (i: TimelineItem) => void }) {
  if (!items.length) return <CustomerEmptyState label="Aucune activité" icon="bi-clock-history" />;
  return (
    <div className="c3-tl" data-testid="c3-timeline">
      {items.map((it) => <TimelineCard key={it.id} item={it} onSelect={onSelect} />)}
    </div>
  );
}

// ── Accordion (section repliable animée) ────────────────────────────────────────
export function Accordion({ title, icon, count, defaultOpen = false, children, testid }: {
  title: string; icon: string; count?: number; defaultOpen?: boolean; children: ReactNode; testid?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`c3-acc${open ? ' c3-acc--open' : ''}`} data-testid={testid}>
      <button type="button" className="c3-acc__head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <i className={icon} aria-hidden="true" />
        <span className="c3-acc__title">{title}</span>
        {count !== undefined ? <span className="c3-acc__count">{count}</span> : null}
        <i className={`bi-chevron-${open ? 'up' : 'down'} c3-acc__chev`} aria-hidden="true" />
      </button>
      {open ? <div className="c3-acc__body">{children}</div> : null}
    </div>
  );
}

// ── Sections ──────────────────────────────────────────────────────────────────
export function BookingSection({ bookings, onSelect }: { bookings: CustomerBooking[]; onSelect?: (b: CustomerBooking) => void }) {
  if (!bookings.length) return <CustomerEmptyState label="Aucune réservation" icon="bi-calendar" />;
  return (
    <div className="c3-list">
      {bookings.map((b) => (
        <button type="button" className="c3-card c3-listitem" key={b.id} onClick={() => onSelect?.(b)}>
          <span className="c3-listitem__main"><strong>{b.serviceName}</strong><span className="c3-listitem__sub">{fmtDateTime(b.startAt)} · {b.status}</span></span>
          <span className="c3-listitem__amount">{money(b.totalPrice)}{b.balanceDueAmount > 0 ? <span className="c3-tag">Solde {money(b.balanceDueAmount)}</span> : null}</span>
        </button>
      ))}
    </div>
  );
}
export function SaleSection({ sales, onSelect }: { sales: CustomerSale[]; onSelect?: (s: CustomerSale) => void }) {
  if (!sales.length) return <CustomerEmptyState label="Aucun achat" icon="bi-bag" />;
  return (
    <div className="c3-list">
      {sales.map((s) => (
        <button type="button" className="c3-card c3-listitem" key={s.id} onClick={() => onSelect?.(s)}>
          <span className="c3-listitem__main"><strong>{s.saleId}</strong><span className="c3-listitem__sub">{fmtDate(s.createdAt)} · {s.itemCount} article(s)</span></span>
          <span className="c3-listitem__amount">{money(s.totalAmount)}</span>
        </button>
      ))}
    </div>
  );
}
export function FormationSection({ formations, customerId }: { formations: CustomerFormation[]; customerId?: string }) {
  if (!formations.length) return <CustomerEmptyState label="Aucune formation" icon="bi-mortarboard" />;
  return (
    <div className="c3-list">
      {formations.map((f) => {
        // C2 — enrichissement learning (progression distanciel / présence présentiel).
        const learningBits: string[] = [];
        if (f.completedAt) learningBits.push('Terminée');
        else if (f.startedAt) learningBits.push('En cours');
        if (typeof f.completedLessons === 'number' && f.completedLessons > 0) learningBits.push(`${f.completedLessons} leçon(s)`);
        if (f.attendanceStatus === 'present') learningBits.push('Présent');
        else if (f.attendanceStatus === 'absent') learningBits.push('Absent');
        return (
          <div className="c3-card c3-listitem" key={f.id}>
            <span className="c3-listitem__main">
              <strong>{f.name}</strong>
              <span className="c3-listitem__sub">{f.type || 'Formation'} · {fmtDate(f.acquiredAt)}{learningBits.length ? ` · ${learningBits.join(' · ')}` : ''}</span>
            </span>
            {/* C3 — attestation téléchargeable si la formation est terminée. */}
            {f.completedAt && customerId && f.formationId ? (
              <a className="c3-tag c3-tag--link" href={managerAttestationUrl(customerId, f.formationId)} target="_blank" rel="noreferrer" aria-label="Télécharger l'attestation">
                <i className="bi bi-award" aria-hidden="true" /> Attestation
              </a>
            ) : (
              <span className="c3-tag">{f.participationStatus}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
export function ProductSection({ products }: { products: CustomerProduct[] }) {
  if (!products.length) return <CustomerEmptyState label="Aucun produit" icon="bi-box-seam" />;
  return (
    <div className="c3-list">
      {products.map((p) => (
        <div className="c3-card c3-listitem" key={p.id}>
          <span className="c3-listitem__main"><strong>{p.name}</strong><span className="c3-listitem__sub">{fmtDate(p.acquiredAt)}</span></span>
        </div>
      ))}
    </div>
  );
}
export function GiftCardSection({ giftCards }: { giftCards: CustomerGiftCard[] }) {
  if (!giftCards.length) return <CustomerEmptyState label="Aucune carte cadeau" icon="bi-gift" />;
  return (
    <div className="c3-list">
      {giftCards.map((g) => (
        <div className="c3-card c3-listitem" key={g.id}>
          <span className="c3-listitem__main"><strong>{g.code}</strong><span className="c3-listitem__sub">{g.status} · {fmtDate(g.purchasedAt)}</span></span>
          <span className="c3-listitem__amount">{money(g.balance)} / {money(g.amount)}</span>
        </div>
      ))}
    </div>
  );
}
export function RefundSection({ refunds }: { refunds: CustomerRefund[] }) {
  if (!refunds.length) return <CustomerEmptyState label="Aucun remboursement" icon="bi-arrow-counterclockwise" />;
  return (
    <div className="c3-list">
      {refunds.map((r) => (
        <div className="c3-card c3-listitem" key={r.id}>
          <span className="c3-listitem__main"><strong>{r.refundId}</strong><span className="c3-listitem__sub">{r.itemType} · {r.status}</span></span>
          <span className="c3-listitem__amount">{money(r.amount)}</span>
        </div>
      ))}
    </div>
  );
}
export function DocumentsSection({ documents }: { documents: CustomerDocument[] }) {
  if (!documents.length) return <CustomerEmptyState label="Aucun document" icon="bi-folder2-open" />;
  return (
    <div className="c3-list">
      {documents.map((d) => (
        d.url ? (
          <a className="c3-card c3-listitem" key={d.id} href={d.url} target="_blank" rel="noreferrer">
            <span className="c3-listitem__main"><strong>{d.label}</strong><span className="c3-listitem__sub">{fmtDate(d.date)}</span></span>
            <i className="bi-download" aria-hidden="true" />
          </a>
        ) : (
          <div className="c3-card c3-listitem" key={d.id}>
            <span className="c3-listitem__main"><strong>{d.label}</strong><span className="c3-listitem__sub">{fmtDate(d.date)}</span></span>
            <i className="bi-check2-circle" aria-hidden="true" />
          </div>
        )
      ))}
    </div>
  );
}
export function CommunicationsSection({ communications }: { communications: CustomerCommunication[] }) {
  if (!communications.length) return <CustomerEmptyState label="Aucune communication" icon="bi-envelope" />;
  return (
    <div className="c3-list">
      {communications.map((c) => (
        <div className="c3-card c3-listitem" key={c.id}>
          <span className="c3-listitem__main"><strong>{c.subject || 'E-mail'}</strong><span className="c3-listitem__sub">{c.channel} · {c.status} · {fmtDate(c.sentAt)}</span></span>
        </div>
      ))}
    </div>
  );
}
export function NotificationSection({ notifications }: { notifications: CustomerNotification[] }) {
  if (!notifications.length) return <CustomerEmptyState label="Aucune notification" icon="bi-bell" />;
  return (
    <div className="c3-list">
      {notifications.map((n) => (
        <div className="c3-card c3-listitem" key={n.id}>
          <span className="c3-listitem__main"><strong>{n.title}</strong><span className="c3-listitem__sub">{n.category}</span></span>
        </div>
      ))}
    </div>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────────
export type C3Tab = 'activite' | 'details' | 'finances';
export function CustomerTabs({ value, onChange }: { value: C3Tab; onChange: (t: C3Tab) => void }) {
  const tabs: { key: C3Tab; label: string; icon: string }[] = [
    { key: 'activite', label: 'Activité', icon: 'bi-clock-history' },
    { key: 'details', label: 'Détails', icon: 'bi-grid-1x2' },
    { key: 'finances', label: 'Finances', icon: 'bi-cash-coin' },
  ];
  return (
    <div className="c3-tabs" role="tablist" data-testid="c3-tabs">
      {tabs.map((t) => (
        <button type="button" key={t.key} role="tab" aria-selected={value === t.key}
          className={`c3-tab${value === t.key ? ' c3-tab--active' : ''}`} onClick={() => onChange(t.key)}>
          <i className={t.icon} aria-hidden="true" /> {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Drawer (bottom-sheet mobile / panel desktop) ──────────────────────────────
export function CustomerDrawer({ open, title, onClose, children }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="c3-overlay" onClick={onClose} aria-hidden="true" />
      <div className="c3-drawer" role="dialog" aria-modal="true" aria-label={title} data-testid="c3-drawer">
        <div className="c3-drawer__head">
          <span className="c3-drawer__title">{title}</span>
          <button type="button" className="c3-iconbtn" aria-label="Fermer" onClick={onClose}><i className="bi-x-lg" aria-hidden="true" /></button>
        </div>
        <div className="c3-drawer__body">{children}</div>
      </div>
    </>
  );
}

// ── Carte recherche client (minimaliste) ─────────────────────────────────────
// Refonte : plus de palier VIP/Fidèle, pas d'emoji, pas d'animation d'entrée, pas de dégradé.
// La carte reste le CTA principal (ouvre la fiche 360) ; libellé « Ouvrir » explicite.
export function ClientSearchCard({ card, onOpen, variant = 'grid' }: {
  card: CustomerSearchCard; onOpen: (id: string) => void; variant?: 'grid' | 'list'; index?: number;
}) {
  return (
    <button
      type="button"
      className={`c3-card cm-card cm-card--${variant}`}
      onClick={() => onOpen(card.id)}
      data-testid="c3-clientcard"
    >
      <span className="cm-card__avatar" aria-hidden="true">
        {initials(card.firstName, card.lastName)}
        {card.bookingSuspended ? <span className="cm-card__avatar-dot cm-card__avatar-dot--suspended" /> : null}
      </span>

      <span className="cm-card__main">
        <span className="cm-card__head">
          <span className="cm-card__name">{card.displayName}</span>
          {card.bookingSuspended ? <span className="c3-badge c3-badge--suspended">Suspendu</span> : null}
        </span>
        {card.email ? <span className="cm-card__email">{card.email}</span> : null}

        <span className="cm-card__stats">
          <span className="cm-stat-pill">{card.salesCount} achat{card.salesCount > 1 ? 's' : ''}</span>
          <span className="cm-stat-pill cm-stat-pill--money">{money(card.totalSpent)}</span>
        </span>

        <span className="cm-card__foot">
          <span className="cm-card__foot-item">Vu {fmtDate(card.lastVisitAt)}</span>
          {card.nextBookingAt ? <span className="cm-card__foot-item cm-card__foot-item--next">Prochain RDV {fmtDateTime(card.nextBookingAt)}</span> : null}
        </span>
      </span>

      <span className="cm-card__cta">Ouvrir <i className="bi-chevron-right" aria-hidden="true" /></span>
    </button>
  );
}
