import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useScrollLock } from '@/lib/scrollLock';
import { Button } from './primitives';

/** Ce qui peut recevoir le focus au clavier, dans l'ordre du document. */
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  /**
   * Une opération est en cours : la modale ne se ferme plus ni par Échap, ni
   * par un clic extérieur. Fermer pendant un enregistrement laisserait
   * l'utilisateur devant un écran qui ne reflète pas ce qu'il vient de lancer.
   */
  busy?: boolean;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  // onClose est souvent une lambda recréée à chaque render du parent ; on la
  // garde dans une ref pour ne PAS relancer l'effet de focus à chaque frappe
  // (sinon panelRef.focus() volerait le focus des inputs).
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const busyRef = React.useRef(busy);
  busyRef.current = busy;

  /*
    Gel de la page derrière la modale — verrou PARTAGÉ et compté.

    Il remplace un `document.body.style.overflow = 'hidden'` posé ici même :
    celui-ci ne bloquait pas le défilement tactile iOS, et deux modales
    imbriquées se marchaient dessus (la seconde fermée rendait le défilement
    alors que la première était encore ouverte). Voir lib/scrollLock.
  */
  useScrollLock(open);

  React.useEffect(() => {
    if (!open) return;
    /**
     * PIÈGE À FOCUS — le clavier ne sort pas de la modale.
     *
     * Sans lui, Tab poursuit dans la page derrière l'overlay : l'utilisateur au
     * clavier « quitte » une modale qu'il voit toujours, et peut actionner des
     * commandes qu'elle est censée bloquer.
     */
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!busyRef.current) onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const cibles = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (cibles.length === 0) { e.preventDefault(); panelRef.current.focus(); return; }
      const premier = cibles[0];
      const dernier = cibles[cibles.length - 1];
      const actif = document.activeElement;
      if (!panelRef.current.contains(actif)) { e.preventDefault(); premier.focus(); return; }
      if (e.shiftKey && actif === premier) { e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && actif === dernier) { e.preventDefault(); premier.focus(); }
    };
    window.addEventListener('keydown', onKey);
    // Déplace le focus dans la modale à l'ouverture (accessibilité clavier).
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      /*
        Restauration du focus — SANS défiler.

        `focus()` amène par défaut sa cible dans le champ de vision. Le
        déclencheur d'une modale vit souvent en haut de page (l'action de
        l'en-tête) : rendre le focus RAMENAIT donc la page tout en haut, juste
        après que le verrou de défilement ait rendu la position exacte. On
        rendait le focus et on volait la place dans la page.
      */
      prev?.focus?.({ preventScroll: true });
    };
  }, [open]);

  // `prefers-reduced-motion` : on garde le fondu, on retire le mouvement.
  const panneau = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : {
        initial: { opacity: 0, scale: 0.96, y: 12 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.96, y: 12 },
        transition: { type: 'spring' as const, duration: 0.3, bounce: 0.1 },
      };
  const fermer = () => { if (!busy) onClose(); };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={fermer}
          />
          {/*
            La modale ne dépasse JAMAIS l'écran : hauteur plafonnée au viewport
            visible (`--m-viewport-h`, donc `dvh` quand il existe) moins la
            marge de l'overlay. L'en-tête reste fixe, seul le corps défile — un
            unique défilement imbriqué, assumé. Avant, le corps était plafonné à
            `70vh` INDÉPENDAMMENT de l'en-tête : sur un petit écran, le total
            dépassait la hauteur visible et le bouton de fermeture sortait de
            l'écran.
          */}
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            className={cn(
              'relative z-10 flex max-h-[calc(var(--m-viewport-h)-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl focus:outline-none',
              className
            )}
            {...panneau}
          >
            <div className="flex shrink-0 items-start justify-between border-b border-border p-5">
              <div>
                {title && <h2 className="text-lg font-semibold">{title}</h2>}
                {description && (
                  <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
                )}
              </div>
              <button
                onClick={fermer}
                disabled={busy}
                aria-label="Fermer"
                className="rounded-md p-1 text-muted-foreground transition hover:bg-muted disabled:opacity-40"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Confirmer',
  description,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  loading,
  destructive,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  /** Une phrase, ou plusieurs quand l'état du contrat mérite une nuance. */
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  destructive?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} className="max-w-md" busy={loading}>
      {description && (
        typeof description === 'string'
          ? <p className="text-sm text-muted-foreground">{description}</p>
          : <div className="space-y-2 text-sm text-muted-foreground">{description}</div>
      )}
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? 'destructive' : 'default'}
          onClick={onConfirm}
          loading={loading}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
