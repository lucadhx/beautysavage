import { Timer, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/primitives';
import {
  MAX_HOURS_PART,
  MAX_MINUTES_PART,
  formatDuration,
  hasDuration,
  joinDuration,
  parseDurationPart,
  splitDuration,
} from '@/lib/duration';

/**
 * Saisie d'une durée FACULTATIVE, en heures + minutes.
 *
 * Deux champs bornés plutôt qu'un champ libre en minutes : « 2h30 » est la
 * façon dont on pense une prestation, « 150 » ne l'est pas. La valeur reste
 * stockée en minutes (cf. `@/lib/duration`), le composant fait la conversion.
 *
 * Vide = non renseignée. Le bouton d'effacement n'apparaît qu'une fois une
 * durée saisie — c'est le seul moyen de revenir en arrière une fois les deux
 * champs remplis, et il doit se voir.
 */
export function DurationField({
  value,
  onChange,
  label = 'Durée',
  hint,
  compact = false,
  className,
}: {
  value?: number | null;
  onChange: (minutes: number | null) => void;
  label?: string;
  hint?: string;
  /** Sans libellé ni aide, pour tenir dans une ligne déjà dense. */
  compact?: boolean;
  className?: string;
}) {
  const { hours, mins } = splitDuration(value);
  const set = (h: number | null, m: number | null) => onChange(joinDuration(h, m));
  const filled = hasDuration(value);

  const controls = (
    <div className={cn('flex items-center gap-2', compact && className)}>
      {compact && <Timer className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
      <Part
        value={hours}
        max={MAX_HOURS_PART}
        unit="h"
        label={`${label} — heures`}
        onChange={(h) => set(h, mins)}
      />
      <Part
        value={mins}
        max={MAX_MINUTES_PART}
        unit="min"
        label={`${label} — minutes`}
        onChange={(m) => set(hours, m)}
      />

      {filled && (
        <>
          {/* Rappel de ce que verra le client : c'est cette chaîne-là qui part
              sur la vitrine, pas « 2 » et « 30 ». */}
          <span className="m-pop rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums">
            {formatDuration(value)}
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            title="Effacer la durée"
            aria-label="Effacer la durée"
            className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );

  // En compact, le composant se fond dans la ligne de l'appelant : pas
  // d'enveloppe supplémentaire qui casserait son `flex-wrap`.
  if (compact) return controls;

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center gap-1.5">
        <Timer className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <Label>{label}</Label>
        <span className="text-xs font-normal text-muted-foreground">(facultatif)</span>
      </div>
      {controls}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Un des deux champs bornés, avec son unité collée à droite. */
function Part({
  value,
  max,
  unit,
  label,
  onChange,
}: {
  value: number | null;
  max: number;
  unit: string;
  label: string;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        // `?? ''` et non `|| ''` : 0 est une valeur saisissable (« 2h00 »).
        value={value ?? ''}
        onChange={(e) => onChange(parseDurationPart(e.target.value, max))}
        placeholder="—"
        aria-label={label}
        className={cn(
          'h-10 w-[4.5rem] rounded-md border border-border bg-background py-2 pl-3 text-sm tabular-nums',
          'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-primary/40 disabled:opacity-50',
          unit === 'min' ? 'pr-9' : 'pr-6'
        )}
      />
      <span
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground"
        aria-hidden
      >
        {unit}
      </span>
    </div>
  );
}
