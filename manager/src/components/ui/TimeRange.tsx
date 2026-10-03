import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronLeft, ChevronRight, Clock, GripVertical, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * CHOISIR DES HORAIRES SANS SÉLECTEUR NATIF.
 *
 * Les champs « date » et « heure » du navigateur ne savent rien de l'agenda,
 * changent d'allure d'un appareil à l'autre et sont minuscules au doigt. Ces
 * composants les remplacent partout où l'on réserve :
 *
 *   MonthCalendar   un mois, sept colonnes, jours passés grisés ;
 *   TimeSelect      une heure, en cases d'un quart d'heure ;
 *   DayTimeline     la journée en frise : ce qui est déjà pris (gris) et la
 *                   plage choisie (verte, rouge si elle chevauche) ;
 *   RangeEditor     « Modifier » : la frise + les heures ; choisir une heure
 *                   redessine la plage, puis « Valider » ou « Annuler ».
 *
 * Tout se lit sur un téléphone : cases de 40 px, grilles qui passent de 4 à
 * 6 colonnes, frise qui occupe toute la largeur.
 */

export const DAY_OPEN = 7 * 60;
export const DAY_CLOSE = 21 * 60;
export const STEP = 15;

export interface Busy { id: string; title: string; startsAt: string | Date; endsAt: string | Date; type?: string }

