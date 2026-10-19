import * as React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

const DropdownContext = React.createContext<{ open: boolean; setOpen: (open: boolean) => void; anchorRef: React.RefObject<HTMLButtonElement> } | null>(null);

function Root({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  const anchorRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-dropdown-popover="true"]')) return;
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <DropdownContext.Provider value={{ open, setOpen, anchorRef }}>
      <div ref={ref} className="relative inline-flex">{children}</div>
    </DropdownContext.Provider>
  );
}

function useDropdown() {
  const ctx = React.useContext(DropdownContext);
  if (!ctx) throw new Error('Dropdown.Root manquant');
  return ctx;
}

function DotsButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { open, setOpen, anchorRef } = useDropdown();
  return (
    <button
      ref={anchorRef}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      className={cn('inline-flex h-9 w-9 items-center justify-center rounded-md bg-transparent text-muted-foreground transition hover:bg-muted hover:text-foreground', className)}
      {...props}
    >
      <MoreVertical className="h-4 w-4" />
    </button>
  );
}

function Popover({
  children,
  className,
  placement = 'bottom end',
}: {
  children: React.ReactNode;
  className?: string;
  placement?: string;
  offset?: number;
}) {
  const { open, anchorRef } = useDropdown();
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = React.useState<React.CSSProperties>({});
  const [above, setAbove] = React.useState(false);

  React.useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const updatePosition = () => {
      if (!anchorRef.current) return;
      const rect = anchorRef.current.getBoundingClientRect();
      const width = 224;
      const gap = 6;
      const left = placement.includes('right')
        ? rect.right + gap
        : Math.min(window.innerWidth - width - gap, Math.max(gap, rect.right - width));
      // Hauteur naturelle du menu (sans transformation ni plafond) : il s'ouvre
      // là où il tient en entier — dessous par défaut, au-dessus si la page
      // s'arrête trop tôt (tableau d'une seule ligne en bas d'écran). S'il ne
      // tient nulle part, il prend le côté le plus grand et défile en lui-même.
      const height = panelRef.current?.scrollHeight || 0;
      const spaceBelow = window.innerHeight - rect.bottom - gap * 2;
      const spaceAbove = rect.top - gap * 2;
      const wantsTop = placement.includes('top');
      const fitsBelow = height <= spaceBelow;
      const fitsAbove = height <= spaceAbove;
      const openAbove = wantsTop
        ? fitsAbove || (!fitsBelow && spaceAbove >= spaceBelow)
        : !fitsBelow && (fitsAbove || spaceAbove > spaceBelow);
      const room = openAbove ? spaceAbove : spaceBelow;
      const shown = Math.min(height, room);
      const top = openAbove ? Math.max(gap, rect.top - gap - shown) : rect.bottom + gap;
      setAbove(openAbove);
      setPosition({
        position: 'fixed', top, left, width, zIndex: 80,
        ...(height > room ? { maxHeight: Math.max(48, room), overflowY: 'auto', overscrollBehavior: 'contain' } : {}),
      });
    };
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [anchorRef, open, placement]);

  const content = (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          data-dropdown-popover="true"
          data-placement={above ? 'top' : 'bottom'}
          initial={{ opacity: 0, y: above ? 4 : -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: above ? 4 : -4, scale: 0.98 }}
          transition={{ duration: 0.14 }}
          className={cn('overflow-hidden rounded-md border p-1 shadow-xl', className)}
          style={{ background: 'var(--m-card)', color: 'var(--m-foreground)', ...position }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}

function Menu({ children }: { children: React.ReactNode }) {
  return <div role="menu" className="grid gap-1">{children}</div>;
}

function Section({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-1">{children}</div>;
}

function Separator() {
  return <div className="-mx-1 my-1 h-px bg-border" />;
}

function Item({
  children,
  addon,
  destructive,
  disabled,
  onAction,
  onClick,
}: {
  children: React.ReactNode;
  addon?: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  onAction?: () => void;
  onClick?: () => void;
}) {
  const { setOpen } = useDropdown();
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onAction?.();
        onClick?.();
        setOpen(false);
      }}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm transition hover:bg-muted disabled:opacity-50',
        destructive && 'text-red-600 hover:bg-red-50',
      )}
    >
      <span>{children}</span>
      {addon && <span className="text-xs text-muted-foreground">{addon}</span>}
    </button>
  );
}

export const Dropdown = { Root, DotsButton, Popover, Menu, Section, Separator, Item };
