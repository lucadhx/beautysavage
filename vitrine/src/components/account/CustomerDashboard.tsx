import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight, CalendarDays, CalendarX, CheckCircle2, ChevronDown, Clock, CreditCard, FileText, Gift, GraduationCap,
  LayoutDashboard, Link2, Loader2, MapPin, Plus, ReceiptText, Sparkles, UserRound, Wallet, X,
} from 'lucide-react';
import { customerApi, type Agenda, type Appointment, type CustomerOrder, type WalletGiftCard } from '@/lib/api';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { GiftCardWallet } from '@/components/GiftCardWallet';
import { AddAfterDialog } from '@/components/account/AddAfterDialog';

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const fmt = (cents: number) => euro.format((cents || 0) / 100);
const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const TABS = [
  { key: 'recap', label: 'Récapitulatif', Icon: LayoutDashboard },
  { key: 'calendrier', label: 'Calendrier', Icon: CalendarDays },
  { key: 'formations', label: 'Formations', Icon: GraduationCap },
  { key: 'cartes', label: 'Cartes cadeaux', Icon: Gift },
  { key: 'achats', label: 'Achats', Icon: ReceiptText },
  { key: 'profil', label: 'Profil', Icon: UserRound },
] as const;
type TabKey = typeof TABS[number]['key'];

type Formation = { lineId: string; productSnapshot?: { title?: string; kind?: string }; product?: { title?: string; coverUrl?: string; gallery?: string[] } | null; progress?: { percent: number } };

/**
 * L'ESPACE CLIENT — en onglets. Le récapitulatif répond aux questions qu'on se
 * pose en arrivant : mon prochain rendez-vous (et dans combien de temps), ce
 * qu'il me reste à régler sur place, mes formations en cours, mes cartes
 * cadeaux. Le calendrier liste les rendez-vous et sessions à venir, avec
 * l'annulation et ses conditions de remboursement.
 */
