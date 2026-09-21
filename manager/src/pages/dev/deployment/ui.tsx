/**
 * Kit d'interface premium partagé par l'expérience de déploiement.
 * Cartes élégantes, coins arrondis, ombres discrètes, animations fluides
 * (respect de `prefers-reduced-motion`). Aucun jargon technique.
 */
import * as React from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  Check,
  Loader2,
  X,
  AlertTriangle,
  MinusCircle,
  ArrowLeft,
  ArrowRight,
  Wand2,
  CloudUpload,
  FolderCog,
  Globe,
  ShieldCheck,
  RefreshCw,
  Rocket,
  Activity,
  BadgeCheck,
  Database,
  DatabaseZap,
  Copy,
  Settings2,
  UserPlus,
  PartyPopper,
  Server,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/primitives';

/* ------------------------------ Icônes ------------------------------ */

const ICONS: Record<string, LucideIcon> = {
  Wand2,
  CloudUpload,
  FolderCog,
  Globe,
  ShieldCheck,
  RefreshCw,
  Rocket,
  Activity,
  BadgeCheck,
  Database,
  DatabaseZap,
  Copy,
  Settings2,
  UserPlus,
  PartyPopper,
  Server,
};

export function DynIcon({ name, className }: { name: string; className?: string }) {
  const I = ICONS[name] ?? BadgeCheck;
  return <I className={className} />;
}

/* ------------------------------ Reveal ------------------------------ */

