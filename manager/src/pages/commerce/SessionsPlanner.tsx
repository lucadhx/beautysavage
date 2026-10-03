import * as React from 'react';
import { CalendarDays, CheckCircle2, Clock, Loader2, Plus, TriangleAlert, Users } from 'lucide-react';
import { DayTimeline, MonthCalendar, RangeEditor, atMinutes, busyOfDay, durationLabel, hm, longDay, minutesOfDate, overlaps, type Busy } from '@/components/ui/TimeRange';
import { api } from '@/lib/api';
import { Button, Field, Input, Textarea } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/dialog';
import { Dropdown } from '@/components/base/dropdown/dropdown';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { StatusBadge, cents } from './CommerceShared';

/**
 * LE PLANNING DES SESSIONS D'UNE FORMATION PRÉSENTIELLE.
 *
 * Une LISTE : toutes les sessions d'un coup d'œil, chacune avec ses actions.
 * Ajouter ou déplacer ouvre un CALENDRIER visuel — la semaine réelle de
 * l'institut, rendez-vous et autres sessions compris — où l'on clique ou fait
 * glisser pour choisir le créneau, puis une fenêtre confirme les horaires.
 *
 * Chaque opération est enregistrée tout de suite, côté serveur, et gère ses
 * conséquences : les inscrites d'une session déplacée sont prévenues ; celles
 * d'une session annulée sont prévenues et remboursées si l'institut le choisit.
 */

export interface PlannerSession {
  _id?: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  reservedCount: number;
  status: string;
  cancellationReason?: string;
  /** Les jours d'une session de plusieurs jours (vide : une seule plage). */
  days?: { startsAt: string; endsAt: string }[];
}

/** Horaires d'un jour de formation, `HH:MM`. */
export interface DayHours { start: string; end: string }

/** Les plages d'une session : un bloc par jour. */
export function sessionDays(session: PlannerSession) {
  const days = (session.days || []).filter((d) => d.startsAt && d.endsAt);
  return days.length ? days : [{ startsAt: session.startsAt, endsAt: session.endsAt }];
}


const addDays = (date: Date, days: number) => { const d = new Date(date); d.setDate(d.getDate() + days); return d; };
const hhmm = (value: string | Date) => new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (value: string | Date) => {
  const text = new Date(value).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  return text.charAt(0).toUpperCase() + text.slice(1);
};