export function CustomerDashboard({ firstName, profile, banner }: { firstName?: string; profile: React.ReactNode; banner?: React.ReactNode }) {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get('onglet'))?.key || 'recap') as TabKey;
  const setTab = (key: TabKey) => setParams((p) => { if (key === 'recap') p.delete('onglet'); else p.set('onglet', key); return p; }, { replace: true });

  const [agenda, setAgenda] = React.useState<Agenda | null>(null);
  const [orders, setOrders] = React.useState<CustomerOrder[] | null>(null);
  const [formations, setFormations] = React.useState<Formation[] | null>(null);
  const [cards, setCards] = React.useState<WalletGiftCard[]>([]);

  const loadAgenda = React.useCallback(() => customerApi.appointments().then(setAgenda).catch(() => setAgenda({ upcoming: [], past: [], balanceDueCents: 0, next: null })), []);
  React.useEffect(() => {
    void loadAgenda();
    customerApi.orders().then(setOrders).catch(() => setOrders([]));
    customerApi.formations().then((f) => setFormations(f as Formation[])).catch(() => setFormations([]));
    customerApi.giftCards().then(setCards).catch(() => setCards([]));
  }, [loadAgenda]);

  const giftBalance = cards.filter((c) => c.status === 'ACTIVE').reduce((s, c) => s + c.balanceCents, 0);
  const inProgress = (formations || []).filter((f) => (f.progress?.percent ?? 0) < 100);

  return (
    <section className="mx-auto min-h-screen w-full max-w-6xl overflow-x-hidden px-4 pb-24 pt-24 sm:px-5 md:px-8 md:pt-32" data-testid="customer-dashboard">
      <h1 className="break-words text-3xl font-semibold sm:text-4xl">{firstName ? `Bonjour ${firstName}` : 'Mon espace client'}</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Vos rendez-vous, formations, cartes cadeaux et factures.</p>
      {banner}

      <nav className="mt-5 sm:mt-6" aria-label="Rubriques">
        <ul className="grid grid-cols-3 gap-1 rounded-xl border p-1 md:flex md:flex-wrap" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
          {TABS.map(({ key, label, Icon }) => {
            const active = key === tab;
            return (
              <li key={key} className="relative">
                {active && <motion.span layoutId="account-tab" className="absolute inset-0 rounded-lg" style={{ background: 'var(--v-primary)' }} transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <button type="button" onClick={() => setTab(key)} data-testid={`tab-${key}`} aria-current={active ? 'page' : undefined}
                  className="relative flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] font-semibold leading-tight transition-colors min-[380px]:text-xs md:w-auto md:flex-row md:gap-2 md:px-3.5 md:py-2.5 md:text-sm"
                  style={{ color: active ? 'var(--v-primary-foreground)' : 'inherit' }}>
                  <Icon className="h-4 w-4 shrink-0" /> <span className="text-center">{label}</span>
                  {key === 'calendrier' && (agenda?.upcoming.length ?? 0) > 0 && (
                    <span className="absolute right-1 top-1 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] md:static md:text-[11px]" style={{ background: active ? 'var(--v-primary-foreground)' : 'var(--v-accent)', color: active ? 'var(--v-primary)' : 'var(--v-accent-foreground)' }}>{agenda?.upcoming.length}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} className="mt-6">
          {tab === 'recap' && <Recap agenda={agenda} inProgress={inProgress} giftBalance={giftBalance} orders={orders} onTab={setTab} />}
          {tab === 'calendrier' && <CalendarTab agenda={agenda} onChanged={loadAgenda} />}
          {tab === 'formations' && <FormationsTab formations={formations} />}
          {tab === 'cartes' && <div className="grid"><GiftCardWallet /></div>}
          {tab === 'achats' && <OrdersTab orders={orders} />}
          {tab === 'profil' && profile}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

/* ───────────────────────── Récapitulatif ───────────────────────── */

function useCountdown(target?: string | null) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!target) return undefined;
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [target]);
  if (!target) return null;
  const ms = Math.max(0, new Date(target).getTime() - now);
  const m = Math.floor(ms / 60_000);
  return { days: Math.floor(m / 1440), hours: Math.floor((m % 1440) / 60), minutes: m % 60 };
}

function Card({ children, className = '', testid }: { children: React.ReactNode; className?: string; testid?: string }) {
  return <div className={`min-w-0 rounded-2xl border p-4 sm:p-5 ${className}`} style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }} data-testid={testid}>{children}</div>;
}

function SectionTitle({ Icon, children }: { Icon: typeof CalendarDays; children: React.ReactNode }) {
  return <h2 className="flex items-center gap-2 text-lg font-semibold"><Icon className="h-5 w-5" style={{ color: 'var(--v-accent)' }} /> {children}</h2>;
}

function Recap({ agenda, inProgress, giftBalance, orders, onTab }: {
  agenda: Agenda | null; inProgress: Formation[]; giftBalance: number; orders: CustomerOrder[] | null; onTab: (t: TabKey) => void;
}) {
  const next = agenda?.next;
  const left = useCountdown(next?.startsAt);
  const stats = [
    { label: 'Rendez-vous à venir', value: String(agenda?.upcoming.length ?? '…'), Icon: CalendarDays, tab: 'calendrier' as TabKey, testid: 'stat-upcoming' },
    { label: 'À régler sur place', value: agenda ? fmt(agenda.balanceDueCents) : '…', Icon: Wallet, tab: 'calendrier' as TabKey, testid: 'stat-balance' },
    { label: 'Formations en cours', value: String(inProgress.length), Icon: GraduationCap, tab: 'formations' as TabKey, testid: 'stat-formations' },
    { label: 'Cartes cadeaux', value: fmt(giftBalance), Icon: Gift, tab: 'cartes' as TabKey, testid: 'stat-gift' },
  ];
  return (
    <div className="grid gap-5">
      <Card className="overflow-hidden" testid="recap-next">
        <SectionTitle Icon={Clock}>Prochain rendez-vous</SectionTitle>
        {!agenda ? <div className="mt-4 h-24 animate-pulse rounded-xl" style={{ background: 'color-mix(in srgb, var(--v-muted-foreground) 10%, transparent)' }} />
          : !next ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Aucun rendez-vous prévu pour le moment.</p>
              <Link to="/prestations" className="inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold sm:w-auto" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>Réserver une prestation <ArrowRight className="h-4 w-4" /></Link>
            </div>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div className="min-w-0">
                <p className="break-words text-lg font-semibold sm:text-xl">{next.title}</p>
                <p className="mt-1 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>{cap(dayFmt.format(new Date(next.startsAt)))} · {timeFmt.format(new Date(next.startsAt))} – {timeFmt.format(new Date(next.days[0]?.endsAt || next.endsAt))}</p>
                {next.balanceDueCents > 0 && <p className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: 'color-mix(in srgb, var(--v-accent) 14%, transparent)' }}><Wallet className="h-3.5 w-3.5" /> {fmt(next.balanceDueCents)} à régler sur place</p>}
              </div>
              {left && (
                <div className="grid grid-cols-3 gap-2 md:flex" data-testid="recap-countdown">
                  {[[left.days, 'jours'], [left.hours, 'h'], [left.minutes, 'min']].map(([v, l]) => (
                    <div key={String(l)} className="grid justify-items-center rounded-xl px-2 py-2 md:min-w-[64px] md:px-3" style={{ background: 'color-mix(in srgb, var(--v-primary) 8%, transparent)' }}>
                      <span className="text-2xl font-semibold tabular-nums">{v}</span>
                      <span className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--v-muted-foreground)' }}>{l}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        {stats.map(({ label, value, Icon, tab, testid }, i) => (
          <motion.button key={label} type="button" onClick={() => onTab(tab)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 sm:p-4" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }} data-testid={testid}>
            <Icon className="h-5 w-5" style={{ color: 'var(--v-accent)' }} />
            <p className="mt-2 truncate text-xl font-semibold tabular-nums sm:mt-3 sm:text-2xl">{value}</p>
            <p className="text-xs" style={{ color: 'var(--v-muted-foreground)' }}>{label}</p>
          </motion.button>
        ))}
      </div>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <SectionTitle Icon={GraduationCap}>Mes formations</SectionTitle>
          {inProgress.length === 0 ? <p className="mt-3 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Aucune formation en cours.</p> : (
            <ul className="mt-3 grid grid-cols-1 gap-3">
              {inProgress.slice(0, 3).map((f) => <FormationRow key={f.lineId} f={f} />)}
            </ul>
          )}
          <Link to="/espace-client/formations" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold">Ouvrir l’espace formation <ArrowRight className="h-4 w-4" /></Link>
        </Card>
        <Card>
          <SectionTitle Icon={ReceiptText}>Derniers achats</SectionTitle>
          {!orders ? null : orders.filter((o) => o.paymentStatus === 'PAID').length === 0 ? <p className="mt-3 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Aucun achat pour le moment.</p> : (
            <ul className="mt-3 grid gap-2">
              {orders.filter((o) => o.paymentStatus === 'PAID').slice(0, 3).map((o) => (
                <li key={o.id} className="flex min-w-0 items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">{o.lines?.[0]?.productSnapshot?.title || o.saleNumber}{o.lines.length > 1 ? ` + ${o.lines.length - 1}` : ''}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{fmt(o.totalCents)}</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => onTab('achats')} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold">Voir mes achats et factures <ArrowRight className="h-4 w-4" /></button>
        </Card>
      </div>

      <div className="grid gap-2 sm:flex sm:flex-wrap">
        <Link to="/prestations" className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}><Sparkles className="h-4 w-4" /> Réserver une prestation</Link>
        <button type="button" onClick={() => onTab('calendrier')} className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-semibold" style={{ borderColor: 'var(--v-border)' }}><CalendarDays className="h-4 w-4" /> Mon calendrier</button>
        <Link to="/cartes-cadeaux" className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-semibold" style={{ borderColor: 'var(--v-border)' }}><Gift className="h-4 w-4" /> Offrir une carte cadeau</Link>
      </div>
    </div>
  );
}

function FormationRow({ f }: { f: Formation }) {
  const pct = Math.round(f.progress?.percent ?? 0);
  const cover = resolvePreviewMediaUrl(f.product?.coverUrl || f.product?.gallery?.[0] || '');
  return (
    <li className="flex min-w-0 items-center gap-3">
      <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg" style={{ background: 'color-mix(in srgb, var(--v-muted-foreground) 12%, transparent)' }}>
        {cover ? <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span className="grid h-full w-full place-items-center"><GraduationCap className="h-5 w-5" style={{ color: 'var(--v-accent)' }} /></span>}
      </span>
      <span className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{f.product?.title || f.productSnapshot?.title || 'Formation'}</p>
        <span className="mt-1.5 block h-2 overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb, var(--v-muted-foreground) 16%, transparent)' }}>
          <motion.span className="block h-full rounded-full" style={{ background: 'var(--v-primary)' }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8 }} />
        </span>
        <p className="mt-1 text-xs" style={{ color: 'var(--v-muted-foreground)' }}>{pct} % complété</p>
      </span>
    </li>
  );
}

/* ───────────────────────── Calendrier ───────────────────────── */

function CalendarTab({ agenda, onChanged }: { agenda: Agenda | null; onChanged: () => Promise<unknown> }) {
  const [cancelling, setCancelling] = React.useState<Appointment | null>(null);
  const [addingAfter, setAddingAfter] = React.useState<Appointment | null>(null);
  const [showPast, setShowPast] = React.useState(false);
  if (!agenda) return <div className="h-48 animate-pulse rounded-2xl" style={{ background: 'color-mix(in srgb, var(--v-muted-foreground) 10%, transparent)' }} />;
  const byMonth = new Map<string, Appointment[]>();
  for (const a of agenda.upcoming) {
    const k = cap(monthFmt.format(new Date(a.startsAt)));
    byMonth.set(k, [...(byMonth.get(k) || []), a]);
  }
  return (
    <div className="grid gap-5" data-testid="calendar-tab">
      {agenda.balanceDueCents > 0 && (
        <div className="flex items-start gap-3 rounded-2xl p-4" style={{ background: 'color-mix(in srgb, var(--v-accent) 12%, var(--v-surface))' }} data-testid="calendar-balance">
          <Wallet className="h-5 w-5 shrink-0" style={{ color: 'var(--v-accent)' }} />
          <p className="min-w-0 text-sm"><span className="font-semibold">{fmt(agenda.balanceDueCents)}</span> resteront à régler sur place lors de vos prochains rendez-vous.</p>
        </div>
      )}
      {agenda.upcoming.length === 0 ? (
        <Card className="grid place-items-center py-12 text-center">
          <CalendarDays className="h-10 w-10" style={{ color: 'var(--v-accent)' }} />
          <p className="mt-3 font-semibold">Aucun rendez-vous à venir</p>
          <Link to="/prestations" className="mt-4 inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>Réserver une prestation</Link>
        </Card>
      ) : [...byMonth.entries()].map(([month, list]) => (
        <section key={month} className="grid gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--v-muted-foreground)' }}>{month}</h3>
          {list.map((a, i) => (
            <AppointmentCard key={a.id} a={a} index={i} onCancel={() => setCancelling(a)} onAddAfter={() => setAddingAfter(a)}
              chained={Boolean(a.bookingGroupId) && agenda.upcoming.some((b) => b.id !== a.id && b.bookingGroupId === a.bookingGroupId)} />
          ))}
        </section>
      ))}
      {agenda.past.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowPast((v) => !v)} className="inline-flex items-center gap-2 text-left text-sm font-semibold"><ChevronDown className={`h-4 w-4 transition-transform ${showPast ? 'rotate-180' : ''}`} /> Rendez-vous passés et annulés ({agenda.past.length})</button>
          <AnimatePresence>
            {showPast && (
              <motion.ul initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-3 grid gap-2 overflow-hidden">
                {agenda.past.map((a) => (
                  <li key={a.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border px-3 py-3 text-sm sm:px-4" style={{ borderColor: 'var(--v-border)' }}>
                    <span className="min-w-0 truncate">{a.title} · {dayFmt.format(new Date(a.startsAt))}</span>
                    <span className="shrink-0 text-xs" style={{ color: 'var(--v-muted-foreground)' }}>{a.status === 'CANCELLED' ? 'Annulé' : 'Passé'}</span>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
      <CancelModal appointment={cancelling} onClose={() => setCancelling(null)} onDone={onChanged} />
      <AddAfterDialog appointment={addingAfter} onClose={() => setAddingAfter(null)} />
    </div>
  );
}

function AppointmentCard({ a, index, onCancel, onAddAfter, chained = false }: { a: Appointment; index: number; onCancel: () => void; onAddAfter: () => void; chained?: boolean }) {
  // Enchaîner une prestation : seulement après un rendez-vous de prestation à venir.
  const canAddAfter = a.kind === 'SERVICE' && a.status !== 'CANCELLED' && new Date(a.startsAt).getTime() > Date.now();
  const image = resolvePreviewMediaUrl(a.coverUrl || '');
  const start = new Date(a.startsAt);
  return (
    <motion.article initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}
      className="flex min-w-0 gap-3 rounded-2xl border p-3 sm:gap-4 sm:p-4" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }} data-testid="appointment" data-soon={a.soon || undefined}>
      <div className="grid h-fit w-14 shrink-0 place-items-center rounded-xl py-2 text-center sm:w-20" style={{ background: 'color-mix(in srgb, var(--v-primary) 8%, transparent)' }}>
        <span className="text-[11px] font-semibold uppercase" style={{ color: 'var(--v-muted-foreground)' }}>{start.toLocaleDateString('fr-FR', { weekday: 'short' })}</span>
        <span className="text-2xl font-semibold leading-none">{start.getDate()}</span>
        <span className="text-[11px]" style={{ color: 'var(--v-muted-foreground)' }}>{start.toLocaleDateString('fr-FR', { month: 'short' })}</span>
      </div>
      {image && <img src={image} alt="" className="hidden h-20 w-20 shrink-0 rounded-xl object-cover sm:block" loading="lazy" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide" style={{ background: 'color-mix(in srgb, var(--v-accent) 14%, transparent)' }}>
            {a.kind === 'SERVICE' ? <Sparkles className="h-3 w-3" style={{ color: 'var(--v-accent)' }} /> : <GraduationCap className="h-3 w-3" style={{ color: 'var(--v-accent)' }} />}
            {a.kind === 'SERVICE' ? 'Prestation' : 'Formation'}
          </span>
          {a.soon && <motion.span initial={{ scale: 0.8 }} animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 1.6, repeat: Infinity }} className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white" data-testid="appointment-soon">Bientôt</motion.span>}
          {chained && <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'color-mix(in srgb, var(--v-primary) 12%, transparent)' }} data-testid="appointment-chained"><Link2 className="h-3 w-3" /> À la suite</span>}
        </div>
        <p className="mt-1.5 break-words font-semibold">{a.title}</p>
        <div className="mt-1 grid gap-0.5 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>
          {a.days.map((d, i) => (
            <p key={i} className="flex items-start gap-1.5"><Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />{a.days.length > 1 ? `Jour ${i + 1} · ${cap(dayFmt.format(new Date(d.startsAt)))} · ` : ''}{timeFmt.format(new Date(d.startsAt))} – {timeFmt.format(new Date(d.endsAt))}</p>
          ))}
          {a.location && <p className="flex items-start gap-1.5 break-words"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{a.location}</p>}
          {a.balanceDueCents > 0 && <p className="flex items-start gap-1.5 font-medium" style={{ color: 'var(--v-foreground)' }} data-testid="appointment-balance"><Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0" />{fmt(a.balanceDueCents)} à régler sur place</p>}
        </div>
        {(a.terms.cancellable || canAddAfter) && (
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {canAddAfter && (
              <button type="button" onClick={onAddAfter} data-testid="appointment-add-after" className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold transition hover:bg-black/5" style={{ borderColor: 'var(--v-border)' }}>
                <Plus className="h-3.5 w-3.5" /> Ajouter une prestation juste après
              </button>
            )}
            {a.terms.cancellable && <button type="button" onClick={onCancel} data-testid="appointment-cancel" className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold transition hover:bg-black/5" style={{ borderColor: 'var(--v-border)' }}>
              <CalendarX className="h-3.5 w-3.5" /> Annuler
            </button>}
          </div>
        )}
      </div>
    </motion.article>
  );
}

function CancelModal({ appointment, onClose, onDone }: { appointment: Appointment | null; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ refundCents: number } | null>(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => { setResult(null); setError(''); setBusy(false); }, [appointment?.id]);
  const a = appointment;
  const t = a?.terms;
  const deadline = t ? new Date(t.deadline) : null;

  async function confirm() {
    if (!a) return;
    setBusy(true);
    setError('');
    try {
      const r = await customerApi.cancelAppointment(a.id);
      setResult({ refundCents: r.refundCents });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Annulation impossible pour le moment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {a && t && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !busy && onClose()} role="dialog" aria-modal="true" data-testid="cancel-modal">
          <motion.div onClick={(e) => e.stopPropagation()} initial={{ opacity: 0, y: 24, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border p-5 text-center shadow-2xl sm:p-6" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
            {!busy && <button type="button" onClick={onClose} aria-label="Fermer" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full hover:bg-black/5"><X className="h-4 w-4" /></button>}
            {result ? (
              <>
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 16 }} className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-600"><CheckCircle2 className="h-8 w-8" /></motion.span>
                <h2 className="mt-4 text-2xl font-semibold">Rendez-vous annulé</h2>
                <p className="mt-2 text-sm" style={{ color: 'var(--v-muted-foreground)' }} data-testid="cancel-result">
                  {result.refundCents > 0 ? `${fmt(result.refundCents)} vous sont remboursés sur votre moyen de paiement (sous quelques jours). Un e-mail de confirmation vous est envoyé.` : 'Le créneau est libéré. Un e-mail de confirmation vous est envoyé.'}
                </p>
                <button type="button" onClick={onClose} className="mt-6 h-11 w-full rounded-md font-semibold" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>Fermer</button>
              </>
            ) : (
              <>
                <motion.span initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 16, delay: 0.06 }} className="mx-auto grid h-16 w-16 place-items-center rounded-full" style={{ background: 'color-mix(in srgb, var(--v-accent) 18%, transparent)', color: 'var(--v-accent)' }}>
                  <CalendarX className="h-7 w-7" />
                </motion.span>
                <h2 className="mt-4 text-xl font-semibold sm:text-2xl">Annuler ce rendez-vous ?</h2>
                <p className="mt-1 text-sm font-medium">{a.title}</p>
                <p className="text-sm" style={{ color: 'var(--v-muted-foreground)' }}>{cap(dayFmt.format(new Date(a.startsAt)))} à {timeFmt.format(new Date(a.startsAt))}</p>
                <div className="mt-4 rounded-xl p-4 text-left text-sm" style={{ background: t.refundCents > 0 ? 'rgb(236 253 245)' : 'rgb(255 247 237)', color: t.refundCents > 0 ? 'rgb(6 95 70)' : 'rgb(154 52 18)' }} data-testid="cancel-terms" data-refund={t.refundCents}>
                  {t.paidCents === 0 ? (
                    <p>Rien n’a été payé en ligne pour ce rendez-vous : l’annulation libère simplement le créneau.</p>
                  ) : t.refundCents > 0 ? (
                    <>
                      <p className="flex items-center gap-2 font-semibold"><CreditCard className="h-4 w-4" /> Remboursement de {fmt(t.refundCents)}{t.percent < 100 ? ` (${t.percent} %)` : ''}</p>
                      <p className="mt-1">{t.onTime ? `Vous annulez plus de ${t.freeCancelHours} h avant : ${t.percent === 100 ? 'le montant payé vous est intégralement remboursé' : `${t.percent} % du montant payé vous sont remboursés`}.` : `Annulation tardive (moins de ${t.freeCancelHours} h avant) : ${t.percent} % du montant payé vous sont remboursés.`}</p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold">Aucun remboursement</p>
                      <p className="mt-1">{t.onTime ? 'Cette réservation n’ouvre pas droit à remboursement.' : `L’annulation gratuite était possible jusqu’au ${deadline ? `${dayFmt.format(deadline)} à ${timeFmt.format(deadline)}` : ''} (${t.freeCancelHours} h avant).`}</p>
                    </>
                  )}
                </div>
                {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
                <div className="mt-6 grid gap-2 min-[360px]:grid-cols-2">
                  <button type="button" onClick={onClose} disabled={busy} className="h-11 rounded-md border font-semibold" style={{ borderColor: 'var(--v-border)' }} data-testid="cancel-no">Non, garder</button>
                  <button type="button" onClick={confirm} disabled={busy} className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-red-600 font-semibold text-white hover:bg-red-700 disabled:opacity-70" data-testid="cancel-yes">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Oui, annuler
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ───────────────────────── Formations ───────────────────────── */

function FormationsTab({ formations }: { formations: Formation[] | null }) {
  const list = formations || [];
  return (
    <div className="grid gap-5" data-testid="formations-tab">
      <Link to="/espace-client/formations" className="group flex items-center justify-between gap-3 rounded-2xl p-5 transition hover:-translate-y-0.5 sm:p-6" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }} data-testid="formations-cta">
        <span>
          <span className="flex items-center gap-2 text-lg font-semibold sm:text-xl"><GraduationCap className="h-6 w-6 shrink-0" /> Mon espace formation</span>
          <span className="mt-1 block text-sm opacity-80">Modules, vidéos, supports et évaluation finale.</span>
        </span>
        <ArrowRight className="h-6 w-6 shrink-0 transition-transform group-hover:translate-x-1" />
      </Link>
      <Card>
        <SectionTitle Icon={GraduationCap}>Formations en cours</SectionTitle>
        {list.length === 0 ? <p className="mt-3 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Aucune formation achetée pour le moment.</p> : (
          <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">{list.map((f) => <FormationRow key={f.lineId} f={f} />)}</ul>
        )}
      </Card>
    </div>
  );
}

/* ───────────────────────── Achats ───────────────────────── */

const ORDER_STATUS: Record<string, string> = { PAID: 'Payée', REFUNDED: 'Remboursée', PROCESSING: 'En traitement', FAILED: 'Échouée', EXPIRED: 'Expirée' };

function OrdersTab({ orders }: { orders: CustomerOrder[] | null }) {
  if (!orders) return <div className="h-40 animate-pulse rounded-2xl" style={{ background: 'color-mix(in srgb, var(--v-muted-foreground) 10%, transparent)' }} />;
  const shown = orders.filter((o) => ORDER_STATUS[o.paymentStatus]);
  return (
    <Card testid="orders-tab">
      <SectionTitle Icon={ReceiptText}>Achats et factures</SectionTitle>
      {shown.length === 0 ? <p className="mt-3 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Aucun achat pour le moment.</p> : (
        <ul className="mt-4 divide-y" style={{ borderColor: 'var(--v-border)' }}>
          {shown.map((o) => (
            <li key={o.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-3" data-testid="order-row">
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate font-semibold">{o.lines?.map((l) => l.productSnapshot?.title).filter(Boolean).join(', ') || o.saleNumber}</p>
                <p className="break-words text-xs" style={{ color: 'var(--v-muted-foreground)' }}>{o.saleNumber} · {new Date(o.createdAt).toLocaleDateString('fr-FR')} · {ORDER_STATUS[o.paymentStatus]}{o.balanceDueCents > 0 ? ` · ${fmt(o.balanceDueCents)} sur place` : ''}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold tabular-nums">{fmt(o.totalCents)}</span>
                {o.invoiceUrl ? (
                  <a href={o.invoiceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: 'var(--v-border)' }} data-testid="order-invoice"><FileText className="h-3.5 w-3.5" /> Facture</a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
