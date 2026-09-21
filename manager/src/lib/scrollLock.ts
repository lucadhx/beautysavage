import * as React from 'react';

/**
 * VERROU DE DÉFILEMENT — un compteur, une restauration, jamais de fantôme.
 *
 * Le manager empile des surfaces qui doivent geler la page derrière elles : le
 * tiroir de navigation mobile, les modales, les boîtes de dialogue de
 * suppression. Chacune posait (ou oubliait de poser) son propre
 * `document.body.style.overflow = 'hidden'`. Deux défauts en découlaient :
 *
 *   1. la DERNIÈRE surface fermée rendait le défilement, même si une autre
 *      était encore ouverte — et inversement, une modale fermée pendant qu'une
 *      autre s'ouvrait pouvait laisser la page verrouillée pour de bon ;
 *   2. `overflow: hidden` sur `body` n'arrête PAS le défilement tactile sur
 *      iOS : la page continuait de glisser derrière l'overlay.
 *
 * D'où ce module unique :
 *
 *   - un COMPTEUR : le verrou tombe quand la dernière surface le relâche, pas
 *     quand la première le fait ;
 *   - `position: fixed` sur `body` avec mémorisation de la position, seule
 *     technique qui tienne sur iOS — la position est rendue à l'identique au
 *     déverrouillage, sans saut ;
 *   - une compensation de la largeur de l'ascenseur (desktop) : sans elle, la
 *     page se décale de ~15 px à chaque ouverture de modale ;
 *   - une fonction de libération IDEMPOTENTE : React 18 en mode strict monte,
 *     démonte et remonte les effets. Un `release()` appelé deux fois ne doit
 *     pas décrémenter deux fois, sinon le compteur passe sous zéro et une
 *     surface encore ouverte se retrouve déverrouillée.
 */

/** Ce que sait faire l'environnement : poser le verrou, et rendre de quoi le défaire. */
export interface ScrollLockAdapter {
  /** Applique le verrou et retourne la fonction qui restaure l'état d'avant. */
  apply(): () => void;
}

export interface ScrollLock {
  /** Pose un verrou. Retourne sa libération, appelable sans risque plusieurs fois. */
  lock(): () => void;
  /** Nombre de verrous actifs — diagnostic et tests. */
  depth(): number;
}

/**
 * Fabrique le verrou au-dessus d'un environnement donné.
 *
 * Le comptage est ici, PUR : il se teste sans DOM (voir scrollLock.test.mjs).
 */
export function createScrollLock(adapter: ScrollLockAdapter): ScrollLock {
  let depth = 0;
  let restore: (() => void) | null = null;

  return {
    lock() {
      depth += 1;
      if (depth === 1) restore = adapter.apply();
      let libere = false;
      return () => {
        // Idempotence : une libération déjà consommée ne compte plus.
        if (libere) return;
        libere = true;
        depth -= 1;
        if (depth === 0) {
          const defaire = restore;
          restore = null;
          defaire?.();
        }
      };
    },
    depth: () => depth,
  };
}

/** L'environnement réel : le `body` du document. */
const domAdapter: ScrollLockAdapter = {
  apply() {
    if (typeof document === 'undefined') return () => {};
    const body = document.body;
    const doc = document.documentElement;
    const y = window.scrollY;
    // Largeur de l'ascenseur : elle disparaît quand `body` passe en `fixed`.
    const ascenseur = Math.max(0, window.innerWidth - doc.clientWidth);

    const avant = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
    };

    body.style.position = 'fixed';
    body.style.top = `-${y}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    if (ascenseur > 0) body.style.paddingRight = `${ascenseur}px`;

    return () => {
      body.style.position = avant.position;
      body.style.top = avant.top;
      body.style.left = avant.left;
      body.style.right = avant.right;
      body.style.width = avant.width;
      body.style.overflow = avant.overflow;
      body.style.paddingRight = avant.paddingRight;
      // `scrollTo` instantané : on REND la position mémorisée, on ne l'anime pas.
      window.scrollTo(0, y);
    };
  },
};

/** Le verrou partagé par tout le manager. */
export const scrollLock = createScrollLock(domAdapter);

/**
 * Verrouille le défilement du document tant que `actif` est vrai.
 *
 * Le nettoyage de l'effet couvre les TROIS sorties possibles — fermeture
 * (`actif` repasse à faux), démontage du composant, et changement de route qui
 * démonte la page — sans dépendre d'une animation de sortie : le verrou tombe
 * quand l'état change, pas quand la transition se termine.
 */
export function useScrollLock(actif: boolean): void {
  React.useEffect(() => {
    if (!actif) return;
    return scrollLock.lock();
  }, [actif]);
}
