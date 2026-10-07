import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
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

  /*
    DÉMONTAGE GARANTI — la modale ne laisse JAMAIS de voile derrière elle.

    La sortie reposait sur `AnimatePresence`, qui ne retire la couche qu'une
    fois TOUTES les animations de sortie déclarées terminées. Après une
    réservation manuelle avec choix d'un client, ce signal ne venait jamais :
    fond et fenêtre finissaient transparents, mais la couche `fixed inset-0`
    restait montée, invisible, et avalait chaque clic du planning jusqu'au
    rechargement de la page.

    La couche est désormais retirée par un minuteur, quoi qu'il arrive aux
    animations, et elle cesse de capter les clics dès le début de la sortie.
    Le contenu est figé pendant la sortie (titre et corps du dernier état
    ouvert), comme le faisait `AnimatePresence`.
  */
  const [mounted, setMounted] = React.useState(open);
  const shown = React.useRef({ title, description, children });
  if (open) shown.current = { title, description, children };
  React.useEffect(() => {
    if (open) { setMounted(true); return; }
    const t = window.setTimeout(() => setMounted(false), reduce ? 180 : 320);
    return () => window.clearTimeout(t);
  }, [open, reduce]);
  if (!mounted && !open) return null;
  const view = shown.current;

  return (
        <div className={cn('fixed inset-0 z-50 flex items-center justify-center p-4', !open && 'pointer-events-none')} aria-hidden={!open || undefined}>
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: open ? 1 : 0 }}
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
            aria-label={view.title}
            tabIndex={-1}
            className={cn(
              'relative z-10 flex max-h-[calc(var(--m-viewport-h)-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl focus:outline-none',
              className
            )}
            initial={panneau.initial}
            animate={open ? panneau.animate : panneau.exit}
            transition={panneau.transition}
          >
            <div className="flex shrink-0 items-start justify-between border-b border-border p-5">
              <div>
                {view.title && <h2 className="text-lg font-semibold">{view.title}</h2>}
                {view.description && (
                  <p className="mt-0.5 text-sm text-muted-foreground">{view.description}</p>
                )}
              </div>
              <button
                onClick={fermer}
                disabled={busy}
                aria-label="Fermer"
                className="-m-1.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted disabled:opacity-40"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{view.children}</div>
          </motion.div>
        </div>
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