export function SessionsPlanner({
  productId,
  sessions,
  onSessions,
  dayTemplate,
}: {
  productId: string | null;
  sessions: PlannerSession[];
  onSessions: (sessions: PlannerSession[]) => void;
  /** Horaires du jour 1, jour 2… (onglet « Horaires » de la fiche). */
  dayTemplate: DayHours[];
}) {
  const [picker, setPicker] = React.useState<{ mode: 'create' | 'edit'; session?: PlannerSession } | null>(null);
  const [cancelTarget, setCancelTarget] = React.useState<PlannerSession | null>(null);
  const [participantsOf, setParticipantsOf] = React.useState<PlannerSession | null>(null);
  const [message, setMessage] = React.useState('');

  const refresh = React.useCallback(async () => {
    if (!productId) return;
    const products = await api.commerceProducts();
    const found = (products as any[]).find((item) => item._id === productId);
    if (found) onSessions(found.sessions || []);
  }, [productId, onSessions]);

  if (!productId) {
    return <p className="rounded-md border border-dashed bg-card p-4 text-sm text-muted-foreground">Enregistrez d'abord la formation : ses sessions se planifient ensuite ici.</p>;
  }

  const sorted = [...sessions].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  async function quickStatus(session: PlannerSession, status: 'ACTIVE' | 'FULL' | 'BLOCKED') {
    try {
      await api.updateFormationSession(productId!, session._id!, { status });
      setMessage(status === 'ACTIVE' ? 'Session rouverte à la vente.' : status === 'FULL' ? 'Session marquée complète.' : 'Session bloquée.');
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Modification impossible');
    }
  }

  async function remove(session: PlannerSession) {
    try {
      await api.deleteFormationSession(productId!, session._id!);
      setMessage('Session supprimée.');
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Suppression impossible');
    }
  }

  return (
    <section className="grid gap-4" data-testid="sessions-planner">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="inline-flex max-w-2xl items-start gap-2 text-sm text-muted-foreground">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" />
          Choisissez le jour 1 : les {dayTemplate.length > 1 ? `${dayTemplate.length} jours s'enchaînent` : 'horaires se remplissent'} selon l'onglet « Horaires ». Chaque jour est vérifié contre les prestations et les autres sessions.
        </p>
        <Button type="button" onClick={() => setPicker({ mode: 'create' })}><Plus className="h-4 w-4" /> Ajouter une session</Button>
      </div>
      {message && <p className="rounded-md border bg-card p-3 text-sm">{message}</p>}
      {sorted.length === 0 ? (
        <p className="rounded-md border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">Aucune session planifiée.</p>
      ) : (
        <div className="m-table max-w-full overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[760px] text-left text-sm" data-testid="sessions-table">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-3">Date</th><th className="m-hide px-4 py-3">Horaires</th><th className="px-4 py-3">Places</th><th className="m-hide px-4 py-3">Statut</th><th className="px-4 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {sorted.map((session) => {
                const fill = session.capacity ? Math.min(100, Math.round((session.reservedCount / session.capacity) * 100)) : 0;
                const cancelled = session.status === 'CANCELLED';
                return (
                  <tr key={session._id} className={`border-t ${cancelled ? 'text-muted-foreground line-through decoration-1' : ''}`}>
                    <td className="px-4 py-3 font-medium">
                      {dayLabel(session.startsAt)}
                      {sessionDays(session).length > 1 && <span className="ml-1 text-xs font-normal text-muted-foreground">· {sessionDays(session).length} jours</span>}
                      <div className="mt-0.5 grid gap-0.5 text-xs font-normal text-muted-foreground sm:hidden">
                        {sessionDays(session).map((d, i) => <span key={i}>{sessionDays(session).length > 1 ? `J${i + 1} ${shortDay(d.startsAt)} · ` : ''}{hhmm(d.startsAt)} - {hhmm(d.endsAt)}</span>)}
                        <span><StatusBadge>{session.status}</StatusBadge></span>
                      </div>
                    </td>
                    <td className="m-hide px-4 py-3">
                      <div className="grid gap-0.5 whitespace-nowrap">
                        {sessionDays(session).map((d, i) => (
                          <span key={i} className="tabular-nums">{sessionDays(session).length > 1 && <span className="text-muted-foreground">J{i + 1} {shortDay(d.startsAt)} · </span>}{hhmm(d.startsAt)} - {hhmm(d.endsAt)}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-12 tabular-nums">{session.reservedCount}/{session.capacity}</span>
                        <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-muted sm:block"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${fill}%` }} /></div>
                      </div>
                    </td>
                    <td className="m-hide px-4 py-3 no-underline"><StatusBadge>{session.status}</StatusBadge></td>
                    <td className="px-4 py-3 text-right">
                      <Dropdown.Root>
                        <Dropdown.DotsButton aria-label={`Actions session du ${dayLabel(session.startsAt)}`} />
                        <Dropdown.Popover className="w-60">
                          <Dropdown.Menu>
                            <Dropdown.Section>
                              <Dropdown.Item onAction={() => setParticipantsOf(session)}>Voir les inscrites</Dropdown.Item>
                              {!cancelled && <Dropdown.Item onAction={() => setPicker({ mode: 'edit', session })}>Modifier / déplacer</Dropdown.Item>}
                              {!cancelled && session.status !== 'FULL' && <Dropdown.Item onAction={() => quickStatus(session, 'FULL')}>Marquer complète</Dropdown.Item>}
                              {!cancelled && session.status !== 'ACTIVE' && <Dropdown.Item onAction={() => quickStatus(session, 'ACTIVE')}>Rouvrir à la vente</Dropdown.Item>}
                              {!cancelled && session.status !== 'BLOCKED' && <Dropdown.Item onAction={() => quickStatus(session, 'BLOCKED')}>Bloquer (hors vente)</Dropdown.Item>}
                              {!cancelled && <Dropdown.Item destructive onAction={() => setCancelTarget(session)}>Annuler la session</Dropdown.Item>}
                              {session.reservedCount === 0 && <Dropdown.Item destructive onAction={() => remove(session)}>Supprimer</Dropdown.Item>}
                            </Dropdown.Section>
                          </Dropdown.Menu>
                        </Dropdown.Popover>
                      </Dropdown.Root>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {picker && (
        <SessionDaysPicker
          productId={productId}
          template={dayTemplate}
          mode={picker.mode}
          session={picker.session}
          onClose={() => setPicker(null)}
          onSaved={async (text) => { setPicker(null); setMessage(text); await refresh(); }}
        />
      )}
      {cancelTarget && (
        <CancelSessionModal
          productId={productId}
          session={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onDone={async (text) => { setCancelTarget(null); setMessage(text); await refresh(); }}
        />
      )}
      {participantsOf && <ParticipantsModal productId={productId} session={participantsOf} onClose={() => setParticipantsOf(null)} />}
    </section>
  );
}

const shortDay = (value: string | Date) => new Date(value).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const toMin = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + (m || 0); };

type DayRange = { from: number; to: number };

/**
 * PLANIFIER UNE SESSION — par jours, pas par créneau.
 *
 * On choisit le JOUR 1 dans le calendrier : les jours suivants s'enchaînent,
 * chacun avec les horaires de l'onglet « Horaires » de la fiche. Chaque jour
 * est posé sur la journée réelle de l'institut (frise : ce qui est déjà pris,
 * et la plage de la session) et dit s'il est libre ou ce qu'il chevauche.
 * « Modifier » ajuste les horaires d'un jour pour cette session seulement.
 */
function SessionDaysPicker({ productId, template, mode, session, onClose, onSaved }: {
  productId: string;
  template: DayHours[];
  mode: 'create' | 'edit';
  session?: PlannerSession;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const own = session ? sessionDays(session) : [];
  const initialDay = session ? (() => { const d = new Date(session.startsAt); d.setHours(0, 0, 0, 0); return d; })() : null;
  const [day1, setDay1] = React.useState<Date | null>(initialDay);
  const [ranges, setRanges] = React.useState<DayRange[]>(() => (session
    ? own.map((d) => ({ from: minutesOfDate(new Date(d.startsAt)), to: minutesOfDate(new Date(d.endsAt)) }))
    : (template.length ? template : [{ start: '09:00', end: '17:00' }]).map((t) => ({ from: toMin(t.start), to: toMin(t.end) }))));
  const [editing, setEditing] = React.useState<number | null>(null);
  const [busyList, setBusyList] = React.useState<Busy[] | null>(null);
  const [capacity, setCapacity] = React.useState(session?.capacity || 6);
  const [note, setNote] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const registered = session?.reservedCount || 0;
  const ownPrefix = session ? `${productId}:${session._id}` : '';
  const dates = day1 ? ranges.map((_, i) => addDays(day1, i)) : [];
  const key = day1 ? `${day1.toDateString()}:${ranges.length}` : '';

  React.useEffect(() => {
    if (!day1) return undefined;
    let alive = true;
    setBusyList(null);
    api.calendarEvents({ from: day1.toISOString(), to: addDays(day1, ranges.length).toISOString() })
      .then((list) => {
        if (!alive) return;
        setBusyList((list as (Busy & { status: string })[]).filter((e) => e.status !== 'CANCELLED' && !(ownPrefix && (e.id === ownPrefix || String(e.id).startsWith(`${ownPrefix}:`)))));
      })
      .catch(() => { if (alive) setBusyList([]); });
    return () => { alive = false; };
  }, [key, ownPrefix]); // eslint-disable-line react-hooks/exhaustive-deps

  const perDay = dates.map((d, i) => {
    const busy = busyOfDay(busyList || [], d);
    return { date: d, range: ranges[i], busy, clashes: overlaps(busy, ranges[i].from, ranges[i].to) };
  });
  const past = day1 ? atMinutes(day1, ranges[0].from) < new Date() : false;
  const conflict = perDay.some((d) => d.clashes.length > 0);
  const moved = Boolean(session) && day1 !== null && JSON.stringify(own.map((d) => [new Date(d.startsAt).getTime(), new Date(d.endsAt).getTime()]))
    !== JSON.stringify(perDay.map((d) => [atMinutes(d.date, d.range.from).getTime(), atMinutes(d.date, d.range.to).getTime()]));

  async function save() {
    if (!day1) return;
    setSaving(true);
    setError('');
    try {
      const days = perDay.map((d) => ({ startsAt: atMinutes(d.date, d.range.from).toISOString(), endsAt: atMinutes(d.date, d.range.to).toISOString() }));
      if (mode === 'create') {
        await api.createFormationSession(productId, { days, capacity });
        onSaved(days.length > 1 ? `Session de ${days.length} jours ajoutée.` : 'Session ajoutée.');
      } else {
        const result = await api.updateFormationSession(productId, session!._id!, { ...(moved ? { days } : {}), capacity, ...(note.trim() ? { message: note.trim() } : {}) });
        onSaved(result?.moved ? `Session déplacée. ${result.participantsNotified} inscrite(s) prévenue(s) par e-mail.` : 'Session modifiée.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  return (
    <Modal
      open
      onClose={() => !saving && onClose()}
      title={mode === 'create' ? 'Nouvelle session' : 'Déplacer / modifier la session'}
      description={ranges.length > 1 ? `Formation de ${ranges.length} jours : choisissez le jour 1, les jours suivants s'enchaînent.` : 'Choisissez le jour de la session.'}
      className="max-w-5xl"
      busy={saving}
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[300px_minmax(0,1fr)]" data-testid="session-days-picker">
        <div className="grid content-start gap-3">
          <p className="text-sm font-semibold">{ranges.length > 1 ? 'Jour 1 de la session' : 'Jour de la session'}</p>
          <div className="rounded-xl border bg-card p-3">
            <MonthCalendar value={day1} minDate={today} onChange={(d) => { setDay1(d); setEditing(null); }} testId="session-calendar" />
          </div>
          <Field label="Places" unit="stagiaires"><Input type="number" min={Math.max(1, registered)} value={capacity} onChange={(e) => setCapacity(Number(e.target.value || 1))} /></Field>
        </div>

        <div className="grid content-start gap-3">
          {!day1 ? (
            <div className="grid min-h-48 place-items-center rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              <p><CalendarDays className="mx-auto mb-2 h-6 w-6" />Touchez un jour du calendrier : {ranges.length > 1 ? `ce sera le jour 1, suivi des ${ranges.length - 1} autre(s)` : 'les horaires se remplissent seuls'}.</p>
            </div>
          ) : perDay.map((d, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-xl border bg-card p-3 sm:p-4" data-testid="session-day">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Jour {i + 1}</p>
                  <p className="font-semibold">{longDay(d.date)}</p>
                  <p className="text-sm tabular-nums" data-testid="session-day-hours">{hm(d.range.from)} → {hm(d.range.to)} <span className="text-muted-foreground">· {durationLabel(d.range.to - d.range.from)}</span></p>
                </div>
                <div className="flex items-center gap-2">
                  {busyList === null ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Vérification</span>
                  ) : d.clashes.length ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-800" data-testid="session-day-state"><TriangleAlert className="h-3.5 w-3.5" /> Occupé</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800" data-testid="session-day-state"><CheckCircle2 className="h-3.5 w-3.5" /> Libre</span>
                  )}
                  {editing !== i && <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setEditing(i)} data-testid="session-day-edit"><Clock className="h-4 w-4" /> Modifier</Button>}
                </div>
              </div>
              {editing === i ? (
                <RangeEditor
                  day={d.date}
                  from={d.range.from}
                  to={d.range.to}
                  busy={d.busy}
                  testId={`day-editor-${i + 1}`}
                  onCancel={() => setEditing(null)}
                  onConfirm={(from, to) => { setRanges(ranges.map((r, k) => (k === i ? { from, to } : r))); setEditing(null); }}
                />
              ) : (
                <>
                  <DayTimeline busy={d.busy} from={d.range.from} to={d.range.to} testId={`session-day-timeline-${i + 1}`} />
                  {d.clashes.length > 0 && (
                    <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">Chevauche : {d.clashes.map((c) => `${c.title} (${hm(c.from)}–${hm(c.to)})`).join(', ')}</p>
                  )}
                </>
              )}
            </div>
          ))}
          {past && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Le jour 1 commence dans le passé.</p>}
          {moved && registered > 0 && (
            <div className="grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">{registered} inscrite(s) seront prévenues de la nouvelle date par e-mail.</p>
              <Field label="Message joint" unit="facultatif"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Votre place est conservée à la nouvelle date…" /></Field>
            </div>
          )}
          {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button variant="outline" className="h-11" onClick={onClose} disabled={saving}>Annuler</Button>
            <Button className="h-11" onClick={save} disabled={saving || !day1 || busyList === null || conflict || past || editing !== null} data-testid="session-save">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} {mode === 'create' ? 'Créer la session' : moved ? 'Déplacer la session' : 'Enregistrer'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function useSessionSheet(productId: string, session: PlannerSession) {
  const [sheet, setSheet] = React.useState<any>(null);
  React.useEffect(() => {
    api.calendarFormationSession(productId, session._id!).then(setSheet).catch(() => setSheet({ participants: [], revenueCents: 0 }));
  }, [productId, session._id]);
  return sheet;
}

function CancelSessionModal({ productId, session, onClose, onDone }: { productId: string; session: PlannerSession; onClose: () => void; onDone: (message: string) => void }) {
  const sheet = useSessionSheet(productId, session);
  const [reason, setReason] = React.useState('');
  const [refundMode, setRefundMode] = React.useState<'FULL' | 'NONE'>('FULL');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const count = sheet?.participants?.length || 0;

  async function confirm() {
    setSaving(true);
    setError('');
    try {
      const result = await api.cancelFormationSession(productId, session._id!, { reason, refundMode });
      const refunded = (result.participants || []).reduce((sum: number, row: any) => sum + Number(row.refundedCents || 0), 0);
      const failures = (result.participants || []).filter((row: any) => row.refundError).length;
      onDone(`Session annulée. ${result.participants?.length || 0} inscrite(s) prévenue(s)${refundMode === 'FULL' ? `, ${cents(refunded)} remboursé(s)` : ''}${failures ? ` · ${failures} remboursement(s) en échec, voir Remboursements` : ''}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Annulation impossible');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={() => !saving && onClose()} title="Annuler la session" description={`${dayLabel(session.startsAt)} · ${hhmm(session.startsAt)} - ${hhmm(session.endsAt)}`} className="max-w-lg" busy={saving}>
      <div className="grid gap-4" data-testid="cancel-session">
        <p className="rounded-md border bg-muted/30 p-3 text-sm">
          {sheet ? (count ? `${count} inscrite(s) · ${cents(sheet.revenueCents)} encaissé(s). Chacune recevra un e-mail avec le motif.` : 'Aucune inscrite : la session sera simplement annulée.') : 'Chargement des inscrites…'}
        </p>
        <Field label="Motif transmis aux inscrites"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Formatrice indisponible, nombre de participantes insuffisant…" /></Field>
        {count > 0 && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Remboursement</legend>
            {([['FULL', 'Rembourser intégralement chaque inscrite', 'Carte bancaire remboursée via Stripe, cartes cadeaux recréditées.'], ['NONE', 'Ne pas rembourser', 'Report proposé en dehors de la plateforme, avoir négocié…']] as const).map(([value, label, hint]) => (
              <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${refundMode === value ? 'border-primary bg-primary/5' : ''}`}>
                <input type="radio" name="refund" checked={refundMode === value} onChange={() => setRefundMode(value)} className="mt-1" />
                <span><span className="font-semibold">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
              </label>
            ))}
          </fieldset>
        )}
        {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Garder la session</Button>
          <Button variant="destructive" onClick={confirm} disabled={saving || !reason.trim()}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Annuler la session</Button>
        </div>
      </div>
    </Modal>
  );
}

function ParticipantsModal({ productId, session, onClose }: { productId: string; session: PlannerSession; onClose: () => void }) {
  const sheet = useSessionSheet(productId, session);
  return (
    <Modal open onClose={onClose} title="Inscrites de la session" description={`${dayLabel(session.startsAt)} · ${hhmm(session.startsAt)} - ${hhmm(session.endsAt)}`} className="max-w-2xl">
      {!sheet ? <TableSkeleton rows={3} cols={4} /> : sheet.participants.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucune inscription payée pour cette session.</p>
      ) : (
        <div className="m-table overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2"><Users className="inline h-3.5 w-3.5" /> Participante</th><th className="m-hide px-3 py-2">Contact</th><th className="px-3 py-2">Payé</th><th className="px-3 py-2">Commande</th></tr></thead>
            <tbody>
              {sheet.participants.map((row: any) => (
                <tr key={`${row.saleId}-${row.customerId}`} className="border-t">
                  <td className="px-3 py-2 font-medium">{row.name}<div className="break-all text-xs font-normal text-muted-foreground sm:hidden">{row.email}{row.phone ? ` · ${row.phone}` : ''}</div></td>
                  <td className="m-hide px-3 py-2 text-muted-foreground">{row.email}<div>{row.phone}</div></td>
                  <td className="px-3 py-2">{cents(row.paidCents)}</td>
                  <td className="px-3 py-2">{row.saleNumber}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
