import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Timer } from 'lucide-react';
import type { CommerceProduct } from '@/lib/api';

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/** Le badge « −20 % », posé en haut à droite d'une couverture (parent `relative`). */
export function PromoBadge({ product, large = false }: { product: CommerceProduct; large?: boolean }) {
  if (!product.promotion) return null;
  return (
    <motion.span
      initial={{ scale: 0.6, opacity: 0, rotate: -8 }}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 18 }}
      className={`absolute right-3 top-3 z-10 rounded-full font-semibold shadow-lg ${large ? 'px-4 py-2 text-base' : 'px-3 py-1 text-sm'}`}
      style={{ background: 'var(--v-accent)', color: 'var(--v-accent-foreground)' }}
      data-testid="promo-badge"
    >
      −{product.promotion.percentOff} %
    </motion.span>
  );
}

/** Prix barré + prix remisé ; sans promotion, le prix seul. */
export function PromoPrice({ product, size = 'card' }: { product: CommerceProduct; size?: 'card' | 'page' }) {
  const now = euro.format(product.price.amountCents / 100);
  if (!product.compareAtPrice || !product.promotion) {
    return size === 'page' ? <div className="text-3xl font-semibold">{now}</div> : <strong>{now}</strong>;
  }
  const before = euro.format(product.compareAtPrice.amountCents / 100);
  if (size === 'card') {
    return (
      <span className="flex flex-wrap items-baseline gap-x-2" data-testid="promo-price">
        <strong style={{ color: 'var(--v-accent)' }}>{now}</strong>
        <s className="text-sm" style={{ color: 'var(--v-muted-foreground)' }} data-testid="promo-was">{before}</s>
      </span>
    );
  }
  return (
    <div className="grid gap-1" data-testid="promo-price">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-3xl font-semibold" style={{ color: 'var(--v-accent)' }}>{now}</span>
        <s className="text-xl" style={{ color: 'var(--v-muted-foreground)' }} data-testid="promo-was">{before}</s>
      </div>
      <p className="text-sm font-semibold">Vous économisez {euro.format(product.promotion.discountCents / 100)}</p>
    </div>
  );
}

function remaining(endsAt: string) {
  const ms = Math.max(0, new Date(endsAt).getTime() - Date.now());
  const s = Math.floor(ms / 1000);
  return { ms, days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 };
}

/** Un chiffre qui glisse quand il change. */
function Digit({ value }: { value: string }) {
  return (
    <span className="relative inline-block h-[1.15em] w-[0.62em] overflow-hidden text-center align-bottom">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span key={value} className="absolute inset-0" initial={{ y: '-100%', opacity: 0 }} animate={{ y: '0%', opacity: 1 }} exit={{ y: '100%', opacity: 0 }} transition={{ duration: 0.32, ease: 'easeOut' }}>
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function Unit({ value, label }: { value: number; label: string }) {
  const text = String(value).padStart(2, '0');
  return (
    <div className="grid min-w-[62px] justify-items-center rounded-xl px-2 py-2.5" style={{ background: 'color-mix(in srgb, var(--v-surface) 82%, transparent)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--v-accent) 30%, transparent)' }}>
      <span className="font-mono text-2xl font-semibold tabular-nums leading-none sm:text-3xl">
        {text.split('').map((c, i) => <Digit key={`${i}-${text.length}`} value={c} />)}
      </span>
      <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--v-muted-foreground)' }}>{label}</span>
    </div>
  );
}

/**
 * LE COMPTE À REBOURS D'UNE PROMOTION PROGRAMMÉE — jours, heures, minutes,
 * secondes ; chaque chiffre glisse quand il change. À zéro, la fiche est
 * rechargée pour afficher le prix normal.
 */
export function PromotionCountdown({ product, onEnded }: { product: CommerceProduct; onEnded?: () => void }) {
  const endsAt = product.promotion?.endsAt || null;
  const [left, setLeft] = React.useState(() => (endsAt ? remaining(endsAt) : null));

  React.useEffect(() => {
    if (!endsAt) return undefined;
    const timer = window.setInterval(() => {
      const next = remaining(endsAt);
      setLeft(next);
      if (next.ms <= 0) { window.clearInterval(timer); onEnded?.(); }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [endsAt, onEnded]);

  if (!endsAt || !left || left.ms <= 0) return null;
  const end = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(endsAt));
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-5 overflow-hidden rounded-2xl p-4"
      style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--v-accent) 22%, var(--v-surface)), color-mix(in srgb, var(--v-accent) 6%, var(--v-surface)))', border: '1px solid color-mix(in srgb, var(--v-accent) 35%, transparent)' }}
      data-testid="promo-countdown" role="timer" aria-label={`Offre valable jusqu'au ${end}`}>
      <p className="flex items-center gap-2 text-sm font-semibold">
        <motion.span animate={{ rotate: [0, -12, 12, 0] }} transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 2.5 }}>
          <Timer className="h-4 w-4" style={{ color: 'var(--v-accent)' }} />
        </motion.span>
        L’offre se termine dans
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {left.days > 0 && <Unit value={left.days} label={left.days > 1 ? 'jours' : 'jour'} />}
        <Unit value={left.hours} label="heures" />
        <Unit value={left.minutes} label="min" />
        <Unit value={left.seconds} label="sec" />
      </div>
      <p className="mt-2 text-xs" style={{ color: 'var(--v-muted-foreground)' }}>Jusqu’au {end}</p>
    </motion.div>
  );
}
