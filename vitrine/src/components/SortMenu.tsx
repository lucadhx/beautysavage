import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpDown, Check, ChevronDown } from 'lucide-react';

export interface SortOption<K extends string> {
  key: K;
  label: string;
}

/**
 * LE MENU DE TRI — une liste déroulante dessinée, pas le <select> du système.
 *
 * Elle prend les couleurs du thème, s'ouvre en fondu glissé, se ferme au clic
 * dehors ou sur Échap, et se pilote au clavier (flèches, Entrée, Début/Fin).
 */
export function SortMenu<K extends string>({
  value,
  options,
  onChange,
  label = 'Trier',
}: {
  value: K;
  options: SortOption<K>[];
  onChange: (key: K) => void;
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const root = React.useRef<HTMLDivElement | null>(null);
  const button = React.useRef<HTMLButtonElement | null>(null);
  const listId = React.useId();
  const current = options.find((o) => o.key === value) || options[0];

  React.useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const openMenu = () => {
    setActive(Math.max(0, options.findIndex((o) => o.key === value)));
    setOpen(true);
  };
  const choose = (key: K) => {
    onChange(key);
    setOpen(false);
    button.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); openMenu(); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); button.current?.focus(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => (i + 1) % options.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => (i - 1 + options.length) % options.length); }
    else if (event.key === 'Home') { event.preventDefault(); setActive(0); }
    else if (event.key === 'End') { event.preventDefault(); setActive(options.length - 1); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(options[active].key); }
    else if (event.key === 'Tab') setOpen(false);
  };

  return (
    <div ref={root} className="relative w-full sm:w-auto" onKeyDown={onKeyDown} data-testid="sort-menu">
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? setOpen(false) : openMenu())}
        data-testid="sort-button"
        className="inline-flex h-12 w-full items-center gap-3 rounded-full border pl-4 pr-3 text-sm font-semibold transition hover:opacity-90 focus:outline-none focus-visible:ring-2 sm:w-auto sm:min-w-[270px]"
        style={{ borderColor: open ? 'var(--v-primary)' : 'var(--v-border)', background: 'var(--v-surface)', color: 'var(--v-foreground)' }}
      >
        <ArrowUpDown className="h-4 w-4 shrink-0" style={{ color: 'var(--v-accent)' }} aria-hidden />
        <span className="shrink-0 font-normal" style={{ color: 'var(--v-muted-foreground)' }}>{label} :</span>
        <span className="min-w-0 flex-1 truncate text-left">{current.label}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="grid shrink-0 place-items-center">
          <ChevronDown className="h-4 w-4" style={{ color: 'var(--v-muted-foreground)' }} aria-hidden />
        </motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            id={listId}
            role="listbox"
            aria-label={label}
            aria-activedescendant={`${listId}-${active}`}
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 z-30 mt-2 w-full origin-top overflow-hidden rounded-2xl border p-1.5 shadow-xl sm:w-72"
            style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)', boxShadow: '0 18px 40px -18px color-mix(in srgb, var(--v-foreground) 45%, transparent)' }}
          >
            {options.map((option, index) => {
              const selected = option.key === value;
              const highlighted = index === active;
              return (
                <motion.li
                  key={option.key}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={selected}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.025 * index, duration: 0.16 }}
                  onPointerEnter={() => setActive(index)}
                  onClick={() => choose(option.key)}
                  data-testid="sort-option"
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors"
                  style={{
                    background: selected
                      ? 'color-mix(in srgb, var(--v-primary) 14%, var(--v-surface))'
                      : highlighted ? 'color-mix(in srgb, var(--v-foreground) 6%, var(--v-surface))' : 'transparent',
                    color: 'var(--v-foreground)',
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  {option.label}
                  {selected && <Check className="h-4 w-4 shrink-0" style={{ color: 'var(--v-primary)' }} aria-hidden />}
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
