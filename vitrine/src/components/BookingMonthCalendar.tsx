import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { commerceApi, type SlotSegment } from '@/lib/api';
import { deviceOutsideInstituteTime, instituteDay, instituteDayKey, instituteTime } from '@/lib/instituteTime';

/** `segments` : une heure par prestation quand plusieurs s'enchaînent. */
export type Slot = { startsAt: string; endsAt: string; durationMinutes: number; segments?: SlotSegment[] };

/**
 * La clé d'une CASE du calendrier. `month` et ses cases sont de simples repères
 * année / mois / jour (construits à partir du jour À L'INSTITUT) ; les créneaux,
 * eux, sont des instants, rangés avec `instituteDayKey`.
 */
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
 *
 * TOUT EST À L'HEURE DE L'INSTITUT (lib/instituteTime) : un téléphone réglé sur
 * un autre fuseau voyait « 10:00 » pour un rendez-vous de 11 h à Nice.
 *
 * LES HEURES SE VOIENT : sous le calendrier, elles tombaient hors de l'écran
 * d'un téléphone, et toucher un jour semblait ne rien faire. Toucher un jour
 * les amène à l'écran ; tant qu'elles n'y sont pas, un repère les annonce.
 *
 * Les heures proposées dépendent de la prestation ET de ses options (le
 * serveur additionne leurs minutes), et, depuis le panier, des autres
 * prestations de la cliente. Tout changement de l'un d'eux — ou `refreshKey`,
 * incrémenté par l'écran après un refus d'heure — relit les disponibilités :
 * une heure refusée ne reste jamais affichée comme libre.
 */
export function BookingMonthCalendar({ durationMinutes, productId, optionKeys, cartLineId, sequence, cartGroupId, refreshKey = 0, slot, onSlot }: {
  durationMinutes: number;
  productId?: string;
  optionKeys?: string[];
  cartLineId?: string;
  /** Plusieurs prestations à la suite (`idA:opt,idB`) : la durée cherchée est leur somme. */
  sequence?: string;
  /** L'enchaînement du panier que l'on déplace : il ne se bloque pas lui-même. */
  cartGroupId?: string;
  refreshKey?: number;
  slot: Slot | null;
  onSlot: (slot: Slot | null) => void;
}) {
  // Aujourd'hui À L'INSTITUT (repère année / mois / jour).
  const today = React.useMemo(() => { const d = instituteDay(); return new Date(d.year, d.month - 1, d.day); }, []);
  const firstMonth = React.useMemo(() => monthStart(today), [today]);
  const [month, setMonth] = React.useState(firstMonth);
  const [direction, setDirection] = React.useState(1);
  const [byMonth, setByMonth] = React.useState<Record<string, Slot[]>>({});
  const [loading, setLoading] = React.useState(true);
  const [day, setDay] = React.useState('');
  const autoAdvanced = React.useRef(0);
  const hoursRef = React.useRef<HTMLDivElement>(null);
  const [hoursInView, setHoursInView] = React.useState(true);
  const outsideTime = React.useMemo(() => deviceOutsideInstituteTime(), []);
  const showHours = () => hoursRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  // Le jour vient d'être touché : ses heures sont amenées à l'écran une fois affichées.
  const scrollAfterPick = React.useRef(false);
  const monthKey = dayKey(month).slice(0, 7);
  const options = (optionKeys || []).join(',');
  const key = [monthKey, durationMinutes, productId || '', options, cartLineId || '', sequence || '', cartGroupId || '', refreshKey].join('|');

  React.useEffect(() => {
    if (byMonth[key]) { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    // Le mois de l'institut, avec une marge (les créneaux sont ensuite triés par jour à l'institut).
    const margin = 14 * 3600_000;
    const from = sameMonth(month, today) ? new Date() : new Date(Date.UTC(month.getFullYear(), month.getMonth(), 1) - margin);
    const to = new Date(Date.UTC(month.getFullYear(), month.getMonth() + 1, 1) + margin);
    commerceApi.availability({ from: from.toISOString(), to: to.toISOString(), durationMinutes: Math.max(15, durationMinutes), productId, optionKeys, cartLineId, sequence, cartGroupId })
      .then((all) => {
        if (!alive) return;
        const list = all.filter((s) => instituteDayKey(s.startsAt).startsWith(monthKey));
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
    for (const s of slots) { const k = instituteDayKey(s.startsAt); map.set(k, [...(map.get(k) || []), s]); }
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

  // Les heures du jour choisi sont-elles à l'écran ? (le navigateur tient compte de la zone qui défile)
  const hoursShown = Boolean(day && byDay.get(day));
  React.useEffect(() => {
    // Le PREMIER BOUTON d'heure, entier — pas le bloc : son titre peut dépasser en bas de l'écran alors qu'aucune heure n'est visible.
    const el = hoursRef.current?.querySelector('[data-testid="booking-slot"]');
    if (!el || !hoursShown) { setHoursInView(true); return undefined; }
    const io = new IntersectionObserver(([entry]) => setHoursInView(entry.isIntersecting && entry.intersectionRatio >= 0.95), { threshold: [0, 0.95, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, [hoursShown, day]);
  React.useEffect(() => {
    if (!scrollAfterPick.current || !hoursShown) return;
    scrollAfterPick.current = false;
    showHours();
  }, [day, hoursShown]);

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
          <motion.div key={monthKey} custom={direction}
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
                <button key={k} type="button" disabled={!open || loading} onClick={() => { scrollAfterPick.current = true; if (k === day) showHours(); setDay(k); onSlot(null); }}
                  data-testid={open ? 'cal-day-open' : 'cal-day'} data-day={k} aria-pressed={active}
                  className="relative mx-auto grid aspect-square w-full max-w-[38px] place-items-center sm:max-w-[46px] rounded-full text-sm transition disabled:cursor-default"
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

      {outsideTime && (
        <p className="text-center text-xs" style={{ color: 'var(--v-muted-foreground)' }} data-testid="cal-time-note">
          Horaires à l’heure de l’institut, en France (il y est {instituteTime(new Date())}).
        </p>
      )}

      {day && byDay.get(day) && !hoursInView && (
        <button type="button" onClick={showHours} data-testid="cal-hours-cue"
          className="sticky bottom-1 z-10 mx-auto inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold shadow-lg"
          style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>
          Voir les horaires ({byDay.get(day)?.length}) <ChevronDown className="h-4 w-4" />
        </button>
      )}

      {day && byDay.get(day) && (
        <div ref={hoursRef} className="grid scroll-mt-2 gap-2" data-testid="cal-hours">
          <p className="text-sm font-semibold capitalize">{new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {(byDay.get(day) || []).map((item) => {
              const active = slot?.startsAt === item.startsAt;
              return (
                <button key={item.startsAt} type="button" data-testid="booking-slot" onClick={() => onSlot(item)}
                  className="rounded-md border px-3 py-3 text-center text-sm font-semibold transition"
                  style={{ borderColor: active ? 'var(--v-primary)' : 'var(--v-border)', background: active ? 'color-mix(in srgb, var(--v-primary) 12%, var(--v-surface))' : 'transparent' }}>
                  {instituteTime(item.startsAt)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
