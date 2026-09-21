import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, Lock, ChevronDown, Minus } from 'lucide-react';
import { Card } from '@/components/ui/primitives';
import type { SetupStatus, SetupStepKey } from '@/lib/contractSetup';
import { cn } from '@/lib/utils';

/**
 * Préparation guidée : une étape ouverte à la fois, les suivantes verrouillées.
 *
 * Une étape verrouillée reste VISIBLE (on voit où l'on va) mais inerte : ni
 * clic, ni contenu. C'est plus honnête qu'un bouton actif qui échouera —
 * placer des zones sans PDF n'a aucun sens, autant le dire avant le clic.
 *
 * Quand une étape est franchie, la suivante s'ouvre et défile jusqu'au champ de
 * vision : l'utilisateur n'a pas à chercher ce qu'il doit faire ensuite.
 */

export interface GuidedStepView {
  key: SetupStepKey;
  title: string;
  status: SetupStatus;
  hint: string;
  content: React.ReactNode;
}

const DOT: Record<SetupStatus, string> = {
  done: 'border-emerald-500 bg-emerald-500 text-white',
  current: 'border-primary bg-primary text-primary-foreground',
  locked: 'border-border bg-muted text-muted-foreground',
  optional: 'border-border bg-card text-muted-foreground',
};

const HINT_TONE: Record<SetupStatus, string> = {
  done: 'text-emerald-700',
  current: 'text-muted-foreground',
  locked: 'text-muted-foreground',
  optional: 'text-muted-foreground',
};

function StepIcon({ status, index }: { status: SetupStatus; index: number }) {
  if (status === 'done') return <Check className="h-3.5 w-3.5" strokeWidth={3} />;
  if (status === 'locked') return <Lock className="h-3 w-3" />;
  if (status === 'optional') return <Minus className="h-3.5 w-3.5" />;
  return <span className="text-[11px] font-semibold">{index + 1}</span>;
}

export function GuidedSteps({ steps, currentIndex }: { steps: GuidedStepView[]; currentIndex: number }) {
  const reduce = useReducedMotion();
  // L'étape ouverte suit l'avancement, mais reste pilotable à la main : on doit
  // pouvoir rouvrir une étape déjà faite pour la corriger.
  const [openKey, setOpenKey] = React.useState<SetupStepKey | null>(steps[currentIndex]?.key ?? null);
  const refs = React.useRef<Partial<Record<SetupStepKey, HTMLDivElement | null>>>({});
  const previousCurrent = React.useRef<SetupStepKey | null>(steps[currentIndex]?.key ?? null);

  // Quand l'étape courante CHANGE (une étape vient d'être franchie), on ouvre la
  // suivante et on l'amène dans le champ de vision.
  React.useEffect(() => {
    const nextKey = steps[currentIndex]?.key ?? null;
    if (!nextKey || nextKey === previousCurrent.current) return;
    previousCurrent.current = nextKey;
    setOpenKey(nextKey);
    // Laisse l'accordéon se déplier avant de défiler, sinon la cible bouge.
    const t = setTimeout(() => {
      refs.current[nextKey]?.scrollIntoView({
        behavior: reduce ? 'auto' : 'smooth',
        block: 'center',
      });
    }, reduce ? 0 : 180);
    return () => clearTimeout(t);
  }, [currentIndex, steps, reduce]);

  return (
    <div className="space-y-3">
      {steps.map((step, i) => {
        const locked = step.status === 'locked';
        const open = openKey === step.key && !locked;
        return (
          <Card
            key={step.key}
            ref={(el: HTMLDivElement | null) => (refs.current[step.key] = el)}
            className={cn(
              'overflow-hidden transition-colors',
              locked && 'opacity-60',
              step.status === 'current' && 'border-primary/40 ring-1 ring-primary/20'
            )}
          >
            <button
              type="button"
              disabled={locked}
              aria-expanded={open}
              onClick={() => setOpenKey(open ? null : step.key)}
              className={cn(
                'flex w-full items-center gap-3 p-4 text-left',
                locked ? 'cursor-not-allowed' : 'hover:bg-muted/40'
              )}
            >
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                  DOT[step.status]
                )}
              >
                <StepIcon status={step.status} index={i} />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{step.title}</span>
                <span className={cn('block truncate text-xs', HINT_TONE[step.status])}>{step.hint}</span>
              </span>

              {!locked && (
                <ChevronDown
                  className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
                />
              )}
              <span className="sr-only">
                {step.status === 'done'
                  ? 'terminée'
                  : step.status === 'locked'
                    ? 'verrouillée, terminez les étapes précédentes'
                    : step.status === 'optional'
                      ? 'facultative'
                      : 'à faire'}
              </span>
            </button>

            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  key="content"
                  initial={reduce ? false : { height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-border p-4">{step.content}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        );
      })}
    </div>
  );
}

export default GuidedSteps;
