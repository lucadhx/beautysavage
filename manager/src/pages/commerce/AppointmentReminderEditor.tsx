import { AnimatePresence, motion } from 'framer-motion';
import { AlarmClock, BellRing, Info, Plus, Trash2 } from 'lucide-react';
import { Button, Input, Switch } from '@/components/ui/primitives';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { ToneSection } from './editorTones';

/**
 * RAPPELS AVANT RENDEZ-VOUS d'une fiche — même règle que le backend
 * (appointmentReminderConfig.js) : chaque rappel est un délai AVANT le début
 * du rendez-vous. Même geste que la demande d'avis : on ajoute, on retire.
 */
export type ReminderUnit = 'HOURS' | 'DAYS' | 'WEEKS';
export interface ReminderStep { value: number; unit: ReminderUnit }
export interface AppointmentReminderConfig { enabled: boolean; reminders: ReminderStep[] }

export const DEFAULT_APPOINTMENT_REMINDER: AppointmentReminderConfig = {
  enabled: true,
  reminders: [{ value: 24, unit: 'HOURS' }],
};

const UNITS: { value: ReminderUnit; label: string }[] = [
  { value: 'HOURS', label: 'heure(s)' },
  { value: 'DAYS', label: 'jour(s)' },
  { value: 'WEEKS', label: 'semaine(s)' },
];
const MINUTES: Record<ReminderUnit, number> = { HOURS: 60, DAYS: 1440, WEEKS: 10080 };
const SHORT: Record<ReminderUnit, [string, string]> = { HOURS: ['heure', 'heures'], DAYS: ['jour', 'jours'], WEEKS: ['semaine', 'semaines'] };
const MAX_REMINDERS = 5;

const label = (s: ReminderStep) => `${s.value} ${s.value > 1 ? SHORT[s.unit][1] : SHORT[s.unit][0]}`;
const minutes = (s: ReminderStep) => s.value * MINUTES[s.unit];

export function normalizeReminderConfig(raw: unknown): AppointmentReminderConfig {
  const r = (raw || null) as Partial<AppointmentReminderConfig> | null;
  if (!r) return { enabled: DEFAULT_APPOINTMENT_REMINDER.enabled, reminders: DEFAULT_APPOINTMENT_REMINDER.reminders.map((x) => ({ ...x })) };
  return {
    enabled: r.enabled !== false,
    reminders: (Array.isArray(r.reminders) ? r.reminders : []).map((x) => ({
      value: Math.max(1, Math.round(Number(x?.value) || 1)),
      unit: (UNITS.some((u) => u.value === x?.unit) ? x.unit : 'HOURS') as ReminderUnit,
    })),
  };
}

function StepInput({ step, onChange, testId }: { step: ReminderStep; onChange: (s: ReminderStep) => void; testId: string }) {
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
      <CustomSelect<ReminderUnit> value={step.unit} onChange={(unit) => onChange({ ...step, unit })} options={UNITS} className="w-36" ariaLabel="Unité" />
    </div>
  );
}

/**
 * `kind` adapte le vocabulaire : une prestation a un RENDEZ-VOUS, une
 * formation en présentiel une SESSION — même règle, même e-mail.
 */
export function AppointmentReminderEditor({ value, onChange, kind = 'service' }: { value: unknown; onChange: (config: AppointmentReminderConfig) => void; kind?: 'service' | 'training' }) {
  const training = kind === 'training';
  const le = training ? 'la session' : 'le rendez-vous';
  const du = training ? 'de la session' : 'du rendez-vous';
  const config = normalizeReminderConfig(value);
  const set = (next: Partial<AppointmentReminderConfig>) => onChange({ ...config, ...next });
  const setReminder = (i: number, s: ReminderStep) => set({ reminders: config.reminders.map((r, j) => (j === i ? s : r)) });
  // La frise lit les rappels du plus éloigné au plus proche du rendez-vous.
  const chronologie = [...config.reminders].sort((a, b) => minutes(b) - minutes(a));
  const doublons = new Set(config.reminders.map(minutes)).size !== config.reminders.length;

  return (
    <ToneSection
      tone="advanced"
      level="nested"
      icon={<AlarmClock className="h-5 w-5" />}
      title={`Rappels avant ${le}`}
      description={training ? 'Un e-mail rappelle à chaque stagiaire inscrite sa session à venir : formation, date et adresse de l’institut.' : 'Un e-mail rappelle à la cliente son rendez-vous à venir : prestation, date, adresse et reste à régler.'}
    >
      <label className="flex items-center gap-3 text-sm font-medium">
        <Switch checked={config.enabled} onChange={(v) => set({ enabled: v })} label="Rappels actifs" />
        Envoyer des rappels avant {le}
      </label>

      <div className={`grid gap-4 transition-opacity ${config.enabled ? '' : 'pointer-events-none opacity-50'}`} data-testid="appointment-reminder-editor">
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-semibold">
              <BellRing className="h-4 w-4 text-slate-600" /> Rappels <span className="text-xs font-normal text-muted-foreground">({config.reminders.length})</span>
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={config.reminders.length >= MAX_REMINDERS}
              title={config.reminders.length >= MAX_REMINDERS ? `${MAX_REMINDERS} rappels au maximum` : undefined}
              onClick={() => set({ reminders: [...config.reminders, { value: 2, unit: 'HOURS' }] })}
              data-testid="add-appointment-reminder"
            >
              <Plus className="h-4 w-4" /> Rappel
            </Button>
          </div>
          {config.reminders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun rappel : la cliente ne reçoit que la confirmation de réservation.</p>
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
                    data-testid="appointment-reminder-row"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-bold text-slate-900">{i + 1}</span>
                    <StepInput step={r} onChange={(s) => setReminder(i, s)} testId={`appointment-reminder-${i}`} />
                    <span className="text-muted-foreground">avant le début {du}</span>
                    <button
                      type="button"
                      onClick={() => set({ reminders: config.reminders.filter((_, j) => j !== i) })}
                      className="ml-auto grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-700"
                      aria-label={`Supprimer le rappel ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>
          )}
          {doublons && <p className="mt-2 text-xs text-amber-700">Deux rappels tombent au même instant : un seul partira.</p>}
        </div>

        {chronologie.length > 0 && (
          <p className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm text-slate-900" data-testid="appointment-reminder-timeline">
            <strong>Déroulé :</strong> réservation
            {chronologie.map((r, i) => <span key={i}>{' → '}rappel {label(r)} avant</span>)}
            {' → '}{training ? 'session' : 'rendez-vous'}.
          </p>
        )}

        <ul className="grid gap-1.5 text-sm text-muted-foreground">
          <li className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0" /> Un rappel dont l'heure est déjà passée au moment de la réservation ne part pas (une réservation pour dans 3 heures ne reçoit pas le rappel « 24 heures avant »).</li>
          <li className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0" /> {training ? 'Une session annulée, ou une inscription remboursée, ne reçoit plus de rappel ; une session déplacée reçoit les rappels de sa nouvelle date.' : 'Un rendez-vous annulé ne reçoit plus de rappel ; un rendez-vous déplacé reçoit les rappels de sa nouvelle date.'}</li>
          <li className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0" /> L'e-mail part au nom de l'institut, avec votre configuration Brevo (Commerce › Clés API).</li>
        </ul>
      </div>
    </ToneSection>
  );
}
