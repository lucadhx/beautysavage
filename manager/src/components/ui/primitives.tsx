import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ---------------------------------- Button --------------------------------- */
/**
 * Exporté pour styler en bouton un élément qui n'en est pas un — typiquement un
 * `<a>` de téléchargement, qui doit rester un vrai lien (clic milieu, « ouvrir
 * dans un nouvel onglet ») tout en ayant l'allure d'un CTA.
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90',
        outline: 'border border-border bg-transparent hover:bg-muted',
        ghost: 'hover:bg-muted',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
        subtle: 'bg-muted text-foreground hover:bg-muted/70',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-12 px-6 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
);
Button.displayName = 'Button';

/* ---------------------------------- Input ---------------------------------- */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

/* -------------------------------- Textarea --------------------------------- */
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[80px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      className
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

/* ---------------------------------- Label ---------------------------------- */
export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn('text-sm font-medium text-foreground', className)} {...props} />
  );
}

/* ---------------------------------- Field ---------------------------------- */
/**
 * Champ de formulaire : libellé, aide, erreur — et le LIEN entre les trois.
 *
 * ─── POURQUOI CE CLONAGE D'ENFANT ────────────────────────────────────────────
 *
 * Un libellé posé À CÔTÉ d'un champ est un libellé pour l'œil seulement. Sans
 * `htmlFor`/`id`, un lecteur d'écran annonce « zone d'édition » sans dire
 * laquelle ; et un message d'erreur non relié par `aria-describedby` n'est
 * jamais lu — l'utilisateur entend qu'il ne peut pas valider, sans savoir
 * pourquoi. On génère donc un identifiant et on l'injecte dans l'enfant.
 *
 * Le clonage n'écrase JAMAIS un attribut déjà fourni par l'appelant : un champ
 * qui gère lui-même son `id` ou son `aria-describedby` garde le sien.
 */
export function Field({
  label,
  hint,
  error,
  children,
  className,
  count,
  max,
  htmlFor,
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
  /**
   * ── QUAND LE CLONAGE NE PEUT PAS ATTEINDRE LE CHAMP ──────────────────────
   *
   * Le clonage ci-dessous ne touche que l'enfant DIRECT. Deux formes très
   * ordinaires le mettent en échec, et toutes deux existaient dans le
   * Manager :
   *
   *   · le champ est enveloppé (`<div class="relative">` pour poser une icône
   *     en absolu) — l'identifiant part alors sur le DIV, et le libellé
   *     désigne un conteneur qui n'est pas un champ ;
   *   · le `Field` porte PLUSIEURS enfants — `React.isValidElement` est faux,
   *     et plus rien n'est injecté du tout.
   *
   * Dans les deux cas le résultat est le même et il est silencieux : un
   * lecteur d'écran annonce « zone d'édition », sans dire laquelle. C'est ce
   * qui s'est produit sur l'adresse e-mail de « Mon profil ».
   *
   * `htmlFor` rend le lien EXPLICITE : l'appelant pose un `id` sur son champ
   * et le nomme ici. Aucune magie, et rien à deviner.
   */
  htmlFor?: string;
  /**
   * ── LA CONTRAINTE SE VOIT AVANT LA SOUMISSION ────────────────────────────
   *
   * `count` + `max` affichent « 37 / 40 » à droite du libellé. Le compteur
   * n'est PAS une validation — `maxLength` sur le champ empêche déjà de
   * dépasser — c'est l'information qui rend ce blocage compréhensible : sans
   * lui, un champ qui cesse d'accepter des lettres se lit comme un clavier
   * cassé.
   *
   * Il n'apparaît qu'à l'approche de la limite (80 %). Un compteur permanent
   * sur vingt champs transforme un formulaire en tableau de bord et détourne
   * l'attention de ce qu'il y a à écrire.
   */
  count?: number;
  max?: number;
}) {
  const id = React.useId();
  const fieldId = `${id}-field`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const showHint = Boolean(hint) && !error;
  const describedBy = error ? errorId : showHint ? hintId : undefined;
  const compteur =
    typeof count === 'number' && typeof max === 'number' && count >= max * 0.8;

  const childProps = (React.isValidElement(children) ? children.props : {}) as Record<string, unknown>;
  // Le libellé doit pointer l'identifiant RÉELLEMENT porté par le champ, pas
  // celui qu'on aurait aimé lui donner. `htmlFor` prime : l'appelant sait où
  // vit son champ mieux que ce clonage.
  const effectiveId = htmlFor ?? (childProps.id as string | undefined) ?? fieldId;

  // Avec un `htmlFor` explicite, on ne clone plus rien : l'appelant a pris la
  // main, et injecter un second identifiant écraserait le sien.
  const child = !htmlFor && React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id: effectiveId,
        'aria-invalid': childProps['aria-invalid'] ?? (error ? true : undefined),
        'aria-describedby': childProps['aria-describedby'] ?? describedBy,
      })
    : children;

  return (
    <div className={cn('space-y-1.5', className)}>
      {(label || compteur) && (
        <div className="flex items-baseline justify-between gap-2">
          {label ? <Label htmlFor={effectiveId}>{label}</Label> : <span />}
          {compteur && (
            /*
              `aria-live="polite"` : un lecteur d'écran annonce l'approche de la
              limite pendant la frappe, au lieu de laisser l'utilisateur
              découvrir en silence que le champ n'accepte plus rien.
            */
            <span
              aria-live="polite"
              className={cn(
                'shrink-0 text-[11px] tabular-nums',
                count! >= max! ? 'font-medium text-amber-600' : 'text-muted-foreground',
              )}
            >
              {count} / {max}
            </span>
          )}
        </div>
      )}
      {child}
      {showHint && <p id={hintId} className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={errorId} className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/* ---------------------------------- Card ----------------------------------- */
// forwardRef : une carte sert parfois d'ancre (défilement vers une étape).
export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-lg border border-border bg-card shadow-sm', className)}
      {...props}
    />
  )
);
Card.displayName = 'Card';
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 border-b border-border', className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold', className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />;
}

