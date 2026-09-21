import * as React from 'react';
import { Check, Loader2, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SaveState } from '@/lib/saveState';

/**
 * Conteneur flottant partagé — le « dock » ancré en bas à droite.
 *
 * `fixed`  : pages pleine hauteur. Le défilement appartient au DOCUMENT (voir
 *            AppLayout) ; un élément fixé reste donc ancré au viewport sans le
 *            moindre écouteur de scroll. Aucun ancêtre entre l'`<Outlet/>` et
 *            `<body>` ne porte de `transform` — sinon `fixed` se recalerait
 *            dessus.
 * `absolute`: pour flotter au-dessus d'un conteneur défilant précis. Le parent
 *            doit être `relative`.
 * `sticky`  : DOCKÉ AU BAS D'UNE FRAME. Tant que la fin de la frame est sous le
 *            bas de la zone visible, le dock reste collé en bas de l'écran ;
 *            quand on atteint la fin de la frame, il s'y pose et défile avec
 *            elle. C'est le comportement de Drive / Notion / Linear, obtenu par
 *            `position: sticky` — sans un seul écouteur de défilement, donc
 *            sans saccade ni recalcul.
 *
 *            Le dock doit être le DERNIER enfant de la frame : sa position
 *            naturelle est ce point d'arrêt. `w-fit ml-auto` : il n'occupe que
 *            sa propre boîte et ne vole aucun clic au document.
 *
 * z-20 : sous le tiroir mobile (z-40) et les modales (z-50). Un bouton
 * d'enregistrement ne doit jamais passer par-dessus une boîte de dialogue.
 */
export function FloatingDock({
  anchor = 'fixed',
  className,
  children,
}: {
  anchor?: 'fixed' | 'absolute' | 'sticky';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'z-20 flex items-center gap-2',
        anchor === 'fixed' && 'fixed bottom-4 right-4 md:bottom-6 md:right-6',
        anchor === 'absolute' && 'absolute bottom-4 right-4',
        anchor === 'sticky' && 'sticky bottom-4 ml-auto w-fit',
        className
      )}
    >
      {children}
    </div>
  );
}

const COPY: Record<SaveState, string> = {
  idle: 'Enregistré',
  dirty: 'Enregistrer',
  saving: 'Enregistrement…',
  saved: 'Enregistré',
};

/**
 * Bouton d'enregistrement flottant — composant d'édition partagé du manager.
 *
 * Il répond en permanence à « mon travail est-il enregistré ? » sans que
 * l'utilisateur ait à remonter le formulaire :
 *
 *   idle    ✓ Enregistré      vert, désactivé
 *   dirty     Enregistrer     couleur principale, pulsation discrète
 *   saving    Enregistrement… spinner, désactivé
 *   saved   ✓ Enregistré      vert + animation de validation
 *
 * Le libellé reste écrit à toutes les tailles : c'est l'information, pas une
 * décoration. Seul le dock se resserre sur mobile.
 */
export function FloatingSaveWidget({
  state,
  onSave,
  anchor = 'fixed',
  before,
  className,
  shortcut = true,
}: {
  state: SaveState;
  onSave: () => void;
  anchor?: 'fixed' | 'absolute' | 'sticky';
  /** Rendu à GAUCHE du bouton (ex. le FAB « Ajouter une zone »). */
  before?: React.ReactNode;
  className?: string;
  /**
   * Ctrl/⌘+S déclenche l'enregistrement quand il y a du travail en attente.
   *
   * L'écouteur est posé sur `window` : DEUX widgets montés en même temps
   * enregistreraient tous les deux. Un seul widget à la fois par écran — si un
   * jour une page en widget ouvre une modale qui en contient un autre, passer
   * `shortcut={false}` sur celui du dessous.
   */
  shortcut?: boolean;
}) {
  const settled = state === 'idle' || state === 'saved';
  const busy = state === 'saving';

  // Ctrl/⌘+S : le réflexe existe, autant l'honorer plutôt que laisser le
  // navigateur proposer d'enregistrer la page HTML.
  React.useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.key === 's' && (e.ctrlKey || e.metaKey))) return;
      e.preventDefault();
      if (state === 'dirty') onSave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcut, state, onSave]);

  return (
    <FloatingDock anchor={anchor} className={className}>
      {before}
      {/* Région d'état séparée : `aria-live` ne peut pas vivre sur le bouton,
          qui est désactivé au repos — plusieurs lecteurs d'écran passent alors
          l'annonce sous silence, or c'est exactement l'information à dire. */}
      <span role="status" aria-live="polite" className="sr-only">
        {COPY[state]}
      </span>
      <button
        type="button"
        onClick={onSave}
        disabled={settled || busy}
        aria-busy={busy}
        title={state === 'dirty' ? 'Enregistrer (Ctrl+S)' : undefined}
        className={cn(
          'm-rise inline-flex h-12 items-center gap-2 rounded-full px-5 text-sm font-semibold shadow-lg',
          'transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
          'focus-visible:ring-offset-background disabled:cursor-default',
          state === 'dirty' &&
            'm-pulse bg-primary text-primary-foreground hover:opacity-90 focus-visible:ring-primary active:scale-95',
          busy && 'bg-primary text-primary-foreground opacity-90',
          // Vert littéral, pas la couleur de thème : « enregistré » doit se lire
          // comme un succès même si le thème du DEV est lui-même vert ou rouge.
          settled && 'bg-emerald-600 text-white shadow-emerald-600/20'
        )}
      >
        {busy && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
        {state === 'dirty' && <Save className="h-4 w-4 shrink-0" />}
        {settled && <Check key={state} className="m-pop h-4 w-4 shrink-0" />}
        <span>{COPY[state]}</span>
      </button>
    </FloatingDock>
  );
}

/**
 * Bouton d'action flottant rond (FAB) — pensé pour vivre dans un `FloatingDock`
 * à côté du widget d'enregistrement.
 */
export const Fab = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>(({ label, className, children, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    title={label}
    aria-label={label}
    className={cn(
      'm-rise inline-flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg',
      'transition-all duration-200 hover:bg-muted hover:shadow-xl active:scale-95',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      className
    )}
    {...props}
  >
    {children}
  </button>
));
Fab.displayName = 'Fab';
