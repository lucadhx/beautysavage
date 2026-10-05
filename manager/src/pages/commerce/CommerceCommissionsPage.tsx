import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, CreditCard, ExternalLink, FileText, Loader2, Percent, RefreshCw, X } from 'lucide-react';
import { api, type CommissionSummary } from '@/lib/api';
import { pct } from '@/lib/commissionMath';
import { cn } from '@/lib/utils';
import { CardsSkeleton, TableSkeleton } from '@/components/ui/Skeleton';
import {
  CommercePageFrame,
  Metric,
  Panel,
  cents,
  dateShort,
  type CommerceCommission,
} from './CommerceShared';

const POLL_EVERY_MS = 2000;
const POLL_FOR_MS = 90_000;

const monthLabel = (c: CommerceCommission) => {
  const start = c.periodStart ? new Date(c.periodStart) : c.periodKey ? new Date(`${c.periodKey}-01T12:00:00Z`) : null;
  if (!start) return c.label;
  const text = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(start);
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const nextMonthFirst = (c: CommerceCommission) => {
  if (!c.periodEnd) return '';
  const d = new Date(new Date(c.periodEnd).getTime() + 1000);
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(d);
};

const ruleText = (c: CommerceCommission) => {
  const rate = c.ratePercent ?? (c.rateBps ? c.rateBps / 100 : null);
  if (rate === null || rate === undefined) return '';
  const type = c.rateType || 'HT';
  const vat = c.vatRate ?? null;
  const ht = type === 'TTC' && vat != null ? ` (${pct(rate / (1 + vat / 100), 4)} HT)` : '';
  return `${pct(rate)} ${type}${ht} · assiette ${c.basis || 'TTC'}`;
};

/** HT / TVA / TTC d'un mois (anciens mois sans TVA enregistrée : le HT seul). */
const totals = (c: CommerceCommission) => {
  const ht = Number(c.amountCents || 0);
  const vat = Number(c.vatCents || 0);
  return { ht, vat, ttc: Number(c.amountTtcCents || 0) || ht + vat };
};

/** L'écran de vérification au retour de Stripe — le paiement n'est « payé » qu'une fois ENREGISTRÉ. */
type Check = { id: string; state: 'CHECKING' | 'PAID' | 'SLOW' | 'ERROR' | 'CANCELLED' | 'PROCESSING'; commission?: CommerceCommission; error?: string };

export default function CommerceCommissionsPage() {
  const [params, setParams] = useSearchParams();
  const [commissions, setCommissions] = React.useState<CommerceCommission[]>([]);
  const [message, setMessage] = React.useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [opening, setOpening] = React.useState<string | null>(null);
  const [check, setCheck] = React.useState<Check | null>(null);
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const [recalculating, setRecalculating] = React.useState(false);

  const [summary, setSummary] = React.useState<Awaited<ReturnType<typeof api.commissionSummary>> | null>(null);
  const refresh = React.useCallback(() => api.commerceCommissions()
    .then((list) => { setCommissions(list as CommerceCommission[]); api.commissionSummary().then(setSummary).catch(() => null); })
    .catch((err) => setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Chargement impossible' }))
    .finally(() => setLoaded(true)), []);

  React.useEffect(() => { void refresh(); }, [refresh]);

  /**
   * RETOUR DE STRIPE — on interroge le serveur (qui relit la session auprès de
   * Stripe) jusqu'à ce que le paiement soit ENREGISTRÉ. Le webhook et le
   * rattrapage automatique font la même chose de leur côté : le premier qui
   * constate le paiement l'enregistre, les autres le retrouvent.
   */
  React.useEffect(() => {
    const id = params.get('commission');
    const outcome = params.get('paiement');
    const fromMail: Record<string, { tone: 'error' | 'info'; text: string }> = {
      'deja-payee': { tone: 'info', text: 'Ces commissions sont déjà payées : la facture est disponible ci-dessous.' },
      'lien-invalide': { tone: 'error', text: 'Ce lien de paiement n’est pas reconnu. Utilisez le bouton « Payer » du mois concerné ci-dessous.' },
      indisponible: { tone: 'error', text: 'Le paiement n’a pas pu s’ouvrir pour le moment. Réessayez avec le bouton « Payer » ci-dessous.' },
    };
    if (outcome && fromMail[outcome]) {
      setMessage(fromMail[outcome]);
      setParams((p) => { p.delete('commission'); p.delete('paiement'); return p; }, { replace: true });
      return;
    }
    if (!id || !outcome) return;
    setParams((p) => { p.delete('commission'); p.delete('paiement'); return p; }, { replace: true });
    if (outcome === 'annule') {
      setCheck({ id, state: 'CANCELLED' });
      void api.syncCommissionPayment(id).catch(() => null).finally(() => void refresh());
      return;
    }
    let stopped = false;
    const started = Date.now();
    setCheck({ id, state: 'CHECKING' });
    const tick = async () => {
      if (stopped) return;
      try {
        const c = await api.syncCommissionPayment(id) as CommerceCommission;
        if (c.status !== 'PAID' && c.checkout?.processing) {
          // Prélèvement bancaire : la banque confirme plus tard, le paiement sera enregistré automatiquement.
          setCheck({ id, state: 'PROCESSING', commission: c });
          void refresh();
          return;
        }
        if (c.status === 'PAID' && (c.invoiceUrl || Date.now() - started > 20_000)) {
          setCheck({ id, state: 'PAID', commission: c });
          void refresh();
          return;
        }
      } catch (err) {
        if (Date.now() - started > POLL_FOR_MS) {
          setCheck({ id, state: 'ERROR', error: err instanceof Error ? err.message : 'Vérification impossible' });
          return;
        }
      }
      if (Date.now() - started > POLL_FOR_MS) { setCheck({ id, state: 'SLOW' }); void refresh(); return; }
      setTimeout(tick, POLL_EVERY_MS);
    };
    void tick();
    return () => { stopped = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Une commission « en paiement » se vérifie seule pendant qu'on regarde la page. */
  const pendingIds = commissions.filter((c) => c.status === 'PAYMENT_PENDING' || (c.status === 'PAID' && !c.invoiceUrl)).map((c) => c._id).join(',');
  React.useEffect(() => {
    if (!pendingIds || check?.state === 'CHECKING') return;
    const timer = setInterval(() => {
      void Promise.all(pendingIds.split(',').map((id) => api.syncCommissionPayment(id).catch(() => null))).then(() => refresh());
    }, 15_000);
    return () => clearInterval(timer);
  }, [pendingIds, check?.state, refresh]);

  async function pay(c: CommerceCommission) {
    setOpening(c._id);
    setMessage(null);
    try {
      const { url } = await api.openCommissionCheckout(c._id);
      if (!/^https:\/\//.test(url)) throw new Error('Lien de paiement invalide');
      window.location.assign(url);
    } catch (err) {
      setOpening(null);
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Ouverture du paiement impossible' });
    }
  }

  async function recalculate() {
    setRecalculating(true);
    try {
      await api.recalculateCommerceCommissions();
      setMessage({ tone: 'info', text: 'Commissions recalculées avec la règle du contrat (taux, HT/TTC, TVA) : les mois payés ou en paiement ne bougent pas.' });
      await refresh();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Recalcul impossible' });
    } finally {
      setRecalculating(false);
    }
  }

  const toPay = commissions.filter((c) => c.status !== 'PAID' && c.payable);
  const toPayAmount = toPay.reduce((sum, c) => sum + (c.amountCents || 0), 0);
  const toPayTtc = toPay.reduce((sum, c) => sum + totals(c).ttc, 0);
  const current = commissions.find((c) => c.status === 'DUE' && !c.payable);

  return (
    <CommercePageFrame
      title="Commissions"
      description="Les commissions dues à la plateforme, mois par mois. Un mois terminé se paie par carte, et sa facture est émise automatiquement."
      actions={
        <button onClick={recalculate} disabled={recalculating} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold disabled:opacity-60">
          <RefreshCw className={cn('h-4 w-4', recalculating && 'animate-spin')} /> Recalculer
        </button>
      }
    >
      {message && (
        <p className={cn('flex items-start gap-2 rounded-md border p-3 text-sm', message.tone === 'error' ? 'border-rose-300 bg-rose-50 text-rose-800' : 'text-muted-foreground')} data-testid="commission-message">
          {message.tone === 'error' && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          {message.text}
        </p>
      )}
      {summary?.rule && <RuleBanner summary={summary} />}
      {summary && <CapGauge summary={summary} />}
      {!loaded ? <CardsSkeleton count={3} /> : (
        <div className="grid gap-4 md:grid-cols-3">
          <Metric label="Mois à payer" value={toPay.length} detail="Mois terminés non réglés" />
          <Metric label="Montant à payer (TTC)" value={cents(toPayTtc)} detail={`${cents(toPayAmount)} HT + ${cents(toPayTtc - toPayAmount)} de TVA`} />
          <Metric label="Mois en cours (TTC)" value={cents(current ? totals(current).ttc : 0)} detail={current ? `${cents(current.amountCents)} HT · payable à partir du ${nextMonthFirst(current)}` : 'Aucune vente assujettie ce mois-ci'} />
        </div>
      )}
      <Panel title="Mois par mois">
        {!loaded ? <TableSkeleton rows={5} cols={4} /> : commissions.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucune commission pour le moment.</p>
        ) : (
          <ul className="grid gap-3" data-testid="commission-list">
            {commissions.map((c) => {
              const lines = c.sourceSnapshot?.lines ?? [];
              const expanded = Boolean(open[c._id]);
              return (
                <li key={c._id} className="rounded-xl border bg-card" data-testid="commission-row" data-status={c.status}>
                  <div className="flex flex-wrap items-center gap-3 p-4">
                    <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{monthLabel(c)}</span>
                        <CommissionBadge c={c} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {lines.length} vente{lines.length > 1 ? 's' : ''} · base {cents(c.basisCents)}{ruleText(c) ? ` · ${ruleText(c)}` : ''}
                        {c.status === 'PAID' && c.paidAt ? ` · payée le ${dateShort(c.paidAt)}` : ''}
                      </p>
                    </div>
                    <div className="flex-1 sm:flex-none sm:text-right" data-testid="commission-amounts">
                      <div className="text-lg font-semibold tabular-nums">{cents(totals(c).ttc)} <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">TTC</span></div>
                      <div className="text-xs tabular-nums text-muted-foreground">{cents(totals(c).ht)} HT · TVA {cents(totals(c).vat)}{c.vatRate != null ? ` (${pct(c.vatRate)})` : ''}</div>
                    </div>
                    <div className="flex w-full justify-end sm:w-auto">
                      <CommissionAction c={c} opening={opening === c._id} disabled={Boolean(opening)} onPay={() => pay(c)} />
                    </div>
                  </div>
                  {lines.length > 0 && (
                    <>
                      <button type="button" onClick={() => setOpen((o) => ({ ...o, [c._id]: !expanded }))}
                        className="flex w-full items-center gap-2 border-t px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/30" aria-expanded={expanded}>
                        <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} /> Détail par vente
                      </button>
                      <AnimatePresence initial={false}>
                        {expanded && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                            <div className="overflow-x-auto">
                            <table className="w-full min-w-[20rem] text-sm" data-testid="commission-lines">
                              <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                <tr className="border-t">
                                  <th className="px-4 py-2 text-left font-medium">Vente</th>
                                  <th className="hidden px-4 py-2 text-left font-medium sm:table-cell">Règle</th>
                                  <th className="px-4 py-2 text-right font-medium">HT</th>
                                  <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">TVA</th>
                                  <th className="px-4 py-2 text-right font-medium">TTC</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.map((line) => {
                                  const ht = Number(line.amountCents || 0);
                                  const vat = Number(line.vatCents ?? (line.vatRate != null ? Math.round(ht * line.vatRate / 100) : 0));
                                  return (
                                    <tr key={line.saleId || line.saleNumber} className="border-t">
                                      <td className="px-4 py-2 font-mono text-xs">{line.saleNumber}{line.capped ? <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">écrêtée</span> : null}
                                        <div className="font-sans text-[11px] text-muted-foreground sm:hidden">{pct(line.ratePercent || 0)} {line.rateType || 'HT'} de {cents(line.basisCents)}</div></td>
                                      <td className="hidden px-4 py-2 text-xs text-muted-foreground sm:table-cell">{pct(line.ratePercent || 0)} {line.rateType || 'HT'}{line.rateType === 'TTC' && line.rateHtPercent ? ` (${pct(line.rateHtPercent, 4)} HT)` : ''} de {cents(line.basisCents)} {line.basis}</td>
                                      <td className="px-4 py-2 text-right tabular-nums">{cents(ht)}</td>
                                      <td className="hidden px-4 py-2 text-right tabular-nums text-muted-foreground sm:table-cell">{cents(vat)}</td>
                                      <td className="px-4 py-2 text-right font-medium tabular-nums">{cents(Number(line.amountTtcCents || 0) || ht + vat)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <AnimatePresence>
        {(opening || check) && (
          <PaymentOverlay
            opening={Boolean(opening)}
            check={check}
            onClose={() => { setCheck(null); void refresh(); }}
          />
        )}
      </AnimatePresence>
    </CommercePageFrame>
  );
}

/** Le statut d'un mois, en clair : le mois en cours n'est pas « à payer ». */
function CommissionBadge({ c }: { c: CommerceCommission }) {
  const [label, tone] = c.status === 'PAID' ? ['Payée', 'border-emerald-300 bg-emerald-100 text-emerald-900']
    : c.status === 'PAYMENT_PENDING' ? ['Paiement en cours', 'border-amber-300 bg-amber-100 text-amber-900']
    : c.status === 'CANCELLED' ? ['Annulée', 'border-red-300 bg-red-100 text-red-900']
    : c.payable ? ['À payer', 'border-blue-300 bg-blue-100 text-blue-900']
    : ['En cours', 'border-slate-300 bg-slate-100 text-slate-700'];
  return <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-xs font-medium', tone)} data-testid="commission-badge">{label}</span>;
}

/** La règle du contrat, en clair : taux HT/TTC, équivalent, TVA, assiette. */
function RuleBanner({ summary }: { summary: CommissionSummary }) {
  const r = summary.rule!;
  const type = r.rateType || 'HT';
  const vat = r.vatRate ?? summary.vatRate ?? 20;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3 text-sm" data-testid="commission-rule">
      <span className="flex items-center gap-2 font-semibold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"><Percent className="h-4 w-4" /></span>{pct(r.ratePercent)} {type}</span>
      <span className="text-muted-foreground">= {pct(type === 'TTC' ? (r.rateHtPercent ?? r.ratePercent / (1 + vat / 100)) : (r.rateTtcPercent ?? r.ratePercent * (1 + vat / 100)), 4)} {type === 'TTC' ? 'HT' : 'TTC'}</span>
      <span className="text-muted-foreground">TVA sur commission {pct(vat)}</span>
      <span className="text-muted-foreground">Assiette : prix {r.basis}</span>
      {r.source === 'DEFAULT' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Règle par défaut</span>}
    </div>
  );
}

/**
 * LE COMPTEUR DU PLAFOND — le total prélevé au centre d'un anneau qui se
 * remplit jusqu'au plafond du contrat, dans l'unité où il a été saisi (HT
 * ou TTC) ; en petit, l'autre unité et ce qu'il reste à payer.
 */
function CapGauge({ summary }: { summary: CommissionSummary }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const ratio = summary.capCents ? Math.min(1, summary.totalCents / summary.capCents) : 0;
  const tone = summary.capReached ? '#d97706' : '#2563eb';
  const ttcUnit = summary.capType === 'TTC';
  const vat = summary.vatRate ?? 20;
  const total = ttcUnit ? (summary.totalTtcCents ?? summary.totalCents) : summary.totalCents;
  const cap = ttcUnit ? (summary.capTtcCents ?? summary.capCents) : summary.capCents;
  const left = summary.capLeftCents == null ? null : ttcUnit ? Math.round(summary.capLeftCents * (1 + vat / 100)) : summary.capLeftCents;
  const unit = ttcUnit ? 'TTC' : 'HT';
  return (
    <div className="flex flex-col items-center gap-5 rounded-xl border bg-card p-5 sm:flex-row" data-testid="commission-cap">
      <div className="relative h-36 w-36 shrink-0">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="60" cy="60" r={R} fill="none" stroke="currentColor" strokeWidth="10" className="text-muted/60" />
          {summary.capCents && (
            <motion.circle cx="60" cy="60" r={R} fill="none" stroke={tone} strokeWidth="10" strokeLinecap="round"
              strokeDasharray={C} initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - ratio) }}
              transition={{ duration: 1.2, ease: 'easeOut' }} />
          )}
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }} className="text-lg font-semibold tabular-nums" data-testid="cap-total">
            {cents(total)}
          </motion.span>
          <span className="text-[11px] text-muted-foreground">{cap ? `sur ${cents(cap)} ${unit}` : `${unit} · sans plafond`}</span>
        </div>
      </div>
      <div className="grid gap-1 text-center sm:text-left">
        <p className="font-semibold">Commissions prélevées au total</p>
        <p className="text-sm text-muted-foreground" data-testid="cap-both">{cents(summary.totalCents)} HT · {cents(summary.totalTtcCents ?? summary.totalCents)} TTC</p>
        <p className="text-sm text-muted-foreground" data-testid="cap-remaining">Reste à payer : <span className="font-semibold text-foreground">{cents(summary.remainingToPayTtcCents ?? summary.remainingToPayCents)} TTC</span> ({cents(summary.remainingToPayCents)} HT) · déjà payé {cents(summary.paidTtcCents ?? summary.paidCents)} TTC</p>
        {summary.capCents && !summary.capReached && (
          <p className="text-xs text-muted-foreground">Encore {cents(left)} {unit} avant le plafond ({Math.round(ratio * 100)} %).</p>
        )}
        {summary.capReached && (
          <p className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="cap-reached">
            Plafond atteint : plus aucune commission n’est prélevée sur les ventes. Les mois déjà enregistrés restent à régler.
          </p>
        )}
      </div>
    </div>
  );
}

function CommissionAction({ c, opening, disabled, onPay }: { c: CommerceCommission; opening: boolean; disabled: boolean; onPay: () => void }) {
  if (c.status === 'PAID') {
    return c.invoiceUrl ? (
      <a href={c.invoiceUrl} target="_blank" rel="noopener noreferrer" data-testid="commission-invoice"
        className="inline-flex h-10 items-center gap-2 rounded-lg border-2 border-emerald-600 px-4 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50">
        <FileText className="h-4 w-4" /> Voir la facture <ExternalLink className="h-3.5 w-3.5" />
      </a>
    ) : (
      <span className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm text-muted-foreground" data-testid="commission-invoice-pending">
        <Loader2 className="h-4 w-4 animate-spin" /> Facture en cours d’émission
      </span>
    );
  }
  if (c.status === 'PAYMENT_PENDING' && c.checkout?.processing) {
    return (
      <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 text-sm text-blue-800" data-testid="commission-processing">
        <Clock className="h-4 w-4" /> Prélèvement en traitement
      </span>
    );
  }
  if (!c.payable) {
    return (
      <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-dashed px-4 text-sm text-muted-foreground" title="Seuls les mois terminés se paient" data-testid="commission-current">
        <Clock className="h-4 w-4" /> Mois en cours
      </span>
    );
  }
  return (
    <button type="button" onClick={onPay} disabled={disabled} data-testid="commission-pay"
      className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60">
      {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
      {c.status === 'PAYMENT_PENDING' ? 'Reprendre le paiement' : 'Payer'}
    </button>
  );
}

function PaymentOverlay({ opening, check, onClose }: { opening: boolean; check: Check | null; onClose: () => void }) {
  const state = opening ? 'OPENING' : check?.state;
  const busy = state === 'OPENING' || state === 'CHECKING';
  return (
    <motion.div className="fixed inset-0 z-[80] grid place-items-center bg-black/50 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      role="dialog" aria-modal="true" aria-live="polite" data-testid="commission-overlay" data-state={state}>
      <motion.div className="relative w-full max-w-sm rounded-2xl bg-card p-6 text-center shadow-2xl" initial={{ scale: 0.92, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}>
        {!busy && (
          <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Fermer"><X className="h-4 w-4" /></button>
        )}
        {busy && (
          <>
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-blue-600" />
            <p className="mt-4 text-lg font-semibold">{state === 'OPENING' ? 'Ouverture du paiement sécurisé…' : 'Vérification du paiement…'}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {state === 'OPENING' ? 'Vous allez être redirigé vers Stripe.' : 'Nous confirmons le paiement auprès de Stripe. Ne fermez pas la page.'}
            </p>
          </>
        )}
        {state === 'PAID' && (
          <>
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 18 }}>
              <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" />
            </motion.div>
            <p className="mt-4 text-lg font-semibold">Paiement enregistré</p>
            <p className="mt-1 text-sm text-muted-foreground">Les commissions de {check?.commission ? monthLabel(check.commission) : 'ce mois'} sont réglées.</p>
            {check?.commission?.invoiceUrl ? (
              <a href={check.commission.invoiceUrl} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 font-semibold text-white hover:bg-emerald-700">
                <FileText className="h-4 w-4" /> Voir la facture
              </a>
            ) : (
              <p className="mt-4 text-xs text-muted-foreground">La facture est en cours d’émission ; elle apparaîtra dans la liste.</p>
            )}
          </>
        )}
        {state === 'PROCESSING' && (
          <>
            <Clock className="mx-auto h-12 w-12 text-blue-600" />
            <p className="mt-4 text-lg font-semibold">Paiement en cours de traitement</p>
            <p className="mt-1 text-sm text-muted-foreground">Votre banque confirme ce type de paiement (prélèvement) sous quelques jours. Il sera enregistré automatiquement : inutile de payer à nouveau.</p>
          </>
        )}
        {state === 'SLOW' && (
          <>
            <Clock className="mx-auto h-12 w-12 text-amber-500" />
            <p className="mt-4 text-lg font-semibold">Confirmation en attente</p>
            <p className="mt-1 text-sm text-muted-foreground">Stripe n’a pas encore confirmé le paiement. Il sera enregistré automatiquement dès sa confirmation : inutile de payer à nouveau.</p>
          </>
        )}
        {state === 'CANCELLED' && (
          <>
            <X className="mx-auto h-12 w-12 text-muted-foreground" />
            <p className="mt-4 text-lg font-semibold">Paiement annulé</p>
            <p className="mt-1 text-sm text-muted-foreground">Aucun montant n’a été prélevé. Vous pouvez reprendre le paiement quand vous voulez.</p>
          </>
        )}
        {state === 'ERROR' && (
          <>
            <AlertTriangle className="mx-auto h-12 w-12 text-rose-600" />
            <p className="mt-4 text-lg font-semibold">Vérification impossible</p>
            <p className="mt-1 text-sm text-muted-foreground">{check?.error} — si vous avez payé, le paiement sera enregistré automatiquement.</p>
          </>
        )}
        {!busy && (
          <button type="button" onClick={onClose} className="mt-5 h-10 w-full rounded-lg border text-sm font-semibold hover:bg-muted/40" data-testid="commission-overlay-close">Fermer</button>
        )}
      </motion.div>
    </motion.div>
  );
}
