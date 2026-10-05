import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight, CalendarDays, Clock, CreditCard, Gift, GraduationCap, ImageIcon, Loader2, LockKeyhole,
  AlertTriangle, MailCheck, MonitorPlay, ShoppingBag, Sparkles, Trash2, X,
} from 'lucide-react';
import { BookingMonthCalendar, type Slot } from '@/components/BookingMonthCalendar';
import { publishCartCount } from '@/lib/cartSignal';
import { customerApi, type CartView } from '@/lib/api';
import { useCustomer } from '@/context/CustomerContext';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { durationText } from '@/components/CommerceProductCard';
import { GiftCardPayment, PaymentSummary, formatEuro, splitPayment, type AppliedGiftCard } from '@/components/GiftCardPayment';

type Line = CartView['lines'][number];

const KIND: Record<string, { label: string; Icon: typeof Sparkles }> = {
  SERVICE: { label: 'Prestation', Icon: Sparkles },
  IN_PERSON_TRAINING: { label: 'Formation en présentiel', Icon: GraduationCap },
  DISTANCE_TRAINING: { label: 'Formation en ligne', Icon: MonitorPlay },
  GIFT_CARD: { label: 'Carte cadeau', Icon: Gift },
  PRODUCT: { label: 'Produit', Icon: ShoppingBag },
};

const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** La ligne « quand » d'un article : créneau d'une prestation, jours d'une session. */
function whenOf(line: Line): string[] {
  if (line.product.kind === 'SERVICE' && line.bookingSnapshot?.startsAt) {
    const start = new Date(line.bookingSnapshot.startsAt);
    const end = line.bookingSnapshot.endsAt ? new Date(line.bookingSnapshot.endsAt) : null;
    return [`${cap(dayFmt.format(start))} · ${timeFmt.format(start)}${end ? ` – ${timeFmt.format(end)}` : ''}`];
  }
  if (line.product.kind === 'IN_PERSON_TRAINING' && line.sessionId) {
    const session = line.product.sessions?.find((s) => s.id === line.sessionId);
    if (!session) return [];
    const days = session.days?.length ? session.days : [{ startsAt: session.startsAt, endsAt: session.endsAt }];
    return days.map((d, i) => `${days.length > 1 ? `Jour ${i + 1} · ` : ''}${cap(dayFmt.format(new Date(d.startsAt)))} · ${timeFmt.format(new Date(d.startsAt))} – ${timeFmt.format(new Date(d.endsAt))}`);
  }
  return [];
}

/**
 * LE PANIER — chaque article avec sa couverture, son type, sa date et son
 * prix ; à droite, le récapitulatif qui reste visible : cartes cadeaux, reste
 * à payer, et le bouton qui dit exactement ce qu'il va faire.
 */
