import * as React from 'react';
import { motion } from 'framer-motion';
import { Check, GraduationCap, MonitorPlay, Percent, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAction } from '@/hooks/useResource';
import { Button, Field, Input } from '@/components/ui/primitives';
import type { Contract, ContractCommission } from '@/types';

const KINDS = [
  { key: 'IN_PERSON_TRAINING', label: 'Formations présentielles', Icon: GraduationCap },
  { key: 'DISTANCE_TRAINING', label: 'Formations à distance', Icon: MonitorPlay },
  { key: 'SERVICE', label: 'Prestations', Icon: Sparkles },
] as const;

/**
 * L'ÉTAPE « COMMISSION » DU CONTRAT — le pourcentage reversé à la plateforme
 * sur les ventes de l'institut, les types de produits assujettis (choix
 * multiple), et la base : HT ou TTC. Une vente d'un type non coché est
 * « non assujettie ».
 */
export function CommissionEditor({ contract, onSaved }: { contract: Contract; onSaved: () => void }) {
  const { pending, run } = useAction();
  const current: ContractCommission = contract.commission ?? { enabled: true, ratePercent: 10, productKinds: ['DISTANCE_TRAINING'], basis: 'TTC', salesVatRate: 20, configuredAt: null };
  const [rate, setRate] = React.useState(String(current.ratePercent ?? 10));
  const [kinds, setKinds] = React.useState<string[]>(current.productKinds ?? []);
  const [basis, setBasis] = React.useState<'HT' | 'TTC'>(current.basis === 'HT' ? 'HT' : 'TTC');
  const [vat, setVat] = React.useState(String(current.salesVatRate ?? 20));
  const [cap, setCap] = React.useState(current.capCents ? String(current.capCents / 100) : '');
  const capCents = cap.trim() ? Math.max(0, Math.round(Number(cap.replace(',', '.')) * 100) || 0) : null;
  const toggle = (key: string) => setKinds((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));
  const rateNum = Math.min(100, Math.max(0, Number(rate.replace(',', '.')) || 0));
  // Exemple concret : ce que rapporterait une vente de 100 € TTC.
  const example = basis === 'HT' ? (100 / (1 + (Number(vat) || 0) / 100)) * (rateNum / 100) : rateNum;

  const save = async () => {
    try {
      await run(() => api.updateContractDraft(contract._id, {
        commission: { enabled: true, ratePercent: rateNum, productKinds: kinds, basis, salesVatRate: Number(vat) || 0, capCents: capCents || null },
      }), { success: 'Commission enregistrée' });
      onSaved();
    } catch { /* message déjà affiché */ }
  };

  return (
    <div className="grid gap-4" data-testid="commission-editor">
      <Field label="Pourcentage de commission" unit="%" icon={<Percent />} className="max-w-xs">
        <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} data-testid="commission-rate" />
      </Field>

      <div className="grid gap-2">
        <p className="text-sm font-medium">Ventes assujetties</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {KINDS.map(({ key, label, Icon }) => {
            const on = kinds.includes(key);
            return (
              <button
                key={key}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(key)}
                data-testid={`commission-kind-${key}`}
                className={cn('flex min-h-[56px] items-center gap-3 rounded-xl border p-3 text-left transition-colors', on ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'hover:bg-muted/40')}
              >
                <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 transition-colors', on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40')}>
                  {on && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 24 }}><Check className="h-4 w-4" strokeWidth={3} /></motion.span>}
                </span>
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm font-semibold">{label}</span>
              </button>
            );
          })}
        </div>
        {kinds.length === 0 && <p className="text-xs text-amber-700">Aucun type coché : aucune vente ne sera assujettie.</p>}
      </div>

      <div className="grid gap-2">
        <p className="text-sm font-medium">Base de calcul</p>
        <div className="inline-flex w-full max-w-xs rounded-lg border bg-muted/30 p-1" role="radiogroup" aria-label="Base de calcul">
          {(['HT', 'TTC'] as const).map((b) => (
            <button key={b} type="button" role="radio" aria-checked={basis === b} onClick={() => setBasis(b)} data-testid={`commission-basis-${b}`}
              className={cn('h-10 flex-1 rounded-md text-sm font-semibold transition', basis === b ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
              {b}
            </button>
          ))}
        </div>
        {basis === 'HT' && (
          <Field label="TVA appliquée aux ventes" unit="%" className="max-w-xs" hint="Le HT d'une vente = son TTC ÷ (1 + TVA).">
            <Input inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} />
          </Field>
        )}
        <p className="text-xs text-muted-foreground">
          Exemple : une vente assujettie de 100 € TTC donne {example.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € de commission ({rateNum} % {basis}).
        </p>
      </div>

      <Field label="Plafond total de commission (facultatif)" unit="€ HT" className="max-w-xs"
        hint="Une fois ce montant atteint (tous mois confondus), plus aucune commission n'est prélevée sur les ventes.">
        <Input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="Sans plafond" data-testid="commission-cap" />
      </Field>

      <div>
        <Button onClick={save} loading={pending} data-testid="commission-save">Enregistrer la commission</Button>
      </div>
    </div>
  );
}
