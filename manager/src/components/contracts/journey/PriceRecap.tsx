import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/utils';
import { deriveSubscriptionCost } from '@/lib/subscriptionPricing';
import type { PricingLine } from '@/types';

/**
 * Récapitulatif d'un montant — HT, TVA, TTC.
 *
 * Le TTC est mis en avant : c'est le seul chiffre que l'utilisateur va
 * réellement payer, les autres l'expliquent.
 */
export function PriceRecap({
  title,
  line,
  highlight = false,
  className,
}: {
  title: string;
  line: PricingLine;
  /** L'étape en cours porte SUR ce montant : on l'accentue. */
  highlight?: boolean;
  className?: string;
}) {
  if (!line.enabled) return null;
  /**
   * Une ligne d'abonnement se reconnaît à sa RÉCURRENCE ; des frais de mise en
   * service n'en portent pas. C'est ce qui distingue « / échéance » d'un
   * paiement unique, sans que l'appelant ait à le déclarer.
   */
  const abonnement = Boolean(line.recurrence || line.interval);
  const cout = deriveSubscriptionCost(line);
  return (
    <div
      className={cn(
        'rounded-lg border p-4 text-sm',
        highlight ? 'border-primary/40 bg-primary/5' : 'border-border bg-card',
        className
      )}
    >
      <p className="font-semibold">{title}</p>
      <dl className="mt-2 space-y-1">
        <div className="flex justify-between text-muted-foreground">
          <dt>Montant HT</dt>
          <dd className="tabular-nums">{formatCents(line.amountExcludingTax)}</dd>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <dt>TVA ({line.taxRate}%)</dt>
          <dd className="tabular-nums">{formatCents(line.taxAmount)}</dd>
        </div>
        <div className="mt-1.5 flex justify-between border-t border-border pt-1.5 text-base font-bold">
          <dt>Total TTC</dt>
          <dd className="tabular-nums">
            {formatCents(line.amountIncludingTax)}
            {abonnement ? (
              <span className="text-sm font-medium text-muted-foreground"> / échéance</span>
            ) : null}
          </dd>
        </div>
        {/*
          « / an » et « / mois » disaient une fréquence que la ligne ne portait
          pas toujours : sur un contrat trimestriel, ils annonçaient un prix
          mensuel pour un montant de trimestre. Le montant est celui d'UNE
          échéance ; la fréquence se dit à part, en toutes lettres.
        */}
        {abonnement && cout.monthsPerCycle > 1 && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {cout.recurrenceLabel} — facturé en une seule fois, équivalent informatif de{' '}
            {formatCents(cout.monthlyEquivalent.includingTax)} TTC/mois.
          </p>
        )}
      </dl>
    </div>
  );
}
