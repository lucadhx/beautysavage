// RX2.3 — FinanceMovementDrawer premium : résumé + détail paiement + profit net + documents + actions
// (remboursement 1-clic, encaissement solde sur place). Le backend fait autorité (aucun calcul de montant).
// Tokens --bs-* via classes fin-md-*/fin-tl-*, zéro hex, mobile-first, ≥44px, footer sticky, reduced-motion.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type {
  FinanceTimelineItem, FinanceMovementDetail, FinanceBreakdownLine,
  FinancePaymentBreakdown, FinanceMovementAction, BalancePaymentMethod,
} from '@bs/api-client';
import { money } from './components';
import { FinanceMovementBadges } from './timeline';
import { useFinanceMovementDetail, useProcessRefund, useMarkBalancePaid } from './useFinance';
import './movementDrawer.css';

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtSigned(amount: number | null): string {
  if (amount === null || amount === undefined) return '—';
  const v = Number(amount);
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${money(Math.abs(v))}`;
}
function signedByDirection(direction: string, amount: number): string {
  if (direction === 'in') return `+${money(amount)}`;
  if (direction === 'out') return `−${money(amount)}`;
  return money(amount);
}
function fmtDateTime(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

// ── Lignes & cards ────────────────────────────────────────────────────────────────
export function FinanceBreakdownLine({ line }: { line: FinanceBreakdownLine }) {
  return (
    <div className="fin-md-line">
      <span className="fin-md-line__label">{line.label}</span>
      {line.amount === null ? (
        <span className="fin-md-line__pending">{line.note || 'en attente'}</span>
      ) : (
        <span className={`fin-md-line__amount fin-md-line__amount--${line.kind}`}>{fmtSigned(line.amount)}</span>
      )}
    </div>
  );
}

export function FinancePaymentBreakdownCard({ lines }: { lines: FinanceBreakdownLine[] }) {
  const rows = lines.filter((l) => l.kind !== 'net');
  if (!rows.length) return null;
  return (
    <div className="fin-md-card" data-testid="fin-md-breakdown">
      <span className="fin-md-card__title"><i className="bi-receipt" aria-hidden="true" /> Détail du paiement</span>
      {rows.map((l, i) => <FinanceBreakdownLine key={`${l.label}-${i}`} line={l} />)}
    </div>
  );
}

export function FinanceNetProfitCard({ breakdown }: { breakdown: FinancePaymentBreakdown }) {
  if (breakdown.netProfitStatus === 'not_applicable') return null;
  const partial = breakdown.netProfitStatus === 'partial';
  return (
    <div className="fin-md-card fin-md-net" data-testid="fin-md-net">
      <span className="fin-md-card__title"><i className="bi-graph-up-arrow" aria-hidden="true" /> Profit net estimé</span>
      <span className={`fin-md-net__value fin-md-net__value--${breakdown.netProfitStatus}`}>{fmtSigned(breakdown.netProfitAmount)}</span>
      {partial ? (
        <span className="fin-md-net__status fin-md-net__status--partial">
          <i className="bi-hourglass-split" aria-hidden="true" /> Données partielles — frais Stripe en attente de synchronisation
        </span>
      ) : (
        <span className="fin-md-net__status"><i className="bi-check2-circle" aria-hidden="true" /> Montant payé − frais Stripe − commission − remboursements</span>
      )}
    </div>
  );
}

export function FinanceDocumentLinks({ actions }: { actions: FinanceMovementAction[] }) {
  const docs = actions.filter((a) => a.kind === 'invoice_view' && a.enabled && a.url);
  if (!docs.length) return null;
  return (
    <div className="fin-md-card" data-testid="fin-md-docs">
      <span className="fin-md-card__title"><i className="bi-folder2-open" aria-hidden="true" /> Documents liés</span>
      <div className="fin-md-docs">
        {docs.map((a, i) => (
          <a key={i} className="fin-md-doclink" href={a.url as string} target="_blank" rel="noreferrer">
            <i className="bi-file-earmark-text" aria-hidden="true" /> Voir la facture
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Panneau remboursement 1-clic ─────────────────────────────────────────────────────
export function RefundProcessPanel({ item, onDone }: { item: FinanceTimelineItem; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<'accept' | 'refuse' | null>(null);
  const mutation = useProcessRefund();
  const refundId = item.source.id;

  if (mutation.isSuccess) {
    return (
      <div className="fin-md-panel" data-testid="fin-md-refund-success">
        <span className="fin-md-panel__success"><i className="bi-check2-circle" aria-hidden="true" /> Remboursement traité.</span>
      </div>
    );
  }
  return (
    <div className="fin-md-panel" data-testid="fin-md-refund-panel">
      <span className="fin-md-panel__title">Traiter le remboursement</span>
      <div className="fin-md-rows">
        <div className="fin-md-row"><span>Client</span><span>{item.customer?.name || '—'}</span></div>
        <div className="fin-md-row"><span>Montant demandé</span><span>{money(item.amount)}</span></div>
      </div>
      <div className="fin-md-field">
        <label htmlFor="fin-refund-reason">Motif (optionnel)</label>
        <textarea id="fin-refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </div>
      {pending ? (
        <>
          <span className="fin-md-panel__confirm">
            {pending === 'accept' ? 'Confirmer le remboursement ? Cette action est irréversible.' : 'Confirmer le refus de ce remboursement ?'}
          </span>
          {mutation.isError ? <span className="fin-md-panel__error">Échec — réessayez.</span> : null}
          <div className="fin-md-footer" style={{ position: 'static', borderTop: 'none', padding: 0 }}>
            <button type="button" className="fin-md-btn" disabled={mutation.isPending} onClick={() => setPending(null)}>Annuler</button>
            <button
              type="button"
              className={`fin-md-btn ${pending === 'accept' ? 'fin-md-btn--primary' : 'fin-md-btn--danger'}`}
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ refundId, decision: pending, reason: reason.trim() || undefined }, { onSuccess: onDone })}
            >
              {mutation.isPending ? '…' : pending === 'accept' ? 'Confirmer le remboursement' : 'Confirmer le refus'}
            </button>
          </div>
        </>
      ) : (
        <div className="fin-md-footer" style={{ position: 'static', borderTop: 'none', padding: 0 }}>
          <button type="button" className="fin-md-btn fin-md-btn--danger" onClick={() => setPending('refuse')}>Refuser</button>
          <button type="button" className="fin-md-btn fin-md-btn--primary" onClick={() => setPending('accept')}>Accepter</button>
        </div>
      )}
    </div>
  );
}

// ── Panneau encaissement solde sur place ─────────────────────────────────────────────
const METHODS: { key: BalancePaymentMethod; label: string }[] = [
  { key: 'card', label: 'CB sur place' }, { key: 'cash', label: 'Espèces' }, { key: 'other', label: 'Autre' },
];
export function BalanceCollectPanel({ item, onDone }: { item: FinanceTimelineItem; onDone: () => void }) {
  const [method, setMethod] = useState<BalancePaymentMethod>('card');
  const [confirming, setConfirming] = useState(false);
  const mutation = useMarkBalancePaid();
  const bookingId = item.source.id;

  if (mutation.isSuccess) {
    return (
      <div className="fin-md-panel" data-testid="fin-md-balance-success">
        <span className="fin-md-panel__success"><i className="bi-check2-circle" aria-hidden="true" /> Solde encaissé.</span>
      </div>
    );
  }
  // RX2.4 — wording adaptatif : prestation payée 100 % sur place vs solde d'acompte.
  const isFullOnSite = item.title.startsWith('Paiement sur place');
  return (
    <div className="fin-md-panel" data-testid="fin-md-balance-panel">
      <span className="fin-md-panel__title">{isFullOnSite ? 'Encaisser le paiement sur place' : 'Encaisser le solde'}</span>
      <div className="fin-md-rows">
        <div className="fin-md-row"><span>Prestation</span><span>{item.subtitle}</span></div>
        <div className="fin-md-row"><span>{isFullOnSite ? 'Montant à encaisser' : 'Solde restant'}</span><span>{money(item.amount)}</span></div>
      </div>
      <div className="fin-md-field">
        <label>Moyen de paiement</label>
        <div className="fin-md-methods" role="group" aria-label="Moyen de paiement">
          {METHODS.map((m) => (
            <button type="button" key={m.key} className={`fin-md-method${method === m.key ? ' fin-md-method--active' : ''}`}
              aria-pressed={method === m.key} onClick={() => setMethod(m.key)}>{m.label}</button>
          ))}
        </div>
      </div>
      {mutation.isError ? <span className="fin-md-panel__error">Échec — réessayez.</span> : null}
      <div className="fin-md-footer" style={{ position: 'static', borderTop: 'none', padding: 0 }}>
        {confirming ? (
          <>
            <button type="button" className="fin-md-btn" disabled={mutation.isPending} onClick={() => setConfirming(false)}>Annuler</button>
            <button type="button" className="fin-md-btn fin-md-btn--primary" disabled={mutation.isPending}
              onClick={() => mutation.mutate({ bookingId, paymentMethod: method }, { onSuccess: onDone })}>
              {mutation.isPending ? '…' : `Encaisser ${money(item.amount)}`}
            </button>
          </>
        ) : (
          <button type="button" className="fin-md-btn fin-md-btn--primary" onClick={() => setConfirming(true)}>Confirmer l'encaissement</button>
        )}
      </div>
    </div>
  );
}

// ── Footer d'action ────────────────────────────────────────────────────────────────
const FOOTER_KINDS = ['customer_view', 'invoice_view', 'refund_process', 'balance_collect', 'commission_view', 'gift_card_view'];
export function FinanceActionFooter({ actions, onRefund, onBalance }: {
  actions: FinanceMovementAction[]; onRefund: () => void; onBalance: () => void;
}) {
  const visible = actions.filter((a) => FOOTER_KINDS.includes(a.kind));
  if (!visible.length) return null;
  return (
    <div className="fin-md-footer" data-testid="fin-md-footer">
      {visible.map((a, i) => {
        if (a.kind === 'refund_process') {
          return <button key={i} type="button" className="fin-md-btn fin-md-btn--primary" disabled={!a.enabled} aria-disabled={!a.enabled} onClick={onRefund}>Traiter le remboursement</button>;
        }
        if (a.kind === 'balance_collect') {
          return <button key={i} type="button" className="fin-md-btn fin-md-btn--primary" disabled={!a.enabled} aria-disabled={!a.enabled} onClick={onBalance}>Encaisser sur place</button>;
        }
        if (a.kind === 'customer_view') {
          return a.enabled && a.to
            ? <Link key={i} className="fin-md-btn" to={a.to}>Voir le client</Link>
            : <button key={i} type="button" className="fin-md-btn" disabled aria-disabled="true">Voir le client</button>;
        }
        if (a.kind === 'commission_view') {
          return a.enabled && a.to
            ? <Link key={i} className="fin-md-btn fin-md-btn--primary" to={a.to}>Voir la commission</Link>
            : <button key={i} type="button" className="fin-md-btn" disabled aria-disabled="true">Voir la commission</button>;
        }
        if (a.kind === 'gift_card_view') {
          return a.enabled && a.to
            ? <Link key={i} className="fin-md-btn fin-md-btn--primary" to={a.to}>Voir la carte cadeau</Link>
            : <button key={i} type="button" className="fin-md-btn" disabled aria-disabled="true">Voir la carte cadeau</button>;
        }
        // invoice_view
        return a.enabled && a.url
          ? <a key={i} className="fin-md-btn" href={a.url} target="_blank" rel="noreferrer">Voir la facture</a>
          : <button key={i} type="button" className="fin-md-btn" disabled aria-disabled="true">Voir la facture</button>;
      })}
    </div>
  );
}

function FinanceDetailSkeleton(): ReactNode {
  return (
    <div className="fin-md-skeleton" aria-hidden="true" data-testid="fin-md-skeleton"><div /><div /><div /></div>
  );
}

// ── Drawer orchestrateur ──────────────────────────────────────────────────────────────
export function FinanceMovementDrawer({ item, onClose }: { item: FinanceTimelineItem | null; onClose: () => void }) {
  const [panel, setPanel] = useState<'none' | 'refund' | 'balance'>('none');
  const movementRef = item ? { sourceModel: item.source.model, sourceId: item.source.id, type: item.type } : null;
  const { data, isLoading } = useFinanceMovementDetail(movementRef);

  useEffect(() => { setPanel('none'); }, [item?.id]);
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;
  const detail = data as FinanceMovementDetail | undefined;
  const breakdown = detail?.paymentBreakdown;
  const lines = detail?.lines;
  const actions = item.actions || [];

  return (
    <>
      <div className="fin-tl-overlay" onClick={onClose} aria-hidden="true" />
      <div className="fin-tl-drawer" role="dialog" aria-modal="true" aria-label={item.title} data-testid="fin-tl-drawer">
        <div className="fin-tl-drawer__head">
          <span className="fin-tl-drawer__title">{item.title}</span>
          <button type="button" className="fin-tl-iconbtn" aria-label="Fermer" onClick={onClose}><i className="bi-x-lg" aria-hidden="true" /></button>
        </div>
        <div className="fin-md-body">
          <span className={`fin-md-amount fin-tl-amount--${item.direction}`}>{signedByDirection(item.direction, item.amount)}</span>
          <FinanceMovementBadges badges={item.badges} />
          <div className="fin-md-rows">
            <div className="fin-md-row"><span>Statut</span><span>{item.status}</span></div>
            <div className="fin-md-row"><span>Date</span><span>{fmtDateTime(item.occurredAt)}</span></div>
            {item.customer ? <div className="fin-md-row"><span>Client</span><span>{item.customer.name || '—'}</span></div> : null}
            <div className="fin-md-row"><span>Origine</span><span>{item.source.model} · {item.source.id}</span></div>
          </div>

          {isLoading ? <FinanceDetailSkeleton /> : null}
          {lines && lines.length ? <FinancePaymentBreakdownCard lines={lines} /> : null}
          {breakdown ? <FinanceNetProfitCard breakdown={breakdown} /> : null}
          <FinanceDocumentLinks actions={actions} />

          {panel === 'refund' ? <RefundProcessPanel item={item} onDone={() => { /* succès affiché ; refetch via invalidate */ }} /> : null}
          {panel === 'balance' ? <BalanceCollectPanel item={item} onDone={() => { /* succès affiché ; refetch via invalidate */ }} /> : null}
        </div>
        <FinanceActionFooter actions={actions} onRefund={() => setPanel('refund')} onBalance={() => setPanel('balance')} />
      </div>
    </>
  );
}
