import * as React from 'react';

/**
 * LE HAUT DE L'ÉCRAN RÉELLEMENT VISIBLE, PUBLIÉ DANS `--vv-top`.
 *
 * Sur mobile, `position: fixed; top: 0` colle un élément au haut du *layout
 * viewport* — pas au haut de ce que le visiteur voit. Or Safari iOS et Chrome
 * Android gardent un layout viewport à la taille « barre d'URL repliée » : dès
 * que cette barre est affichée (haut de page, remontée du doigt) ou pendant le
 * rebond en bas de page, la zone visible descend et la barre de navigation se
 * retrouve AU-DESSUS d'elle. Résultat vu par le visiteur : la top bar « part en
 * haut » et disparaît, puis revient d'un coup en fin de geste.
 *
 * `visualViewport.offsetTop` donne exactement cet écart. On le publie en
 * variable CSS ; la bannière promo et la navbar l'ajoutent à leur `top` et
 * restent collées au haut de l'écran VISIBLE, quel que soit l'état de la barre
 * d'URL. Sur desktop (et partout où le décalage est nul) la valeur vaut 0 : le
 * rendu est strictement identique à aujourd'hui.
 *
 * Pendant un zoom au doigt on ne corrige rien : l'élément serait à la bonne
 * place mais à la mauvaise échelle, ce qui est pire que de le laisser filer.
 */
export function useVisualViewportTop() {
  React.useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let frame = 0;
    const publish = () => {
      frame = 0;
      const top = vv.scale > 1.01 ? 0 : Math.max(0, Math.round(vv.offsetTop));
      document.documentElement.style.setProperty('--vv-top', `${top}px`);
    };
    // `scroll` sur le visual viewport se déclenche à chaque image d'un geste :
    // on n'écrit dans le DOM qu'une fois par frame.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(publish);
    };

    publish();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      document.documentElement.style.removeProperty('--vv-top');
    };
  }, []);
}
