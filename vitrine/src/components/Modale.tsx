import * as React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { useScrollLock } from '@/lib/scrollLock';

/**
 * LA FENÊTRE MODALE DU SITE — une seule, pour toutes.
 *
 * ══ POURQUOI ELLE EST PARTAGÉE ══════════════════════════════════════════════
 *
 * La fiche d'un kart et la grille tarifaire d'un forfait ont exactement le même
 * comportement : fond cliquable, croix, touche d'échappement, verrou de
 * défilement, hauteur fixe, corps défilant, même animation. Écrire deux fois
 * ces sept règles garantit qu'elles divergeront — et la divergence se verra
 * d'abord sur celle qu'on ouvre le moins, donc tard.
 *
 * ══ TROIS FAÇONS DE FERMER, ET C'EST VOULU ══════════════════════════════════
 *
 * La croix, le clic à côté, et `Échap`. Une fenêtre qui ne se ferme que par sa
 * croix se referme mal au doigt : la croix est la plus petite cible de
 * l'écran, et le geste naturel sur mobile est de toucher à côté.
 */
export function Modale({
  ouvert,
  onClose,
  eyebrow,
  titre,
  children,
  /**
   * La hauteur du panneau. FIXE par défaut, et c'est le point : une fenêtre
   * qui s'adapte à son contenu change de taille d'un élément à l'autre, et la
   * page semble sauter quand on en ferme une petite pour en ouvrir une grande.
   *
   * `dvh` et non `vh` : sur mobile, `vh` vaut la hauteur du viewport LARGE, et
   * le panneau passerait sous la barre d'adresse.
   */
  hauteur = 'min(82dvh, 44rem)',
  /** Largeur maximale — une grille tarifaire est plus étroite qu'une fiche. */
  largeurClassName = 'max-w-lg',
}: {
  ouvert: boolean;
  onClose: () => void;
  eyebrow?: string;
  titre: string;
  children: React.ReactNode;
  hauteur?: string;
  largeurClassName?: string;
}) {
  const sobre = useReducedMotion();

  /**
   * LE VERROU DE DÉFILEMENT EST COMPTÉ (voir `lib/scrollLock`) : deux surfaces
   * modales peuvent se superposer, et la première fermeture ne doit pas rendre
   * la page sous la seconde.
   */
  useScrollLock(ouvert);

  React.useEffect(() => {
    if (!ouvert) return undefined;
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', auClavier);
    return () => window.removeEventListener('keydown', auClavier);
  }, [ouvert, onClose]);

  return createPortal(
    <AnimatePresence>
      {ouvert && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          {/*
            LE FOND — cliquable, et il porte le `onClose`. Le panneau est un
            FRÈRE, pas un enfant : imbriqué, il faudrait arrêter la propagation
            de chaque clic à l'intérieur, et un clic sur une barre de
            défilement fermerait la fenêtre.
          */}
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden="true"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={titre}
            className={`relative flex w-full flex-col overflow-hidden rounded-3xl border shadow-2xl ${largeurClassName}`}
            style={{
              borderColor: 'var(--v-border)',
              background: 'var(--v-background)',
              height: hauteur,
            }}
            initial={sobre ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 24 }}
            animate={sobre ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={sobre ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* ── EN-TÊTE — hors du défilement : la croix reste atteignable ── */}
            <div
              className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3.5"
              style={{ borderColor: 'var(--v-border)' }}
            >
              <div className="min-w-0">
                {eyebrow && (
                  <p
                    className="text-[10px] font-bold uppercase tracking-[0.16em]"
                    style={{ color: 'var(--v-accent)' }}
                  >
                    {eyebrow}
                  </p>
                )}
                <p className="truncate text-sm font-extrabold">{titre}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="shrink-0 rounded-lg p-1.5 transition-colors hover:bg-[color-mix(in_srgb,var(--v-foreground)_10%,transparent)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/*
              LE CORPS DÉFILE, ET SON GESTE RESTE DEDANS.

              `overscroll-contain` : arrivé en butée, le geste ne repart pas
              dans la page derrière — sans quoi on lit la fenêtre pendant que
              le site défile dessous, et l'on perd sa place dans les deux.
            */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
