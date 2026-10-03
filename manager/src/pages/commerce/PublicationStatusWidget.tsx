import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PRODUCT_STATUSES, PRODUCT_STATUS_META, productStatusMeta, type ProductStatus } from './productStatus';

/**
 * LE STATUT DE PUBLICATION, EN WIDGET FLOTTANT — à côté du bouton Enregistrer.
 *
 * Il vivait dans un onglet (« Avancé » d'un côté, « Informations » de
 * l'autre) : pour savoir si une fiche était visible, il fallait aller le
 * chercher. Il est désormais toujours à l'écran, dans sa couleur, et se change
 * en deux clics. Le changer MODIFIE la fiche : le bouton passe à
 * « Enregistrer » et la garde « Quitter sans enregistrer ? » s'applique,
 * exactement comme pour n'importe quel champ.
 */
export function PublicationStatusWidget({ value, onChange }: { value?: string; onChange: (status: ProductStatus) => void }) {
  const [open, setOpen] = React.useState(false);
  const root = React.useRef<HTMLDivElement | null>(null);
  const meta = productStatusMeta(value);
  const Icon = meta.icon;

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={root} className="relative" data-testid="publication-status">
      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            aria-label="Statut de publication"
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="absolute bottom-full right-0 mb-2 w-64 origin-bottom-right overflow-hidden rounded-xl border bg-card p-1.5 text-card-foreground shadow-xl ring-1 ring-black/5"
            data-testid="publication-status-menu"
          >
            {PRODUCT_STATUSES.map((status) => {
              const item = PRODUCT_STATUS_META[status];
              const ItemIcon = item.icon;
              const selected = status === (value || 'DRAFT');
              return (
                <li key={status}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => { onChange(status); setOpen(false); }}
                    className={cn('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted', selected && 'bg-muted')}
                    data-status={status}
                  >
                    <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full', item.solid)}><ItemIcon className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{item.label}</span>
                      <span className="block text-xs text-muted-foreground">{item.hint}</span>
                    </span>
                    {selected && <Check className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Statut de publication"
        className={cn(
          'm-rise inline-flex h-12 items-center gap-2 rounded-full border-2 bg-card pl-2 pr-3.5 text-sm font-semibold shadow-lg transition-all hover:shadow-xl active:scale-95',
          meta.badge,
        )}
        data-status={value || 'DRAFT'}
        data-testid="publication-status-button"
      >
        <span className={cn('grid h-8 w-8 place-items-center rounded-full', meta.solid)}><Icon className="h-4 w-4" /></span>
        <span>{meta.label}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.16 }}><ChevronUp className="h-4 w-4 opacity-70" /></motion.span>
      </button>
    </div>
  );
}