export default function CartPage() {
  const { customer } = useCustomer();
  const [params, setParams] = useSearchParams();
  const [cart, setCart] = React.useState<CartView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [message, setMessage] = React.useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [consents, setConsents] = React.useState<string[]>([]);
  const [cards, setCards] = React.useState<AppliedGiftCard[]>([]);
  const [paying, setPaying] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [scheduling, setScheduling] = React.useState<Line | null>(null);

  React.useEffect(() => {
    if (!customer) { setLoading(false); return; }
    customerApi.cart().then(setCart).catch((err) => setMessage({ tone: 'error', text: err.message })).finally(() => setLoading(false));
  }, [customer]);

  React.useEffect(() => {
    if (params.get('paiement') !== 'annule') return;
    setMessage({ tone: 'info', text: 'Paiement annulé : rien n’a été débité. Votre panier vous attend.' });
    params.delete('paiement');
    setParams(params, { replace: true });
  }, [params, setParams]);

  const lines = cart?.lines ?? [];
  const total = cart?.totalCents ?? 0;
  const split = splitPayment(total, cards);
  const required = lines.flatMap((line) => (line.consentRequirements ?? []).filter((r) => r.required).map((r) => `${line.id}:${r.key}`));
  const missing = required.filter((key) => !consents.includes(key));
  // Une prestation ajoutée sans date attend son créneau : le paiement aussi.
  const unscheduled = lines.filter((line) => line.product.kind === 'SERVICE' && !line.bookingSnapshot?.startsAt);
  React.useEffect(() => { if (cart) publishCartCount(cart.lines.length); }, [cart]);

  async function remove(line: Line) {
    setRemoving(line.id);
    try { setCart(await customerApi.removeCartItem(line.id)); } catch (err) { setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Impossible de retirer cet article.' }); }
    finally { setRemoving(null); }
  }

  async function checkout() {
    setMessage(null);
    if (!customer?.emailVerified) { setMessage({ tone: 'error', text: 'Confirmez d’abord votre adresse e-mail depuis votre espace client.' }); return; }
    if (unscheduled.length) {
      setMessage({ tone: 'error', text: unscheduled.length > 1 ? 'Choisissez un créneau pour chaque prestation avant de payer.' : `Choisissez un créneau pour « ${unscheduled[0].product.title} » avant de payer.` });
      setScheduling(unscheduled[0]);
      return;
    }
    if (missing.length) { setMessage({ tone: 'error', text: 'Cochez les conditions demandées sous les articles concernés.' }); return; }
    setPaying(true);
    try {
      const result = await customerApi.checkout(consents, split.lines.filter((l) => l.debitCents > 0).map((l) => l.code));
      if (result.checkoutUrl) { window.location.href = result.checkoutUrl; return; }
      setMessage({ tone: 'info', text: result.message });
      setPaying(false);
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Le paiement est momentanément indisponible.' });
      setPaying(false);
    }
  }

  if (!customer) {
    return (
      <section className="mx-auto grid min-h-screen max-w-xl content-start px-5 pt-32 text-center">
        <ShoppingBag className="mx-auto h-12 w-12" style={{ color: 'var(--v-accent)' }} />
        <h1 className="mt-4 text-4xl font-semibold">Votre panier</h1>
        <p className="mt-3" style={{ color: 'var(--v-muted-foreground)' }}>Connectez-vous pour retrouver vos réservations et passer commande.</p>
        <Link to="/connexion-client" className="mx-auto mt-6 inline-flex items-center gap-2 rounded-md px-6 py-3 font-semibold" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>
          Me connecter <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto min-h-screen max-w-6xl px-5 pb-24 pt-28 md:px-8 md:pt-32">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-semibold">Panier</h1>
          {lines.length > 0 && <p className="mt-1 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>{lines.length} article{lines.length > 1 ? 's' : ''}</p>}
        </div>
        <Link to="/prestations" className="text-sm font-semibold underline-offset-4 hover:underline">Continuer mes achats</Link>
      </div>

      <AnimatePresence>
        {message && (
          <motion.p initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" data-testid="cart-message"
            className="mt-6 rounded-lg border px-4 py-3 text-sm"
            style={message.tone === 'error' ? { borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' } : { borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
            {message.text}
          </motion.p>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="mt-10 grid gap-4">{[0, 1].map((i) => <div key={i} className="h-32 animate-pulse rounded-2xl" style={{ background: 'color-mix(in srgb, var(--v-muted-foreground) 10%, transparent)' }} />)}</div>
      ) : lines.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-10 grid place-items-center rounded-2xl border border-dashed px-6 py-16 text-center" style={{ borderColor: 'var(--v-border)' }} data-testid="cart-empty">
          <ShoppingBag className="h-12 w-12" style={{ color: 'var(--v-accent)' }} />
          <p className="mt-4 text-xl font-semibold">Votre panier est vide</p>
          <p className="mt-2 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Choisissez une prestation, une formation ou une carte cadeau.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to="/prestations" className="rounded-md px-5 py-3 text-sm font-semibold" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>Voir les prestations</Link>
            <Link to="/cartes-cadeaux" className="rounded-md border px-5 py-3 text-sm font-semibold" style={{ borderColor: 'var(--v-border)' }}>Offrir une carte cadeau</Link>
          </div>
        </motion.div>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <ul className="grid content-start gap-4" data-testid="cart-lines">
            <AnimatePresence initial={false}>
              {lines.map((line) => (
                <CartLine key={line.id} line={line} consents={consents} setConsents={setConsents} removing={removing === line.id} onRemove={() => remove(line)} onSchedule={() => setScheduling(line)} />
              ))}
            </AnimatePresence>
          </ul>

          <aside className="lg:sticky lg:top-28 lg:self-start">
            <div className="grid gap-5 rounded-2xl border p-5" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
              <h2 className="text-lg font-semibold">Récapitulatif</h2>
              <GiftCardPayment totalCents={total} cards={cards} onChange={setCards} />
              <PaymentSummary totalCents={total} cards={cards} />
              {(cart?.balanceDueCents ?? 0) > 0 && (
                <p className="-mt-2 flex justify-between rounded-lg px-3 py-2 text-sm" style={{ background: 'color-mix(in srgb, var(--v-accent) 12%, transparent)' }} data-testid="cart-balance-total">
                  <span>À régler sur place</span><span className="font-semibold tabular-nums">{formatEuro(cart?.balanceDueCents ?? 0)}</span>
                </p>
              )}
              {!customer.emailVerified && (
                <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--v-border)', background: 'color-mix(in srgb, var(--v-primary) 8%, transparent)' }}>
                  <p className="flex items-center gap-2 font-semibold"><MailCheck className="h-4 w-4" /> Confirmez votre e-mail</p>
                  <p className="mt-1" style={{ color: 'var(--v-muted-foreground)' }}>Votre panier est gardé. Saisissez le code reçu par e-mail pour pouvoir payer.</p>
                  <Link to="/espace-client" className="mt-2 inline-flex text-sm font-semibold underline">Confirmer mon e-mail</Link>
                </div>
              )}
              <button onClick={checkout} disabled={paying} data-testid="cart-checkout"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md px-5 font-semibold transition disabled:opacity-70"
                style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>
                {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : split.toPayCents === 0 ? <Gift className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
                {paying ? 'Un instant…' : split.toPayCents === 0 ? 'Valider ma commande' : `Payer ${formatEuro(split.toPayCents)}`}
              </button>
              {unscheduled.length > 0 && <p className="-mt-2 text-center text-xs font-medium" style={{ color: '#9a3412' }} data-testid="cart-unscheduled-hint">{unscheduled.length > 1 ? `${unscheduled.length} prestations attendent leur créneau.` : 'Une prestation attend son créneau.'}</p>}
              {missing.length > 0 && <p className="-mt-2 text-center text-xs" style={{ color: 'var(--v-muted-foreground)' }}>Pensez à cocher les conditions sous {missing.length > 1 ? 'les articles' : 'l’article'}.</p>}
              {lines.some((l) => (l.product.kind === 'SERVICE' && l.bookingSnapshot?.startsAt) || (l.product.kind === 'IN_PERSON_TRAINING' && l.sessionId)) && (
                <p className="-mt-2 flex items-center justify-center gap-1.5 text-center text-xs" style={{ color: 'var(--v-muted-foreground)' }} data-testid="cart-hold-notice">
                  <Clock className="h-3.5 w-3.5 shrink-0" /> Vos créneaux et places vous sont réservés 30 minutes pendant le paiement.
                </p>
              )}
              <p className="flex items-center justify-center gap-1.5 text-xs" style={{ color: 'var(--v-muted-foreground)' }}><LockKeyhole className="h-3.5 w-3.5" /> Paiement sécurisé</p>
            </div>
          </aside>
        </div>
      )}
      <ScheduleDialog line={scheduling} onClose={() => setScheduling(null)} onSaved={(next) => { setCart(next); setScheduling(null); setMessage(null); }} />
    </section>
  );
}

/** Choisir le créneau d'une prestation du panier — le même calendrier que sur la fiche. */
function ScheduleDialog({ line, onClose, onSaved }: { line: Line | null; onClose: () => void; onSaved: (cart: CartView) => void }) {
  const [slot, setSlot] = React.useState<Slot | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => { setSlot(null); setError(''); setBusy(false); }, [line?.id]);
  async function save() {
    if (!line || !slot) return;
    setBusy(true);
    setError('');
    try {
      onSaved(await customerApi.setCartItemBooking(line.id, slot));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ce créneau n’est plus disponible.');
      setBusy(false);
    }
  }
  return (
    <AnimatePresence>
      {line && (
        <motion.div className="fixed inset-0 z-50 grid place-items-end bg-black/60 sm:place-items-center sm:px-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={() => !busy && onClose()} role="dialog" aria-modal="true" aria-label="Choisir un créneau" data-testid="schedule-dialog">
          <motion.div onClick={(e) => e.stopPropagation()} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border sm:rounded-2xl" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
            <div className="flex items-center justify-between gap-3 border-b p-4" style={{ borderColor: 'var(--v-border)' }}>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--v-muted-foreground)' }}>Choisir le créneau</p>
                <h2 className="truncate font-semibold">{line.product.title}</h2>
              </div>
              <button type="button" onClick={onClose} disabled={busy} className="grid h-10 w-10 shrink-0 place-items-center rounded-md border" style={{ borderColor: 'var(--v-border)' }} aria-label="Fermer"><X className="h-4 w-4" /></button>
            </div>
            <div className="overflow-y-auto p-4 sm:p-5">
              <BookingMonthCalendar durationMinutes={Number(line.product.durationMinutes || 60)} slot={slot} onSlot={setSlot} />
              {error && <p className="mt-3 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' }} role="alert">{error}</p>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t p-4" style={{ borderColor: 'var(--v-border)' }}>
              <span className="text-sm" style={{ color: 'var(--v-muted-foreground)' }}>
                {slot ? `${cap(dayFmt.format(new Date(slot.startsAt)))} · ${timeFmt.format(new Date(slot.startsAt))}` : 'Choisissez un jour puis une heure'}
              </span>
              <button type="button" onClick={save} disabled={!slot || busy} data-testid="schedule-confirm"
                className="inline-flex items-center gap-2 rounded-md px-5 py-3 text-sm font-semibold disabled:opacity-50" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />} Valider ce créneau
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CartLine({ line, consents, setConsents, removing, onRemove, onSchedule }: {
  line: Line;
  consents: string[];
  setConsents: React.Dispatch<React.SetStateAction<string[]>>;
  removing: boolean;
  onRemove: () => void;
  onSchedule: () => void;
}) {
  const needsSlot = line.product.kind === 'SERVICE' && !line.bookingSnapshot?.startsAt;
  const kind = KIND[line.product.kind] ?? KIND.PRODUCT;
  const image = resolvePreviewMediaUrl(line.product.coverUrl || line.product.gallery?.[0] || '');
  const when = whenOf(line);
  const options = (line.product.options ?? []).filter((o) => line.optionKeys.includes(o.key));
  return (
    <motion.li layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: removing ? 0.5 : 1, y: 0 }} exit={{ opacity: 0, x: -40, height: 0, marginBottom: 0 }} transition={{ duration: 0.25 }}
      className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }} data-testid="cart-line">
      <div className="flex gap-4 p-3 sm:p-4">
        <Link to={`/catalogue/${line.product.slug}`} className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl sm:h-32 sm:w-32" style={{ background: 'color-mix(in srgb, var(--v-muted-foreground) 10%, transparent)' }}>
          {image ? <img src={image} alt="" className="h-full w-full object-cover transition-transform duration-500 hover:scale-105" loading="lazy" data-testid="cart-cover" />
            : <span className="grid h-full w-full place-items-center"><ImageIcon className="h-6 w-6" style={{ color: 'var(--v-muted-foreground)' }} /></span>}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                style={{ background: 'color-mix(in srgb, var(--v-accent) 16%, transparent)', color: 'var(--v-foreground)' }} data-testid="cart-kind">
                <kind.Icon className="h-3 w-3" style={{ color: 'var(--v-accent)' }} /> {kind.label}
              </span>
              <Link to={`/catalogue/${line.product.slug}`} className="mt-1.5 block font-semibold leading-snug hover:underline sm:text-lg">{line.product.title}</Link>
            </div>
            <span className="shrink-0 text-right font-semibold tabular-nums sm:text-lg" data-testid="cart-price">{formatEuro(line.totalCents)}</span>
          </div>

          {needsSlot && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: '#fed7aa', background: '#fff7ed', color: '#9a3412' }} data-testid="cart-needs-slot">
              <span className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4 shrink-0" /> Créneau à choisir</span>
              <button type="button" onClick={onSchedule} data-testid="cart-pick-slot" className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>
                <CalendarDays className="h-3.5 w-3.5" /> Choisir un créneau
              </button>
            </motion.div>
          )}
          <div className="mt-2 grid gap-1 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>
            {when.map((w) => (
              <p key={w} className="flex flex-wrap items-center gap-1.5" data-testid="cart-when">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--v-accent)' }} /> {w}
                {line.product.kind === 'SERVICE' && <button type="button" onClick={onSchedule} className="text-xs font-semibold underline" data-testid="cart-change-slot">Changer</button>}
              </p>
            ))}
            {line.product.kind === 'SERVICE' && line.product.durationMinutes ? <p className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--v-accent)' }} /> {durationText(line.product.durationMinutes)}</p> : null}
            {line.giftCard && <p>Pour {line.giftCard.recipientName || 'la personne de votre choix'}{line.giftCard.senderName ? `, de la part de ${line.giftCard.senderName}` : ''}</p>}
            {options.length > 0 && <p>Options : {options.map((o) => o.label).join(', ')}</p>}
            {line.quantity > 1 && <p>Quantité : {line.quantity} × {formatEuro(line.unitPriceCents)}</p>}
            {(line.balanceDueCents ?? 0) > 0 && (
              <p className="font-medium" style={{ color: 'var(--v-foreground)' }} data-testid="cart-balance">
                {line.totalCents > 0 ? `Acompte payé en ligne · ${formatEuro(line.balanceDueCents ?? 0)} à régler sur place` : `Rien à payer en ligne · ${formatEuro(line.balanceDueCents ?? 0)} à régler sur place`}
              </p>
            )}
          </div>

          {(line.consentRequirements ?? []).map((requirement) => {
            const key = `${line.id}:${requirement.key}`;
            return (
              <label key={key} className="mt-3 flex cursor-pointer items-start gap-2 text-xs" style={{ color: 'var(--v-muted-foreground)' }}>
                <input type="checkbox" className="mt-0.5" checked={consents.includes(key)}
                  onChange={(event) => setConsents((current) => (event.target.checked ? [...current, key] : current.filter((item) => item !== key)))} />
                <span>{requirement.label}</span>
              </label>
            );
          })}

          <div className="mt-3 flex justify-end">
            <button onClick={onRemove} disabled={removing} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold transition hover:bg-black/5" style={{ color: 'var(--v-muted-foreground)' }} data-testid="cart-remove">
              {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Retirer
            </button>
          </div>
        </div>
      </div>
    </motion.li>
  );
}
