import { RotateCw } from 'lucide-react';
import { formatCents } from '@/lib/utils';
import { deriveSubscriptionCost, type SubscriptionLine } from '@/lib/subscriptionPricing';

/**
 * CE QUE COÛTE L'ABONNEMENT — sans jamais laisser croire à un prélèvement
 * mensuel quand il est annuel.
 *
 * La mise en avant est TOUJOURS l'équivalent mensuel : c'est le repère avec
 * lequel on compare deux offres, et celui que le client a en tête. Mais la
 * somme réellement débitée est dite juste en dessous, en toutes lettres — un
 * abonnement annuel prélève douze mois d'un coup, et l'écrire petit ne suffit
 * pas à le rendre honnête.
 *
 * Aucun montant n'est écrit en dur : tout vient du contrat, via un calcul pur
 * en centimes entiers.
 */
export function SubscriptionCostCard({
  line,
  variant = 'preview',
  className = '',
}: {
  line: SubscriptionLine | null | undefined;
  /** `preview` : configuration DEV. `due` : échéance à régler par l'ADMIN. */
  variant?: 'preview' | 'due';
  className?: string;
}) {
  const cost = deriveSubscriptionCost(line);

  if (!cost.applicable) {
    return (
      <div className={`rounded-xl border border-border p-4 text-sm text-muted-foreground ${className}`}>
        Aucun abonnement — ce contrat ne comporte pas de facturation récurrente.
      </div>
    );
  }

  const { perCharge, monthlyEquivalent, yearly, paidUpfront, recurrenceLabel } = cost;
  // « pour l'année » ne vaut que pour un annuel ; la phrase se dit avec la
  // récurrence réelle : « pour la période », « tous les 3 mois ».
  const periode = recurrenceLabel.toLowerCase();

  return (
    <div className={`overflow-hidden rounded-xl border border-border ${className}`}>
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <RotateCw className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Abonnement</span>
        {/* La périodicité, dite en toutes lettres. « Annuel / Mensuel » ne
            savait nommer que deux offres et aurait rangé un trimestriel dans
            la mauvaise case. */}
        <span className="ml-auto text-xs text-muted-foreground">{recurrenceLabel}</span>
      </div>

      <div className="space-y-3 p-4">
        {/* L'ancre visuelle : l'équivalent mensuel, quelle que soit la
            fréquence. C'est le repère de comparaison. */}
        <div>
          <p className="flex flex-wrap items-baseline gap-1.5">
            <span className="text-2xl font-semibold tabular-nums">
              {formatCents(monthlyEquivalent.excludingTax)}
            </span>
            <span className="text-sm text-muted-foreground">HT / mois</span>
          </p>
          {/* La vérité du prélèvement, juste en dessous — jamais reléguée. */}
          {paidUpfront && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              ({formatCents(perCharge.excludingTax)} HT à payer en une fois, {periode})
            </p>
          )}
        </div>

        <dl className="space-y-1.5 border-t border-border pt-3 text-sm">
          <Ligne label="TVA" valeur={formatCents(perCharge.tax)} />
          <Ligne
            label={variant === 'due' ? 'Total débité aujourd’hui' : 'Total TTC par échéance'}
            valeur={formatCents(perCharge.includingTax)}
            fort
          />
          {/* Le coût sur douze mois n'a d'intérêt que s'il diffère de
              l'échéance : sur un annuel, ce serait la même ligne deux fois. */}
          {cost.monthsPerCycle !== 12 && (
            <Ligne
              label="Sur douze mois"
              valeur={`${formatCents(yearly.excludingTax)} HT · ${formatCents(yearly.includingTax)} TTC`}
              discret
            />
          )}
          {paidUpfront && (
            <Ligne
              label="Équivalent mensuel TTC"
              valeur={formatCents(monthlyEquivalent.includingTax)}
              discret
            />
          )}
        </dl>
      </div>
    </div>
  );
}

function Ligne({
  label, valeur, fort, discret,
}: { label: string; valeur: string; fort?: boolean; discret?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${discret ? 'text-xs text-muted-foreground' : ''}`}>
      <dt className={discret ? '' : 'text-muted-foreground'}>{label}</dt>
      <dd className={`text-right tabular-nums ${fort ? 'font-semibold' : ''}`}>{valeur}</dd>
    </div>
  );
}

export default SubscriptionCostCard;
