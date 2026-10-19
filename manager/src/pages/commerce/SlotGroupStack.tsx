import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight, GraduationCap, Hourglass, Layers, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives';

/**
 * CRÉNEAU PARTAGÉ DANS LE PLANNING — plusieurs formations proposées sur la
 * même date forment une PILE. Un clic la déploie en carrousel ; un clic sur
 * une carte ouvre la fiche habituelle de la session (au-dessus du carrousel,
 * qui réapparaît à sa fermeture).
 */
export interface StackEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: string;
  capacity?: number;
  reservedCount?: number;
  slotGroupStatus?: string | null;
  slotGroupHeld?: boolean;
}

const time = (v: string) => new Date(v).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const clean = (t: string) => t.replace(/ · jour \d+\/\d+$/, '');

/** La carte empilée, posée dans la grille du planning. */
export function StackCard({ events, style, onOpen }: { events: StackEvent[]; style: React.CSSProperties; onOpen: (rect: DOMRect) => void }) {
  const held = events.some((e) => e.slotGroupHeld);
  return (
    <button
      type="button"
      onClick={(click) => { click.stopPropagation(); onOpen((click.currentTarget as HTMLElement).getBoundingClientRect()); }}
      className="group absolute left-1 right-1 z-10 text-left"
      style={style}
      aria-label={`${events.length} formations en option sur ce créneau`}
      data-testid="slot-stack"
    >
      {/* Les cartes du dessous, décalées : l'œil comprend « il y en a plusieurs ». */}
      <span className="absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-md border border-violet-300/70 bg-violet-100/70 transition-transform group-hover:translate-x-2 group-hover:translate-y-2" aria-hidden />
      {events.length > 2 && <span className="absolute inset-0 translate-x-[3px] translate-y-[3px] rounded-md border border-violet-300/80 bg-violet-50" aria-hidden />}
      <span className="relative flex h-full flex-col overflow-hidden rounded-md border border-dashed border-violet-400 bg-white px-2 py-1 text-xs text-violet-950 shadow-sm transition group-hover:shadow-md">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold">{events.length} formations en option</span>
          <Layers className="h-3.5 w-3.5 shrink-0 text-violet-600" />
        </span>
        <span>{time(events[0].startsAt)} - {time(events[0].endsAt)}</span>
        <span className="truncate text-[11px] text-violet-800/80">{events.map((e) => clean(e.title)).join(' · ')}</span>
        {held && <span className="mt-0.5 inline-flex items-center gap-1 font-semibold text-amber-800"><Hourglass className="h-3 w-3" /> Paiement en cours</span>}
      </span>
    </button>
  );
}

/**
 * LE CARROUSEL — les cartes partent de la pile et se rangent côte à côte.
 * Démontage minuté (pas d'AnimatePresence) : rien ne reste posé sur la page
 * une fois fermé (cf. le voile fantôme des modales).
 */
