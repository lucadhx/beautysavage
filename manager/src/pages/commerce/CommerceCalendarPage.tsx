import * as React from 'react';
import { Ban, ChevronLeft, ChevronRight, Clock, CreditCard, Lock, Plus, RefreshCw, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Card, CardContent, Field, Input, Textarea } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/dialog';
import { CustomSelect } from '@/components/ui/CustomSelect';
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
}

interface ScheduleDay {
  weekday: number;
  enabled: boolean;
  ranges: { start: string; end: string }[];
}

interface EventForm {
  type: 'SERVICE_BOOKING' | 'FORMATION_SESSION' | 'MANUAL_BLOCK';
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
  const [availability, setAvailability] = React.useState<{ startsAt: string; endsAt: string; durationMinutes: number }[]>([]);
  const [message, setMessage] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [showSchedule, setShowSchedule] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selectedOpen, setSelectedOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [balanceOpen, setBalanceOpen] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState('');
  const [refundEuros, setRefundEuros] = React.useState('0');
  const [balanceEuros, setBalanceEuros] = React.useState('');

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
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Chargement du calendrier impossible'));
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
    const duration = Math.max(15, Math.round((new Date(form.endsAt).getTime() - new Date(form.startsAt).getTime()) / 60_000) || 60);
    setForm(formWithSlot(day, raw, duration));
    setSelected(null);
    setCreateOpen(true);
  }

  async function saveSchedule() {
    if (!schedule) return;
    setSaving(true);
    try {
      const saved = await api.saveCalendarSchedule(schedule);
      setSchedule(saved);
      setMessage('Horaires enregistres.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Sauvegarde des horaires impossible');
    } finally {
      setSaving(false);
    }
  }

  async function createEvent() {
    setSaving(true);
    setMessage('');
    try {
      await api.createCalendarEvent({
        type: form.type,
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
      setMessage('Creneau cree. Les chevauchements ont ete verifies.');
      refresh();
      setCreateOpen(false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Creation impossible');
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

  async function loadAvailability() {
    setSaving(true);
    setMessage('');
    try {
      const durationMinutes = Math.max(5, Math.round((new Date(form.endsAt).getTime() - new Date(form.startsAt).getTime()) / 60_000) || 60);
      const slots = await api.calendarAvailability({ from, to, durationMinutes });
      setAvailability(slots as { startsAt: string; endsAt: string; durationMinutes: number }[]);
      setMessage('Disponibilites recalculees.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Calcul des disponibilites impossible');
    } finally {
      setSaving(false);
    }
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
                  <Button variant="outline" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Ajouter</Button>
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
                  {days.map((day) => {
                    const dayEvents = events.filter((event) => sameDay(new Date(event.startsAt), day));
                    return (
                      <div key={day.toISOString()} className="relative border-r last:border-r-0" onClick={(event) => chooseSlot(day, event)}>
                        {hours.map((hour) => (
                          <div key={hour} className="absolute left-0 right-0 border-t" style={{ top: `${(((hour * 60) - DAY_START) / (DAY_END - DAY_START)) * 100}%` }} />
                        ))}
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
                              {event.customerSnapshot?.email && <div className="truncate">{event.customerSnapshot.email}</div>}
                              {event.paymentSnapshot && <div>{cents(event.paymentSnapshot.paidCents)} paye - {cents(event.paymentSnapshot.balanceDueCents)} restant</div>}
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
        onClose={() => setCreateOpen(false)}
        title={form.type === 'MANUAL_BLOCK' ? 'Bloquer un creneau' : 'Reservation manuelle'}
        description="Le creneau sera verifie avant enregistrement."
        className="max-w-2xl"
        busy={saving}
      >
        <CreatePanel
          form={form}
          setForm={setForm}
          saving={saving}
          availability={availability}
          onAvailability={loadAvailability}
          onCreate={async () => {
            await createEvent();
          }}
        />
      </Modal>
      <Modal
        open={selectedOpen && Boolean(selected)}
        onClose={() => setSelectedOpen(false)}
        title={selected?.title || 'Evenement'}
        description="Modifier, encaisser le solde ou annuler sans quitter le calendrier."
        className="max-w-3xl"
        busy={saving}
      >
        {selected && (
          <EventPanel
            selected={selected}
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
        onClose={() => setShowSchedule(false)}
        title="Horaires classiques"
        description="Ces plages alimentent les disponibilites proposees aux clientes."
        className="max-w-3xl"
        busy={saving}
      >
        {schedule && <SchedulePanel schedule={schedule} setSchedule={setSchedule} onSave={saveSchedule} saving={saving} />}
      </Modal>
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

function CreatePanel({
  form,
  setForm,
  saving,
  availability,
  onAvailability,
  onCreate,
}: {
  form: EventForm;
  setForm: (form: EventForm) => void;
  saving: boolean;
  availability: { startsAt: string; endsAt: string; durationMinutes: number }[];
  onAvailability: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Creer / bloquer</h2>
          <Button variant="outline" size="sm" onClick={onAvailability} loading={saving}>Voir les disponibilites</Button>
        </div>
        {availability.length > 0 && (
          <div className="max-h-36 overflow-auto rounded-md border p-2">
            {availability.slice(0, 18).map((slot) => (
              <button
                key={slot.startsAt}
                type="button"
                onClick={() => setForm({ ...form, startsAt: toInputValue(slot.startsAt), endsAt: toInputValue(slot.endsAt) })}
                className="mb-1 block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted"
              >
                {new Date(slot.startsAt).toLocaleString('fr-FR')} - {timeLabel(slot.endsAt)}
              </button>
            ))}
          </div>
        )}
        <Field label="Type">
          <CustomSelect
            value={form.type}
            onChange={(type) => setForm({ ...form, type: type as EventForm['type'], title: type === 'MANUAL_BLOCK' ? 'Blocage manuel' : 'Rendez-vous institut' })}
            options={[
              { value: 'SERVICE_BOOKING', label: 'Reservation manuelle', description: 'Client, acompte, solde et notes.' },
              { value: 'MANUAL_BLOCK', label: 'Blocage', description: 'Indisponibilite, pause, fermeture ou preparation.' },
            ]}
          />
        </Field>
        <Field label="Titre"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Debut"><Input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></Field>
          <Field label="Fin"><Input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></Field>
        </div>
        {form.type !== 'MANUAL_BLOCK' && (
          <>
            <Field label="Client"><Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></Field>
            <Field label="E-mail client"><Input type="email" value={form.customerEmail} onChange={(e) => setForm({ ...form, customerEmail: e.target.value })} /></Field>
            <Field label="Telephone"><Input value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Total EUR"><Input type="number" min="0" step="0.01" value={form.totalEuros} onChange={(e) => setForm({ ...form, totalEuros: e.target.value })} /></Field>
              <Field label="Acompte paye EUR"><Input type="number" min="0" step="0.01" value={form.paidEuros} onChange={(e) => setForm({ ...form, paidEuros: e.target.value })} /></Field>
            </div>
          </>
        )}
        <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <Button onClick={onCreate} loading={saving}><Plus className="h-4 w-4" /> {form.type === 'MANUAL_BLOCK' ? 'Bloquer le creneau' : 'Creer le rendez-vous'}</Button>
    </div>
  );
}

function EventPanel({
  selected,
  onBalance,
  onCancel,
}: {
  selected: CalendarEvent;
  onBalance: () => void;
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
          <Button variant="outline" onClick={onBalance}><CreditCard className="h-4 w-4" /> Encaisser solde</Button>
          <Button variant="destructive" onClick={onCancel}><Ban className="h-4 w-4" /> Annuler / rembourser</Button>
        </div>
      </CardContent>
    </Card>
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

function SchedulePanel({
  schedule,
  setSchedule,
  onSave,
  saving,
}: {
  schedule: { weeklyHours: ScheduleDay[]; slotStepMinutes: number; timezone: string };
  setSchedule: (schedule: { weeklyHours: ScheduleDay[]; slotStepMinutes: number; timezone: string }) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="grid gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Horaires classiques</h2>
          <Button size="sm" onClick={onSave} loading={saving}><Save className="h-4 w-4" /> Sauver</Button>
        </div>
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