/* --------------------------------- Switch ---------------------------------- */
/**
 * Toggle partagé — UNIQUE implémentation d'interrupteur du manager.
 *
 * État OFF : piste `--m-toggle-off` + bordure. L'ancien `bg-muted-foreground/30`
 * se confondait avec le fond des cartes — un toggle éteint doit rester
 * lisible (contraste AA), pas disparaître.
 *
 * Le rendu ne dépend PAS de la couleur de thème à l'état OFF : un thème clair
 * ne doit jamais rendre l'interrupteur invisible.
 */
export function Switch({
  checked,
  onChange,
  disabled,
  id,
  label,
  describedBy,
  size = 'default',
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
  /** Libellé accessible quand aucun texte n'est associé visuellement. */
  label?: string;
  describedBy?: string;
  size?: 'sm' | 'default';
  className?: string;
}) {
  const sm = size === 'sm';
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'group relative inline-flex shrink-0 items-center rounded-full border transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        sm ? 'h-5 w-9' : 'h-6 w-11',
        checked
          ? 'border-primary bg-primary hover:opacity-90'
          : 'border-[var(--m-toggle-off-border)] bg-[var(--m-toggle-off)] hover:bg-[var(--m-toggle-off-hover)]',
        className
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block transform rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-200',
          sm ? 'h-4 w-4' : 'h-5 w-5',
          // Piste `w-11` moins 2px de bordure = 42px ; pouce 20px ; 2px de marge
          // de chaque côté -> course de 20px (`translate-x-5`). Idem en `sm`.
          checked ? (sm ? 'translate-x-4' : 'translate-x-5') : 'translate-x-0.5'
        )}
      />
    </button>
  );
}

/* ------------------------------ FieldGroup --------------------------------- */
/**
 * Groupe de champs titré — la brique de section des écrans d'édition.
 *
 * Icône + titre + sous-titre : une section doit se repérer d'un coup d'œil et
 * dire à quoi elle sert, plutôt que d'aligner des champs nus. `aside` accueille
 * l'action de la section (un interrupteur, typiquement) : elle appartient au
 * titre, pas au contenu — sinon elle disparaît quand le contenu est replié.
 */
