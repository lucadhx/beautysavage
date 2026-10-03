import * as React from 'react';
import { Link } from 'react-router-dom';
import { Ban, CalendarDays, Check, Pencil, ChevronLeft, ChevronRight, Clock, CreditCard, GraduationCap, Lock, MapPin, Plus, RefreshCw, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Card, CardContent, Field, Input, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { useFloatingSave } from '@/hooks/useFloatingSave';
import { FloatingSaveWidget } from '@/components/ui/FloatingSaveWidget';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { motion } from 'framer-motion';
import { ClientPicker, clientName } from './ClientPicker';
import { DayTimeline, DAY_CLOSE, MonthCalendar, RangeEditor, STEP as QUARTER, TimeSelect, atMinutes, busyOfDay, durationLabel, hm, longDay, overlaps, sameDate, type Busy } from '@/components/ui/TimeRange';
import { CardsSkeleton, Skeleton, TableSkeleton } from '@/components/ui/Skeleton';
import { CommercePageFrame, StatusBadge, cents } from './CommerceShared';

interface CalendarEvent {
  id: string;
  type: 'SERVICE_BOOKING' | 'FORMATION_SESSION' | 'MANUAL_BLOCK';
  title: string;
  startsAt: string;
  endsAt: string;
  status: string;
  customerSnapshot?: { name?: string; email?: string; phone?: string };
  paymentSnapshot?: { totalCents?: number; paidCents?: number; depositCents?: number; balanceDueCents?: number; balancePaidCents?: number; balancePaymentMethod?: string };
  notes?: string;
  cancellation?: { reason?: string; refundedCents?: number };
  source?: Record<string, unknown>;
  productId?: string | null;
  capacity?: number;
  reservedCount?: number;
  sessionId?: string;
  location?: string;
}

interface FormationSessionSheet {
  product: { id: string; title: string; location: string; durationDays: number | null; formalities: string; priceCents: number };
  session: { id: string; startsAt: string; endsAt: string; status: string; capacity: number; reservedCount: number; cancellationReason: string };
  participants: { customerId: string; name: string; email: string; phone: string; seats: number; paidCents: number; saleId: string; saleNumber: string; registeredAt: string }[];
  seatsTaken: number;
  seatsLeft: number;
  revenueCents: number;
}

interface ServiceChoice {
  _id: string;
  title: string;
  durationMinutes?: number;
  price?: { amountCents?: number };
}

/** Une session issue d'une fiche formation — pas un rendez-vous : sa fiche est celle des inscrites. */
function isFormationSession(event: CalendarEvent | null) {
  return Boolean(event && event.type === 'FORMATION_SESSION' && event.source?.generatedFrom === 'commerceProduct.sessions');
}

interface ScheduleDay {
  weekday: number;
  enabled: boolean;
  ranges: { start: string; end: string }[];
}

interface EventForm {
  type: 'SERVICE_BOOKING' | 'FORMATION_SESSION' | 'MANUAL_BLOCK';
  productId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  totalEuros: string;
  paidEuros: string;
  notes: string;
}

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const DAY_START = 7 * 60;
const DAY_END = 21 * 60;
const STEP = 15;
const GRID_HEIGHT = ((DAY_END - DAY_START) / 60) * 72;

function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day + 1);
  return d;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function toInputValue(date: Date | string) {
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Fin = début + durée (en minutes), au format du champ `datetime-local`. */
function endFrom(startsAt: string, minutes: number) {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return '';
  return toInputValue(new Date(start.getTime() + Math.max(5, minutes) * 60_000));
}

function timeLabel(value: Date | string) {
  return new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function defaultForm(day: Date): EventForm {
  const start = new Date(day);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + 60);
  return {
    type: 'SERVICE_BOOKING',
    productId: '',
    title: 'Rendez-vous institut',
    startsAt: toInputValue(start),
    endsAt: toInputValue(end),
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    totalEuros: '0',
    paidEuros: '0',
    notes: '',
  };
}

function eventClasses(type: CalendarEvent['type']) {
  if (type === 'MANUAL_BLOCK') return 'border-amber-300 bg-amber-50 text-amber-950';
  if (type === 'FORMATION_SESSION') return 'border-violet-300 bg-violet-50 text-violet-950';
  return 'border-emerald-300 bg-emerald-50 text-emerald-950';
}

function eventLabel(type: CalendarEvent['type']) {
  if (type === 'MANUAL_BLOCK') return 'Blocage';
  if (type === 'FORMATION_SESSION') return 'Formation';
  return 'Prestation';
}

function minutesOfDate(value: string | Date) {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function eventPosition(event: CalendarEvent) {
  const start = clamp(minutesOfDate(event.startsAt), DAY_START, DAY_END);
  const end = clamp(minutesOfDate(event.endsAt), DAY_START, DAY_END);
  const total = DAY_END - DAY_START;
  return {
    top: `${((start - DAY_START) / total) * 100}%`,
    height: `${Math.max(42, ((end - start) / total) * GRID_HEIGHT)}px`,
  };
}

function formWithSlot(day: Date, minute: number, duration = 60): EventForm {
  const start = new Date(day);
  start.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + duration);
  return { ...defaultForm(day), startsAt: toInputValue(start), endsAt: toInputValue(end) };
}

export default function CommerceCalendarPage() {
  const [anchor, setAnchor] = React.useState(() => startOfWeek());
  const [view, setView] = React.useState<'week' | 'day'>('week');
  const [events, setEvents] = React.useState<CalendarEvent[]>([]);
  const [schedule, setSchedule] = React.useState<{ weeklyHours: ScheduleDay[]; slotStepMinutes: number; timezone: string } | null>(null);
  const [selected, setSelected] = React.useState<CalendarEvent | null>(null);
  const [form, setForm] = React.useState(() => defaultForm(new Date()));
  const [message, setMessage] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [showSchedule, setShowSchedule] = React.useState(false);
  const [showCancelled, setShowCancelled] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  /** Rendez-vous en cours de modification (même fenêtre que la création). */
  const [editing, setEditing] = React.useState<CalendarEvent | null>(null);
  const [selectedOpen, setSelectedOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [balanceOpen, setBalanceOpen] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState('');
  const [refundEuros, setRefundEuros] = React.useState('0');
  const [balanceEuros, setBalanceEuros] = React.useState('');
  const [services, setServices] = React.useState<ServiceChoice[]>([]);
  const [createError, setCreateError] = React.useState('');
  // Premier chargement : des rendez-vous fantômes plutôt qu'une grille vide.
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    api.commerceProducts()
      .then((items) => setServices((items as (ServiceChoice & { kind?: string; status?: string })[])
        .filter((item) => item.kind === 'SERVICE' && item.status !== 'ARCHIVED')
        .sort((a, b) => a.title.localeCompare(b.title, 'fr'))))
      .catch(() => setServices([]));
  }, []);

  const week = React.useMemo(() => startOfWeek(anchor), [anchor]);
  const days = React.useMemo(() => (view === 'day' ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(week, i))), [anchor, view, week]);
  const from = (view === 'day' ? anchor : week).toISOString();
  const to = addDays(view === 'day' ? anchor : week, view === 'day' ? 1 : 7).toISOString();
  const hours = React.useMemo(() => Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, i) => DAY_START / 60 + i), []);

  const refresh = React.useCallback(() => {
    setMessage('');
    Promise.all([api.calendarEvents({ from, to }), api.calendarSchedule()])
      .then(([eventList, scheduleDoc]) => {
        const next = eventList as CalendarEvent[];
        setEvents(next);
        setSchedule(scheduleDoc as typeof schedule);
        setSelected((current) => current ? next.find((event) => event.id === current.id) ?? null : current);
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Chargement du calendrier impossible'))
      .finally(() => setLoaded(true));
  }, [from, to]);

  React.useEffect(refresh, [refresh]);

  function selectEvent(event: CalendarEvent) {
    setSelected(event);
    setSelectedOpen(true);
  }

  function chooseSlot(day: Date, event: React.MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const raw = DAY_START + Math.round(((DAY_END - DAY_START) * ratio) / STEP) * STEP;
    // Un clic dans la grille ouvre une réservation neuve à cette heure ; sa
    // durée sera celle de la prestation choisie (1 h tant qu'aucune).
    setEditing(null);
    setForm(formWithSlot(day, raw, 60));
    setSelected(null);
    setCreateError('');
    setCreateOpen(true);
  }

  const [scheduleDirty, setScheduleDirty] = React.useState(false);
  const [confirmScheduleClose, setConfirmScheduleClose] = React.useState(false);
  const closeSchedule = () => {
    if (scheduleDirty) setConfirmScheduleClose(true);
    else setShowSchedule(false);
  };

  function openEdit(event: CalendarEvent) {
    setForm({
      type: event.type === 'MANUAL_BLOCK' ? 'MANUAL_BLOCK' : 'SERVICE_BOOKING',
      productId: event.productId ? String(event.productId) : '',
      title: event.title,
      startsAt: toInputValue(event.startsAt),
      endsAt: toInputValue(event.endsAt),
      customerName: event.customerSnapshot?.name || '',
      customerEmail: event.customerSnapshot?.email || '',
      customerPhone: event.customerSnapshot?.phone || '',
      totalEuros: String((event.paymentSnapshot?.totalCents || 0) / 100),
      paidEuros: String((event.paymentSnapshot?.paidCents || 0) / 100),
      notes: event.notes || '',
    });
    setEditing(event);
    setCreateError('');
    setSelectedOpen(false);
    setCreateOpen(true);
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    setCreateError('');
    try {
      await api.updateCalendarEvent(editing.id, {
        title: form.title,
        productId: form.type === 'SERVICE_BOOKING' && form.productId ? form.productId : null,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        customerSnapshot: { name: form.customerName, email: form.customerEmail, phone: form.customerPhone },
        paymentSnapshot: {
          totalCents: Math.round(Number(form.totalEuros || 0) * 100),
          paidCents: Math.round(Number(form.paidEuros || 0) * 100),
        },
        notes: form.notes,
      });
      const moved = new Date(form.startsAt).getTime() !== new Date(editing.startsAt).getTime() || new Date(form.endsAt).getTime() !== new Date(editing.endsAt).getTime();
      setMessage(moved
        ? `Rendez-vous déplacé au ${new Date(form.startsAt).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.`
        : 'Rendez-vous modifié.');
      setCreateOpen(false);
      setEditing(null);
      refresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Modification impossible');
    } finally {
      setSaving(false);
    }
  }

  async function createEvent() {
    setSaving(true);
    setMessage('');
    setCreateError('');
    try {
      const created = await api.createCalendarEvent({
        type: form.type,
        productId: form.type === 'SERVICE_BOOKING' && form.productId ? form.productId : null,
        title: form.title,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        customerSnapshot: { name: form.customerName, email: form.customerEmail, phone: form.customerPhone },
        paymentSnapshot: {
          totalCents: Math.round(Number(form.totalEuros || 0) * 100),
          paidCents: Math.round(Number(form.paidEuros || 0) * 100),
          depositCents: Math.round(Number(form.paidEuros || 0) * 100),
        },
        notes: form.notes,
      });
      const email = created?.customerSnapshot?.email;
      setMessage(
        form.type === 'MANUAL_BLOCK'
          ? 'Creneau bloque. Les chevauchements ont ete verifies.'
          : created?.customerAccountCreated
            ? `Rendez-vous cree. Compte client cree pour ${email} : un e-mail lui permet de choisir son mot de passe.`
            : email
              ? `Rendez-vous cree et rattache au compte client ${email}.`
              : 'Rendez-vous cree (sans e-mail client, aucun compte rattache).'
      );
      refresh();
      setCreateOpen(false);
    } catch (err) {
      // Dans la fenêtre, pas derrière elle : un chevauchement refusé doit se lire là où l'on saisit.
      setCreateError(err instanceof Error ? err.message : 'Creation impossible');
    } finally {
      setSaving(false);
    }
  }

  async function cancelSelected() {
    if (!selected) return;
    setSaving(true);
    await api.cancelCalendarEvent(selected.id, {
      reason: cancelReason,
      refundedCents: Math.round(Number(refundEuros || 0) * 100),
    });
    setSelected(null);
    setCancelOpen(false);
    setSelectedOpen(false);
    setSaving(false);
    refresh();
  }

  async function markBalancePaid() {
    if (!selected) return;
    if (!balanceEuros) return;
    setSaving(true);
    await api.recordCalendarBalancePayment(selected.id, {
      amountCents: Math.round(Number(balanceEuros) * 100),
      method: 'ON_SITE',
    });
    setBalanceOpen(false);
    setBalanceEuros('');
    setSaving(false);
    refresh();
  }

  const rangeLabel = view === 'day'
    ? anchor.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' })
    : `${week.toLocaleDateString('fr-FR')} - ${addDays(week, 6).toLocaleDateString('fr-FR')}`;

  return (
    <CommercePageFrame
      title="Calendrier institut"
      description="Planning type Planity : prestations, formations, blocages, acomptes, soldes et remboursements. Les superpositions sont refusees automatiquement."
    >
      {message && <p className="rounded-md border p-3 text-sm text-muted-foreground">{message}</p>}
      <div className="grid min-w-0 gap-4">
        <Card className="min-w-0 overflow-visible">
          <CardContent className="grid gap-4">
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={() => { setEditing(null); setForm(defaultForm(new Date())); setCreateError(''); setCreateOpen(true); }}><Plus className="h-4 w-4" /> Ajouter</Button>
                  <Button variant="outline" onClick={() => setShowSchedule(true)}><Clock className="h-4 w-4" /> Horaires classiques</Button>
                  <Button variant="outline" onClick={refresh}><RefreshCw className="h-4 w-4" /> Actualiser</Button>
                  {selected && <Button variant="outline" onClick={() => setSelectedOpen(true)}><CreditCard className="h-4 w-4" /> Evenement selectionne</Button>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{rangeLabel}</span>
                  <div className="inline-flex rounded-md border bg-background p-1">
                    <button type="button" onClick={() => setView('day')} className={`h-8 rounded px-3 text-xs font-medium ${view === 'day' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>Jour</button>
                    <button type="button" onClick={() => setView('week')} className={`h-8 rounded px-3 text-xs font-medium ${view === 'week' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>Semaine</button>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" aria-label="Periode precedente" onClick={() => setAnchor(addDays(anchor, view === 'day' ? -1 : -7))}><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="outline" onClick={() => setAnchor(view === 'day' ? new Date() : startOfWeek())}>Aujourd'hui</Button>
                <Button variant="outline" size="icon" aria-label="Periode suivante" onClick={() => setAnchor(addDays(anchor, view === 'day' ? 1 : 7))}><ChevronRight className="h-4 w-4" /></Button>
              </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  <Legend className="bg-emerald-100 text-emerald-900" label="Prestations reservees" />
                  <Legend className="bg-violet-100 text-violet-900" label="Formations" />
                  <Legend className="bg-amber-100 text-amber-900" label="Blocages" />
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium text-muted-foreground">
                    <input type="checkbox" checked={showCancelled} onChange={(event) => setShowCancelled(event.target.checked)} data-testid="show-cancelled" />
                    Afficher les annulés
                  </label>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <div className="min-w-[980px]">
                <div className="grid border-b bg-muted/40" style={{ gridTemplateColumns: `72px repeat(${days.length}, minmax(130px, 1fr))` }}>
                  <div className="p-3 text-xs font-medium text-muted-foreground">Heure</div>
                  {days.map((day, index) => (
                    <button key={day.toISOString()} type="button" onClick={() => setAnchor(day)} className="border-l p-3 text-left hover:bg-muted">
                      <div className="text-xs font-semibold uppercase text-muted-foreground">{DAY_LABELS[(day.getDay() || 7) - 1] ?? DAY_LABELS[index]}</div>
                      <div className="text-sm font-semibold">{day.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</div>
                    </button>
                  ))}
                </div>
                <div className="grid" style={{ gridTemplateColumns: `72px repeat(${days.length}, minmax(130px, 1fr))`, height: GRID_HEIGHT }}>
                  <div className="relative border-r bg-muted/20">
                    {hours.map((hour) => (
                      <div key={hour} className="absolute left-0 right-0 border-t px-2 pt-1 text-[11px] text-muted-foreground" style={{ top: `${(((hour * 60) - DAY_START) / (DAY_END - DAY_START)) * 100}%` }}>
                        {String(hour).padStart(2, '0')}:00
                      </div>
                    ))}
                  </div>
                  {days.map((day, dayIndex) => {
                    // Un rendez-vous annulé libère sa place : il quitte la grille
                    // (réaffichable avec la case « Afficher les annulés »).
                    const dayEvents = events.filter((event) => sameDay(new Date(event.startsAt), day) && (showCancelled || event.status !== 'CANCELLED'));
                    return (
                      <div key={day.toISOString()} className="relative border-r last:border-r-0" onClick={(event) => chooseSlot(day, event)}>
                        {hours.map((hour) => (
                          <div key={hour} className="absolute left-0 right-0 border-t" style={{ top: `${(((hour * 60) - DAY_START) / (DAY_END - DAY_START)) * 100}%` }} />
                        ))}
                        {!loaded && (
                          <>
                            <Skeleton className={`absolute inset-x-1 h-16 ${dayIndex % 2 ? 'top-[18%]' : 'top-[8%]'}`} />
                            <Skeleton className={`absolute inset-x-1 h-24 ${dayIndex % 3 ? 'top-[46%]' : 'top-[58%]'}`} />
                          </>
                        )}
                        {dayEvents.map((event) => {
                          const position = eventPosition(event);
                          return (
                            <button
                              key={event.id}
                              type="button"
                              onClick={(click) => {
                                click.stopPropagation();
                                selectEvent(event);
                              }}
                              className={`absolute left-1 right-1 z-10 overflow-hidden rounded-md border px-2 py-1 text-left text-xs shadow-sm transition hover:shadow-md ${eventClasses(event.type)} ${event.status === 'CANCELLED' ? 'opacity-55 line-through' : ''}`}
                              style={position}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate font-semibold">{event.title}</span>
                                {event.source?.generatedFrom === 'commerceProduct.sessions' && <Lock className="h-3 w-3 shrink-0" />}
                              </div>
                              <div>{timeLabel(event.startsAt)} - {timeLabel(event.endsAt)}</div>
                              {isFormationSession(event) ? (
                                <div className="font-medium">{event.reservedCount || 0}/{event.capacity || 0} inscrite(s)</div>
                              ) : (
                                <>
                                  {event.customerSnapshot?.email && <div className="truncate">{event.customerSnapshot.email}</div>}
                                  {event.paymentSnapshot && <div>{cents(event.paymentSnapshot.paidCents)} paye - {cents(event.paymentSnapshot.balanceDueCents)} restant</div>}
                                </>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      <Modal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setEditing(null); }}
        title={editing ? (form.type === 'MANUAL_BLOCK' ? 'Modifier le blocage' : 'Modifier le rendez-vous') : form.type === 'MANUAL_BLOCK' ? 'Bloquer un créneau' : 'Réservation manuelle'}
        description={editing ? 'Déplacez-le ou ajustez sa durée : le planning est vérifié sans tenir compte de ce rendez-vous lui-même.' : 'Choisissez le jour et l’heure : la durée de la prestation donne la fin estimée.'}
        className="max-w-3xl"
        busy={saving}
      >
        <CreatePanel
          form={form}
          setForm={setForm}
          services={services}
          error={createError}
          saving={saving}
          editingId={editing?.id || null}
          onCreate={async () => {
            if (editing) await saveEdit();
            else await createEvent();
          }}
        />
      </Modal>
      <Modal
        open={selectedOpen && Boolean(selected)}
        onClose={() => setSelectedOpen(false)}
        title={selected?.title || 'Evenement'}
        description={isFormationSession(selected)
          ? 'Session de formation : participantes inscrites, places et lieu.'
          : 'Modifier, encaisser le solde ou annuler sans quitter le calendrier.'}
        className="max-w-3xl"
        busy={saving}
      >
        {selected && isFormationSession(selected) && <FormationSessionPanel selected={selected} />}
        {selected && !isFormationSession(selected) && (
          <EventPanel
            selected={selected}
            onEdit={() => openEdit(selected)}
            onBalance={() => {
              setBalanceEuros(String(((selected.paymentSnapshot?.balanceDueCents || 0) / 100) || ''));
              setBalanceOpen(true);
            }}
            onCancel={() => {
              setCancelReason('');
              setRefundEuros('0');
              setCancelOpen(true);
            }}
          />
        )}
      </Modal>
      <Modal
        open={showSchedule && Boolean(schedule)}
        onClose={closeSchedule}
        title="Horaires classiques"
        description="Ces plages alimentent les disponibilités proposées aux clientes."
        className="max-w-3xl"
      >
        {showSchedule && schedule && (
          <SchedulePanel
            initial={schedule}
            onDirtyChange={setScheduleDirty}
            onSaved={(saved) => { setSchedule(saved); setMessage('Horaires enregistrés.'); }}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={confirmScheduleClose}
        onClose={() => setConfirmScheduleClose(false)}
        onConfirm={() => { setConfirmScheduleClose(false); setScheduleDirty(false); setShowSchedule(false); }}
        title="Fermer sans enregistrer ?"
        description="Les horaires modifiés n’ont pas été enregistrés."
        confirmLabel="Fermer sans enregistrer"
        cancelLabel="Continuer la saisie"
        destructive
      />
      <Modal open={balanceOpen} onClose={() => setBalanceOpen(false)} title="Encaisser le solde" className="max-w-md" busy={saving}>
        <div className="grid gap-4">
          <Field label="Montant encaisse en EUR">
            <Input type="number" min="0" step="0.01" value={balanceEuros} onChange={(event) => setBalanceEuros(event.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setBalanceOpen(false)} disabled={saving}>Annuler</Button>
            <Button onClick={markBalancePaid} loading={saving}><CreditCard className="h-4 w-4" /> Valider</Button>
          </div>
        </div>
      </Modal>
      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Annuler / rembourser" description="Le remboursement est historise sur l evenement calendrier." className="max-w-md" busy={saving}>
        <div className="grid gap-4">
          <Field label="Motif">
            <Textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
          </Field>
          <Field label="Montant rembourse en EUR">
            <Input type="number" min="0" step="0.01" value={refundEuros} onChange={(event) => setRefundEuros(event.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={saving}>Annuler</Button>
            <Button variant="destructive" onClick={cancelSelected} loading={saving}><Ban className="h-4 w-4" /> Confirmer</Button>
          </div>
        </div>
      </Modal>
    </CommercePageFrame>
  );
}

function Legend({ label, className }: { label: string; className: string }) {
  return <span className={`rounded-full px-2.5 py-1 font-medium ${className}`}>{label}</span>;
}

/** Les champs du formulaire gardent le format `AAAA-MM-JJTHH:MM` (heure locale). */
const partsOf = (value: string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * RÉSERVATION MANUELLE — sans aucun sélecteur natif.
 *
 *   1. le jour, dans un calendrier du mois ;
 *   2. l'heure de début, en cases d'un quart d'heure ;
 *   3. la DURÉE PRÉVUE (celle de la prestation choisie) et la FIN ESTIMÉE,
 *      écrites en clair, avec la journée en frise : ce qui est déjà pris, et
 *      la plage réservée ;
 *   4. « Modifier » ouvre la frise en grand avec les heures : choisir une
 *      heure redessine la plage, puis « Valider » ou « Annuler ».
 */
function CreatePanel({
  form,
  setForm,
  services,
  error,
  saving,
  onCreate,
  editingId = null,
}: {
  form: EventForm;
  setForm: (form: EventForm) => void;
  services: ServiceChoice[];
  error: string;
  saving: boolean;
  onCreate: () => void;
  /** Modification d'un rendez-vous : il ne se compte pas comme conflit, son type ne change pas. */
  editingId?: string | null;
}) {
  const start = partsOf(form.startsAt) || new Date();
  const end = partsOf(form.endsAt) || new Date(start.getTime() + 60 * 60_000);
  const day = new Date(start); day.setHours(0, 0, 0, 0);
  const dayKey = day.toDateString();
  const fromMin = minutesOfDate(start);
  const toMin = sameDate(start, end) ? minutesOfDate(end) : DAY_CLOSE;
  const length = Math.max(0, toMin - fromMin);
  const [calendarOpen, setCalendarOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  /** Le formulaire, ou l'écran « Choisir un client » qui glisse à sa place. */
  const [view, setView] = React.useState<'form' | 'clients'>('form');
  /** Incrémenté à chaque client choisi : rejoue l'animation de remplissage. */
  const [filled, setFilled] = React.useState(0);
  /** Le formulaire glisse depuis la gauche quand on revient de la liste des clients. */
  const [wentAway, setWentAway] = React.useState(false);
  const clientSection = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (filled > 0) clientSection.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [filled]);
  const [busyList, setBusyList] = React.useState<Busy[] | null>(null);
  const service = services.find((item) => item._id === form.productId) || null;

  React.useEffect(() => {
    let alive = true;
    setBusyList(null);
    const from = new Date(dayKey);
    api.calendarEvents({ from: from.toISOString(), to: new Date(from.getTime() + 86400_000).toISOString() })
      .then((list) => { if (alive) setBusyList((list as CalendarEvent[]).filter((e) => e.status !== 'CANCELLED' && e.id !== editingId)); })
      .catch(() => { if (alive) setBusyList([]); });
    return () => { alive = false; };
  }, [dayKey, editingId]);
  const busy = busyOfDay(busyList || [], day);
  const clashes = overlaps(busy, fromMin, toMin);

  const setRange = (d: Date, from: number, to: number) => setForm({ ...form, startsAt: toInputValue(atMinutes(d, from)), endsAt: toInputValue(atMinutes(d, to)) });

  /** Choisir une prestation remplit le titre, la durée et le total — tout reste modifiable. */
  const chooseService = (id: string) => {
    const chosen = services.find((item) => item._id === id);
    if (!chosen) {
      setForm({ ...form, productId: '' });
      return;
    }
    setForm({
      ...form,
      productId: chosen._id,
      title: chosen.title,
      endsAt: endFrom(form.startsAt, Number(chosen.durationMinutes || 60)),
      totalEuros: String((chosen.price?.amountCents || 0) / 100),
    });
  };

  if (view === 'clients') {
    return (
      <motion.div key="clients" initial={{ opacity: 0, x: 56 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}>
        <ClientPicker
          currentEmail={form.customerEmail}
          onBack={() => setView('form')}
          onPick={(c) => {
            setForm({ ...form, customerName: clientName(c), customerEmail: c.email || '', customerPhone: c.phone || '' });
            setFilled((n) => n + 1);
            setView('form');
          }}
        />
      </motion.div>
    );
  }

  return (
    <motion.div
      key="form"
      initial={wentAway ? { opacity: 0, x: -56 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="grid grid-cols-[minmax(0,1fr)] gap-5"
      data-testid="create-panel"
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        {!editingId && <Field label="Type">
          <CustomSelect
            value={form.type}
            onChange={(type) => setForm({ ...form, type: type as EventForm['type'], title: type === 'MANUAL_BLOCK' ? 'Blocage manuel' : 'Rendez-vous institut' })}
            options={[
              { value: 'SERVICE_BOOKING', label: 'Réservation manuelle', description: 'Client, acompte, solde et notes.' },
              { value: 'MANUAL_BLOCK', label: 'Blocage', description: 'Indisponibilité, pause, fermeture ou préparation.' },
            ]}
          />
        </Field>}
        {form.type === 'SERVICE_BOOKING' && services.length > 0 && (
          <Field label="Prestation">
            <CustomSelect
              value={form.productId}
              onChange={chooseService}
              options={[
                { value: '', label: 'Rendez-vous libre', description: 'Sans fiche prestation associée.' },
                ...services.map((item) => ({
                  value: item._id,
                  label: item.title,
                  description: `${durationLabel(item.durationMinutes || 60)} · ${cents(item.price?.amountCents)}`,
                })),
              ]}
            />
          </Field>
        )}
      </div>

      {/* QUAND */}
      <section className="grid grid-cols-[minmax(0,1fr)] gap-4 rounded-xl border bg-muted/20 p-3 sm:p-4" data-testid="when">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <span className="text-sm font-medium">Jour</span>
            <button
              type="button"
              onClick={() => setCalendarOpen((o) => !o)}
              aria-expanded={calendarOpen}
              className={`inline-flex h-11 items-center justify-between gap-2 rounded-lg border bg-background px-3 text-left text-sm font-semibold transition hover:border-primary/60 ${calendarOpen ? 'border-primary ring-2 ring-primary/15' : ''}`}
              data-testid="day-button"
            >
              <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-muted-foreground" />{longDay(day)}</span>
              <span className="text-xs font-medium text-muted-foreground">{calendarOpen ? 'Fermer' : 'Changer'}</span>
            </button>
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium">Heure de début</span>
            <TimeSelect
              value={hm(fromMin)}
              label="Heure de début"
              testId="start-select"
              stateOf={(m) => (atMinutes(day, m) < new Date() ? 'past' : overlaps(busy, m, m + (length || 60)).length ? 'conflict' : 'free')}
              onChange={(value) => {
                const [h, m] = value.split(':').map(Number);
                const from = h * 60 + m;
                setRange(day, from, Math.min(DAY_CLOSE + 180, from + (length || 60)));
              }}
            />
          </div>
        </div>
        {calendarOpen && (
          <div className="rounded-lg border bg-card p-3">
            <MonthCalendar
              value={day}
              onChange={(d) => { setRange(d, fromMin, fromMin + (length || 60)); setCalendarOpen(false); }}
            />
          </div>
        )}

        {editing ? (
          <RangeEditor
            day={day}
            from={fromMin}
            to={Math.max(fromMin + QUARTER, toMin)}
            busy={busy}
            onCancel={() => setEditing(false)}
            onConfirm={(from, to) => { setRange(day, from, to); setEditing(false); }}
          />
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-xl border bg-card p-3 sm:p-4" data-testid="range-summary">
            <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Durée prévue</p>
                <p className="text-xl font-semibold tabular-nums" data-testid="planned-duration">{durationLabel(length)}</p>
                <p className="line-clamp-2 text-xs text-muted-foreground">{service ? `Durée de « ${service.title} »` : 'Durée libre'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fin estimée</p>
                <p className="text-xl font-semibold tabular-nums" data-testid="estimated-end">{hm(toMin)}</p>
                <p className="text-xs text-muted-foreground">de {hm(fromMin)} à {hm(toMin)}</p>
              </div>
              <Button type="button" variant="outline" className="col-span-2 h-11 sm:col-span-1" onClick={() => setEditing(true)} data-testid="edit-range">
                <Clock className="h-4 w-4" /> Modifier
              </Button>
            </div>
            <DayTimeline busy={busy} from={fromMin} to={toMin} testId="summary-timeline" onMove={(m) => setRange(day, m, m + length)} />
            {busyList === null ? (
              <p className="text-xs text-muted-foreground">Vérification du planning…</p>
            ) : clashes.length > 0 ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert" data-testid="range-conflict">
                Chevauche : {clashes.map((c) => `${c.title} (${hm(c.from)}–${hm(c.to)})`).join(', ')}
              </p>
            ) : (
              <p className="text-xs font-semibold text-emerald-700" data-testid="range-free">Créneau libre au planning.</p>
            )}
          </div>
        )}
      </section>

      <Field label="Titre"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
      {form.type !== 'MANUAL_BLOCK' && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <section ref={clientSection} className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-xl border bg-muted/20 p-3 sm:col-span-2 sm:p-4" data-testid="client-section">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">Client</p>
              <Button type="button" variant="outline" className="h-11" onClick={() => { setWentAway(true); setView('clients'); }} data-testid="choose-client">
                <Users className="h-4 w-4" /> {form.customerEmail || form.customerName ? 'Changer de client' : 'Choisir un client'}
              </Button>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
              <FillFlash k={filled} delay={0}>
                <Field label="Nom"><Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} data-testid="client-name" /></Field>
              </FillFlash>
              <FillFlash k={filled} delay={0.08}>
                <Field label="Téléphone"><Input value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} data-testid="client-phone" /></Field>
              </FillFlash>
              <FillFlash k={filled} delay={0.16} className="sm:col-span-2">
                <Field
                  label="E-mail client"
                  hint="Adresse inconnue : un compte client est créé et reçoit un lien pour choisir son mot de passe."
                >
                  <Input type="email" value={form.customerEmail} onChange={(e) => setForm({ ...form, customerEmail: e.target.value })} data-testid="client-email" />
                </Field>
              </FillFlash>
            </div>
          </section>
          <Field label="Total" unit="€"><Input inputMode="decimal" value={form.totalEuros} onChange={(e) => setForm({ ...form, totalEuros: e.target.value })} /></Field>
          <Field label="Acompte payé" unit="€"><Input inputMode="decimal" value={form.paidEuros} onChange={(e) => setForm({ ...form, paidEuros: e.target.value })} /></Field>
        </div>
      )}
      <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      <Button className="h-11" onClick={onCreate} loading={saving} disabled={editing}>{editingId ? <><Check className="h-4 w-4" /> Enregistrer les modifications</> : <><Plus className="h-4 w-4" /> {form.type === 'MANUAL_BLOCK' ? 'Bloquer le créneau' : 'Créer le rendez-vous'}</>}</Button>
    </motion.div>
  );
}

/**
 * ANIMATION DE REMPLISSAGE — après « Valider » dans « Choisir un client »,
 * chaque champ s'allume en vert puis s'estompe, l'un après l'autre.
 */
function FillFlash({ k, delay, className, children }: { k: number; delay: number; className?: string; children: React.ReactNode }) {
  return (
    <motion.div
      key={k}
      className={`rounded-lg ${className || ''}`}
      initial={k > 0 ? { backgroundColor: 'rgba(16, 185, 129, 0.28)', scale: 0.98 } : false}
      animate={{ backgroundColor: 'rgba(16, 185, 129, 0)', scale: 1 }}
      transition={{ duration: 0.9, delay, ease: 'easeOut' }}
      data-filled={k > 0 || undefined}
    >
      {children}
    </motion.div>
  );
}

function EventPanel({
  selected,
  onBalance,
  onEdit,
  onCancel,
}: {
  selected: CalendarEvent;
  onBalance: () => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const generated = selected.source?.generatedFrom === 'commerceProduct.sessions';
  const totalCents = Number(selected.paymentSnapshot?.totalCents || 0);
  const paidCents = Number(selected.paymentSnapshot?.paidCents || 0);
  const remainingCents = Number(selected.paymentSnapshot?.balanceDueCents ?? Math.max(0, totalCents - paidCents));
  return (
    <Card className="min-w-0">
      <CardContent className="grid gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{eventLabel(selected.type)}</p>
            <h2 className="truncate text-lg font-semibold">{selected.title}</h2>
            <p className="text-sm text-muted-foreground">{timeLabel(selected.startsAt)} - {timeLabel(selected.endsAt)}</p>
          </div>
          <StatusBadge>{selected.status}</StatusBadge>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <AmountCard label="Montant total" value={cents(totalCents)} />
          <AmountCard label="Montant paye" value={cents(paidCents)} />
          <AmountCard label="Restant a payer" value={cents(remainingCents)} />
        </div>

        {generated && (
          <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            Session issue d une fiche formation. Les horaires se gerent depuis la formation.
          </p>
        )}

        <dl className="grid gap-2 text-sm">
          <Row label="Client" value={selected.customerSnapshot?.name || 'Non renseigne'} />
          <Row label="E-mail" value={selected.customerSnapshot?.email || 'Non renseigne'} />
          <Row label="Telephone" value={selected.customerSnapshot?.phone || 'Non renseigne'} />
          <Row label="Total" value={cents(selected.paymentSnapshot?.totalCents)} />
          <Row label="Acompte / paye" value={cents(selected.paymentSnapshot?.paidCents)} />
          <Row label="Reste a payer" value={cents(selected.paymentSnapshot?.balanceDueCents)} />
          <Row label="Rembourse" value={cents(selected.cancellation?.refundedCents)} />
        </dl>
        {selected.notes && <p className="rounded-md border bg-muted/30 p-3 text-sm">{selected.notes}</p>}
        <div className="flex flex-wrap gap-2">
          {selected.status !== 'CANCELLED' && <Button onClick={onEdit} data-testid="event-edit"><Pencil className="h-4 w-4" /> Modifier</Button>}
          <Button variant="outline" onClick={onBalance}><CreditCard className="h-4 w-4" /> Encaisser solde</Button>
          <Button variant="destructive" onClick={onCancel}><Ban className="h-4 w-4" /> Annuler / rembourser</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * LA FICHE D'UNE SESSION DE FORMATION — ce n'est pas un rendez-vous : pas de
 * solde à encaisser, pas d'annulation individuelle. Ce que l'institut vient y
 * chercher, c'est QUI vient, combien de places restent, et où.
 */
function FormationSessionPanel({ selected }: { selected: CalendarEvent }) {
  const [sheet, setSheet] = React.useState<FormationSessionSheet | null>(null);
  const [error, setError] = React.useState('');
  const productId = String(selected.productId || '');
  const sessionId = String(selected.sessionId || selected.source?.sessionId || '');

  React.useEffect(() => {
    let alive = true;
    setSheet(null);
    setError('');
    api.calendarFormationSession(productId, sessionId)
      .then((data) => { if (alive) setSheet(data as FormationSessionSheet); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : 'Session introuvable'); });
    return () => { alive = false; };
  }, [productId, sessionId]);

  const rawDay = new Date(selected.startsAt).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const day = rawDay.charAt(0).toUpperCase() + rawDay.slice(1);
  if (error) return <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  if (!sheet) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-36 w-full rounded-xl" />
        <CardsSkeleton count={3} className="gap-3 sm:grid-cols-3 md:grid-cols-3" />
        <TableSkeleton rows={3} cols={5} />
      </div>
    );
  }

  const capacity = sheet.session.capacity;
  const taken = Math.max(sheet.seatsTaken, sheet.session.reservedCount);
  const fill = capacity > 0 ? Math.min(100, Math.round((taken / capacity) * 100)) : 0;
  return (
    <div className="grid gap-4" data-testid="formation-session-panel">
      <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900 dark:bg-violet-950/30">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300"><GraduationCap className="h-4 w-4" /> Session de formation</p>
            <h2 className="mt-1 text-lg font-semibold">{sheet.product.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{day} · {timeLabel(sheet.session.startsAt)} - {timeLabel(sheet.session.endsAt)}</p>
            {sheet.product.location && <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin className="h-4 w-4" /> {sheet.product.location}</p>}
          </div>
          <StatusBadge>{sheet.session.status}</StatusBadge>
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">{taken} / {capacity} places occupees</span>
            <span className="text-muted-foreground">{sheet.seatsLeft} restante(s)</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-violet-100 dark:bg-violet-950">
            <div className="h-full rounded-full bg-violet-500" style={{ width: `${fill}%` }} />
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <AmountCard label="Inscrites" value={String(sheet.participants.length)} />
        <AmountCard label="Places restantes" value={String(sheet.seatsLeft)} />
        <AmountCard label="Encaisse" value={cents(sheet.revenueCents)} />
      </div>

      <section className="overflow-hidden rounded-lg border">
        <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-3">
          <Users className="h-4 w-4" />
          <h3 className="font-semibold">Participantes</h3>
        </div>
        {sheet.participants.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Aucune inscription payee pour cette session.</p>
        ) : (
          <div className="m-table m-flush max-w-full overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-muted/20 text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-4 py-2">Participante</th><th className="m-hide px-4 py-2">Contact</th><th className="px-4 py-2">Places</th><th className="m-hide px-4 py-2">Paye</th><th className="px-4 py-2">Commande</th></tr>
              </thead>
              <tbody>
                {sheet.participants.map((row) => (
                  <tr key={`${row.saleId}-${row.customerId}`} className="border-t">
                    <td className="px-4 py-2 font-medium">
                      {row.customerId ? <Link to={`/commerce/clients/${row.customerId}`} className="hover:underline">{row.name}</Link> : row.name}
                      <div className="break-all text-xs font-normal text-muted-foreground sm:hidden">{row.email}{row.phone ? ` · ${row.phone}` : ''}</div>
                    </td>
                    <td className="m-hide px-4 py-2 text-muted-foreground">
                      <div className="truncate">{row.email}</div>
                      {row.phone && <div>{row.phone}</div>}
                    </td>
                    <td className="px-4 py-2">{row.seats}</td>
                    <td className="m-hide whitespace-nowrap px-4 py-2">{cents(row.paidCents)}</td>
                    <td className="px-4 py-2">
                      <Link to={`/commerce/ventes/${row.saleId}`} className="text-primary hover:underline">{row.saleNumber}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {sheet.session.reservedCount > sheet.seatsTaken && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {sheet.session.reservedCount - sheet.seatsTaken} place(s) comptee(s) sur la fiche formation sans commande en ligne associee (inscription saisie a la main).
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Link to={`/commerce/formations/${sheet.product.id}`} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold hover:bg-muted">
          <GraduationCap className="h-4 w-4" /> Gerer la formation et ses sessions
        </Link>
      </div>
    </div>
  );
}

function AmountCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

type WeeklySchedule = { weeklyHours: ScheduleDay[]; slotStepMinutes: number; timezone: string };

/**
 * LES HORAIRES CLASSIQUES — un brouillon, le bouton flottant « Enregistrer »
 * collé au bas de la fenêtre, et la garde de sortie : fermer la fenêtre ou
 * quitter la page avec des horaires non enregistrés demande confirmation.
 * Monté à l'ouverture seulement : chaque ouverture repart des horaires
 * enregistrés.
 */
function SchedulePanel({
  initial,
  onDirtyChange,
  onSaved,
}: {
  initial: WeeklySchedule;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (schedule: WeeklySchedule) => void;
}) {
  const [schedule, setSchedule] = React.useState<WeeklySchedule>(initial);
  const [error, setError] = React.useState('');
  const { state, dirty, save } = useFloatingSave<WeeklySchedule>(schedule, async () => {
    setError('');
    try {
      const saved = await api.saveCalendarSchedule(schedule);
      onSaved(saved as WeeklySchedule);
      return schedule;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sauvegarde des horaires impossible');
      throw err;
    }
  });
  React.useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  React.useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  return (
    <div className="grid gap-3" data-testid="schedule-panel">
      {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
    <Card className="min-w-0">
      <CardContent className="grid gap-3">
        {schedule.weeklyHours.map((day, index) => (
          <div key={day.weekday} className="rounded-md border p-3">
            <div className="mb-2 flex items-center justify-between">
              <strong>{DAY_LABELS[index]}</strong>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={day.enabled}
                  onChange={(e) => {
                    const next = [...schedule.weeklyHours];
                    next[index] = { ...day, enabled: e.target.checked };
                    setSchedule({ ...schedule, weeklyHours: next });
                  }}
                />
                ouvert
              </label>
            </div>
            {(day.ranges.length ? day.ranges : [{ start: '', end: '' }]).map((range, rangeIndex) => (
              <div key={rangeIndex} className="mb-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input
                  type="time"
                  aria-label={`${DAY_LABELS[index]} debut plage ${rangeIndex + 1}`}
                  value={range.start}
                  onChange={(e) => {
                    const next = [...schedule.weeklyHours];
                    const ranges = [...day.ranges];
                    ranges[rangeIndex] = { ...range, start: e.target.value };
                    next[index] = { ...day, ranges };
                    setSchedule({ ...schedule, weeklyHours: next });
                  }}
                />
                <Input
                  type="time"
                  aria-label={`${DAY_LABELS[index]} fin plage ${rangeIndex + 1}`}
                  value={range.end}
                  onChange={(e) => {
                    const next = [...schedule.weeklyHours];
                    const ranges = [...day.ranges];
                    ranges[rangeIndex] = { ...range, end: e.target.value };
                    next[index] = { ...day, ranges };
                    setSchedule({ ...schedule, weeklyHours: next });
                  }}
                />
                <Button size="sm" variant="ghost" onClick={() => {
                  const next = [...schedule.weeklyHours];
                  next[index] = { ...day, ranges: day.ranges.filter((_, i) => i !== rangeIndex) };
                  setSchedule({ ...schedule, weeklyHours: next });
                }}>Retirer</Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => {
              const next = [...schedule.weeklyHours];
              next[index] = { ...day, ranges: [...day.ranges, { start: '09:00', end: '12:00' }] };
              setSchedule({ ...schedule, weeklyHours: next });
            }}>Ajouter plage</Button>
          </div>
        ))}
      </CardContent>
    </Card>
      <FloatingSaveWidget state={state} onSave={() => void save()} anchor="sticky" shortcut />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b pb-1 last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
