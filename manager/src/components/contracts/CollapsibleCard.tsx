import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/**
 * Carte repliable — la zone « à la demande » des écrans de contrat.
 *
 * Ce qui est secondaire doit rester ATTEIGNABLE sans encombrer : replié par
 * défaut, à l'écart du parcours. Un détail technique posé à côté d'un CTA
 * contractuel se lit comme une action métier, ce qu'il n'est pas.
 *
 * Le contenu est démonté quand la carte est fermée (`AnimatePresence`) : rien
 * ne travaille en arrière-plan pour une section que personne ne regarde.
 */
export function CollapsibleCard({
  icon: Icon,
  title,
  description,
  defaultOpen = false,
  className,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  /** Affiché une fois ouvert : dit à quoi sert la section, pas ce qu'elle contient. */
  description?: string;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const reduce = useReducedMotion();

  return (
    <Card className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 p-5 text-left"
      >
        <span className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          <span className="text-base font-semibold">{title}</span>
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <CardContent className="space-y-4 border-t border-border pt-5">
              {description && <p className="text-xs text-muted-foreground">{description}</p>}
              {children}
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
