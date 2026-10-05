import * as React from 'react';
import { motion } from 'framer-motion';
import { Calculator, Check, GraduationCap, MonitorPlay, Percent, Receipt, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAction } from '@/hooks/useResource';
import { Button, Field, Input } from '@/components/ui/primitives';
import { capBoth, eur, pct, simulateCommission, type RateType } from '@/lib/commissionMath';
import type { Contract, ContractCommission } from '@/types';

const KINDS = [
  { key: 'IN_PERSON_TRAINING', label: 'Formations présentielles', Icon: GraduationCap },
  { key: 'DISTANCE_TRAINING', label: 'Formations à distance', Icon: MonitorPlay },
  { key: 'SERVICE', label: 'Prestations', Icon: Sparkles },
] as const;

const num = (v: string, fallback = 0) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : fallback; };

function Segmented<T extends string>({ value, options, onChange, label, testid }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; testid: string }) {
  return (
    <div className="inline-flex w-full rounded-lg border bg-muted/30 p-1 sm:max-w-sm" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} data-testid={`${testid}-${o.value}`}
          className={cn('min-h-10 flex-1 rounded-md px-2 text-sm font-semibold transition', value === o.value ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * L'ÉTAPE « COMMISSION » DU CONTRAT — le taux (exprimé HT, ou TTC c'est-à-dire
 * TVA sur la commission comprise), la TVA facturée sur la commission,
 * l'assiette (prix de vente HT ou TTC), les types de ventes assujettis et le
 * plafond (HT ou TTC). Le simulateur montre ce que donne une vente réelle,
 * avant et après TVA — c'est ce que la facture Stripe portera.
 */
export function CommissionEditor({ contract, onSaved }: { contract: Contract; onSaved: () => void }) {
  const { pending, run } = useAction();
  const current: ContractCommission = contract.commission ?? { enabled: true, ratePercent: 10, productKinds: ['DISTANCE_TRAINING'], basis: 'TTC', salesVatRate: 20, configuredAt: null };
  const contractVat = Number.isFinite(contract.taxRate) ? contract.taxRate : 20;
  const [rate, setRate] = React.useState(String(current.ratePercent ?? 10));
  const [rateType, setRateType] = React.useState<RateType>(current.rateType === 'TTC' ? 'TTC' : 'HT');
  const [vat, setVat] = React.useState(String(current.vatRate ?? contractVat));
  const [kinds, setKinds] = React.useState<string[]>(current.productKinds ?? []);
  const [basis, setBasis] = React.useState<'HT' | 'TTC'>(current.basis === 'HT' ? 'HT' : 'TTC');
  const [salesVat, setSalesVat] = React.useState(String(current.salesVatRate ?? 20));
  const [cap, setCap] = React.useState(current.capCents ? String(current.capCents / 100) : '');
  const [capType, setCapType] = React.useState<RateType>(current.capType === 'TTC' ? 'TTC' : 'HT');
  const [sample, setSample] = React.useState('1000');

  const toggle = (key: string) => setKinds((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));
  const rateNum = Math.min(100, Math.max(0, num(rate)));
  const vatNum = Math.min(100, Math.max(0, num(vat, 20)));
  const capCents = cap.trim() ? Math.max(0, Math.round(num(cap) * 100)) : null;
  const sim = simulateCommission(Math.max(0, Math.round(num(sample, 1000) * 100)), { ratePercent: rateNum, rateType, vatRate: vatNum, basis, salesVatRate: num(salesVat, 20) });
  const capView = capBoth(capCents, capType, vatNum);

  const save = async () => {
    try {
      await run(() => api.updateContractDraft(contract._id, {
        commission: {
          enabled: true, ratePercent: rateNum, rateType, vatRate: vatNum, productKinds: kinds,
          basis, salesVatRate: num(salesVat, 20), capCents: capCents || null, capType,
        },
      }), { success: 'Commission enregistrée' });
      onSaved();
    } catch { /* message déjà affiché */ }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]" data-testid="commission-editor">
      <div className="grid min-w-0 content-start gap-5">
        {/* Taux */}
        <section className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Pourcentage de commission" unit="%" icon={<Percent />}>
              <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} data-testid="commission-rate" />
            </Field>
            <Field label="TVA sur la commission" unit="%" hint={`Celle du contrat : ${contractVat} %`}>
              <Input inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} data-testid="commission-vat" />
            </Field>
          </div>
          <div className="grid gap-1.5">
            <p className="text-sm font-medium">Ce pourcentage est exprimé</p>
            <Segmented label="Taux exprimé" testid="commission-ratetype" value={rateType} onChange={setRateType}
              options={[{ value: 'HT', label: 'Hors taxe (HT)' }, { value: 'TTC', label: 'TTC (TVA incluse)' }]} />
            <p className="text-xs text-muted-foreground" data-testid="commission-rate-explain">
              {rateType === 'TTC'
                ? <>Commission <strong>+ TVA</strong> = {pct(rateNum)} de l’assiette, soit <strong>{pct(sim.htPercent, 4)} HT</strong> ({pct(sim.htPercent, 4)} × {(1 + vatNum / 100).toLocaleString('fr-FR')} = {pct(rateNum)}).</>
                : <>{pct(rateNum)} HT, auxquels s’ajoute la TVA : soit <strong>{pct(sim.ttcPercent, 4)} TTC</strong>.</>}
            </p>
          </div>
        </section>

        {/* Ventes assujetties */}
        <section className="grid gap-2">
          <p className="text-sm font-medium">Ventes assujetties</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {KINDS.map(({ key, label, Icon }) => {
              const on = kinds.includes(key);
              return (
                <button key={key} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(key)} data-testid={`commission-kind-${key}`}
                  className={cn('flex min-h-[56px] items-center gap-3 rounded-xl border p-3 text-left transition-colors', on ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'hover:bg-muted/40')}>
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
        </section>

        {/* Assiette */}
        <section className="grid gap-2">
          <p className="text-sm font-medium">Assiette : le pourcentage s’applique au prix de vente</p>
          <Segmented label="Assiette" testid="commission-basis" value={basis} onChange={setBasis}
            options={[{ value: 'TTC', label: 'TTC (payé par la cliente)' }, { value: 'HT', label: 'HT' }]} />
          {basis === 'HT' && (
            <Field label="TVA appliquée aux ventes de l’institut" unit="%" className="sm:max-w-sm" hint="Le HT d’une vente = son TTC ÷ (1 + TVA).">
              <Input inputMode="decimal" value={salesVat} onChange={(e) => setSalesVat(e.target.value)} />
            </Field>
          )}
        </section>

        {/* Plafond */}
        <section className="grid gap-2">
          <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
            <Field label="Plafond total de commission (facultatif)" unit="€" hint="Atteint (tous mois confondus), plus rien n’est prélevé.">
              <Input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="Sans plafond" data-testid="commission-cap" />
            </Field>
            <Segmented label="Plafond exprimé" testid="commission-captype" value={capType} onChange={setCapType}
              options={[{ value: 'HT', label: 'Plafond HT' }, { value: 'TTC', label: 'Plafond TTC' }]} />
          </div>
          {capView && <p className="text-xs text-muted-foreground" data-testid="commission-cap-both">Soit {eur(capView.htCents)} HT · {eur(capView.ttcCents)} TTC (TVA {pct(vatNum)}).</p>}
        </section>

        <div><Button onClick={save} loading={pending} data-testid="commission-save">Enregistrer la commission</Button></div>
      </div>

      {/* Simulateur */}
      <aside className="min-w-0 rounded-2xl border bg-gradient-to-b from-primary/5 to-card p-4 shadow-sm sm:p-5 lg:sticky lg:top-24 lg:self-start" data-testid="commission-simulator">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"><Calculator className="h-4 w-4" /></span>Simulation</h4>
        <Field label="Pour une vente de" unit="€ TTC" className="mt-3">
          <Input inputMode="decimal" value={sample} onChange={(e) => setSample(e.target.value)} data-testid="commission-sample" />
        </Field>
        <dl className="mt-3 grid gap-1 text-sm">
          <div className="flex justify-between gap-3 py-1"><dt className="text-muted-foreground">Assiette ({basis})</dt><dd className="font-medium tabular-nums">{eur(sim.basisCents)}</dd></div>
          <div className="flex justify-between gap-3 py-1"><dt className="text-muted-foreground">Taux HT effectif</dt><dd className="font-medium tabular-nums">{pct(sim.htPercent, 4)}</dd></div>
          <div className="mt-1 flex justify-between gap-3 rounded-lg bg-background/80 px-3 py-2 ring-1 ring-border"><dt className="flex items-center gap-1.5"><Receipt className="h-4 w-4 text-muted-foreground" />Commission HT</dt><dd className="font-semibold tabular-nums" data-testid="sim-ht">{eur(sim.htCents)}</dd></div>
          <div className="flex justify-between gap-3 px-3 py-1"><dt className="text-muted-foreground">+ TVA ({pct(vatNum)})</dt><dd className="tabular-nums" data-testid="sim-vat">{eur(sim.vatCents)}</dd></div>
          <div className="flex justify-between gap-3 rounded-lg bg-primary px-3 py-2.5 text-primary-foreground"><dt className="font-medium">Commission TTC</dt><dd className="text-base font-bold tabular-nums" data-testid="sim-ttc">{eur(sim.ttcCents)}</dd></div>
          <p className="mt-1 text-xs text-muted-foreground">Soit {pct(sim.ttcPercent, 4)} TTC de l’assiette. L’institut conserve {eur(Math.max(0, Math.round(num(sample, 1000) * 100) - sim.ttcCents))} sur cette vente.</p>
        </dl>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />La facture Stripe des commissions détaille le HT, la TVA à {pct(vatNum)} et le TTC.</p>
      </aside>
    </div>
  );
}
