import { Check, GraduationCap, MonitorPlay, Percent, Sparkles, X } from 'lucide-react';
import { cn, formatCents } from '@/lib/utils';
import type { ContractCommission } from '@/types';

const KINDS = [
  { key: 'SERVICE', label: 'Prestations', Icon: Sparkles },
  { key: 'IN_PERSON_TRAINING', label: 'Formations présentielles', Icon: GraduationCap },
  { key: 'DISTANCE_TRAINING', label: 'Formations distancielles', Icon: MonitorPlay },
] as const;

/**
 * LE RÉCAPITULATIF DES COMMISSIONS DU CONTRAT — chaque type de vente avec une
 * coche verte (prélevé) ou une croix rouge (non prélevé), le taux, la base et
 * le plafond éventuel.
 */
export function CommissionCoverage({ commission }: { commission: ContractCommission | null | undefined }) {
  const configured = Boolean(commission?.configuredAt);
  const rule = commission ?? { enabled: true, ratePercent: 10, productKinds: ['DISTANCE_TRAINING'], basis: 'TTC' as const, salesVatRate: 20, capCents: null, configuredAt: null };
  const rate = Number(rule.ratePercent).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  return (
    <div className="grid gap-3" data-testid="commission-coverage">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 font-semibold text-primary">
          <Percent className="h-3.5 w-3.5" /> {rate} % {rule.rateType || 'HT'}
        </span>
        {rule.rateType === 'TTC' && (
          <span className="text-muted-foreground" data-testid="coverage-rate-ht">soit {(Number(rule.ratePercent) / (1 + (rule.vatRate ?? 20) / 100)).toLocaleString('fr-FR', { maximumFractionDigits: 4 })} % HT</span>
        )}
        <span className="text-muted-foreground">TVA sur commission {rule.vatRate ?? 20} % · assiette {rule.basis}</span>
        <span className="text-muted-foreground">
          {rule.capCents ? `Plafond total : ${formatCents(rule.capCents)} ${rule.capType || 'HT'}` : 'Sans plafond'}
        </span>
        {!configured && <span className="text-xs text-amber-700">Règle par défaut (commission non configurée)</span>}
      </div>
      <ul className="grid gap-2 sm:grid-cols-3">
        {KINDS.map(({ key, label, Icon }) => {
          const on = rule.enabled !== false && rule.productKinds.includes(key);
          return (
            <li key={key} data-testid={`coverage-${key}`} data-covered={on}
              className={cn('flex items-center gap-3 rounded-lg border p-3', on ? 'border-emerald-200 bg-emerald-50/60' : 'border-rose-200 bg-rose-50/60')}>
              <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-white', on ? 'bg-emerald-600' : 'bg-rose-600')} aria-hidden>
                {on ? <Check className="h-4 w-4" strokeWidth={3} /> : <X className="h-4 w-4" strokeWidth={3} />}
              </span>
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{label}</span>
                <span className={cn('block text-xs', on ? 'text-emerald-800' : 'text-rose-700')}>{on ? 'Commission prélevée' : 'Non assujetti'}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
