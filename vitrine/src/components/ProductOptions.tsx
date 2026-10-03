import { AnimatePresence, motion } from 'framer-motion';
import { Check, Plus } from 'lucide-react';
import type { CommerceProduct } from '@/lib/api';

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/**
 * LES OPTIONS D'UNE PRESTATION OU D'UNE FORMATION — des cartes cochables
 * (jamais une case native) : une pression coche ou décoche, la coche apparaît
 * avec un ressort, le prix de l'option reste lisible à droite.
 */
export function ProductOptions({ product, selected, onChange }: {
  product: CommerceProduct;
  selected: string[];
  onChange: (keys: string[]) => void;
}) {
  const options = product.options || [];
  if (!options.length) return null;
  const toggle = (key: string) => onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  return (
    <div className="grid gap-2" data-testid="product-options">
      <p className="text-sm font-semibold">Options</p>
      {options.map((option) => {
        const on = selected.includes(option.key);
        return (
          <motion.button
            key={option.key}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => toggle(option.key)}
            whileTap={{ scale: 0.98 }}
            data-testid="product-option"
            data-selected={on || undefined}
            className="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors"
            style={{
              borderColor: on ? 'var(--v-primary)' : 'var(--v-border)',
              background: on ? 'color-mix(in srgb, var(--v-primary) 7%, var(--v-surface))' : 'var(--v-surface)',
              boxShadow: on ? '0 0 0 3px color-mix(in srgb, var(--v-primary) 14%, transparent)' : 'none',
            }}
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 transition-colors"
              style={{ borderColor: on ? 'var(--v-primary)' : 'color-mix(in srgb, var(--v-muted-foreground) 45%, transparent)', background: on ? 'var(--v-primary)' : 'transparent', color: 'var(--v-primary-foreground)' }}>
              <AnimatePresence initial={false}>
                {on && (
                  <motion.span initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 520, damping: 22 }}>
                    <Check className="h-4 w-4" strokeWidth={3} />
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{option.label}</span>
              {option.description && <span className="block text-xs" style={{ color: 'var(--v-muted-foreground)' }}>{option.description}</span>}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums" data-testid="product-option-price">
              {option.priceCents > 0 ? <><Plus className="h-3.5 w-3.5" />{euro.format(option.priceCents / 100)}</> : 'Inclus'}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

/** Le supplément des options choisies. */
export function optionsTotalCents(product: CommerceProduct, selected: string[]) {
  return (product.options || []).filter((o) => selected.includes(o.key)).reduce((s, o) => s + (o.priceCents || 0), 0);
}
