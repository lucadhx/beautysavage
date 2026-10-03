import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { commerceApi } from '@/lib/api';

export type Slot = { startsAt: string; endsAt: string; durationMinutes: number };

const dayKey = (value: string | Date) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const MAX_MONTHS_AHEAD = 12;

/**
 * LE CALENDRIER DE RÉSERVATION — un mois à la fois, flèches pour passer au
 * suivant ou revenir au précédent. La flèche « précédent » est grisée sur le
 * mois en cours : on ne réserve pas dans le passé. Les jours sans créneau sont
 * grisés ; un jour choisi montre ses heures.
 */
export function BookingMonthCalendar({ durationMinutes, slot, onSlot }: {
  durationMinutes: number;
  slot: Slot | null;
  onSlot: (slot: Slot | null) => void;
}) {
  const today = React.useMemo(() => new Date(), []);
  const firstMonth = React.useMemo(() => monthStart(today), [today]);
  const [month, setMonth] = React.useState(firstMonth);
  const [direction, setDirection] = React.useState(1);
  const [byMonth, setByMonth] = React.useState<Record<string, Slot[]>>({});
  const [loading, setLoading] = React.useState(true);
  const [day, setDay] = React.useState('');
  const autoAdvanced = React.useRef(0);
  const key = dayKey(month).slice(0, 7);

  React.useEffect(() => {
    if (byMonth[key]) { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    const from = sameMonth(month, today) ? today : month;
    const to = addMonths(month, 1);
    commerceApi.availability({ from: from.toISOString(), to: to.toISOString(), durationMinutes: Math.max(15, durationMinutes) })
      .then((list) => {
        if (!alive) return;
        setByMonth((m) => ({ ...m, [key]: list }));
        // Mois en cours complet : on montre directement le premier mois qui a des créneaux.
        if (list.length === 0 && autoAdvanced.current < 3 && sameMonth(month, firstMonth)) {
          autoAdvanced.current += 1;
          setMonth((m) => addMonths(m, 1));
        }
      })
      .catch(() => alive && setByMonth((m) => ({ ...m, [key]: [] })))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const slots = byMonth[key] || [];
  const byDay = React.useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) map.set(dayKey(s.startsAt), [...(map.get(dayKey(s.startsAt)) || []), s]);
    return map;
  }, [slots]);

  // Premier jour libre du mois choisi d'office.
  React.useEffect(() => {
    if (loading) return;
    if (!day || !byDay.has(day)) {
      const first = [...byDay.keys()][0] || '';
      setDay(first);
    }
  }, [byDay, loading, day]);

  const canPrev = !sameMonth(month, firstMonth);
  const canNext = month < addMonths(firstMonth, MAX_MONTHS_AHEAD);
  const go = (n: number) => { setDirection(n); setMonth((m) => addMonths(m, n)); setDay(''); onSlot(null); };

  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const lead = (month.getDay() + 6) % 7; // lundi en premier
  const label = month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const todayKey = dayKey(today);

  return (
    <div className="grid gap-4" data-testid="booking-calendar">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => canPrev && go(-1)} disabled={!canPrev} aria-label="Mois précédent" data-testid="cal-prev"
          className="grid h-10 w-10 place-items-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-35"
          style={{ borderColor: 'var(--v-border)' }}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <p className="text-base font-semibold capitalize" data-testid="cal-month">{label}</p>
        <button type="button" onClick={() => canNext && go(1)} disabled={!canNext} aria-label="Mois suivant" data-testid="cal-next"
          className="grid h-10 w-10 place-items-center rounded-full border transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-35"
          style={{ borderColor: 'var(--v-border)' }}>
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="relative overflow-hidden">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div key={key} custom={direction}
            initial={{ x: direction * 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -direction * 40, opacity: 0 }} transition={{ duration: 0.22 }}
            className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((w, i) => <span key={i} className="pb-1 text-[11px] font-semibold uppercase" style={{ color: 'var(--v-muted-foreground)' }}>{w}</span>)}
            {Array.from({ length: lead }).map((_, i) => <span key={`l${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const date = new Date(month.getFullYear(), month.getMonth(), i + 1);
              const k = dayKey(date);
              const open = byDay.has(k);
              const active = k === day;
              return (
                <button key={k} type="button" disabled={!open || loading} onClick={() => { setDay(k); onSlot(null); }}
                  data-testid={open ? 'cal-day-open' : 'cal-day'} data-day={k} aria-pressed={active}
                  className="relative mx-auto grid aspect-square w-full max-w-[46px] place-items-center rounded-full text-sm transition disabled:cursor-default"
                  style={{
                    background: active ? 'var(--v-primary)' : open ? 'color-mix(in srgb, var(--v-accent) 14%, transparent)' : 'transparent',
                    color: active ? 'var(--v-primary-foreground)' : open ? 'inherit' : 'color-mix(in srgb, var(--v-muted-foreground) 55%, transparent)',
                    fontWeight: open ? 600 : 400,
                  }}>
                  {i + 1}
                  {k === todayKey && !active && <span className="absolute bottom-1 h-1 w-1 rounded-full" style={{ background: 'var(--v-accent)' }} />}
                </button>
              );
            })}
          </motion.div>
        </AnimatePresence>
        {loading && (
          <div className="absolute inset-0 grid place-items-center" style={{ background: 'color-mix(in srgb, var(--v-surface) 60%, transparent)' }}>
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
      </div>

      {!loading && slots.length === 0 && (
        <p className="rounded-md border border-dashed p-4 text-center text-sm" style={{ color: 'var(--v-muted-foreground)', borderColor: 'var(--v-border)' }} data-testid="cal-empty">
          Plus aucun créneau ce mois-ci. {canNext ? 'Essayez le mois suivant.' : ''}
        </p>
      )}

      {day && byDay.get(day) && (
        <div className="grid gap-2">
          <p className="text-sm font-semibold capitalize">{new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {(byDay.get(day) || []).map((item) => {
              const active = slot?.startsAt === item.startsAt;
              return (
                <button key={item.startsAt} type="button" data-testid="booking-slot" onClick={() => onSlot(item)}
                  className="rounded-md border px-3 py-3 text-center text-sm font-semibold transition"
                  style={{ borderColor: active ? 'var(--v-primary)' : 'var(--v-border)', background: active ? 'color-mix(in srgb, var(--v-primary) 12%, var(--v-surface))' : 'transparent' }}>
                  {new Date(item.startsAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
