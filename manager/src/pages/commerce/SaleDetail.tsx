import * as React from 'react';
import {
  AlertTriangle, ArrowUpRight, CalendarDays, Check, Clock, Copy, CreditCard, FileText, Gift, GraduationCap, Hash,
  Landmark, Mail, MonitorPlay, Package, Percent, ReceiptText, RotateCcw, ShieldCheck, Sparkles, UserRound, Wallet,
} from 'lucide-react';
import { api, type SalePaymentDetails } from '@/lib/api';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusBadge, cents, type CommerceSale } from './CommerceShared';

/**
 * LA FICHE D'UNE VENTE — ce qu'on cherche en l'ouvrant, dans cet ordre :
 * qui, quoi, combien, et ce que Stripe a réellement encaissé (commission,
 * net versé). Une colonne sur téléphone, deux sur grand écran.
 */

const KIND: Record<string, { label: string; Icon: typeof Sparkles; tone: string }> = {
  SERVICE: { label: 'Prestation', Icon: Sparkles, tone: 'bg-rose-50 text-rose-600 ring-rose-100' },
  IN_PERSON_TRAINING: { label: 'Formation en présentiel', Icon: GraduationCap, tone: 'bg-violet-50 text-violet-600 ring-violet-100' },
  DISTANCE_TRAINING: { label: 'Formation en ligne', Icon: MonitorPlay, tone: 'bg-sky-50 text-sky-600 ring-sky-100' },
  GIFT_CARD: { label: 'Carte cadeau', Icon: Gift, tone: 'bg-amber-50 text-amber-600 ring-amber-100' },
  PRODUCT: { label: 'Produit', Icon: Package, tone: 'bg-slate-50 text-slate-600 ring-slate-100' },
};

const dateTime = (v?: string | null) => (v ? new Date(v).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) : '—');
const dateLong = (v?: string | null) => (v ? new Date(v).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '—');
const time = (v?: string | null) => (v ? new Date(v).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');

function buyerOf(sale: CommerceSale) {
  const c = typeof sale.customerId === 'object' && sale.customerId ? sale.customerId : null;
  return { name: [c?.firstName, c?.lastName].filter(Boolean).join(' '), email: c?.email || '' };
}

/** Le logo Stripe — mot-symbole sur fond violet, comme dans leurs propres reçus. */
export function StripeLogo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-md bg-[#635BFF] px-2 py-0.5 text-[13px] font-bold lowercase tracking-tight text-white ${className}`} aria-label="Stripe" data-testid="stripe-logo">
      stripe
    </span>
  );
}

function Section({ title, Icon, children, aside, testid }: { title: string; Icon: typeof Sparkles; children: React.ReactNode; aside?: React.ReactNode; testid?: string }) {
  return (
    <section className="min-w-0 rounded-2xl border bg-card p-4 shadow-sm sm:p-5" data-testid={testid}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
          <span className="truncate">{title}</span>
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value, strong = false, muted = false }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className={muted ? 'text-muted-foreground' : 'text-muted-foreground'}>{label}</span>
      <span className={`text-right tabular-nums ${strong ? 'text-base font-semibold' : 'font-medium'} ${muted ? 'text-muted-foreground' : ''}`}>{value}</span>
    </div>
  );
}