export function FieldGroup({
  icon: Icon,
  title,
  description,
  aside,
  children,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  aside?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-lg border border-border bg-card p-3.5 sm:p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {Icon && (
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0">
            <h4 className="text-sm font-semibold leading-tight">{title}</h4>
            {description && (
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      {children && <div className="mt-3.5">{children}</div>}
    </section>
  );
}

/* --------------------------- SegmentedControl ------------------------------ */
/**
 * Choix exclusif entre deux ou trois options — « Prix fixe / Sur devis ».
 *
 * Un `radiogroup`, pas des boutons indépendants : l'option retenue doit être
 * annoncée comme telle, et les flèches doivent naviguer. Chaque écran roulait
 * jusqu'ici sa propre version, avec des styles d'état divergents.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'default',
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  size?: 'sm' | 'default';
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 rounded-md border border-border bg-background p-0.5',
        className
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-[calc(var(--m-radius)-6px)] font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
              'focus-visible:ring-offset-background',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-xs',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------- Stepper ----------------------------------- */
/**
 * COMPTEUR ENTIER BORNÉ — « tous les [−] 3 [+] mois ».
 *
 * ══ POURQUOI PAS UN `<input type="number">` NU ══════════════════════════════
 *
 * Parce qu'il laisse composer ce qu'on ne veut pas voir. Son champ accepte
 * `-1`, `0`, `1.5`, `1e3` et la chaîne vide ; ses flèches natives sont
 * minuscules et absentes sur mobile ; et son `min` n'est qu'un signal de
 * validation — le navigateur laisse taper en dessous, il se contente de le
 * signaler à la soumission. Pour une périodicité de facturation, « composable
 * mais refusé plus tard » n'est pas acceptable : ce qui n'a pas de sens ne
 * doit pas pouvoir s'écrire.
 *
 * ══ LA SAISIE CLAVIER RESTE POSSIBLE ════════════════════════════════════════
 *
 * Deux boutons seuls auraient obligé à cliquer trente-cinq fois pour atteindre
 * 36. Le champ reste donc éditable, mais il est TENU : on n'y accepte que des
 * chiffres pendant la frappe, et la valeur est ramenée dans les bornes à la
 * sortie du champ. Un champ vidé revient au minimum plutôt que de propager
 * `NaN` — vider n'est pas choisir zéro.
 *
 * ══ ACCESSIBILITÉ ══════════════════════════════════════════════════════════
 *
 * `role="spinbutton"` et les trois `aria-value*` : un lecteur d'écran annonce
 * « 3, minimum 1, maximum 36 » plutôt qu'un champ de texte anonyme. Les flèches
 * haut/bas incrémentent, comme sur un compteur natif — c'est ce que l'attribut
 * promet, et le promettre sans le tenir serait pire que de se taire.
 */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 99,
  label,
  disabled = false,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  // Ce que le champ AFFICHE pendant la frappe. Distinct de `value` : effacer
  // pour retaper est un geste normal, et forcer le minimum à chaque touche
  // rendrait le champ inutilisable.
  const [brouillon, setBrouillon] = React.useState<string | null>(null);
  const borne = (n: number) => Math.min(max, Math.max(min, n));

  const pas = (delta: number) => {
    setBrouillon(null);
    onChange(borne((Number.isFinite(value) ? value : min) + delta));
  };

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md border border-border bg-background',
        disabled && 'pointer-events-none opacity-50',
        className
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => pas(-1)}
        disabled={value <= min}
        className="flex h-8 w-8 items-center justify-center rounded-l-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>

      <input
        type="text"
        inputMode="numeric"
        role="spinbutton"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        value={brouillon ?? String(value)}
        onChange={(e) => {
          // Seuls des chiffres entrent : ni signe, ni séparateur décimal, ni
          // notation exponentielle. `-1` et `1.5` ne sont pas « refusés plus
          // tard », ils ne s'écrivent pas.
          const chiffres = e.target.value.replace(/\D/g, '');
          setBrouillon(chiffres);
          if (chiffres !== '') onChange(borne(Number(chiffres)));
        }}
        onBlur={() => setBrouillon(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); pas(1); }
          if (e.key === 'ArrowDown') { e.preventDefault(); pas(-1); }
        }}
        className="h-8 w-10 border-x border-border bg-transparent text-center text-sm font-medium tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      />

      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => pas(1)}
        disabled={value >= max}
        className="flex h-8 w-8 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* --------------------------------- Badge ----------------------------------- */
export function Badge({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        className
      )}
      style={style}
    >
      {children}
    </span>
  );
}

/* -------------------------------- Spinner ---------------------------------- */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-muted-foreground', className)} />;
}

/* ------------------------------- EmptyState -------------------------------- */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-14 px-6 text-center">
      {Icon && <Icon className="mb-3 h-10 w-10 text-muted-foreground/60" />}
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
