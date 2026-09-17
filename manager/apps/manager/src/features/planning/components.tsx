import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type {
  BookingParticipant,
  BookingPricingBreakdown,
  CalendarItem,
  CalendarItemType,
  PlanningException,
  PlanningExceptionInput,
  PlanningSchedule,
  PlanningTimeSlot,
  PlanningWeekdaySchedule,
  RescheduleBookingPayload,
} from '@bs/api-client';
import {
  buildAvailabilityWindows,
  inferHourRange,
  toDateKey,
} from './usePlanning';

const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'] as const;
const HOUR_HEIGHT = 72;

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function dateInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function fmtTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function fmtMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${Number(value).toFixed(2).replace('.', ',')} €`;
}

export function fmtDayLabel(date: Date): string {
  return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function defaultWeeklySchedule(): PlanningWeekdaySchedule[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    isWorking: dayOfWeek >= 1 && dayOfWeek <= 5,
    slots: dayOfWeek >= 1 && dayOfWeek <= 5 ? [{ startTime: '09:00', endTime: '18:00' }] : [],
  }));
}

function blankException(practitionerId: string | null): ExceptionDraft {
  const today = new Date();
  return {
    id: null,
    practitionerId,
    date: dateInputValue(today.toISOString()),
    type: 'block',
    isFullDay: false,
    slots: [{ startTime: '09:00', endTime: '12:00' }],
    reason: '',
  };
}

function buildExceptionSummary(exception: PlanningException) {
  if (exception.isFullDay) return 'Journée complète';
  const slots = exception.slots?.length
    ? exception.slots.map((slot) => `${slot.startTime}-${slot.endTime}`).join(' / ')
    : [exception.startTime, exception.endTime].filter(Boolean).join('-');
  return slots || 'Créneau ponctuel';
}

type ExceptionDraft = {
  id: string | null;
  practitionerId: string | null;
  date: string;
  type: 'block' | 'add' | 'modify';
  isFullDay: boolean;
  slots: PlanningTimeSlot[];
  reason: string;
};

const PAYMENT_LABEL: Record<string, string> = {
  paid: 'Payé',
  deposit_paid: 'Acompte payé',
  pending: 'En attente',
  refunded: 'Remboursé',
  cancelled: 'Annulé',
};

export function PaymentStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const tone = ['paid', 'deposit_paid', 'pending', 'refunded', 'cancelled'].includes(status) ? status : 'neutral';
  return <span className={`pl-badge pl-badge--${tone}`} data-testid="pl-payment-badge">{PAYMENT_LABEL[status] || status}</span>;
}

export function RefundStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const label = status === 'refunded' ? 'Remboursé' : status === 'cancelled' ? 'Annulé' : status;
  const tone = status === 'refunded' ? 'refunded' : 'cancelled';
  return <span className={`pl-badge pl-badge--${tone}`} data-testid="pl-refund-badge">{label}</span>;
}

export function BalanceDueBadge({ amount }: { amount: number | null }) {
  if (!amount || amount <= 0) return null;
  return <span className="pl-badge pl-badge--balance" data-testid="pl-balance-badge">Reste {fmtMoney(amount)}</span>;
}

function timeGridStyle(startIso: string, endIso: string, startHour: number, endHour: number): CSSProperties {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const totalMinutes = Math.max(60, (endHour - startHour) * 60);
  const topMinutes = (start.getHours() - startHour) * 60 + start.getMinutes();
  const heightMinutes = Math.max(30, (end.getTime() - start.getTime()) / 60000);
  return {
    top: `${(topMinutes / totalMinutes) * 100}%`,
    height: `${(heightMinutes / totalMinutes) * 100}%`,
  };
}

function backgroundStyle(startMin: number, endMin: number, startHour: number, endHour: number): CSSProperties {
  const totalMinutes = Math.max(60, (endHour - startHour) * 60);
  const topMinutes = startMin - startHour * 60;
  const heightMinutes = Math.max(10, endMin - startMin);
  return {
    top: `${(topMinutes / totalMinutes) * 100}%`,
    height: `${(heightMinutes / totalMinutes) * 100}%`,
  };
}

function buildHourTicks(startHour: number, endHour: number) {
  return Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);
}

function buildConflictPreview({
  bookings,
  schedule,
  exception,
}: {
  bookings: CalendarItem[];
  schedule: PlanningSchedule | null;
  exception: ExceptionDraft;
}) {
  if (!exception.practitionerId || exception.type === 'add') return [];
  const date = new Date(`${exception.date}T12:00:00`);
  const planningException = {
    _id: exception.id || 'draft',
    practitionerId: exception.practitionerId,
    date: exception.date,
    type: exception.type,
    isFullDay: exception.isFullDay,
    startTime: exception.isFullDay ? null : (exception.slots[0]?.startTime ?? null),
    endTime: exception.isFullDay ? null : (exception.slots[0]?.endTime ?? null),
    slots: exception.slots,
    reason: exception.reason,
  } as PlanningException;
  const { available } = buildAvailabilityWindows(schedule, date, planningException);

  return bookings.filter((item) => {
    const start = new Date(item.startAt);
    const end = new Date(item.endAt);
    const startMin = start.getHours() * 60 + start.getMinutes();
    const endMin = end.getHours() * 60 + end.getMinutes();
    return !available.some((interval) => startMin >= interval.startMin && endMin <= interval.endMin);
  });
}

function CalendarGridCard({
  item,
  onSelect,
  startHour,
  endHour,
  compact = false,
}: {
  item: CalendarItem;
  onSelect: (item: CalendarItem) => void;
  startHour: number;
  endHour: number;
  compact?: boolean;
}) {
  const style = timeGridStyle(item.startAt, item.endAt, startHour, endHour);
  const subtitle = item.type === 'blocked_slot'
    ? item.title || 'Indisponible'
    : item.client?.name || (item.participant ? `${item.participant.reservedCount}/${item.participant.maxClients}` : 'Institut');

  return (
    <button
      type="button"
      className={`pl-event pl-event--${item.type} pl-event--${item.status}${compact ? ' pl-event--compact' : ''}`}
      style={style}
      onClick={() => onSelect(item)}
      data-testid={item.type === 'formation_session' ? 'pl-formation-card' : 'pl-card'}
    >
      <span className="pl-event__time">{fmtTime(item.startAt)}-{fmtTime(item.endAt)}</span>
      <strong className="pl-event__title">{item.title}</strong>
      <span className="pl-event__sub">{subtitle}</span>
      {item.type !== 'blocked_slot' && !compact ? (
        <span className="pl-event__badges">
          <PaymentStatusBadge status={item.paymentStatus} />
          <BalanceDueBadge amount={item.balanceDueAmount} />
          <RefundStatusBadge status={item.refundStatus} />
        </span>
      ) : null}
      {item.type !== 'blocked_slot' && compact ? (
        <span className="pl-event__dot" aria-hidden="true" />
      ) : null}
    </button>
  );
}

function TimeGridColumn({
  date,
  items,
  schedule,
  exception,
  startHour,
  endHour,
  onSelect,
}: {
  date: Date;
  items: CalendarItem[];
  schedule: PlanningSchedule | null;
  exception?: PlanningException | null;
  startHour: number;
  endHour: number;
  onSelect: (item: CalendarItem) => void;
}) {
  const hourTicks = buildHourTicks(startHour, endHour);
  const windows = buildAvailabilityWindows(schedule, date, exception);
  const gridHeight = Math.max(8, endHour - startHour) * HOUR_HEIGHT;

  return (
    <div className="pl-column" data-testid="pl-daycol">
      <div className="pl-column__head">
        <strong>{date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })}</strong>
        <span>{fmtDayLabel(date)}</span>
      </div>
      <div className="pl-grid">
        <div className="pl-grid__times">
          {hourTicks.map((hour) => (
            <span key={hour} className="pl-grid__time">{pad2(hour)}:00</span>
          ))}
        </div>
        <div className="pl-grid__lane" style={{ height: gridHeight }}>
          <div className="pl-grid__closed" data-testid="pl-closed-zones" />
          {windows.available.map((interval, index) => (
            <div
              key={`${toDateKey(date)}-open-${index}`}
              className="pl-grid__segment pl-grid__segment--open"
              style={backgroundStyle(interval.startMin, interval.endMin, startHour, endHour)}
            />
          ))}
          {windows.blocked.map((interval, index) => (
            <div
              key={`${toDateKey(date)}-blocked-${index}`}
              className="pl-grid__segment pl-grid__segment--blocked"
              style={backgroundStyle(interval.startMin, interval.endMin, startHour, endHour)}
              data-testid="pl-blocked-zone"
            />
          ))}
          {hourTicks.slice(0, -1).map((hour) => (
            <div
              key={`${toDateKey(date)}-line-${hour}`}
              className="pl-grid__line"
              style={{ top: `${((hour - startHour) / Math.max(1, endHour - startHour)) * 100}%` }}
            />
          ))}
          {items.map((item) => (
            <CalendarGridCard key={item.id} item={item} onSelect={onSelect} startHour={startHour} endHour={endHour} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function PlanningEmptyState({ label = 'Aucun événement' }: { label?: string }) {
  return (
    <div className="pl-empty" role="status">
      <div className="pl-empty__icon" aria-hidden="true"><i className="bi-calendar2-x" /></div>
      <p>{label}</p>
    </div>
  );
}

export function MobileDayAgenda({
  date,
  items,
  schedule,
  exceptionsByDay,
  onSelect,
}: {
  date: Date;
  items: CalendarItem[];
  schedule: PlanningSchedule | null;
  exceptionsByDay: Map<string, PlanningException>;
  onSelect: (item: CalendarItem) => void;
}) {
  const { startHour, endHour } = inferHourRange({ items, schedule, exceptions: Array.from(exceptionsByDay.values()) });
  return (
    <div className="pl-agenda" data-testid="pl-agenda">
      <TimeGridColumn
        date={date}
        items={items}
        schedule={schedule}
        exception={exceptionsByDay.get(toDateKey(date)) || null}
        startHour={startHour}
        endHour={endHour}
        onSelect={onSelect}
      />
    </div>
  );
}

export function DayColumn({
  date,
  items,
  schedule,
  exception,
  startHour,
  endHour,
  onSelect,
}: {
  date: Date;
  items: CalendarItem[];
  schedule: PlanningSchedule | null;
  exception?: PlanningException | null;
  startHour: number;
  endHour: number;
  onSelect: (item: CalendarItem) => void;
}) {
  return (
    <TimeGridColumn
      date={date}
      items={items}
      schedule={schedule}
      exception={exception}
      startHour={startHour}
      endHour={endHour}
      onSelect={onSelect}
    />
  );
}

function WeekLane({
  date,
  items,
  schedule,
  exception,
  startHour,
  endHour,
  onSelect,
}: {
  date: Date;
  items: CalendarItem[];
  schedule: PlanningSchedule | null;
  exception?: PlanningException | null;
  startHour: number;
  endHour: number;
  onSelect: (item: CalendarItem) => void;
}) {
  const hourTicks = buildHourTicks(startHour, endHour);
  const windows = buildAvailabilityWindows(schedule, date, exception);
  const key = toDateKey(date);

  return (
    <div className="pl-week__lane" data-testid="pl-daycol">
      <div className="pl-week__laneclosed" data-testid="pl-closed-zones" />
      {windows.available.map((interval, index) => (
        <div
          key={`${key}-open-${index}`}
          className="pl-grid__segment pl-grid__segment--open"
          style={backgroundStyle(interval.startMin, interval.endMin, startHour, endHour)}
        />
      ))}
      {windows.blocked.map((interval, index) => (
        <div
          key={`${key}-blocked-${index}`}
          className="pl-grid__segment pl-grid__segment--blocked"
          style={backgroundStyle(interval.startMin, interval.endMin, startHour, endHour)}
          data-testid="pl-blocked-zone"
        />
      ))}
      {hourTicks.slice(0, -1).map((hour) => (
        <div
          key={`${key}-line-${hour}`}
          className="pl-grid__line"
          style={{ top: `${((hour - startHour) / Math.max(1, endHour - startHour)) * 100}%` }}
        />
      ))}
      {items.map((item) => (
        <CalendarGridCard key={item.id} item={item} onSelect={onSelect} startHour={startHour} endHour={endHour} compact />
      ))}
    </div>
  );
}

export function WeekView({
  days,
  itemsByDay,
  schedule,
  exceptionsByDay,
  onSelect,
}: {
  days: Date[];
  itemsByDay: Map<string, CalendarItem[]>;
  schedule: PlanningSchedule | null;
  exceptionsByDay: Map<string, PlanningException>;
  onSelect: (item: CalendarItem) => void;
}) {
  const allItems = days.flatMap((day) => itemsByDay.get(toDateKey(day)) ?? []);
  const { startHour, endHour } = inferHourRange({ items: allItems, schedule, exceptions: Array.from(exceptionsByDay.values()) });
  const hourTicks = buildHourTicks(startHour, endHour);
  const laneHeight = Math.max(8, endHour - startHour) * HOUR_HEIGHT;
  const todayKey = toDateKey(new Date());

  return (
    <div className="pl-week" data-testid="pl-week">
      <div className="pl-week__scroll">
        <div className="pl-week__grid" style={{ '--pl-lane-h': `${laneHeight}px` } as CSSProperties}>
          <div className="pl-week__corner" aria-hidden="true" />
          {days.map((day) => {
            const isToday = toDateKey(day) === todayKey;
            return (
              <div key={`head-${toDateKey(day)}`} className={`pl-week__dayhead${isToday ? ' pl-week__dayhead--today' : ''}`}>
                <span className="pl-week__dayname">{day.toLocaleDateString('fr-FR', { weekday: 'short' })}</span>
                <span className="pl-week__daynum">{day.getDate()}</span>
              </div>
            );
          })}

          <div className="pl-week__gutter" style={{ height: laneHeight }}>
            {hourTicks.map((hour) => (
              <span
                key={`tick-${hour}`}
                className="pl-week__tick"
                style={{ top: `${((hour - startHour) / Math.max(1, endHour - startHour)) * 100}%` }}
              >
                {pad2(hour)}:00
              </span>
            ))}
          </div>

          {days.map((day) => (
            <div
              key={`lane-${toDateKey(day)}`}
              className={`pl-week__lanewrap${toDateKey(day) === todayKey ? ' pl-week__lanewrap--today' : ''}`}
              style={{ height: laneHeight }}
            >
              <WeekLane
                date={day}
                items={itemsByDay.get(toDateKey(day)) ?? []}
                schedule={schedule}
                exception={exceptionsByDay.get(toDateKey(day)) || null}
                startHour={startHour}
                endHour={endHour}
                onSelect={onSelect}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const TYPE_FILTERS: Array<{ value: CalendarItemType | null; label: string }> = [
  { value: null, label: 'Tout' },
  { value: 'service_booking', label: 'Réservations' },
  { value: 'formation_session', label: 'Formations' },
  { value: 'blocked_slot', label: 'Bloqués' },
];

export function CalendarFiltersDrawer({ value, onChange }: { value: CalendarItemType | null; onChange: (value: CalendarItemType | null) => void }) {
  return (
    <div className="pl-filterbar" role="tablist" aria-label="Filtres du planning">
      {TYPE_FILTERS.map((filter) => (
        <button
          key={filter.label}
          type="button"
          role="tab"
          aria-selected={value === filter.value}
          className={`pl-filter${value === filter.value ? ' pl-filter--active' : ''}`}
          onClick={() => onChange(filter.value)}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}

export function PlanningLegend() {
  return (
    <div className="pl-legend" aria-label="Légende du planning">
      <span className="pl-legend__item"><span className="pl-legend__swatch pl-legend__swatch--open" /> Disponible</span>
      <span className="pl-legend__item"><span className="pl-legend__swatch pl-legend__swatch--closed" /> Fermé</span>
      <span className="pl-legend__item"><span className="pl-legend__swatch pl-legend__swatch--blocked" /> Bloqué</span>
      <span className="pl-legend__item"><span className="pl-legend__swatch pl-legend__swatch--booking" /> Réservation</span>
      <span className="pl-legend__item"><span className="pl-legend__swatch pl-legend__swatch--formation" /> Formation</span>
    </div>
  );
}

export function RescheduleForm({
  item,
  onReschedule,
  onDone,
}: {
  item: CalendarItem;
  onReschedule: (item: CalendarItem, payload: RescheduleBookingPayload) => Promise<void>;
  onDone: () => void;
}) {
  const durationMs = Math.max(0, new Date(item.endAt).getTime() - new Date(item.startAt).getTime());
  const [date, setDate] = useState(dateInputValue(item.startAt));
  const [time, setTime] = useState(fmtTime(item.startAt));
  const [reason, setReason] = useState('');
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error' | 'success'>('idle');
  const [error, setError] = useState('');

  const submit = async () => {
    if (!date || !time) {
      setPhase('error');
      setError('Date et heure requises.');
      return;
    }
    const newStartAt = `${date}T${time}`;
    const startMs = new Date(newStartAt).getTime();
    if (Number.isNaN(startMs)) {
      setPhase('error');
      setError('Créneau invalide.');
      return;
    }
    const newEndAt = new Date(startMs + durationMs).toISOString();
    setPhase('submitting');
    setError('');
    try {
      await onReschedule(item, { newStartAt, newEndAt, reason: reason.trim() || undefined });
      setPhase('success');
    } catch (cause) {
      setPhase('error');
      setError(cause instanceof Error && cause.message ? cause.message : 'Report impossible.');
    }
  };

  if (phase === 'success') {
    return (
      <div className="pl-reschedule" data-testid="pl-reschedule-success" role="status">
        <p className="pl-reschedule__ok"><i className="bi-check-circle" aria-hidden="true" /> Créneau reporté.</p>
        <button type="button" className="pl-actionbtn pl-actionbtn--primary" onClick={onDone}>Fermer</button>
      </div>
    );
  }

  return (
    <div className="pl-reschedule" data-testid="pl-reschedule-form">
      <label className="pl-field">
        <span className="pl-field__label">Nouvelle date</span>
        <input className="pl-field__input" type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Nouvelle date" />
      </label>
      <label className="pl-field">
        <span className="pl-field__label">Nouvelle heure</span>
        <input className="pl-field__input" type="time" value={time} onChange={(event) => setTime(event.target.value)} aria-label="Nouvelle heure" />
      </label>
      <label className="pl-field">
        <span className="pl-field__label">Motif (optionnel)</span>
        <input className="pl-field__input" type="text" value={reason} onChange={(event) => setReason(event.target.value)} aria-label="Motif du report" />
      </label>
      {phase === 'error' ? <p className="pl-reschedule__err" role="alert" data-testid="pl-reschedule-error">{error}</p> : null}
      <div className="pl-reschedule__actions">
        <button type="button" className="pl-actionbtn pl-actionbtn--primary" disabled={phase === 'submitting'} onClick={() => void submit()} data-testid="pl-reschedule-submit">
          {phase === 'submitting' ? 'Report en cours…' : 'Confirmer le report'}
        </button>
        <button type="button" className="pl-actionbtn" disabled={phase === 'submitting'} onClick={onDone}>Annuler</button>
      </div>
    </div>
  );
}

export function BookingActionsPanel({
  item,
  onCancel,
  onMarkPaid,
  onReschedule,
  busy,
}: {
  item: CalendarItem;
  onCancel: (item: CalendarItem) => void;
  onMarkPaid: (item: CalendarItem) => void;
  onReschedule: (item: CalendarItem, payload: RescheduleBookingPayload) => Promise<void>;
  busy?: boolean;
}) {
  const [showReschedule, setShowReschedule] = useState(false);
  if (item.type !== 'service_booking') return null;

  if (showReschedule) {
    return <RescheduleForm item={item} onReschedule={onReschedule} onDone={() => setShowReschedule(false)} />;
  }

  return (
    <div className="pl-actions" data-testid="pl-actions">
      {item.actionLinks.markBalancePaid ? (
        <button type="button" className="pl-actionbtn pl-actionbtn--primary" disabled={busy} onClick={() => onMarkPaid(item)}>
          <i className="bi-cash-coin" aria-hidden="true" /> Encaisser le reste
        </button>
      ) : null}
      {item.actionLinks.reschedule ? (
        <button type="button" className="pl-actionbtn" disabled={busy} onClick={() => setShowReschedule(true)} data-testid="pl-reschedule-open">
          <i className="bi-arrow-left-right" aria-hidden="true" /> Reporter le créneau
        </button>
      ) : null}
      {item.actionLinks.cancel ? (
        <button type="button" className="pl-actionbtn pl-actionbtn--danger" disabled={busy} onClick={() => onCancel(item)}>
          <i className="bi-x-circle" aria-hidden="true" /> Annuler
        </button>
      ) : null}
    </div>
  );
}

function DrawerDetailRows({ item }: { item: CalendarItem }) {
  return (
    <div className="pl-section" data-testid="pl-detail">
      <span className="pl-section__title">Détail</span>
      <div className="pl-row"><span>Quand</span><strong>{fmtTime(item.startAt)}-{fmtTime(item.endAt)}</strong></div>
      <div className="pl-row"><span>Statut</span><span>{item.status}</span></div>
      {item.client?.name ? <div className="pl-row"><span>Client</span><span>{item.client.name}</span></div> : null}
    </div>
  );
}

function initialsOf(name: string | null | undefined): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

/**
 * Section « Participant » d'une réservation prestation : qui a réservé, combien il a payé,
 * combien il reste à régler. Le montant réglé combine carte cadeau + paiement en ligne +
 * encaissement sur place. Alimenté par le détail enrichi (fallback sur l'item calendrier).
 */
function ParticipantSection({
  item,
  participant,
  pricing,
  loading,
}: {
  item: CalendarItem;
  participant: BookingParticipant | null;
  pricing: BookingPricingBreakdown | null;
  loading?: boolean;
}) {
  const name = participant?.name || item.client?.name || 'Client';
  const email = participant?.email || null;
  const paid = pricing?.totalPaidAmount ?? item.amountPaidOnline ?? 0;
  const due = pricing?.balanceDueAmount ?? item.balanceDueAmount ?? 0;

  return (
    <div className="pl-section" data-testid="pl-participants">
      <span className="pl-section__title">Participant{loading ? ' · chargement…' : ''}</span>
      <div className="pl-person">
        <span className="pl-person__avatar" aria-hidden="true">{initialsOf(name)}</span>
        <div className="pl-person__id">
          <strong>{name}</strong>
          {email ? <span className="pl-person__email">{email}</span> : null}
        </div>
        <div className="pl-person__amounts">
          <span className="pl-person__paid" data-testid="pl-person-paid">Payé {fmtMoney(paid)}</span>
          {due > 0 ? <span className="pl-person__due" data-testid="pl-person-due">Reste {fmtMoney(due)}</span> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Ventilation du prix réel vendu (catalogue → remise promotion → prix réel) et du règlement
 * (carte cadeau / en ligne / sur place / reste). N'affiche que les lignes non nulles.
 */
function PricingBreakdownSection({ pricing }: { pricing: BookingPricingBreakdown }) {
  const hasPayments = (pricing.giftCardAmount ?? 0) > 0
    || (pricing.paidOnlineAmount ?? 0) > 0
    || (pricing.paidOnSiteAmount ?? 0) > 0
    || (pricing.balanceDueAmount ?? 0) > 0;

  return (
    <div className="pl-section" data-testid="pl-pricing-breakdown">
      <span className="pl-section__title">Prix &amp; paiement</span>
      <div className="pl-row"><span>Prix catalogue</span><span>{fmtMoney(pricing.catalogAmount)}</span></div>
      {pricing.promotionApplied && (pricing.promotionDiscountAmount ?? 0) > 0 ? (
        <div className="pl-row pl-row--discount" data-testid="pl-promo-line">
          <span><i className="bi-tag" aria-hidden="true" /> Remise promotion</span>
          <span>−{fmtMoney(pricing.promotionDiscountAmount)}</span>
        </div>
      ) : null}
      <div className="pl-row pl-row--strong"><span>Prix réel</span><strong data-testid="pl-real-price">{fmtMoney(pricing.soldAmount)}</strong></div>

      {hasPayments ? <div className="pl-hr" role="presentation" /> : null}
      {(pricing.giftCardAmount ?? 0) > 0 ? (
        <div className="pl-row" data-testid="pl-giftcard-line"><span><i className="bi-gift" aria-hidden="true" /> Payé par carte cadeau</span><span>{fmtMoney(pricing.giftCardAmount)}</span></div>
      ) : null}
      {(pricing.paidOnlineAmount ?? 0) > 0 ? (
        <div className="pl-row"><span><i className="bi-credit-card" aria-hidden="true" /> Payé en ligne</span><span>{fmtMoney(pricing.paidOnlineAmount)}</span></div>
      ) : null}
      {(pricing.paidOnSiteAmount ?? 0) > 0 ? (
        <div className="pl-row"><span><i className="bi-cash" aria-hidden="true" /> Encaissé sur place</span><span>{fmtMoney(pricing.paidOnSiteAmount)}</span></div>
      ) : null}
      <div className="pl-row pl-row--strong"><span>Total réglé</span><strong data-testid="pl-total-paid">{fmtMoney(pricing.totalPaidAmount)}</strong></div>
      {(pricing.balanceDueAmount ?? 0) > 0 ? (
        <div className="pl-row pl-row--due"><span>Reste à payer sur place</span><strong>{fmtMoney(pricing.balanceDueAmount)}</strong></div>
      ) : null}
    </div>
  );
}

export function CalendarItemDetailDrawer({
  item,
  onClose,
  onCancel,
  onMarkPaid,
  onReschedule,
  busy,
  pricing = null,
  participant = null,
  detailLoading = false,
}: {
  item: CalendarItem | null;
  onClose: () => void;
  onCancel: (item: CalendarItem) => void;
  onMarkPaid: (item: CalendarItem) => void;
  onReschedule: (item: CalendarItem, payload: RescheduleBookingPayload) => Promise<void>;
  busy?: boolean;
  pricing?: BookingPricingBreakdown | null;
  participant?: BookingParticipant | null;
  detailLoading?: boolean;
}) {
  useEffect(() => {
    if (!item) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;

  const isBooking = item.type === 'service_booking';
  const onSiteLabel = item.balanceDueAmount && item.balanceDueAmount > 0
    ? 'Reste à payer sur place'
    : item.paymentType === 'full' && item.amountPaidOnline === 0
      ? 'Paiement sur place'
      : null;

  return (
    <>
      <div className="pl-overlay" onClick={onClose} aria-hidden="true" />
      <div className="pl-drawer" role="dialog" aria-modal="true" aria-label={item.title} data-testid="pl-drawer">
        <div className="pl-drawer__head">
          <span className="pl-drawer__title">{item.title}</span>
          <button type="button" className="pl-iconbtn" onClick={onClose} aria-label="Fermer"><i className="bi-x-lg" aria-hidden="true" /></button>
        </div>
        <div className="pl-drawer__body">
          {isBooking ? (
            <div className="pl-amounts" data-testid="pl-amounts">
              <div className="pl-amountcard" data-testid="pl-amount-total">
                <span>Total</span>
                <strong>{fmtMoney(item.totalAmount)}</strong>
              </div>
              <div className="pl-amountcard" data-testid="pl-amount-deposit">
                <span>Acompte payé</span>
                <strong>{fmtMoney(item.depositAmount ?? 0)}</strong>
              </div>
              <div className="pl-amountcard" data-testid="pl-amount-balance">
                <span>Reste à payer</span>
                <strong>{fmtMoney(item.balanceDueAmount ?? 0)}</strong>
              </div>
            </div>
          ) : null}

          {isBooking ? (
            <ParticipantSection item={item} participant={participant} pricing={pricing} loading={detailLoading} />
          ) : null}

          <DrawerDetailRows item={item} />

          {isBooking && pricing ? (
            <PricingBreakdownSection pricing={pricing} />
          ) : null}

          {isBooking && !pricing ? (
            <div className="pl-section">
              <span className="pl-section__title">Paiement</span>
              <div className="pl-row"><span>Payé en ligne</span><strong data-testid="pl-paid-online">{fmtMoney(item.amountPaidOnline)}</strong></div>
              <div className="pl-row"><span>Total</span><strong>{fmtMoney(item.totalAmount)}</strong></div>
              <div className="pl-row"><span>Acompte</span><span>{fmtMoney(item.depositAmount ?? 0)}</span></div>
              <div className="pl-row"><span>Reste</span><strong data-testid="pl-balance-due">{fmtMoney(item.balanceDueAmount ?? 0)}</strong></div>
              {onSiteLabel ? <p className="pl-inline-note">{onSiteLabel}</p> : null}
              <span className="pl-card__badges">
                <PaymentStatusBadge status={item.paymentStatus} />
                <RefundStatusBadge status={item.refundStatus} />
              </span>
            </div>
          ) : null}

          {isBooking && pricing ? (
            <span className="pl-card__badges">
              <PaymentStatusBadge status={item.paymentStatus} />
              <RefundStatusBadge status={item.refundStatus} />
            </span>
          ) : null}

          {item.participant ? (
            <div className="pl-section">
              <span className="pl-section__title">Participants</span>
              <div className="pl-row"><span>Inscrits</span><strong>{item.participant.reservedCount}/{item.participant.maxClients}</strong></div>
              <div className="pl-row"><span>Places restantes</span><strong>{item.participant.placesLeft}</strong></div>
            </div>
          ) : null}

          <BookingActionsPanel item={item} onCancel={onCancel} onMarkPaid={onMarkPaid} onReschedule={onReschedule} busy={busy} />
        </div>
      </div>
    </>
  );
}

export function PlToggle({
  checked,
  onChange,
  label,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <label className={`pl-toggle${checked ? ' pl-toggle--on' : ''}`}>
      <input
        type="checkbox"
        className="pl-toggle__input"
        checked={checked}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="pl-toggle__track" aria-hidden="true"><span className="pl-toggle__thumb" /></span>
      {label ? <span className="pl-toggle__label">{label}</span> : null}
    </label>
  );
}

function WeeklyScheduleEditor({
  value,
  onChange,
}: {
  value: PlanningWeekdaySchedule[];
  onChange: (value: PlanningWeekdaySchedule[]) => void;
}) {
  const updateDay = (dayOfWeek: number, updater: (day: PlanningWeekdaySchedule) => PlanningWeekdaySchedule) => {
    onChange(value.map((day) => (day.dayOfWeek === dayOfWeek ? updater(day) : day)));
  };

  const openDays = value.filter((day) => day.isWorking).length;

  return (
    <div className="pl-weeked">
      <div className="pl-weeked__grid">
        {value.map((day) => (
          <div className={`pl-daycard${day.isWorking ? ' pl-daycard--open' : ''}`} key={day.dayOfWeek}>
            <div className="pl-daycard__head">
              <div className="pl-daycard__id">
                <strong>{DAY_NAMES[day.dayOfWeek]}</strong>
                <span className="pl-daycard__state">{day.isWorking ? 'Ouvert' : 'Fermé'}</span>
              </div>
              <PlToggle
                checked={day.isWorking}
                ariaLabel={`${DAY_NAMES[day.dayOfWeek]} ${day.isWorking ? 'ouvert' : 'fermé'}`}
                onChange={(checked) => updateDay(day.dayOfWeek, (current) => ({
                  ...current,
                  isWorking: checked,
                  slots: checked && current.slots.length === 0 ? [{ startTime: '09:00', endTime: '18:00' }] : current.slots,
                }))}
              />
            </div>

            <div className={`pl-daycard__body${day.isWorking ? ' pl-daycard__body--open' : ''}`}>
              {day.isWorking ? (
                <div className="pl-slots">
                  {day.slots.map((slot, index) => (
                    <div key={`${day.dayOfWeek}-${index}`} className="pl-slotrow">
                      <input
                        className="pl-field__input pl-field__input--time"
                        type="time"
                        value={slot.startTime}
                        onChange={(event) => updateDay(day.dayOfWeek, (current) => ({
                          ...current,
                          slots: current.slots.map((currentSlot, slotIndex) => slotIndex === index ? { ...currentSlot, startTime: event.target.value } : currentSlot),
                        }))}
                      />
                      <span className="pl-slotrow__sep">→</span>
                      <input
                        className="pl-field__input pl-field__input--time"
                        type="time"
                        value={slot.endTime}
                        onChange={(event) => updateDay(day.dayOfWeek, (current) => ({
                          ...current,
                          slots: current.slots.map((currentSlot, slotIndex) => slotIndex === index ? { ...currentSlot, endTime: event.target.value } : currentSlot),
                        }))}
                      />
                      <button
                        type="button"
                        className="pl-iconbtn pl-iconbtn--sm"
                        aria-label={`Supprimer le créneau ${index + 1}`}
                        onClick={() => updateDay(day.dayOfWeek, (current) => ({
                          ...current,
                          slots: current.slots.filter((_, slotIndex) => slotIndex !== index),
                        }))}
                      >
                        <i className="bi bi-trash3" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="pl-ghostbtn"
                    onClick={() => updateDay(day.dayOfWeek, (current) => ({
                      ...current,
                      slots: [...current.slots, { startTime: '14:00', endTime: '18:00' }],
                    }))}
                  >
                    <i className="bi-plus-lg" aria-hidden="true" /> Ajouter une plage
                  </button>
                </div>
              ) : (
                <p className="pl-daycard__closed">Repos</p>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="pl-weeked__summary">{openDays} jour{openDays > 1 ? 's' : ''} d’ouverture par semaine</p>
    </div>
  );
}

function ExceptionEditor({
  draft,
  onChange,
}: {
  draft: ExceptionDraft;
  onChange: (draft: ExceptionDraft) => void;
}) {
  const updateSlots = (slots: PlanningTimeSlot[]) => onChange({ ...draft, slots });
  const EXCEPTION_TYPES: Array<{ value: ExceptionDraft['type']; label: string; icon: string }> = [
    { value: 'block', label: 'Bloquer', icon: 'bi-slash-circle' },
    { value: 'add', label: 'Ouvrir', icon: 'bi-plus-circle' },
    { value: 'modify', label: 'Remplacer', icon: 'bi-arrow-repeat' },
  ];

  return (
    <div className="pl-exform">
      <label className="pl-field">
        <span className="pl-field__label">Date</span>
        <input className="pl-field__input" type="date" value={draft.date} aria-label="Date de l'exception" onChange={(event) => onChange({ ...draft, date: event.target.value })} />
      </label>

      <div className="pl-field">
        <span className="pl-field__label">Type d’exception</span>
        <div className="pl-seg" role="radiogroup" aria-label="Type d’exception">
          {EXCEPTION_TYPES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={draft.type === option.value}
              className={`pl-seg__btn${draft.type === option.value ? ' pl-seg__btn--active' : ''}`}
              onClick={() => onChange({ ...draft, type: option.value })}
            >
              <i className={option.icon} aria-hidden="true" /> {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pl-exform__toggle">
        <PlToggle
          checked={draft.isFullDay}
          ariaLabel="Journée complète"
          label={<span>Journée complète</span>}
          onChange={(checked) => onChange({ ...draft, isFullDay: checked })}
        />
      </div>

      {!draft.isFullDay ? (
        <div className="pl-slots">
          {draft.slots.map((slot, index) => (
            <div key={`draft-slot-${index}`} className="pl-slotrow">
              <input
                className="pl-field__input pl-field__input--time"
                type="time"
                value={slot.startTime}
                aria-label="Heure de début de l'exception"
                onChange={(event) => updateSlots(draft.slots.map((current, currentIndex) => currentIndex === index ? { ...current, startTime: event.target.value } : current))}
              />
              <span className="pl-slotrow__sep">→</span>
              <input
                className="pl-field__input pl-field__input--time"
                type="time"
                value={slot.endTime}
                aria-label="Heure de fin de l'exception"
                onChange={(event) => updateSlots(draft.slots.map((current, currentIndex) => currentIndex === index ? { ...current, endTime: event.target.value } : current))}
              />
              <button
                type="button"
                className="pl-iconbtn pl-iconbtn--sm"
                aria-label={`Supprimer la plage ${index + 1}`}
                onClick={() => updateSlots(draft.slots.filter((_, currentIndex) => currentIndex !== index))}
              >
                <i className="bi bi-trash3" aria-hidden="true" />
              </button>
            </div>
          ))}
          <button type="button" className="pl-ghostbtn" onClick={() => updateSlots([...draft.slots, { startTime: '14:00', endTime: '18:00' }])}>
            <i className="bi-plus-lg" aria-hidden="true" /> Ajouter une plage
          </button>
        </div>
      ) : null}

      <label className="pl-field">
        <span className="pl-field__label">Motif</span>
        <input className="pl-field__input" type="text" value={draft.reason} onChange={(event) => onChange({ ...draft, reason: event.target.value })} placeholder="Fermeture, ouverture exceptionnelle…" />
      </label>
    </div>
  );
}

/** Modale d'édition d'une exception ponctuelle (création ou modification). */
function ExceptionModal({
  draft,
  onChange,
  conflicts,
  error,
  busy,
  onSubmit,
  onClose,
}: {
  draft: ExceptionDraft;
  onChange: (draft: ExceptionDraft) => void;
  conflicts: CalendarItem[];
  error: string | null;
  busy: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="pl-modal" data-testid="pl-exception-modal">
      <div className="pl-modal__overlay" onClick={onClose} aria-hidden="true" />
      <div className="pl-modal__dialog" role="dialog" aria-modal="true" aria-label={draft.id ? 'Modifier une exception' : 'Ajouter une exception'}>
        <div className="pl-modal__head">
          <span className="pl-modal__title">{draft.id ? 'Modifier l’exception' : 'Ajouter une exception'}</span>
          <button type="button" className="pl-iconbtn" onClick={onClose} aria-label="Fermer"><i className="bi-x-lg" aria-hidden="true" /></button>
        </div>
        <div className="pl-modal__body">
          <ExceptionEditor draft={draft} onChange={onChange} />
          {conflicts.length > 0 ? (
            <div className="pl-warning" role="alert" data-testid="pl-exception-conflict">
              <strong>Conflit détecté :</strong> {conflicts.map((item) => `${item.title} (${fmtTime(item.startAt)})`).join(', ')}
            </div>
          ) : null}
          {error ? <div className="pl-warning pl-warning--error" role="alert">{error}</div> : null}
        </div>
        <div className="pl-modal__foot">
          <button type="button" className="pl-actionbtn" onClick={onClose} disabled={busy}>Annuler</button>
          <button type="button" className="pl-actionbtn pl-actionbtn--primary" onClick={onSubmit} disabled={busy}>
            {draft.id ? 'Mettre à jour l’exception' : 'Enregistrer l’exception'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PlanningAvailabilityPanel({
  schedule,
  practitionerId,
  exceptions,
  visibleBookings,
  onSaveSchedule,
  onCreateException,
  onUpdateException,
  onDeleteException,
  busy,
}: {
  schedule: PlanningSchedule | null;
  practitionerId: string | null;
  exceptions: PlanningException[];
  visibleBookings: CalendarItem[];
  onSaveSchedule: (input: { weeklySchedule: PlanningWeekdaySchedule[]; lunchBreak?: PlanningSchedule['lunchBreak'] }) => Promise<unknown>;
  onCreateException: (input: PlanningExceptionInput) => Promise<unknown>;
  onUpdateException: (id: string, input: Partial<PlanningExceptionInput>) => Promise<unknown>;
  onDeleteException: (id: string) => Promise<unknown>;
  busy: boolean;
}) {
  const [weeklySchedule, setWeeklySchedule] = useState<PlanningWeekdaySchedule[]>(schedule?.weeklySchedule ?? defaultWeeklySchedule());
  const [draft, setDraft] = useState<ExceptionDraft>(() => blankException(practitionerId));
  const [modalOpen, setModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    setWeeklySchedule(schedule?.weeklySchedule ?? defaultWeeklySchedule());
  }, [schedule]);

  useEffect(() => {
    setDraft((current) => current.practitionerId === practitionerId ? current : blankException(practitionerId));
  }, [practitionerId]);

  const conflicts = useMemo(() => {
    if (!modalOpen) return [];
    const dayBookings = visibleBookings.filter((item) => item.type === 'service_booking' && toDateKey(item.startAt) === draft.date);
    return buildConflictPreview({ bookings: dayBookings, schedule: { practitionerId: practitionerId || '', weeklySchedule }, exception: draft });
  }, [modalOpen, draft, practitionerId, visibleBookings, weeklySchedule]);

  const openCreate = () => {
    setDraft(blankException(practitionerId));
    setModalError(null);
    setFeedback(null);
    setModalOpen(true);
  };

  const openEdit = (exception: PlanningException) => {
    setDraft({
      id: exception._id,
      practitionerId,
      date: dateInputValue(exception.date),
      type: exception.type,
      isFullDay: exception.isFullDay,
      slots: exception.slots?.length ? exception.slots : [{ startTime: exception.startTime || '09:00', endTime: exception.endTime || '12:00' }],
      reason: exception.reason || '',
    });
    setModalError(null);
    setFeedback(null);
    setModalOpen(true);
  };

  const saveSchedule = async () => {
    setFeedback(null);
    setError(null);
    try {
      await onSaveSchedule({
        weeklySchedule,
        lunchBreak: schedule?.lunchBreak ?? { isActive: false, startTime: '12:00', endTime: '13:00' },
      });
      setFeedback('Disponibilités hebdomadaires enregistrées.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enregistrement impossible.');
    }
  };

  const submitException = async () => {
    if (!practitionerId) {
      setModalError('Calendrier institut introuvable.');
      return;
    }
    if (conflicts.length > 0) {
      setModalError('Une réservation existe déjà sur le créneau à fermer.');
      return;
    }
    setModalError(null);
    const input: PlanningExceptionInput = {
      practitionerId,
      date: draft.date,
      type: draft.type,
      isFullDay: draft.isFullDay,
      slots: draft.isFullDay ? [] : draft.slots,
      startTime: draft.isFullDay ? null : draft.slots[0]?.startTime ?? null,
      endTime: draft.isFullDay ? null : draft.slots[0]?.endTime ?? null,
      reason: draft.reason,
    };

    try {
      if (draft.id) {
        await onUpdateException(draft.id, input);
        setFeedback('Exception mise à jour.');
      } else {
        await onCreateException(input);
        setFeedback('Exception enregistrée.');
      }
      setDraft(blankException(practitionerId));
      setModalOpen(false);
    } catch (cause) {
      setModalError(cause instanceof Error ? cause.message : 'Exception impossible.');
    }
  };

  return (
    <section className="pl-settings" data-testid="pl-availability-panel">
      <div className="pl-settings__head">
        <div>
          <h2>Disponibilités et exceptions</h2>
          <p>Le calendrier manager et la réservation cliente partagent la même source d’autorité.</p>
        </div>
        <button type="button" className="pl-actionbtn pl-actionbtn--primary" onClick={() => void saveSchedule()} disabled={busy}>
          <i className="bi-check2" aria-hidden="true" /> Enregistrer les disponibilités
        </button>
      </div>

      <WeeklyScheduleEditor value={weeklySchedule} onChange={setWeeklySchedule} />

      {error ? <div className="pl-warning pl-warning--error" role="alert">{error}</div> : null}
      {feedback ? <div className="pl-warning pl-warning--success" role="status">{feedback}</div> : null}

      <div className="pl-settings__head pl-settings__head--compact">
        <div>
          <h3>Exceptions ponctuelles</h3>
          <p>Bloquer une journée, fermer un créneau ou ajouter une ouverture exceptionnelle.</p>
        </div>
        <button type="button" className="pl-actionbtn pl-actionbtn--primary" onClick={openCreate} disabled={busy}>
          <i className="bi-plus-lg" aria-hidden="true" /> Ajouter une exception
        </button>
      </div>

      <div className="pl-settings__list">
        {exceptions.length === 0 ? (
          <div className="pl-exempty">
            <i className="bi-calendar2-plus" aria-hidden="true" />
            <p>Aucune exception sur la période chargée.</p>
          </div>
        ) : (
          exceptions.map((exception) => (
            <article key={exception._id} className={`pl-exceptioncard pl-exceptioncard--${exception.type}`}>
              <span className="pl-exceptioncard__mark" aria-hidden="true">
                <i className={exception.type === 'block' ? 'bi-slash-circle' : exception.type === 'add' ? 'bi-plus-circle' : 'bi-arrow-repeat'} />
              </span>
              <div className="pl-exceptioncard__main">
                <strong>{fmtDayLabel(new Date(exception.date))}</strong>
                <p>{buildExceptionSummary(exception)}</p>
                {exception.reason ? <span className="pl-exceptioncard__reason">{exception.reason}</span> : null}
              </div>
              <div className="pl-exceptioncard__actions">
                <button type="button" className="pl-iconbtn pl-iconbtn--sm" aria-label="Modifier l’exception" onClick={() => openEdit(exception)}><i className="bi-pencil" aria-hidden="true" /></button>
                <button type="button" className="pl-iconbtn pl-iconbtn--sm pl-iconbtn--danger" aria-label="Supprimer l’exception" onClick={() => void onDeleteException(exception._id)} disabled={busy}>
                  <i className="bi-trash3" aria-hidden="true" />
                </button>
              </div>
            </article>
          ))
        )}
      </div>

      {modalOpen ? (
        <ExceptionModal
          draft={draft}
          onChange={setDraft}
          conflicts={conflicts}
          error={modalError}
          busy={busy}
          onSubmit={() => void submitException()}
          onClose={() => setModalOpen(false)}
        />
      ) : null}
    </section>
  );
}

export function PlanningSkeleton(): ReactNode {
  return (
    <div aria-hidden="true">
      <div className="pl-skeleton" />
      <div className="pl-skeleton" />
      <div className="pl-skeleton" />
    </div>
  );
}