/** Apparition douce ; désactivée si l'utilisateur réduit les animations. */
export function Reveal({
  children,
  delay = 0,
  y = 8,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* --------------------------- Carte élégante --------------------------- */

export function Panel({
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border/70 bg-card p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-12px_rgba(16,24,40,0.12)]',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/* --------------------------- Carte d'action --------------------------- */

export function ActionCard({
  icon: Icon,
  art,
  title,
  description,
  cta,
  accent = 'primary',
  onClick,
}: {
  icon: LucideIcon;
  art?: React.ReactNode;
  title: string;
  description: string;
  cta: string;
  accent?: 'primary' | 'emerald';
  onClick: () => void;
}) {
  const reduce = useReducedMotion();
  const accentText = accent === 'emerald' ? 'text-emerald-500' : 'text-primary';
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={reduce ? undefined : { y: -4 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      className={cn(
        'group relative flex w-full flex-col items-start gap-4 overflow-hidden rounded-3xl border border-border/70 bg-card p-7 text-left',
        'shadow-[0_1px_2px_rgba(16,24,40,0.04),0_12px_32px_-16px_rgba(16,24,40,0.18)] transition-shadow hover:shadow-[0_1px_2px_rgba(16,24,40,0.06),0_20px_48px_-20px_rgba(16,24,40,0.28)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background'
      )}
    >
      {art && <div className={cn('pointer-events-none absolute -right-6 -top-4 h-40 w-40 opacity-[0.14]', accentText)}>{art}</div>}
      <span className={cn('inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-muted', accentText)}>
        <Icon className="h-6 w-6" />
      </span>
      <div className="space-y-1">
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <span className={cn('mt-2 inline-flex items-center gap-1.5 text-sm font-medium', accentText)}>
        {cta}
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </motion.button>
  );
}

/* ------------------------------ Stepper ------------------------------ */

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  const pct = steps.length > 1 ? (current / (steps.length - 1)) * 100 : 0;
  return (
    <div>
      <div className="relative mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s} className="flex items-center gap-1.5">
              <span
                className={cn(
                  'inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold transition-colors',
                  done && 'bg-primary text-primary-foreground',
                  active && 'bg-primary/15 text-primary ring-1 ring-primary/40',
                  !done && !active && 'bg-muted text-muted-foreground'
                )}
                aria-current={active ? 'step' : undefined}
              >
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className={cn('font-medium', active ? 'text-foreground' : 'text-muted-foreground')}>{s}</span>
              {i < steps.length - 1 && <span className="mx-1 hidden text-muted-foreground/40 sm:inline">·</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ---------------------------- Wizard shell ---------------------------- */

export function WizardShell({
  steps,
  current,
  title,
  subtitle,
  children,
  onBack,
  onNext,
  nextLabel = 'Suivant',
  backLabel = 'Précédent',
  nextDisabled,
  nextLoading,
  canBack = true,
  footer,
}: {
  steps: string[];
  current: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  backLabel?: string;
  nextDisabled?: boolean;
  nextLoading?: boolean;
  canBack?: boolean;
  footer?: React.ReactNode;
}) {
  return (
    <Panel className="mx-auto max-w-2xl p-7 sm:p-9">
      <Stepper steps={steps} current={current} />
      <div className="mt-7">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <AnimatePresence mode="wait">
        <StepFade key={current}>
          <div className="mt-6">{children}</div>
        </StepFade>
      </AnimatePresence>
      {footer ?? (
        <div className="mt-8 flex items-center justify-between">
          <Button variant="ghost" onClick={onBack} disabled={!canBack}>
            <ArrowLeft className="h-4 w-4" /> {backLabel}
          </Button>
          {onNext && (
            <Button onClick={onNext} disabled={nextDisabled} loading={nextLoading}>
              {nextLabel} <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}

function StepFade({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  if (reduce) return <div>{children}</div>;
  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* -------------------------- Progression radiale -------------------------- */

export function RadialProgress({
  value,
  size = 168,
  label,
  sublabel,
  state = 'running',
}: {
  value: number; // 0..1
  size?: number;
  label?: React.ReactNode;
  sublabel?: React.ReactNode;
  state?: 'running' | 'ok' | 'error';
}) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, value));
  const color = state === 'error' ? 'text-red-500' : state === 'ok' ? 'text-emerald-500' : 'text-primary';
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="stroke-muted" fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeLinecap="round"
          className={cn('fill-none', color)}
          stroke="currentColor"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - clamped) }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {label}
        {sublabel && <div className="mt-0.5 max-w-[70%] text-xs text-muted-foreground">{sublabel}</div>}
      </div>
    </div>
  );
}

/* ---------------------------- Ligne de phase ---------------------------- */

export type StepState = 'pending' | 'running' | 'ok' | 'warning' | 'error' | 'skipped' | 'cancelled';

export function StatusDot({ state }: { state: StepState }) {
  const base = 'inline-flex h-6 w-6 items-center justify-center rounded-full';
  if (state === 'ok') return <span className={cn(base, 'bg-emerald-100 text-emerald-600')} aria-label="réussie"><Check className="h-3.5 w-3.5" /></span>;
  if (state === 'error') return <span className={cn(base, 'bg-red-100 text-red-600')} aria-label="échouée"><X className="h-3.5 w-3.5" /></span>;
  if (state === 'warning') return <span className={cn(base, 'bg-amber-100 text-amber-600')} aria-label="avertissement"><AlertTriangle className="h-3.5 w-3.5" /></span>;
  if (state === 'running') return <span className={cn(base, 'bg-primary/10 text-primary')} aria-label="en cours"><Loader2 className="h-3.5 w-3.5 animate-spin" /></span>;
  if (state === 'skipped') return <span className={cn(base, 'bg-muted text-muted-foreground')} aria-label="ignorée"><MinusCircle className="h-3.5 w-3.5" /></span>;
  if (state === 'cancelled') return <span className={cn(base, 'bg-muted text-muted-foreground')} aria-label="annulée"><X className="h-3.5 w-3.5" /></span>;
  return <span className={cn(base, 'bg-muted text-muted-foreground/50')} aria-label="en attente">·</span>;
}

export function PhaseRow({
  icon,
  label,
  hint,
  state,
}: {
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  state: StepState;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors',
        state === 'running' && 'bg-primary/[0.04]',
        state === 'error' && 'bg-red-500/[0.04]'
      )}
    >
      <StatusDot state={state} />
      <div className="min-w-0 flex-1">
        <div className={cn('flex items-center gap-2 text-sm font-medium', state === 'pending' && 'text-muted-foreground')}>
          {icon}
          {label}
        </div>
        {hint && state !== 'pending' && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

/* --------------------------- Voir les détails --------------------------- */

export function DetailsDisclosure({ children, label = 'Voir les détails techniques' }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
        {label}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-3 rounded-xl border border-border/70 bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* --------------------------- Options avancées --------------------------- */

/**
 * Section repliable « Options avancées » — pour les réglages que l'utilisateur
 * courant n'a pas à voir (ex. l'utilisateur du serveur, préconfiguré sur root).
 * Contrairement à DetailsDisclosure, le contenu est un formulaire normal.
 */
export function AdvancedDisclosure({
  children,
  label = 'Options avancées',
  defaultOpen = false,
}: {
  children: React.ReactNode;
  label?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
        {label}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-3 space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------ Stat tile ------------------------------ */

export function StatTile({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon?: LucideIcon }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}
