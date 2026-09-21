import * as React from 'react';
import { completedStep } from '@/lib/journey';
import type { ActivationStep } from '@/types';

/** Durée d'affichage de « ✓ étape terminée » avant l'écran suivant. */
export const CELEBRATION_MS = 1900;

/**
 * Détecte le franchissement d'une étape et pilote son accusé animé.
 *
 * `seed` sert au retour de paiement ou de signature : ce trajet est un rechargement
 * complet de l'application (on a quitté le site), l'étape précédente est donc
 * perdue. La page de retour, elle, SAIT ce qui vient d'aboutir : elle passe
 * l'étape franchie via l'état de navigation, et on la fête ici. Sans ce relais,
 * le retour de paiement afficherait l'écran suivant sans jamais confirmer que
 * le paiement est passé.
 */
export function useJourneyCelebration(step: ActivationStep | null | undefined, seed?: ActivationStep | null) {
  const [celebrating, setCelebrating] = React.useState<ActivationStep | null>(seed ?? null);
  const previous = React.useRef<ActivationStep | null>(null);

  React.useEffect(() => {
    if (!step) return;
    const done = completedStep(previous.current, step);
    previous.current = step;
    if (done) setCelebrating(done);
  }, [step]);

  React.useEffect(() => {
    if (!celebrating) return;
    const t = setTimeout(() => setCelebrating(null), CELEBRATION_MS);
    return () => clearTimeout(t);
  }, [celebrating]);

  return celebrating;
}

/**
 * Rafraîchit une ressource tant qu'une confirmation est attendue.
 *
 * Un webhook (paiement, signature) arrive quand il arrive : sans cela, l'écran
 * resterait bloqué sur l'étape précédente jusqu'à ce que l'utilisateur pense à
 * recharger — précisément ce qu'on veut supprimer.
 *
 * Deux garde-fous : on ne sonde QUE si l'onglet est visible (un onglet en
 * arrière-plan n'a rien à afficher, autant ne pas marteler l'API), et on
 * s'arrête dès que `active` est faux — le parcours terminé ne sonde plus.
 */
export function usePollWhile(active: boolean, reload: () => void, intervalMs = 5000) {
  const saved = React.useRef(reload);
  saved.current = reload;

  React.useEffect(() => {
    if (!active) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (document.visibilityState === 'visible') saved.current();
      timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, intervalMs);

    // Revenir sur l'onglet doit rafraîchir TOUT DE SUITE : c'est le cas typique
    // du retour de signature dans un autre onglet.
    const onVisible = () => {
      if (document.visibilityState === 'visible') saved.current();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, intervalMs]);
}
