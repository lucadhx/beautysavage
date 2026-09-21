import { LaunchFeeStatusBadge, SubscriptionStatusBadge } from '@/components/contracts/status';
import { formatCents, formatDateTime } from '@/lib/utils';
import type { Contract, PaymentDetail } from '@/types';

/**
 * État Stripe côté DEV — LECTURE SEULE, jamais un bouton.
 *
 * Le DEV n'a aucune action commerciale à mener : payer et souscrire
 * appartiennent au client, et le backend le refuserait de toute façon. Cette
 * vue sert au diagnostic (« où en est le paiement ? »), pas à agir — d'où sa
 * place dans la section repliée, à l'écart du parcours.
 */
export function DevStripeDetails({ contract, payments }: { contract: Contract; payments: PaymentDetail[] }) {
  const { launchFee, subscription } = contract.pricing;
  if (!launchFee.enabled && !subscription.enabled) return null;

  const fee = contract.stripe.launchFee;
  const sub = contract.stripe.subscription;
  const attempt = payments.find((x) => x.type === 'LAUNCH_FEE');

  return (
    <>
      {launchFee.enabled && (
        <div className="rounded-md border border-border p-3 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-medium">Frais de lancement (Stripe)</p>
            <LaunchFeeStatusBadge status={fee.status} />
          </div>
          <Row label="Montant TTC" value={formatCents(launchFee.amountIncludingTax)} />
          {fee.paidAt && <Row label="Payé le" value={formatDateTime(fee.paidAt)} />}
          {fee.lastError && <Row label="Dernière erreur" value={fee.lastError} tone="error" mono />}
          {attempt ? (
            <div className="mt-2 space-y-1 rounded-md border border-border p-3 text-xs">
              <Row label="Mode Stripe" value={attempt.providerMode} />
              <Row label="Tentative n°" value={String(attempt.attempt)} />
              {attempt.checkoutSessionId && <Row label="Session" value={attempt.checkoutSessionId} mono />}
              {attempt.paymentIntentId && <Row label="PaymentIntent" value={attempt.paymentIntentId} mono />}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Aucune tentative de paiement.</p>
          )}
        </div>
      )}

      {subscription.enabled && (
        <div className="rounded-md border border-border p-3 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-medium">Abonnement (Stripe)</p>
            <SubscriptionStatusBadge status={sub.status} />
          </div>
          <Row label="Montant TTC / mois" value={formatCents(subscription.amountIncludingTax)} />
          {sub.currentPeriodEnd && (
            <Row
              label="Période en cours"
              value={`${sub.currentPeriodStart ? `${formatDateTime(sub.currentPeriodStart)} → ` : ''}${formatDateTime(sub.currentPeriodEnd)}`}
            />
          )}
          {sub.cancelAtPeriodEnd && <Row label="Résiliation" value="Programmée en fin de période" tone="warn" />}
          {sub.endedAt && <Row label="Terminé le" value={formatDateTime(sub.endedAt)} />}
          {sub.lastError?.message && <Row label="Dernière erreur" value={sub.lastError.message} tone="error" />}
          <div className="mt-2 space-y-1 rounded-md border border-border p-3 text-xs">
            {sub.subscriptionId && <Row label="Subscription" value={sub.subscriptionId} mono />}
            {sub.priceId && <Row label="Price (immuable)" value={sub.priceId} mono />}
            {sub.latestInvoiceId && <Row label="Dernière facture" value={sub.latestInvoiceId} mono />}
          </div>
        </div>
      )}
    </>
  );
}

function Row({
  label, value, mono, tone,
}: { label: string; value: string; mono?: boolean; tone?: 'error' | 'warn' }) {
  return (
    <div className={`flex justify-between gap-3 ${tone === 'error' ? 'text-red-600' : tone === 'warn' ? 'text-orange-600' : ''}`}>
      <span className={tone ? '' : 'text-muted-foreground'}>{label}</span>
      <span className={`text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
