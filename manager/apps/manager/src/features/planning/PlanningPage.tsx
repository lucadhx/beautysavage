import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { CalendarItem, CalendarItemType, RescheduleBookingPayload } from '@bs/api-client';
import {
  usePlanning,
  usePlanningAvailability,
  useBookingDetail,
  planningRange,
  groupItemsByDay,
  groupExceptionsByDay,
  addDays,
  startOfDay,
  type PlanningView,
} from './usePlanning';
import {
  MobileDayAgenda,
  WeekView,
  CalendarFiltersDrawer,
  CalendarItemDetailDrawer,
  PlanningSkeleton,
  PlanningLegend,
  PlanningAvailabilityPanel,
  fmtDayLabel,
} from './components';
import './planning.css';

function parseDateParam(value: string | undefined): Date {
  if (value) {
    const date = new Date(`${value}T12:00:00`);
    if (!Number.isNaN(date.getTime())) return startOfDay(date);
  }
  return startOfDay(new Date());
}

function toDateParam(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function PlanningCalendar({
  items,
  date,
  view,
  schedule,
  exceptionsByDay,
  onSelect,
}: {
  items: CalendarItem[];
  date: Date;
  view: PlanningView;
  schedule: ReturnType<typeof usePlanningAvailability>['schedule'];
  exceptionsByDay: Map<string, ReturnType<typeof usePlanningAvailability>['exceptions'][number]>;
  onSelect: (item: CalendarItem) => void;
}) {
  if (view === 'week') {
    const { start } = planningRange(date, 'week');
    const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
    return (
      <WeekView
        days={days}
        itemsByDay={groupItemsByDay(items)}
        schedule={schedule}
        exceptionsByDay={exceptionsByDay}
        onSelect={onSelect}
      />
    );
  }

  return (
    <MobileDayAgenda
      date={date}
      items={items}
      schedule={schedule}
      exceptionsByDay={exceptionsByDay}
      onSelect={onSelect}
    />
  );
}

export function PlanningPage() {
  const navigate = useNavigate();
  const params = useParams();
  const [date, setDate] = useState<Date>(() => parseDateParam(params.date));
  const [view, setView] = useState<PlanningView>('day');
  const [type, setType] = useState<CalendarItemType | null>(null);
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const [busy, setBusy] = useState(false);

  const planning = usePlanning({ date, view, type });
  const availability = usePlanningAvailability({ date, view });
  const bookingDetail = useBookingDetail(selected);

  const title = useMemo(() => {
    if (view === 'week') {
      const { start, end } = planningRange(date, 'week');
      return `Semaine du ${start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} au ${addDays(end, -1).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
    }
    return fmtDayLabel(date);
  }, [date, view]);

  const step = view === 'week' ? 7 : 1;
  const exceptionsByDay = useMemo(() => groupExceptionsByDay(availability.exceptions), [availability.exceptions]);

  const go = (delta: number) => {
    const next = addDays(date, delta * step);
    setDate(next);
    navigate(`/planning/${toDateParam(next)}`, { replace: true });
  };

  const onCancel = async (item: CalendarItem) => {
    setBusy(true);
    try {
      await planning.cancel(item.id);
      setSelected(null);
    } finally {
      setBusy(false);
    }
  };

  const onMarkPaid = async (item: CalendarItem) => {
    setBusy(true);
    try {
      await planning.markPaid(item.id);
      setSelected(null);
    } finally {
      setBusy(false);
    }
  };

  const onReschedule = async (item: CalendarItem, payload: RescheduleBookingPayload) => {
    await planning.reschedule(item.id, payload);
    planning.refetch();
    setSelected(null);
  };

  return (
    <section className="pl-page">
      <div className="pl-toolbar">
        <button type="button" className="pl-navbtn" aria-label="Précédent" onClick={() => go(-1)}><i className="bi-chevron-left" aria-hidden="true" /></button>
        <button
          type="button"
          className="pl-navbtn"
          aria-label="Aujourd'hui"
          onClick={() => {
            const today = startOfDay(new Date());
            setDate(today);
            navigate(`/planning/${toDateParam(today)}`, { replace: true });
          }}
        >
          <i className="bi-calendar-check" aria-hidden="true" />
        </button>
        <button type="button" className="pl-navbtn" aria-label="Suivant" onClick={() => go(1)}><i className="bi-chevron-right" aria-hidden="true" /></button>
        <span className="pl-toolbar__title" data-testid="pl-title">{title}</span>
        <span className="pl-viewtoggle">
          <button type="button" className={`pl-viewbtn${view === 'day' ? ' pl-viewbtn--active' : ''}`} onClick={() => setView('day')}>Jour</button>
          <button type="button" className={`pl-viewbtn${view === 'week' ? ' pl-viewbtn--active' : ''}`} onClick={() => setView('week')}>Semaine</button>
        </span>
      </div>

      <PlanningLegend />
      <CalendarFiltersDrawer value={type} onChange={setType} />

      {planning.isLoading || availability.isLoading ? (
        <PlanningSkeleton />
      ) : (
        <PlanningCalendar
          items={planning.items}
          date={date}
          view={view}
          schedule={availability.schedule}
          exceptionsByDay={exceptionsByDay}
          onSelect={setSelected}
        />
      )}

      <PlanningAvailabilityPanel
        schedule={availability.schedule}
        practitionerId={availability.practitionerId}
        exceptions={availability.exceptions}
        visibleBookings={planning.items}
        onSaveSchedule={availability.saveSchedule}
        onCreateException={availability.createException}
        onUpdateException={availability.updateException}
        onDeleteException={availability.deleteException}
        busy={busy || availability.isSaving}
      />

      <CalendarItemDetailDrawer
        item={selected}
        onClose={() => setSelected(null)}
        onCancel={onCancel}
        onMarkPaid={onMarkPaid}
        onReschedule={onReschedule}
        busy={busy}
        pricing={bookingDetail.pricing}
        participant={bookingDetail.participant}
        detailLoading={bookingDetail.isLoading}
      />
    </section>
  );
}
