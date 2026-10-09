import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarCheck, CalendarClock, Loader2, ShoppingBag, X } from 'lucide-react';
import { commerceApi, customerApi, type Appointment, type CommerceProduct } from '@/lib/api';
import { ProductOptions } from '@/components/ProductOptions';
import { ServicePicker } from '@/components/ServicePicker';
import { durationText } from '@/components/CommerceProductCard';
import { itemMinutes, itemPriceCents } from '@/lib/bookingSequence';
import { publishCartCount } from '@/lib/cartSignal';

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const time = (v: string) => new Date(v).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

type Check = { state: 'checking' } | { state: 'right-after'; at: string } | { state: 'later'; at: string } | { state: 'none' };

/**
 * AJOUTER UNE PRESTATION JUSTE APRÈS UN RENDEZ-VOUS DÉJÀ PRIS.
 *
 * Le cas qui a fait naître l'enchaînement : une cliente a réservé sa dépose et
 * veut poser ses cils dans la foulée. Elle choisit la prestation (et ses
 * options) ; l'écran vérifie que l'heure de FIN de son rendez-vous est libre
 * pour toute la durée. Sinon, il dit la prochaine heure libre du même jour —
 * jamais un « indisponible » sans suite. La réservation passe ensuite par le
 * panier, comme toute autre : mêmes contrôles, même paiement.
 */
export function AddAfterDialog({ appointment, onClose }: { appointment: Appointment | null; onClose: () => void }) {
  const navigate = useNavigate();
  const [product, setProduct] = React.useState<CommerceProduct | null>(null);
  const [optionKeys, setOptionKeys] = React.useState<string[]>([]);
  const [check, setCheck] = React.useState<Check>({ state: 'checking' });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => { setProduct(null); setOptionKeys([]); setError(''); setBusy(false); }, [appointment?.id]);

  React.useEffect(() => {
    if (!appointment || !product) return;
    let alive = true;
    setCheck({ state: 'checking' });
    const end = new Date(appointment.endsAt);
    const endOfDay = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59);
    commerceApi.availability({ from: end.toISOString(), to: endOfDay.toISOString(), durationMinutes: itemMinutes(product, optionKeys), productId: product.id, optionKeys })
      .then((slots) => {
        if (!alive) return;
        const first = slots[0];
        if (!first) setCheck({ state: 'none' });
        else if (new Date(first.startsAt).getTime() === end.getTime()) setCheck({ state: 'right-after', at: first.startsAt });
        else setCheck({ state: 'later', at: first.startsAt });
      })
      .catch(() => alive && setCheck({ state: 'none' }));
    return () => { alive = false; };
  }, [appointment, product, optionKeys]);

  async function add(at: string) {
    if (!product) return;
    setBusy(true);
    setError('');
    try {
      const cart = await customerApi.addCartItem({ productId: product.id, quantity: 1, optionKeys, serviceBooking: { startsAt: at, endsAt: at } });
      publishCartCount(cart.lines.length, true);
      navigate('/panier');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ajout impossible');
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {appointment && (
        <motion.div className="fixed inset-0 z-50 grid place-items-end bg-black/60 sm:place-items-center sm:px-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={() => !busy && onClose()} role="dialog" aria-modal="true" aria-label="Ajouter une prestation juste après" data-testid="add-after-dialog">
          <motion.div onClick={(e) => e.stopPropagation()} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border sm:rounded-2xl" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
            <div className="flex items-center justify-between gap-3 border-b p-4" style={{ borderColor: 'var(--v-border)' }}>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--v-muted-foreground)' }}>Juste après · {time(appointment.endsAt)}</p>
                <h2 className="truncate font-semibold">Après « {appointment.title} »</h2>
              </div>
              <button type="button" onClick={onClose} disabled={busy} className="grid h-10 w-10 shrink-0 place-items-center rounded-md border" style={{ borderColor: 'var(--v-border)' }} aria-label="Fermer"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-4 overflow-y-auto p-4 sm:p-5">
              {!product ? (
                <>
                  <p className="text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Choisissez la prestation à enchaîner : nous vérifions qu’elle peut commencer à {time(appointment.endsAt)}, sans attente.</p>
                  <ServicePicker onPick={(p) => { setProduct(p); setOptionKeys([]); }} />
                </>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3 rounded-xl border p-3" style={{ borderColor: 'var(--v-border)' }}>
                    <div className="min-w-0">
                      <p className="font-semibold" data-testid="add-after-product">{product.title}</p>
                      <p className="text-xs" style={{ color: 'var(--v-muted-foreground)' }}>{durationText(itemMinutes(product, optionKeys))} · {euro.format(itemPriceCents(product, optionKeys) / 100)}</p>
                    </div>
                    <button type="button" onClick={() => setProduct(null)} className="shrink-0 text-xs font-semibold underline">Changer</button>
                  </div>
                  <ProductOptions product={product} selected={optionKeys} onChange={setOptionKeys} />
                  <div className="rounded-xl p-3 text-sm" style={{ background: 'color-mix(in srgb, var(--v-accent) 12%, var(--v-surface))' }} data-testid="add-after-check" data-state={check.state}>
                    {check.state === 'checking' && <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Vérification de l’horaire…</p>}
                    {check.state === 'right-after' && <p className="flex items-start gap-2"><CalendarCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--v-accent)' }} /> Disponible juste après : de {time(check.at)} à {time(new Date(new Date(check.at).getTime() + itemMinutes(product, optionKeys) * 60_000).toISOString())}.</p>}
                    {check.state === 'later' && <p className="flex items-start gap-2"><CalendarClock className="mt-0.5 h-4 w-4 shrink-0" /> Pas possible à {time(appointment.endsAt)} pour cette durée. Prochaine heure libre ce jour-là : {time(check.at)}.</p>}
                    {check.state === 'none' && <p>Plus de place ce jour-là pour cette prestation. Vous pouvez la réserver un autre jour depuis sa fiche.</p>}
                  </div>
                  {error && <p className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' }} role="alert">{error}</p>}
                </>
              )}
            </div>
            {product && (check.state === 'right-after' || check.state === 'later') && (
              <div className="flex justify-end border-t p-4" style={{ borderColor: 'var(--v-border)' }}>
                <button type="button" onClick={() => add(check.at)} disabled={busy} data-testid="add-after-confirm"
                  className="inline-flex items-center gap-2 rounded-md px-5 py-3 text-sm font-semibold disabled:opacity-50" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />} Ajouter à {time(check.at)} et payer
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
