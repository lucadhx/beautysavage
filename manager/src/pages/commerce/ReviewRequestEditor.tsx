import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BellRing, Info, MailCheck, Plus, Star, Trash2 } from 'lucide-react';
import { Button, Input, Switch } from '@/components/ui/primitives';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { ToneSection } from './editorTones';

/**
 * DEMANDE D'AVIS d'une fiche — même règle que le backend (reviewRequestConfig.js) :
 * un délai après la fin (prestation, session présentielle, ou validation d'une
 * formation à distance), puis des relances, chacune après l'envoi précédent.
 */
export type ReviewUnit = 'HOURS' | 'DAYS' | 'WEEKS' | 'MONTHS';
export interface ReviewStep { value: number; unit: ReviewUnit }
export interface ReviewRequestConfig { enabled: boolean; delay: ReviewStep; reminders: ReviewStep[] }

export const DEFAULT_REVIEW_REQUEST: ReviewRequestConfig = {
  enabled: true,
  delay: { value: 2, unit: 'HOURS' },
  reminders: [{ value: 48, unit: 'HOURS' }, { value: 1, unit: 'WEEKS' }],
};

const UNITS: { value: ReviewUnit; label: string }[] = [
  { value: 'HOURS', label: 'heure(s)' },
  { value: 'DAYS', label: 'jour(s)' },
  { value: 'WEEKS', label: 'semaine(s)' },
  { value: 'MONTHS', label: 'mois' },
];

const SHORT: Record<ReviewUnit, [string, string]> = {
  HOURS: ['heure', 'heures'],
  DAYS: ['jour', 'jours'],
  WEEKS: ['semaine', 'semaines'],
  MONTHS: ['mois', 'mois'],
};

export function stepLabel(step: ReviewStep) {
  const [one, many] = SHORT[step.unit];
  return `${step.value} ${step.value > 1 ? many : one}`;
}

export function normalizeConfig(raw: unknown): ReviewRequestConfig {
  const r = (raw || null) as Partial<ReviewRequestConfig> | null;
  if (!r) return { ...DEFAULT_REVIEW_REQUEST, delay: { ...DEFAULT_REVIEW_REQUEST.delay }, reminders: DEFAULT_REVIEW_REQUEST.reminders.map((x) => ({ ...x })) };
  const step = (s: Partial<ReviewStep> | undefined, fb: ReviewStep): ReviewStep => ({
    value: Math.max(1, Math.round(Number(s?.value) || fb.value)),
    unit: (UNITS.some((u) => u.value === s?.unit) ? s?.unit : fb.unit) as ReviewUnit,
  });
  return {
    enabled: r.enabled !== false,
    delay: step(r.delay, DEFAULT_REVIEW_REQUEST.delay),
    reminders: (Array.isArray(r.reminders) ? r.reminders : []).map((x) => step(x, { value: 1, unit: 'DAYS' })),
  };
}

function StepInput({ step, onChange, testId }: { step: ReviewStep; onChange: (s: ReviewStep) => void; testId: string }) {
  return (
    <div className="flex items-center gap-2" data-testid={testId}>
      <Input
        type="number"
        min={1}
        inputMode="numeric"
        className="h-10 w-20 text-center tabular-nums"
        value={step.value}
        onChange={(e) => onChange({ ...step, value: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
        aria-label="Durée"
      />
      <CustomSelect<ReviewUnit>
        value={step.unit}
        onChange={(unit) => onChange({ ...step, unit })}
        options={UNITS}
        className="w-36"
        ariaLabel="Unité"
      />
    </div>
  );
}

export function ReviewRequestEditor({ value, onChange, anchor }: {
  value: unknown;
  onChange: (config: ReviewRequestConfig) => void;
  /** Ce qui déclenche le premier envoi, dit en clair. */
  anchor: string;
}) {
  const config = normalizeConfig(value);
  const set = (next: Partial<ReviewRequestConfig>) => onChange({ ...config, ...next });
  const setReminder = (i: number, s: ReviewStep) => set({ reminders: config.reminders.map((r, j) => (j === i ? s : r)) });

  return (
    <ToneSection
      tone="reviews"
      icon={<Star className="h-5 w-5" />}
      title="Demande d'avis"
      description="Un e-mail invite la cliente à noter cette fiche, puis des relances si elle n'a pas encore répondu."
    >
      <label className="flex items-center gap-3 text-sm font-medium">
        <Switch checked={config.enabled} onChange={(v) => set({ enabled: v })} label="Demande d'avis active" />
        Envoyer une demande d'avis
      </label>

      <div className={`grid gap-4 transition-opacity ${config.enabled ? '' : 'pointer-events-none opacity-50'}`} data-testid="review-request-editor">
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center gap-2 font-semibold"><MailCheck className="h-4 w-4 text-amber-600" /> Premier envoi</div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <StepInput step={config.delay} onChange={(delay) => set({ delay })} testId="review-delay" />
            <span className="text-muted-foreground">{anchor}</span>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-semibold"><BellRing className="h-4 w-4 text-amber-600" /> Relances <span className="text-xs font-normal text-muted-foreground">({config.reminders.length})</span></span>
            <Button type="button" variant="outline" onClick={() => set({ reminders: [...config.reminders, { value: 1, unit: 'WEEKS' }] })} data-testid="add-reminder">
              <Plus className="h-4 w-4" /> Relance
            </Button>
          </div>
          {config.reminders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune relance : seul le premier e-mail part.</p>
          ) : (
            <ol className="grid gap-2">
              <AnimatePresence initial={false}>
                {config.reminders.map((r, i) => (
                  <motion.li
                    key={i}
                    layout
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2 text-sm"
                    data-testid="reminder-row"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-100 text-xs font-bold text-amber-900">{i + 1}</span>
                    <span className="text-muted-foreground">Après</span>
                    <StepInput step={r} onChange={(s) => setReminder(i, s)} testId={`reminder-${i}`} />
                    <span className="text-muted-foreground">sans avis, après l'envoi précédent</span>
                    <button type="button" onClick={() => set({ reminders: config.reminders.filter((_, j) => j !== i) })} className="ml-auto grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-700" aria-label={`Supprimer la relance ${i + 1}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>
          )}
        </div>

        <p className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-950" data-testid="review-timeline">
          <strong>Déroulé :</strong> e-mail {stepLabel(config.delay)} {anchor}
          {config.reminders.map((r, i) => <React.Fragment key={i}>{' → '}relance {i + 1} : {stepLabel(r)} plus tard</React.Fragment>)}.
        </p>

        <ul className="grid gap-1.5 text-sm text-muted-foreground">
          <li className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0" /> Une demande d'avis ne sera pas envoyée si la cliente a déjà laissé un avis sur cette prestation.</li>
          <li className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0" /> Les relances s'arrêtent à partir du moment où l'avis de la cliente est reçu.</li>
          <li className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0" /> Plusieurs prestations dues le même jour partent dans un seul e-mail. Les avis reçus attendent votre validation dans la page Avis.</li>
        </ul>
      </div>
    </ToneSection>
  );
}
