import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Un écran du parcours d'activation.
 *
 * Chaque étape est un ÉCRAN, pas un bouton qui change de libellé : illustration,
 * titre, explication, récapitulatif, action. C'est ce qui donne la sensation
 * d'avancer plutôt que de rester sur place.
 *
 * Responsive : l'illustration passe AU-DESSUS du texte sur mobile, plafonnée en
 * hauteur pour que le CTA reste dans l'écran — une illustration plein cadre
 * repousserait l'action sous la ligne de flottaison, exactement ce qu'on veut
 * éviter.
 */
export function JourneyStage({
  art,
  eyebrow,
  title,
  description,
  children,
  cta,
  note,
}: {
  art: React.ReactNode;
  /** Situe l'étape dans le parcours (« Étape 2 sur 4 »). */
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  /** Récapitulatif, montants, checklist — le corps propre à l'étape. */
  children?: React.ReactNode;
  cta?: React.ReactNode;
  note?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="grid items-center gap-6 md:gap-10 lg:grid-cols-[1fr_minmax(0,22rem)]">
      {/* Texte + action. `order` : l'illustration passe devant sur mobile. */}
      <div className="order-2 lg:order-1">
        {eyebrow && (
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-primary">{eyebrow}</p>
        )}
        <h2 className="text-xl font-bold leading-tight sm:text-2xl">{title}</h2>
        {description && (
          <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</div>
        )}
        {children && <div className="mt-5">{children}</div>}
        {cta && <div className="mt-6 flex flex-wrap items-center gap-3">{cta}</div>}
        {note && <div className="mt-3 text-xs text-muted-foreground">{note}</div>}
      </div>

      <motion.div
        className="order-1 mx-auto w-full max-w-[15rem] lg:order-2 lg:max-w-none"
        initial={reduce ? false : { opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        aria-hidden={false}
      >
        {art}
      </motion.div>
    </div>
  );
}

/**
 * « ✓ Signature terminée » — l'accusé de franchissement d'une étape.
 *
 * Volontairement bref et sans action : il s'efface seul pour laisser place à
 * l'étape suivante. Un bouton « Continuer » ici ferait payer à l'utilisateur un
 * clic pour une information qu'il a déjà comprise.
 */
export function StepCelebration({ label, className }: { label: string; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-4 py-14 text-center', className)}
      role="status"
      aria-live="polite"
    >
      <motion.span
        className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100"
        initial={reduce ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 20 }}
      >
        {!reduce && (
          <motion.span
            className="absolute inset-0 rounded-full bg-emerald-400"
            initial={{ scale: 1, opacity: 0.5 }}
            animate={{ scale: 1.7, opacity: 0 }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
          />
        )}
        <motion.span
          initial={reduce ? false : { scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.12 }}
        >
          <Check className="h-10 w-10 text-emerald-600" strokeWidth={3} />
        </motion.span>
      </motion.span>

      <motion.p
        className="text-lg font-semibold"
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18, duration: 0.3 }}
      >
        {label}
      </motion.p>
      <motion.p
        className="text-sm text-muted-foreground"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.3 }}
      >
        Étape suivante…
      </motion.p>
    </div>
  );
}

/**
 * Transition entre écrans : l'ancien s'efface, le nouveau glisse.
 *
 * `mode="wait"` : les deux écrans ne se croisent jamais — un fondu enchaîné
 * ferait clignoter deux CTA différents au même endroit.
 */
export const stageMotion = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.28, ease: 'easeOut' as const },
};
