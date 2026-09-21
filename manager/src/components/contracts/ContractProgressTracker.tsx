import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, Minus, X } from 'lucide-react';
import type { Contract } from '@/types';
import { deriveContractProgress, type ProgressStatus, type ProgressStep } from '@/lib/contractProgress';
import { cn } from '@/lib/utils';

/**
 * Suivi horizontal du contrat — MÊME composant pour le DEV et l'ADMIN.
 *
 * L'avancement vient de `deriveContractProgress`, dérivé des états réels : les
 * deux rôles voient donc rigoureusement la même chose, sans duplication de
 * règles. Voir docs/CONTRACT_ACTIVATION_FLOW.md.
 *
 * Mobile : défilement horizontal avec snap, l'étape courante est centrée
 * automatiquement — un stepper compressé sur 6 étapes est illisible.
 */

const DOT: Record<ProgressStatus, string> = {
  done: 'border-emerald-500 bg-emerald-500 text-white',
  current: 'border-primary bg-primary text-primary-foreground',
  upcoming: 'border-border bg-card text-muted-foreground',
  'not-required': 'border-border bg-muted text-muted-foreground',
  error: 'border-red-500 bg-red-500 text-white',
};

const LABEL_TONE: Record<ProgressStatus, string> = {
  done: 'text-foreground',
  current: 'text-foreground font-semibold',
  upcoming: 'text-muted-foreground',
  'not-required': 'text-muted-foreground',
  error: 'text-red-600 font-medium',
};

function StepDot({ step, index, animate }: { step: ProgressStep; index: number; animate: boolean }) {
  const { status } = step;
  return (
    <span className="relative flex h-7 w-7 shrink-0 items-center justify-center">
      {/* Halo de l'étape courante — sobre, et désactivé si l'utilisateur a
          demandé moins d'animations. */}
      {status === 'current' && animate && (
        <motion.span
          className="absolute inset-0 rounded-full bg-primary/30"
          animate={{ scale: [1, 1.6, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <span
        className={cn(
          'relative flex h-7 w-7 items-center justify-center rounded-full border-2 text-[11px] font-semibold transition-colors duration-500',
          DOT[status]
        )}
      >
        {status === 'done' ? (
          <motion.span
            initial={animate ? { scale: 0 } : false}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 24 }}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          </motion.span>
        ) : status === 'error' ? (
          <X className="h-3.5 w-3.5" strokeWidth={3} />
        ) : status === 'not-required' ? (
          <Minus className="h-3.5 w-3.5" />
        ) : (
          index + 1
        )}
      </span>
    </span>
  );
}

export function ContractProgressTracker({ contract, className }: { contract: Contract; className?: string }) {
  const reduce = useReducedMotion();
  const animate = !reduce;
  const { steps, currentIndex, completed, total, outcome } = React.useMemo(
    () => deriveContractProgress(contract),
    [contract]
  );

  const scroller = React.useRef<HTMLDivElement>(null);
  const currentRef = React.useRef<HTMLDivElement>(null);

  /*
    Mobile : amener l'étape courante dans le champ de vision — HORIZONTALEMENT,
    et uniquement dans cette bande.

    `scrollIntoView` remontait la chaîne des conteneurs défilants : depuis que
    le document est le propriétaire du défilement vertical du manager, il
    pouvait tirer la PAGE vers cette bande au montage, alors qu'on voulait
    seulement recentrer une pastille. On déplace donc la bande, et rien d'autre.
  */
  React.useEffect(() => {
    const el = currentRef.current;
    const box = scroller.current;
    if (!el || !box || box.scrollWidth <= box.clientWidth) return;
    const cible = el.getBoundingClientRect();
    const bande = box.getBoundingClientRect();
    const ecart = cible.left + cible.width / 2 - (bande.left + bande.width / 2);
    box.scrollBy({ left: ecart, behavior: reduce ? 'auto' : 'smooth' });
  }, [currentIndex, reduce]);

  // Progression de la ligne : proportion d'étapes franchies.
  const ratio = total > 0 ? completed / total : 0;

  return (
    <div className={cn('space-y-2', className)}>
      <div
        ref={scroller}
        className="-mx-1 overflow-x-auto overscroll-x-contain px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ scrollSnapType: 'x mandatory' }}
        role="list"
        aria-label="Avancement du contrat"
      >
        <div className="relative flex min-w-max items-start gap-0 sm:min-w-0">
          {/* Rail + progression animée, derrière les pastilles. */}
          <div className="pointer-events-none absolute left-0 right-0 top-3.5 h-0.5 bg-border" aria-hidden />
          <motion.div
            className="pointer-events-none absolute left-0 top-3.5 h-0.5 bg-emerald-500"
            initial={false}
            animate={{ width: `${ratio * 100}%` }}
            transition={animate ? { duration: 0.6, ease: 'easeOut' } : { duration: 0 }}
            aria-hidden
          />

          {steps.map((step, i) => (
            <div
              key={step.key}
              ref={i === currentIndex ? currentRef : undefined}
              role="listitem"
              aria-current={i === currentIndex ? 'step' : undefined}
              className="relative flex w-28 shrink-0 flex-col items-center gap-1.5 sm:w-auto sm:flex-1"
              style={{ scrollSnapAlign: 'center' }}
            >
              <StepDot step={step} index={i} animate={animate} />
              <span className={cn('px-1 text-center text-[11px] leading-tight', LABEL_TONE[step.status])}>
                {step.label}
              </span>
              {step.hint && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                    step.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-muted text-muted-foreground'
                  )}
                >
                  {step.hint}
                </span>
              )}
              {/* Lecteurs d'écran : l'état n'est pas que visuel. */}
              <span className="sr-only">
                {step.status === 'done'
                  ? 'terminée'
                  : step.status === 'current'
                    ? 'en cours'
                    : step.status === 'error'
                      ? 'en erreur'
                      : step.status === 'not-required'
                        ? 'non requise'
                        : 'à venir'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {outcome.kind !== 'NONE' && (
        <p
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium',
            outcome.kind === 'CANCEL_AT_PERIOD_END' && 'bg-amber-100 text-amber-800',
            outcome.kind === 'ENDED' && 'bg-slate-100 text-slate-600',
            (outcome.kind === 'CANCELLED' || outcome.kind === 'FAILED') && 'bg-red-100 text-red-700'
          )}
        >
          {outcome.label}
        </p>
      )}
    </div>
  );
}

export default ContractProgressTracker;
