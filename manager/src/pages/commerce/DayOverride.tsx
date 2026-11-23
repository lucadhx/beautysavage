import * as React from 'react';
import { CalendarCheck, CalendarX, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/dialog';

/**
 * UNE JOURNÉE QUI SORT DE L'ORDINAIRE — ouvrir un samedi habituellement fermé,
 * fermer un mardi pour un congé, sans toucher aux horaires classiques.
 *
 * Même règle que le serveur (`backend/src/services/dayOverrides.js`) : une
 * exception REMPLACE la semaine type ce jour-là, et ne vaut que pour la
 * réservation EN LIGNE. Au Manager, un rendez-vous se pose toujours, même un
 * jour fermé.
 */

export interface DayRange { start: string; end: string }
interface ScheduleDayLike { weekday: number; enabled: boolean; ranges: DayRange[] }
export interface DayException { date: string; closed: boolean; ranges: DayRange[]; reason?: string }
export interface ScheduleLike {
  weeklyHours: ScheduleDayLike[];
  alternation?: { enabled: boolean; anchor: string; weeklyHours: ScheduleDayLike[] };
  exceptions?: DayException[];
}

export interface DayState {
  /** Réservable en ligne ce jour-là. */
  open: boolean;
  ranges: DayRange[];
  /** La règle de la semaine type, sans exception. */
  usual: { open: boolean; ranges: DayRange[] };
  exception: DayException | null;
}

/** « AAAA-MM-JJ » du jour affiché (heure de l'appareil, comme la grille). */
export function isoOf(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const DAY_MS = 86400_000;
const utcDay = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
};
const mondayOf = (t: number) => t - (((new Date(t).getUTCDay() || 7) - 1) * DAY_MS);

/** La grille de la semaine type qui vaut ce jour (alternance sur deux semaines comprise). */
function weeklyGrid(schedule: ScheduleLike, iso: string) {
  const alt = schedule.alternation;
  const anchor = alt?.enabled ? utcDay(alt.anchor) : NaN;
  if (!alt || Number.isNaN(anchor)) return schedule.weeklyHours || [];
  const gap = Math.round((mondayOf(utcDay(iso)) - mondayOf(anchor)) / (7 * DAY_MS));
  return ((gap % 2) + 2) % 2 === 0 ? schedule.weeklyHours || [] : alt.weeklyHours || [];
}

export function dayState(schedule: ScheduleLike | null | undefined, date: Date): DayState {
  const iso = isoOf(date);
  const weekday = date.getDay() || 7;
  const rule = schedule ? weeklyGrid(schedule, iso).find((d) => d.weekday === weekday) : undefined;
  const usualRanges = rule?.enabled ? (rule.ranges || []).filter((r) => r.start && r.end) : [];
  const usual = { open: usualRanges.length > 0, ranges: usualRanges };
  const exception = schedule?.exceptions?.find((e) => e.date === iso) || null;
  if (!exception) return { ...usual, usual, exception: null };
  if (exception.closed) return { open: false, ranges: [], usual, exception };
  return { open: exception.ranges.length > 0, ranges: exception.ranges, usual, exception };
}

const h = (hhmm: string) => {
  const [hh, mm] = hhmm.split(':');
  return `${Number(hh)}h${mm && mm !== '00' ? mm : ''}`;
};
export const rangesLabel = (ranges: DayRange[]) => ranges.map((r) => `${h(r.start)}–${h(r.end)}`).join(' · ');

/** La pastille sous la date, dans l'en-tête du planning : un clic ouvre la journée. */
export function DayStateChip({ state, onClick }: { state: DayState; onClick: () => void }) {
  const { exception, open } = state;
  // Court : la colonne d'un jour fait ~130 px. Le détail est dans l'infobulle et la fenêtre.
  const [label, tone] = exception
    ? open
      ? [`Ouvert · ${rangesLabel(state.ranges)}`, 'border-emerald-300 bg-emerald-50 text-emerald-800']
      : ['Fermé ce jour', 'border-rose-300 bg-rose-50 text-rose-800']
    : open
      ? [rangesLabel(state.ranges), 'border-transparent text-muted-foreground hover:border-border']
      : ['Fermé · ouvrir ?', 'border-dashed border-muted-foreground/40 text-muted-foreground'];
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`mt-1 inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 text-[11px] font-medium transition hover:bg-muted ${tone}`}
      title={exception
        ? `${open ? 'Ouvert' : 'Fermé'} exceptionnellement à la réservation en ligne${exception.reason ? ` — ${exception.reason}` : ''}`
        : 'Ouvrir ou fermer cette journée à la réservation en ligne'}
      data-testid="day-state-chip"
      data-state={exception ? (open ? 'open-exception' : 'closed-exception') : open ? 'open' : 'closed'}
    >
      {label}
    </button>
  );
}

type Mode = 'usual' | 'open' | 'closed';

/** Des plages de départ pour ouvrir un jour fermé : celles d'un jour ouvert de la semaine type. */
function suggestedRanges(schedule: ScheduleLike | null | undefined, state: DayState): DayRange[] {
  if (state.exception && !state.exception.closed && state.exception.ranges.length) return state.exception.ranges;
  if (state.usual.ranges.length) return state.usual.ranges;
  const open = (schedule?.weeklyHours || []).find((d) => d.enabled && d.ranges?.some((r) => r.start && r.end));
  return open ? open.ranges.filter((r) => r.start && r.end) : [{ start: '09:00', end: '18:00' }];
}

