import * as React from 'react';

/**
 * LE VERROU DE SCROLL, COMPTÉ — un seul propriétaire ne peut plus déverrouiller
 * pour tout le monde.
 *
 * Trois composants gelaient la page chacun de leur côté en écrivant
 * `document.body.style.overflow` : le tiroir mobile, la visionneuse d'images et
 * la fiche d'avis. Deux d'entre eux ouverts en même temps (une image agrandie
 * DEPUIS une fiche d'avis, par exemple), et la fermeture du premier rendait la
 * page scrollable sous le second — ou, dans l'ordre inverse, laissait
 * `overflow: hidden` collé au body : le site refusait alors de descendre.
 *
 * On compte donc les demandeurs. Le style n'est posé qu'à la première prise et
 * n'est rendu qu'à la dernière, dans sa valeur d'origine. `<html>` est verrouillé
 * en plus de `<body>` : sur mobile, `body` seul laisse parfois la page glisser
 * derrière l'overlay.
 *
 * La position de scroll n'est volontairement PAS restaurée : une navigation
 * depuis le tiroir remet déjà la page en haut, et la rétablir ici annulerait ce
 * retour en haut.
 */
let holders = 0;
let saved: { html: string; body: string } | null = null;

export function lockScroll() {
  if (holders++ > 0) return;
  saved = {
    html: document.documentElement.style.overflow,
    body: document.body.style.overflow,
  };
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
}

export function unlockScroll() {
  if (holders === 0) return;
  if (--holders > 0) return;
  document.documentElement.style.overflow = saved?.html ?? '';
  document.body.style.overflow = saved?.body ?? '';
  saved = null;
}

/** Gèle la page tant que `active` est vrai. */
export function useScrollLock(active: boolean) {
  React.useEffect(() => {
    if (!active) return;
    lockScroll();
    return unlockScroll;
  }, [active]);
}