export function StackCarousel({ open, events, origin, onPick, onClose, modalOpen }: {
  open: boolean;
  events: StackEvent[];
  origin: DOMRect | null;
  onPick: (event: StackEvent) => void;
  onClose: () => void;
  /** La fiche d'une session est ouverte au-dessus : Échap la ferme, elle. */
  modalOpen: boolean;
}) {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = React.useState(open);
  const shown = React.useRef(events);
  if (open) shown.current = events;
  const track = React.useRef<HTMLDivElement | null>(null);
  /**
   * Point de départ : la pile dans le planning, ramenée au repère de la
   * première carte du carrousel (centré, 64rem de large, marge de 1rem).
   * Calculé AVANT le premier rendu : une mesure après coup arriverait trop
   * tard pour servir de position initiale.
   */
  const offset = React.useMemo(() => {
    if (!origin || typeof window === 'undefined') return { x: 0, y: 40 };
    const left = Math.max(16, (window.innerWidth - 1024) / 2 + 16);
    const top = window.innerHeight / 2 - 40;
    return { x: origin.left - left, y: origin.top - top };
  }, [origin]);

  React.useEffect(() => {
    if (open) { setMounted(true); return; }
    const t = window.setTimeout(() => setMounted(false), reduce ? 120 : 280);
    return () => window.clearTimeout(t);
  }, [open, reduce]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !modalOpen) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, modalOpen, onClose]);

  if (!mounted && !open) return null;
  const list = shown.current;
  const slide = (dir: number) => track.current?.scrollBy({ left: dir * 280, behavior: 'smooth' });

  return (
    <div className={`fixed inset-0 z-40 flex items-center justify-center ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open || undefined} data-testid="slot-carousel">
      <motion.div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: open ? 1 : 0 }} transition={{ duration: 0.2 }} onClick={onClose} />
      <div className="relative w-full max-w-5xl px-4">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: open ? 1 : 0, y: open ? 0 : -8 }} className="mb-3 flex items-center justify-between gap-3 text-white">
          <div>
            <p className="inline-flex items-center gap-2 text-sm font-semibold"><Layers className="h-4 w-4" /> Créneau partagé · {list.length} formations en option</p>
            <p className="text-xs text-white/75">La première réservée et payée sera retenue. Choisissez une formation pour ouvrir sa fiche.</p>
          </div>
          <div className="flex items-center gap-2">
            {list.length > 3 && (
              <>
                <button type="button" onClick={() => slide(-1)} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 hover:bg-white/25" aria-label="Précédentes"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" onClick={() => slide(1)} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 hover:bg-white/25" aria-label="Suivantes"><ChevronRight className="h-4 w-4" /></button>
              </>
            )}
            <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 hover:bg-white/25" aria-label="Fermer" data-testid="slot-carousel-close"><X className="h-4 w-4" /></button>
          </div>
        </motion.div>
        <div ref={track} className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 [scrollbar-width:thin]" data-testid="slot-carousel-track">
          {list.map((event, i) => (
            <motion.div
              key={event.id}
              className="w-[min(78vw,260px)] shrink-0 snap-start"
              initial={reduce ? { opacity: 0 } : { opacity: 0, x: offset.x - i * 276, y: offset.y, scale: 0.55, rotate: (i - 1) * 3 }}
              animate={open
                ? { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 }
                : (reduce ? { opacity: 0 } : { opacity: 0, x: offset.x - i * 276, y: offset.y, scale: 0.55 })}
              transition={reduce ? { duration: 0.12 } : { type: 'spring', stiffness: 260, damping: 26, delay: open ? i * 0.04 : 0 }}
            >
              <button
                type="button"
                onClick={() => onPick(event)}
                className="flex h-full w-full flex-col rounded-2xl border bg-card p-4 text-left shadow-xl transition hover:-translate-y-1 hover:shadow-2xl"
                data-testid="slot-carousel-card"
              >
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700"><GraduationCap className="h-3.5 w-3.5" /> Formation</span>
                <span className="mt-1.5 line-clamp-2 text-base font-semibold leading-snug">{clean(event.title)}</span>
                <span className="mt-1 text-sm text-muted-foreground">{time(event.startsAt)} - {time(event.endsAt)}</span>
                <span className="mt-3 flex items-center justify-between text-sm">
                  <span>{event.reservedCount || 0}/{event.capacity || 0} inscrite(s)</span>
                  {event.slotGroupHeld
                    ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Paiement en cours</span>
                    : event.status === 'CANCELLED'
                      ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">Retirée</span>
                      : <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-900">En option</span>}
                </span>
              </button>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

export interface SlotGroupInfo {
  id: string;
  status: 'OPEN' | 'ASSIGNED';
  members: { productId: string; sessionId: string; title: string; status: string; reservedCount: number; capacity: number; winner: boolean; cancelledByAssignment: boolean }[];
  winner: { title: string; at: string } | null;
  heldUntil: string | null;
  canReopen: boolean;
}

/** Dans la fiche d'une session : les autres formations du créneau, et « Rouvrir ». */
export function SlotGroupPanel({ group, onReopen, busy }: { group: SlotGroupInfo; onReopen: () => void; busy: boolean }) {
  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-4 dark:border-violet-900 dark:bg-violet-950/20" data-testid="slot-group-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-semibold"><Layers className="h-4 w-4 text-violet-600" /> Créneau partagé</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {group.status === 'OPEN'
              ? 'Ces formations sont proposées sur la même date : la première réservée et payée sera retenue, les autres retirées.'
              : `Attribué à « ${group.winner?.title} »${group.winner?.at ? ` le ${new Date(group.winner.at).toLocaleDateString('fr-FR')}` : ''} : les autres formations ont été retirées de la vente à cette date.`}
          </p>
          {group.heldUntil && <p className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-amber-800"><Hourglass className="h-4 w-4" /> Paiement en cours jusqu’à {time(group.heldUntil)}</p>}
        </div>
        {group.canReopen && (
          <Button variant="outline" onClick={onReopen} disabled={busy} data-testid="slot-group-reopen"><RotateCcw className="h-4 w-4" /> Rouvrir les autres formations</Button>
        )}
      </div>
      <ul className="mt-3 grid gap-1.5">
        {group.members.map((m) => (
          <li key={m.sessionId} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-sm">
            <span className={`min-w-0 truncate font-medium ${m.status === 'CANCELLED' ? 'text-muted-foreground line-through' : ''}`}>{m.title}</span>
            <span className="shrink-0 text-xs font-semibold">
              {m.winner ? <span className="text-emerald-700">Retenue · {m.reservedCount}/{m.capacity}</span>
                : m.status === 'CANCELLED' ? <span className="text-muted-foreground">Retirée</span>
                  : <span className="text-violet-800">En option</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
