import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CustomSelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export function CustomSelect<T extends string>({
  value,
  onChange,
  options,
  className,
  buttonClassName,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: CustomSelectOption<T>[];
  className?: string;
  buttonClassName?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative min-w-0', className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-3 rounded-md border bg-background px-3 text-left text-sm transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          buttonClassName,
        )}
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{selected?.label}</span>
          {selected?.description && <span className="block truncate text-xs text-muted-foreground">{selected.description}</span>}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 6, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute left-0 right-0 z-40 overflow-hidden rounded-md border shadow-xl"
            style={{ background: 'var(--m-card)', color: 'var(--m-foreground)' }}
          >
            <div role="listbox" className="max-h-72 overflow-auto p-1">
              {options.map((option) => {
                const active = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-start justify-between gap-3 rounded px-3 py-2 text-left text-sm transition hover:bg-muted',
                      active && 'bg-primary/10 text-primary',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{option.label}</span>
                      {option.description && <span className="block text-xs text-muted-foreground">{option.description}</span>}
                    </span>
                    {active && <Check className="mt-0.5 h-4 w-4 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