export function DayOverrideModal({
  date,
  schedule,
  onClose,
  onSaved,
}: {
  date: Date | null;
  schedule: ScheduleLike | null | undefined;
  onClose: () => void;
  onSaved: (schedule: ScheduleLike, message: string) => void;
}) {
  const state = date ? dayState(schedule, date) : null;
  const [mode, setMode] = React.useState<Mode>('usual');
  const [ranges, setRanges] = React.useState<DayRange[]>([]);
  const [reason, setReason] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const dateKey = date ? isoOf(date) : '';

  React.useEffect(() => {
    if (!date) return;
    const s = dayState(schedule, date);
    setMode(s.exception ? (s.exception.closed ? 'closed' : 'open') : s.usual.open ? 'usual' : 'open');
    setRanges(suggestedRanges(schedule, s).map((r) => ({ ...r })));
    setReason(s.exception?.reason || '');
    setError('');
    // Réinitialisé à chaque journée ouverte, pas à chaque rechargement du planning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  if (!date || !state) return null;
  const longDay = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const title = longDay.charAt(0).toUpperCase() + longDay.slice(1);
  const usualText = state.usual.open ? `ouvert, ${rangesLabel(state.usual.ranges)}` : 'fermé';

  async function save() {
    setSaving(true);
    setError('');
    try {
      let saved: ScheduleLike;
      let message: string;
      if (mode === 'usual') {
        saved = await api.clearCalendarDay(dateKey);
        message = `${title} : retour aux horaires classiques (${usualText}).`;
      } else if (mode === 'closed') {
        saved = await api.saveCalendarDay(dateKey, { closed: true, reason });
        message = `${title} : fermé à la réservation en ligne.`;
      } else {
        saved = await api.saveCalendarDay(dateKey, { closed: false, ranges, reason });
        message = `${title} : ouvert à la réservation en ligne, ${rangesLabel(ranges)}.`;
      }
      onSaved(saved, message);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  }

  const choices: { value: Mode; label: string; hint: string; icon: React.ReactNode }[] = [
    { value: 'usual', label: 'Horaires classiques', hint: `D’habitude ce jour-là : ${usualText}.`, icon: <RotateCcw className="h-4 w-4" /> },
    { value: 'open', label: 'Ouvrir cette journée', hint: 'Les clientes peuvent réserver en ligne aux heures choisies.', icon: <CalendarCheck className="h-4 w-4" /> },
    { value: 'closed', label: 'Fermer toute la journée', hint: 'Aucune réservation en ligne ce jour-là.', icon: <CalendarX className="h-4 w-4" /> },
  ];

  return (
    <Modal open={Boolean(date)} onClose={onClose} title={title} description="Ce jour seulement : vos horaires classiques ne changent pas." className="max-w-lg" busy={saving}>
      <div className="grid gap-4" data-testid="day-override">
        <div className="grid gap-2" role="radiogroup" aria-label="Cette journée">
          {choices.map((c) => (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={mode === c.value}
              onClick={() => setMode(c.value)}
              data-testid={`day-mode-${c.value}`}
              className={`flex items-start gap-3 rounded-lg border p-3 text-left transition ${mode === c.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
            >
              <span className={`mt-0.5 ${mode === c.value ? 'text-primary' : 'text-muted-foreground'}`}>{c.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{c.label}</span>
                <span className="block text-xs text-muted-foreground">{c.hint}</span>
              </span>
              {/* La pastille dit le choix : le contour seul se confondait avec le focus clavier. */}
              <span aria-hidden className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${mode === c.value ? 'border-primary' : 'border-muted-foreground/40'}`}>
                {mode === c.value && <span className="h-2 w-2 rounded-full bg-primary" />}
              </span>
            </button>
          ))}
        </div>

        {mode === 'open' && (
          <div className="grid gap-2 rounded-lg border bg-muted/20 p-3">
            <p className="text-sm font-medium">Heures d’ouverture ce jour-là</p>
            {ranges.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                <Input type="time" aria-label={`Début plage ${i + 1}`} value={r.start} onChange={(e) => setRanges(ranges.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} data-testid={`day-range-start-${i}`} />
                <Input type="time" aria-label={`Fin plage ${i + 1}`} value={r.end} onChange={(e) => setRanges(ranges.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} data-testid={`day-range-end-${i}`} />
                <Button type="button" size="icon" variant="ghost" aria-label="Retirer la plage" disabled={ranges.length <= 1} onClick={() => setRanges(ranges.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {ranges.length < 4 && (
              <Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={() => setRanges([...ranges, { start: '14:00', end: '18:00' }])}>
                <Plus className="h-4 w-4" /> Ajouter une plage
              </Button>
            )}
          </div>
        )}

        {mode !== 'usual' && (
          <Field label="Motif (facultatif, pour vous)">
            <Input value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} placeholder={mode === 'open' ? 'Samedi des fêtes' : 'Congé, formation…'} />
          </Field>
        )}

        <p className="text-xs text-muted-foreground">
          Seule la réservation en ligne suit ce réglage. Au planning, vous pouvez toujours poser un rendez-vous à la main, même un jour fermé.
        </p>
        {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Annuler</Button>
          <Button onClick={save} loading={saving} data-testid="day-save">Enregistrer</Button>
        </div>
      </div>
    </Modal>
  );
}
