import * as React from 'react';

/**
 * UN ÉCRAN QUI S'AFFICHE RESTE AFFICHÉ UN MOMENT.
 *
 * ══ LE DÉFAUT ═══════════════════════════════════════════════════════════════
 *
 * Le chargement dure ce qu'il dure : trois secondes sur un réseau mobile,
 * quarante millisecondes sur une réponse déjà en cache. Dans le second cas, le
 * loader apparaissait et disparaissait dans la même image — un clignotement
 * qui se lit comme un défaut d'affichage, jamais comme un chargement.
 *
 * On ne peut pas le corriger en n'affichant le loader qu'« au bout d'un
 * moment » : il faudrait alors deviner ce moment, et un chargement lent
 * n'afficherait rien pendant ce temps. On le corrige à l'autre bout — une fois
 * montré, l'écran tient une durée PLANCHER.
 *
 * @param actif   l'état réel (ex. « les données ne sont pas encore là »)
 * @param minimum durée plancher d'affichage, en millisecondes
 * @returns       l'état à afficher : vrai tant que l'un OU l'autre le veut
 */
export function useMinimumDuration(actif: boolean, minimum: number): boolean {
  const [retenu, setRetenu] = React.useState(actif);
  /** Quand l'affichage a commencé — `null` s'il n'a jamais commencé. */
  const depuis = React.useRef<number | null>(actif ? Date.now() : null);

  React.useEffect(() => {
    if (actif) {
      if (depuis.current === null) depuis.current = Date.now();
      setRetenu(true);
      return;
    }
    // Jamais affiché : il n'y a rien à tenir. C'est le cas d'un chargement
    // instantané où l'écran n'a même pas eu à paraître.
    if (depuis.current === null) {
      setRetenu(false);
      return;
    }
    const reste = minimum - (Date.now() - depuis.current);
    if (reste <= 0) {
      depuis.current = null;
      setRetenu(false);
      return;
    }
    const t = setTimeout(() => {
      depuis.current = null;
      setRetenu(false);
    }, reste);
    return () => clearTimeout(t);
  }, [actif, minimum]);

  return actif || retenu;
}