export const pad = (n: number) => String(n).padStart(2, '0');
export const hm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
export const minutesOfDate = (d: Date) => d.getHours() * 60 + d.getMinutes();
export const atMinutes = (day: Date, minutes: number) => { const d = new Date(day); d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0); return d; };
export const sameDate = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export function durationLabel(minutes: number) {
  if (minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${pad(m)}` : ''}` : `${m} min`;
}
export function longDay(d: Date) {
  const t = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Les occupations d'un jour, en minutes depuis minuit, bornées à la journée. */
export function busyOfDay(busy: Busy[], day: Date) {
  return busy
    .map((b) => ({ ...b, s: new Date(b.startsAt), e: new Date(b.endsAt) }))
    .filter((b) => b.s < atMinutes(day, 24 * 60) && b.e > atMinutes(day, 0))
    .map((b) => ({
      id: b.id,
      title: b.title,
      type: b.type,
      from: sameDate(b.s, day) ? minutesOfDate(b.s) : 0,
      to: sameDate(b.e, day) ? minutesOfDate(b.e) : 24 * 60,
    }))
    .sort((a, b) => a.from - b.from);
}

export function overlaps<T extends { from: number; to: number }>(busy: T[], from: number, to: number): T[] {
  return busy.filter((b) => from < b.to && to > b.from);
}

/* ─────────────────────────────── Calendrier ─────────────────────────────── */

const WEEK = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export function MonthCalendar({ value, onChange, minDate, testId = 'month-calendar' }: {
  value: Date | null;
  onChange: (day: Date) => void;
  minDate?: Date;
  testId?: string;
}) {
  const [month, setMonth] = React.useState(() => { const d = new Date(value || new Date()); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const floor = minDate ? new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate()) : null;
  const first = (month.getDay() || 7) - 1;
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: first + count }, (_, i) => (i < first ? null : new Date(month.getFullYear(), month.getMonth(), i - first + 1)));
  const today = new Date();
  const label = month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return (
    <div className="grid gap-2" data-testid={testId}>
      <div className="flex items-center justify-between">
        <button type="button" aria-label="Mois précédent" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="grid h-10 w-10 place-items-center rounded-lg border hover:bg-muted"><ChevronLeft className="h-4 w-4" /></button>
        <p className="text-sm font-semibold capitalize">{label}</p>
        <button type="button" aria-label="Mois suivant" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="grid h-10 w-10 place-items-center rounded-lg border hover:bg-muted"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-muted-foreground">
        {WEEK.map((d, i) => <span key={i}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const disabled = Boolean(floor && d < floor);
          const selected = Boolean(value && sameDate(d, value));
          const isToday = sameDate(d, today);
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => onChange(d)}
              data-day={`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`}
              className={cn(
                'h-10 rounded-lg text-sm font-semibold tabular-nums transition',
                selected ? 'bg-primary text-primary-foreground shadow-sm' : disabled ? 'cursor-not-allowed text-muted-foreground/40' : 'hover:bg-muted',
                isToday && !selected && 'ring-1 ring-primary/50',
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────── Heures ─────────────────────────────── */

export type CellState = 'free' | 'busy' | 'conflict' | 'past';

function TimeCells({ times, selected, stateOf, onPick, inRange, testId }: {
  times: number[];
  selected: number | null;
  stateOf?: (minute: number) => CellState;
  onPick: (minute: number) => void;
  inRange?: (minute: number) => boolean;
  testId?: string;
}) {
  return (
    <div className="grid max-h-64 grid-cols-4 gap-1.5 overflow-y-auto overscroll-contain p-0.5 sm:grid-cols-6" data-testid={testId}>
      {times.map((minute) => {
        const state = stateOf ? stateOf(minute) : 'free';
        const isSel = minute === selected;
        // Une heure qui créerait un chevauchement est grisée, comme une heure prise.
        const blocked = state === 'past' || state === 'busy' || state === 'conflict';
        return (
          <button
            key={minute}
            type="button"
            disabled={blocked && !isSel}
            onClick={() => onPick(minute)}
            data-time={hm(minute)}
            data-state={state}
            className={cn(
              'h-10 rounded-lg border text-sm font-semibold tabular-nums transition',
              isSel ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                : state === 'conflict' ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 line-through decoration-slate-400/70'
                  : inRange?.(minute) ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                    : state === 'busy' ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                      : state === 'past' ? 'cursor-not-allowed border-transparent text-muted-foreground/40'
                        : 'border-border bg-card hover:border-primary/60 hover:bg-primary/5',
            )}
          >
            {hm(minute)}
          </button>
        );
      })}
    </div>
  );
}

/** Une heure (HH:MM), choisie dans une grille de quarts d'heure qui se déplie. */
export function TimeSelect({ value, onChange, label, from = DAY_OPEN, to = DAY_CLOSE, testId, stateOf }: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  from?: number;
  to?: number;
  testId?: string;
  /** Heures interdites (prises, ou qui feraient chevaucher) : grisées, non cliquables. */
  stateOf?: (minute: number) => CellState;
}) {
  const [open, setOpen] = React.useState(false);
  const [h, m] = value.split(':').map(Number);
  const current = Number.isFinite(h) ? h * 60 + (m || 0) : null;
  const times = Array.from({ length: Math.floor((to - from) / STEP) + 1 }, (_, i) => from + i * STEP);
  return (
    <div className="grid gap-2" data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={label}
        className={cn('inline-flex h-11 w-full items-center justify-between gap-2 rounded-lg border bg-background px-3 text-left text-sm font-semibold tabular-nums transition hover:border-primary/60', open && 'border-primary ring-2 ring-primary/15')}
      >
        <span className="inline-flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" />{value || '--:--'}</span>
        <span className="text-xs font-medium text-muted-foreground">{open ? 'Fermer' : 'Choisir'}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            <div className="rounded-lg border bg-muted/20 p-2">
              <TimeCells times={times} selected={current} stateOf={stateOf} onPick={(minute) => { onChange(hm(minute)); setOpen(false); }} testId={testId ? `${testId}-grid` : undefined} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─────────────────────────────── Frise ─────────────────────────────── */

/**
 * LA JOURNÉE EN FRISE — de l'ouverture à la fermeture, sur toute la largeur.
 * Gris : déjà pris. Vert : la plage choisie ; rouge si elle chevauche.
 *
 * Avec `onMove`, la plage verte se FAIT GLISSER (souris ou doigt, flèches au
 * clavier) : elle avance par quarts d'heure en gardant sa durée. Elle peut
 * passer SUR un créneau déjà pris — elle devient alors rouge — mais, relâchée
 * là, elle repart en ressort vers la position libre la plus proche. Chaque
 * pas remonte aussitôt (`onMove`), d'où l'heure et la fin estimée en direct.
 */
export function DayTimeline({ busy, from, to, open = DAY_OPEN, close = DAY_CLOSE, testId, onMove }: {
  busy: { id: string; title: string; from: number; to: number }[];
  from: number | null;
  to: number | null;
  open?: number;
  close?: number;
  testId?: string;
  onMove?: (from: number) => void;
}) {
  const span = close - open;
  const pct = (minute: number) => `${(Math.min(close, Math.max(open, minute)) - open) / span * 100}%`;
  const width = (a: number, b: number) => `${(Math.min(close, b) - Math.max(open, a)) / span * 100}%`;
  const conflict = from !== null && to !== null && overlaps(busy, from, to).length > 0;
  const ticks = Array.from({ length: Math.floor(span / 60) + 1 }, (_, i) => open + i * 60);
  const bar = React.useRef<HTMLDivElement | null>(null);
  const drag = React.useRef<{ x0: number; from0: number; min: number; max: number } | null>(null);
  const [dragging, setDragging] = React.useState(false);
  /** Vrai le temps du retour en ressort vers une position libre. */
  const [snapping, setSnapping] = React.useState(false);

  /** La position libre (au quart d'heure) la plus proche de `f`, ou null. */
  const nearestFree = (f: number, length: number) => {
    let best: number | null = null;
    for (let c = open; c + length <= close; c += STEP) {
      if (overlaps(busy, c, c + length).length) continue;
      if (best === null || Math.abs(c - f) < Math.abs(best - f)) best = c;
    }
    return best;
  };

  /** Jusqu'où la plage peut aller sans toucher un créneau pris (butées). */
  const limits = (f: number, t: number) => {
    const length = t - f;
    let min = open;
    let max = close - length;
    // Plage déjà en conflit : on la laisse se dégager librement.
    if (overlaps(busy, f, t).length === 0) {
      for (const b of busy) {
        if (b.to <= f) min = Math.max(min, b.to);
        if (b.from >= t) max = Math.min(max, b.from - length);
      }
    }
    return { min, max };
  };
  const place = (target: number, min: number, max: number) => {
    const snapped = Math.round(target / STEP) * STEP;
    return Math.min(max, Math.max(min, snapped));
  };

  const start = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (!onMove || from === null || to === null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    // Pendant le glissement, toute la journée est permise (la plage rougit sur le gris).
    drag.current = { x0: event.clientX, from0: from, min: open, max: close - (to - from) };
    setSnapping(false);
    setDragging(true);
  };
  const move = (event: React.PointerEvent<HTMLSpanElement>) => {
    const d = drag.current;
    if (!d || !bar.current || !onMove) return;
    const delta = ((event.clientX - d.x0) / bar.current.getBoundingClientRect().width) * span;
    const next = place(d.from0 + delta, d.min, d.max);
    if (next !== from) onMove(next);
  };
  const end = () => {
    const wasDragging = Boolean(drag.current);
    drag.current = null;
    setDragging(false);
    // Relâchée sur un créneau pris : retour animé vers la position libre la plus proche.
    if (wasDragging && onMove && from !== null && to !== null && overlaps(busy, from, to).length) {
      const free = nearestFree(from, to - from);
      if (free !== null && free !== from) {
        setSnapping(true);
        onMove(free);
        window.setTimeout(() => setSnapping(false), 700);
      }
    }
  };
  const key = (event: React.KeyboardEvent<HTMLSpanElement>) => {
    if (!onMove || from === null || to === null) return;
    const step = event.key === 'ArrowRight' ? STEP : event.key === 'ArrowLeft' ? -STEP : 0;
    if (!step) return;
    event.preventDefault();
    const { min, max } = limits(from, to);
    const next = place(from + step, min, max);
    if (next !== from) onMove(next);
  };

  return (
    <div className="grid gap-1" data-testid={testId}>
      <div ref={bar} className="relative h-12 overflow-hidden rounded-lg border bg-card">
        {ticks.map((t) => <span key={t} className="absolute inset-y-0 w-px bg-border/70" style={{ left: pct(t) }} />)}
        {busy.filter((b) => b.to > open && b.from < close).map((b) => (
          <span key={b.id} title={`${hm(b.from)}–${hm(b.to)} ${b.title}`} className="absolute inset-y-1.5 rounded bg-slate-300/80" style={{ left: pct(b.from), width: width(b.from, b.to) }} />
        ))}
        {from !== null && to !== null && to > from && (
          <motion.span
            layout={!dragging}
            data-testid={testId ? `${testId}-range` : undefined}
            role={onMove ? 'slider' : undefined}
            tabIndex={onMove ? 0 : undefined}
            aria-label={onMove ? `Créneau ${hm(from)} – ${hm(to)} : glisser pour le déplacer` : undefined}
            aria-valuemin={onMove ? open : undefined}
            aria-valuemax={onMove ? close : undefined}
            aria-valuenow={onMove ? from : undefined}
            aria-valuetext={onMove ? `${hm(from)} – ${hm(to)}` : undefined}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={key}
            className={cn(
              'absolute inset-y-0.5 grid place-items-center rounded-md border-2 outline-none',
              conflict ? 'border-rose-500 bg-rose-500/25' : 'border-emerald-600 bg-emerald-500/30',
              // Zone de prise plus large que la plage : une plage d'une heure fait ~24 px sur téléphone.
              onMove && "touch-none cursor-grab select-none focus-visible:ring-2 focus-visible:ring-primary/50 before:absolute before:-inset-x-4 before:inset-y-0 before:content-['']",
              dragging && 'cursor-grabbing shadow-lg',
            )}
            style={{ left: pct(from), width: width(from, to) }}
            transition={snapping ? { type: 'spring', stiffness: 260, damping: 14, mass: 0.9 } : { type: 'spring', stiffness: 380, damping: 32 }}
            data-snapping={snapping || undefined}
          >
            {onMove && <GripVertical className={cn('h-4 w-4', conflict ? 'text-rose-700' : 'text-emerald-800')} aria-hidden />}
          </motion.span>
        )}
      </div>
      <div className="relative h-4 text-[10px] font-medium tabular-nums text-muted-foreground">
        {ticks.filter((_, i) => i % 2 === 0).map((t) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: pct(t) }}>{pad(Math.floor(t / 60))}h</span>
        ))}
      </div>
      {onMove && <p className="text-[11px] text-muted-foreground">Faites glisser le créneau vert pour le déplacer. Relâché sur un créneau déjà pris (rouge), il rejoint la place libre la plus proche.</p>}
    </div>
  );
}

/* ─────────────────────────────── Modifier une plage ─────────────────────────────── */

/**
 * « MODIFIER » — la plage réservée, en frise, et les heures au-dessous.
 * Choisir une heure redessine la plage ; « Valider » l'applique, « Annuler »
 * revient à la plage d'avant. Par défaut on règle la FIN (le début est déjà
 * choisi) ; l'onglet « Début » déplace la plage en gardant sa durée.
 */
export function RangeEditor({ day, from, to, busy, onConfirm, onCancel, allowStart = true, testId = 'range-editor' }: {
  day: Date;
  from: number;
  to: number;
  busy: { id: string; title: string; from: number; to: number }[];
  onConfirm: (from: number, to: number) => void;
  onCancel: () => void;
  allowStart?: boolean;
  testId?: string;
}) {
  const [draft, setDraft] = React.useState({ from, to });
  const [mode, setMode] = React.useState<'end' | 'start'>('end');
  const changed = draft.from !== from || draft.to !== to;
  const length = draft.to - draft.from;
  const now = new Date();
  const clashes = overlaps(busy, draft.from, draft.to);
  const inBusy = (minute: number) => busy.some((b) => minute >= b.from && minute < b.to);
  const endTimes = Array.from({ length: Math.floor((DAY_CLOSE - draft.from) / STEP) }, (_, i) => draft.from + (i + 1) * STEP);
  const startTimes = Array.from({ length: Math.floor((DAY_CLOSE - DAY_OPEN) / STEP) }, (_, i) => DAY_OPEN + i * STEP).filter((m) => m + length <= DAY_CLOSE);
  const endState = (minute: number): CellState => (overlaps(busy, draft.from, minute).length ? 'conflict' : 'free');
  const startState = (minute: number): CellState => {
    if (atMinutes(day, minute) < now) return 'past';
    if (inBusy(minute)) return 'busy';
    return overlaps(busy, minute, minute + length).length ? 'conflict' : 'free';
  };
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-[minmax(0,1fr)] gap-4 rounded-xl border-2 border-primary/30 bg-card p-3 sm:p-4" data-testid={testId}>
      {/* Collée en haut : la plage reste visible pendant qu'on choisit l'heure. */}
      <div className="sticky -top-5 z-10 -mx-3 -mt-3 grid gap-2 rounded-t-xl border-b bg-card px-3 pb-3 pt-3 sm:-mx-4 sm:-mt-4 sm:px-4 sm:pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">{longDay(day)}</p>
          <p className="text-sm tabular-nums">
            <span className="font-semibold">{hm(draft.from)} → {hm(draft.to)}</span>
            <span className="text-muted-foreground"> · {durationLabel(length)}</span>
          </p>
        </div>
        <DayTimeline busy={busy} from={draft.from} to={draft.to} testId={`${testId}-timeline`} onMove={(m) => setDraft({ from: m, to: m + length })} />
      </div>
      {clashes.length > 0 && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert" data-testid={`${testId}-conflict`}>
          Chevauche : {clashes.map((c) => `${c.title} (${hm(c.from)}–${hm(c.to)})`).join(', ')}
        </p>
      )}
      {allowStart && (
        <div className="inline-flex w-full rounded-lg border bg-muted/30 p-1 sm:w-auto">
          {(['end', 'start'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={cn('h-9 flex-1 rounded-md px-4 text-sm font-semibold transition sm:flex-none', mode === m ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
              {m === 'end' ? 'Fin' : 'Début'}
            </button>
          ))}
        </div>
      )}
      {mode === 'end' ? (
        <TimeCells times={endTimes} selected={draft.to} stateOf={endState} inRange={(m) => m < draft.to} onPick={(m) => setDraft({ ...draft, to: m })} testId={`${testId}-end`} />
      ) : (
        <TimeCells times={startTimes} selected={draft.from} stateOf={startState} onPick={(m) => setDraft({ from: m, to: m + length })} testId={`${testId}-start`} />
      )}
      {/* Les deux boutons n'apparaissent qu'une fois une heure choisie. */}
      <AnimatePresence mode="wait" initial={false}>
        {changed ? (
          <motion.div key="decide" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <button type="button" onClick={onCancel} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border px-5 text-sm font-semibold hover:bg-muted" data-testid={`${testId}-cancel`}>
              <X className="h-4 w-4" /> Annuler
            </button>
            <button
              type="button"
              disabled={draft.to <= draft.from}
              onClick={() => onConfirm(draft.from, draft.to)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition disabled:opacity-40"
              data-testid={`${testId}-confirm`}
            >
              <Check className="h-4 w-4" /> Valider
            </button>
          </motion.div>
        ) : (
          <motion.div key="close" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex justify-end">
            <button type="button" onClick={onCancel} className="inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-muted-foreground hover:bg-muted" data-testid={`${testId}-close`}>
              Fermer
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