function CopyId({ label, value }: { label: string; value?: string | null }) {
  const [copied, setCopied] = React.useState(false);
  if (!value) return null;
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate font-mono text-xs">{value}</p>
      </div>
      <button type="button" aria-label={`Copier ${label}`} onClick={() => { void navigator.clipboard?.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md hover:bg-muted">
        {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** La commission de la plateforme sur cette vente (règle du contrat). */
function PlatformCommission({ sale }: { sale: CommerceSale }) {
  const c = sale.commission as (CommerceSale['commission'] & { capReached?: boolean; capped?: boolean }) | null | undefined;
  if (c?.capReached && !(c.amountCents > 0)) return <span className="text-amber-700" data-testid="sale-commission">Plafond atteint — non prélevée</span>;
  if (!c || !c.subject || c.amountCents <= 0) return <span className="text-rose-600" data-testid="sale-commission">Non assujetti</span>;
  const rate = Number(c.ratePercent).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  return <span data-testid="sale-commission">{cents(c.amountCents)} <span className="text-xs font-normal text-muted-foreground">({rate} % {c.basis}{c.capped ? ', écrêtée' : ''})</span></span>;
}

export function SaleDetail({ sale, onRefund }: { sale: CommerceSale; onRefund: () => void }) {
  const [payment, setPayment] = React.useState<SalePaymentDetails | null>(null);
  React.useEffect(() => {
    let alive = true;
    api.commerceSalePayment(sale._id).then((p) => { if (alive) setPayment(p); }).catch(() => { if (alive) setPayment({ available: false, reason: 'ERROR' }); });
    return () => { alive = false; };
  }, [sale._id]);

  const buyer = buyerOf(sale);
  const lines = sale.lines || [];
  const balanceDue = lines.reduce((s, l) => s + Number(l.balanceDueCents || 0), 0);
  const total = Number(sale.totalCents || 0);
  const card = Number(sale.stripeAmountCents || 0);
  const gift = Number(sale.giftCardAmountCents || 0);
  const grand = total + balanceDue;
  const refunds = [
    ...(sale.partialRefunds || []),
    ...(sale.refund?.amountCents ? [{ amountCents: sale.refund.amountCents, reason: sale.refund.reason, at: sale.refund.refundedAt }] : []),
  ];
  const refundedTotal = refunds.reduce((s, r) => s + Number(r.amountCents || 0), 0);
  const invoiceUrl = sale.invoiceUrl || payment?.invoiceUrl || '';
  const share = (v: number) => (grand > 0 ? `${Math.max(2, (v / grand) * 100)}%` : '0%');

  return (
    <div className="grid min-w-0 gap-4" data-testid="sale-detail">
      {/* En-tête : la commande en un coup d'œil */}
      <section className="relative min-w-0 overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-background/80 px-2.5 py-1 font-mono text-xs ring-1 ring-border"><Hash className="h-3.5 w-3.5" />{sale.saleNumber}</span>
              <StatusBadge>{sale.paymentStatus}</StatusBadge>
              {sale.checkoutSource === 'QUICK_BUY' && <span className="rounded-full bg-background/80 px-2.5 py-1 text-xs text-muted-foreground ring-1 ring-border">Achat direct</span>}
            </div>
            <p className="mt-3 text-3xl font-semibold tabular-nums sm:text-4xl" data-testid="sale-total">{cents(total)}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Clock className="h-4 w-4" />{dateTime(sale.createdAt)}</p>
          </div>
          <div className="flex min-w-0 items-center gap-3 rounded-xl bg-background/80 p-3 ring-1 ring-border md:max-w-xs">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"><UserRound className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="truncate font-semibold" data-testid="sale-buyer">{buyer.name || 'Cliente'}</p>
              {buyer.email && <a href={`mailto:${buyer.email}`} className="flex items-center gap-1 truncate text-sm text-muted-foreground hover:underline"><Mail className="h-3.5 w-3.5 shrink-0" />{buyer.email}</a>}
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
          {invoiceUrl && (
            <a href={invoiceUrl} target="_blank" rel="noreferrer" data-testid="sale-invoice-stripe"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#635BFF] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#5146f5]">
              <FileText className="h-4 w-4" /> Facture Stripe <ArrowUpRight className="h-4 w-4" />
            </a>
          )}
          {payment?.receiptUrl && (
            <a href={payment.receiptUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg border bg-background px-4 py-2.5 text-sm font-semibold hover:bg-muted">
              <ReceiptText className="h-4 w-4" /> Reçu de paiement
            </a>
          )}
          {payment?.dashboardUrl && (
            <a href={payment.dashboardUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg border bg-background px-4 py-2.5 text-sm font-semibold hover:bg-muted">
              Voir dans <StripeLogo />
            </a>
          )}
          <button type="button" onClick={onRefund} disabled={sale.paymentStatus === 'REFUNDED'} data-testid="sale-refund"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-background px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 sm:ml-auto">
            <RotateCcw className="h-4 w-4" /> Rembourser
          </button>
        </div>
      </section>

      {(sale.finalizeIssues?.length ?? 0) > 0 && (
        <div className="flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" data-testid="sale-issues">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">À traiter — survenu après l’encaissement</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">{sale.finalizeIssues!.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
          </div>
        </div>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-4">
          {/* Articles */}
          <Section title={`Articles (${lines.length})`} Icon={Package} testid="sale-lines">
            <ul className="grid gap-3">
              {lines.map((line, i) => {
                const k = KIND[line.productSnapshot?.kind || 'PRODUCT'] || KIND.PRODUCT;
                const options = (line.productSnapshot?.options || []).filter((o) => (line.optionKeys || []).includes(o.key));
                const refunded = (sale.partialRefunds || []).filter((r) => r.lineId && r.lineId === line._id).reduce((s, r) => s + Number(r.amountCents || 0), 0);
                return (
                  <li key={line._id || i} className="flex min-w-0 gap-3 rounded-xl border p-3" data-testid="sale-line">
                    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ring-1 ${k.tone}`}><k.Icon className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                        <div className="min-w-0">
                          <p className="break-words font-semibold leading-snug">{line.productSnapshot?.title || 'Article'}</p>
                          <p className="text-xs text-muted-foreground">{k.label}{(line.quantity || 1) > 1 ? ` · ${line.quantity} × ${cents(line.unitPriceCents)}` : ''}</p>
                        </div>
                        <p className="font-semibold tabular-nums">{cents(line.totalCents)}</p>
                      </div>
                      <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                        {line.bookingSnapshot?.startsAt && (
                          <p className="flex items-start gap-1.5"><CalendarDays className="mt-px h-3.5 w-3.5 shrink-0 text-primary" /><span className="first-letter:uppercase">{dateLong(line.bookingSnapshot.startsAt)} · {time(line.bookingSnapshot.startsAt)} – {time(line.bookingSnapshot.endsAt)}</span></p>
                        )}
                        {line.giftCardSnapshot?.recipientName && <p className="flex items-center gap-1.5"><Gift className="h-3.5 w-3.5 shrink-0 text-primary" />Pour {line.giftCardSnapshot.recipientName}{line.giftCardSnapshot.senderName ? `, de la part de ${line.giftCardSnapshot.senderName}` : ''}</p>}
                        {options.length > 0 && <p className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />Options : {options.map((o) => o.label).join(', ')}</p>}
                        {Number(line.balanceDueCents || 0) > 0 && <p className="flex items-center gap-1.5 font-medium text-foreground"><Wallet className="h-3.5 w-3.5 shrink-0 text-primary" />{cents(line.balanceDueCents)} à régler sur place</p>}
                        {refunded > 0 && <p className="flex items-center gap-1.5 font-medium text-sky-700"><RotateCcw className="h-3.5 w-3.5 shrink-0" />{cents(refunded)} remboursés</p>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>

          {/* Répartition du règlement */}
          <Section title="Règlement" Icon={Wallet} testid="sale-split">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
              {card > 0 && <span className="h-full bg-[#635BFF]" style={{ width: share(card) }} />}
              {gift > 0 && <span className="h-full bg-amber-400" style={{ width: share(gift) }} />}
              {balanceDue > 0 && <span className="h-full bg-slate-300" style={{ width: share(balanceDue) }} />}
            </div>
            <div className="mt-3 grid gap-1">
              <Row label={<span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#635BFF]" />Carte bancaire (en ligne)</span>} value={cents(card)} />
              {gift > 0 && <Row label={<span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" />Cartes cadeaux</span>} value={cents(gift)} />}
              {balanceDue > 0 && <Row label={<span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-slate-300" />À régler sur place</span>} value={cents(balanceDue)} />}
              <div className="mt-1 border-t pt-1"><Row label="Total de la commande" value={cents(grand)} strong /></div>
            </div>
            {(sale.giftCardAllocations || []).length > 0 && (
              <div className="mt-3 grid gap-2">
                {sale.giftCardAllocations!.map((a, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
                    <span className="flex min-w-0 items-center gap-2"><Gift className="h-4 w-4 shrink-0" /><span className="truncate font-mono text-xs">{a.codeMasked || 'Carte cadeau'}</span></span>
                    <strong className="tabular-nums">{cents(a.amountCents)}</strong>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {refunds.length > 0 && (
            <Section title="Remboursements" Icon={RotateCcw} aside={<span className="text-sm font-semibold tabular-nums text-sky-700">{cents(refundedTotal)}</span>} testid="sale-refunds">
              <ul className="grid gap-2">
                {refunds.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-950">
                    <span className="min-w-0 flex-1">{r.reason || 'Remboursement'}<span className="block text-xs opacity-70">{dateTime(r.at)}</span></span>
                    <strong className="tabular-nums">{cents(r.amountCents)}</strong>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="grid min-w-0 content-start gap-4">
          {/* Paiement Stripe */}
          <Section title="Paiement en ligne" Icon={CreditCard} aside={<StripeLogo />} testid="sale-stripe">
            {!payment ? (
              <div className="grid gap-2"><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-4/5" /><Skeleton className="h-5 w-3/5" /></div>
            ) : !payment.available ? (
              <p className="text-sm text-muted-foreground">
                {payment.reason === 'NO_CARD_PAYMENT' ? 'Aucun paiement par carte : commande réglée par carte cadeau ou sans paiement en ligne.' : 'Détails Stripe momentanément indisponibles.'}
              </p>
            ) : (
              <>
                {payment.card && (
                  <div className="mb-3 flex items-center gap-3 rounded-xl bg-gradient-to-br from-slate-900 to-slate-700 p-3 text-white">
                    <CreditCard className="h-6 w-6 shrink-0 opacity-80" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold capitalize">{payment.card.brand}{payment.card.wallet ? ` · ${payment.card.wallet.replace(/_/g, ' ')}` : ''}</p>
                      <p className="font-mono text-xs tracking-widest opacity-80">•••• {payment.card.last4}{payment.card.expMonth ? `   ${String(payment.card.expMonth).padStart(2, '0')}/${String(payment.card.expYear || '').slice(-2)}` : ''}</p>
                    </div>
                    {payment.mode !== 'PROD' && <span className="ml-auto rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-amber-950">TEST</span>}
                  </div>
                )}
                <Row label="Encaissé" value={cents(payment.amountCents)} />
                <Row label={<span className="flex items-center gap-1.5"><Percent className="h-3.5 w-3.5" />Commission Stripe</span>} value={payment.feeCents == null ? '—' : `− ${cents(payment.feeCents)}`} />
                {(payment.feeDetails || []).length > 1 && (
                  <ul className="mb-1 ml-5 grid gap-0.5 text-xs text-muted-foreground">
                    {payment.feeDetails!.map((f, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{f.description}</span><span className="tabular-nums">{cents(f.amountCents)}</span></li>)}
                  </ul>
                )}
                {Number(payment.refundedCents || 0) > 0 && <Row label="Remboursé" value={`− ${cents(payment.refundedCents)}`} />}
                <div className="mt-1 border-t pt-1">
                  <Row label={<span className="flex items-center gap-1.5 font-medium text-foreground"><Landmark className="h-3.5 w-3.5" />Net versé à l’institut</span>} value={<span data-testid="stripe-net">{payment.netCents == null ? '—' : cents(payment.netCents - Number(payment.refundedCents || 0))}</span>} strong />
                </div>
                {payment.feeCents != null && payment.amountCents ? (
                  <p className="mt-1 text-xs text-muted-foreground" data-testid="stripe-fee-rate">Soit {((payment.feeCents / payment.amountCents) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} % de frais Stripe sur ce paiement.</p>
                ) : null}
                {payment.availableOn && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" />Disponible sur le compte Stripe le {new Date(payment.availableOn).toLocaleDateString('fr-FR')}</p>}
              </>
            )}
          </Section>

          {/* Commission plateforme */}
          <Section title="Commission plateforme" Icon={ShieldCheck} testid="sale-platform-commission">
            <Row label="Sur cette vente" value={<PlatformCommission sale={sale} />} />
          </Section>

          {/* Références techniques */}
          <Section title="Références" Icon={Hash}>
            <div className="grid gap-2">
              <CopyId label="Paiement Stripe" value={sale.stripe?.paymentIntentId && sale.stripe.paymentIntentId !== 'gift_card_only' ? sale.stripe.paymentIntentId : ''} />
              <CopyId label="Session de paiement" value={sale.stripe?.checkoutSessionId} />
              <CopyId label="Facture Stripe" value={sale.stripe?.invoiceId} />
              {sale.siteUrl && <CopyId label="Site d’achat" value={sale.siteUrl.replace(/^https?:\/\//, '')} />}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

export default SaleDetail;
