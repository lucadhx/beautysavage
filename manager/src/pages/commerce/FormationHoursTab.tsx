import { CalendarClock, Minus, Plus } from 'lucide-react';
import { DayTimeline, TimeSelect, durationLabel } from '@/components/ui/TimeRange';
import { ToneSection } from './editorTones';
import type { DayHours } from './SessionsPlanner';

const DEFAULT: DayHours = { start: '09:00', end: '17:00' };
const MAX_DAYS = 14;
const toMin = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + (m || 0); };

/**
 * LE MODÈLE D'HORAIRES D'UNE FORMATION PRÉSENTIELLE — jour 1, jour 2…
 *
 * Le nombre de jours est la « Durée (jours) » de la fiche ; chaque jour a
 * ses horaires. Même règle que le serveur (`formationDayTemplate`) : un jour
 * sans horaire propre reprend celui de la veille, le premier 9:00-17:00.
 */
export function formationDayTemplate(training: Record<string, unknown> | undefined): DayHours[] {
  const count = Math.min(MAX_DAYS, Math.max(1, Math.round(Number(training?.durationDays) || 1)));
  const saved = Array.isArray(training?.dayHours) ? (training!.dayHours as DayHours[]) : [];
  const days: DayHours[] = [];
  for (let i = 0; i < count; i += 1) {
    const own = saved[i];
    const valid = own && /^\d{2}:\d{2}$/.test(own.start) && /^\d{2}:\d{2}$/.test(own.end) && toMin(own.end) > toMin(own.start);
    days.push(valid ? { start: own.start, end: own.end } : (days[i - 1] || DEFAULT));
  }
  return days;
}

export function FormationHoursTab({ training, onChange }: {
  training: Record<string, unknown> | undefined;
  onChange: (patch: { durationDays: number; dayHours: DayHours[] }) => void;
}) {
  const days = formationDayTemplate(training);
  const total = days.reduce((sum, d) => sum + Math.max(0, toMin(d.end) - toMin(d.start)), 0);
  const setCount = (count: number) => {
    const next = Math.min(MAX_DAYS, Math.max(1, count));
    const hours = Array.from({ length: next }, (_, i) => days[i] || days[days.length - 1] || DEFAULT);
    onChange({ durationDays: next, dayHours: hours });
  };
  const setDay = (index: number, patch: Partial<DayHours>) => {
    const hours = days.map((d, i) => (i === index ? { ...d, ...patch } : d));
    onChange({ durationDays: days.length, dayHours: hours });
  };

  return (
    <ToneSection
      tone="sessions"
      title="Horaires de la formation"
      icon={<CalendarClock className="h-4 w-4" />}
      description="Les horaires de chaque jour. Au planning, le jour choisi devient le jour 1 et les suivants s'enchaînent avec ces horaires."
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3 sm:p-4">
        <div>
          <p className="text-sm font-semibold">Nombre de jours</p>
          <p className="text-xs text-muted-foreground">La « Durée (jours) » de l'onglet Informations.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Un jour de moins" onClick={() => setCount(days.length - 1)} disabled={days.length <= 1} className="grid h-11 w-11 place-items-center rounded-lg border hover:bg-muted disabled:opacity-40"><Minus className="h-4 w-4" /></button>
          <span className="w-16 text-center text-lg font-semibold tabular-nums" data-testid="hours-day-count">{days.length} j</span>
          <button type="button" aria-label="Un jour de plus" onClick={() => setCount(days.length + 1)} disabled={days.length >= MAX_DAYS} className="grid h-11 w-11 place-items-center rounded-lg border hover:bg-muted disabled:opacity-40"><Plus className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
        {days.map((d, i) => {
          const length = toMin(d.end) - toMin(d.start);
          return (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-xl border bg-card p-3 sm:p-4" data-testid="hours-day">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold">Jour {i + 1}</p>
                <p className={`text-sm tabular-nums ${length > 0 ? 'text-muted-foreground' : 'font-semibold text-rose-700'}`}>{length > 0 ? durationLabel(length) : 'La fin doit suivre le début'}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Début</span>
                  <TimeSelect value={d.start} label={`Début du jour ${i + 1}`} onChange={(start) => setDay(i, { start })} testId={`hours-start-${i + 1}`} />
                </div>
                <div className="grid gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fin</span>
                  <TimeSelect value={d.end} label={`Fin du jour ${i + 1}`} onChange={(end) => setDay(i, { end })} testId={`hours-end-${i + 1}`} />
                </div>
              </div>
              <DayTimeline busy={[]} from={toMin(d.start)} to={toMin(d.end)} />
            </div>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">Total : <span className="font-semibold text-foreground">{durationLabel(total)}</span> sur {days.length} jour{days.length > 1 ? 's' : ''}.</p>
    </ToneSection>
  );
}
