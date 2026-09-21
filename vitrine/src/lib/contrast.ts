/**
 * LE TEXTE POSÉ SUR UN APLAT — calculé, jamais supposé.
 *
 * ══ POURQUOI CE FICHIER EST SÉPARÉ DE `theme.ts` ════════════════════════════
 *
 * Parce que le Manager en a besoin, et qu'il ne peut pas importer `theme.ts` :
 * ce dernier importe `@/lib/fontCatalog`, et l'alias `@` désigne un dossier
 * différent de chaque côté — il résoudrait le catalogue du Manager depuis un
 * fichier de la vitrine.
 *
 * L'aperçu du Manager doit pourtant obtenir EXACTEMENT la même couleur de
 * texte que le site, sinon il montre un bouton dont le libellé est lisible
 * chez lui et illisible en ligne. Recopier la formule dans le Manager aurait
 * produit deux implémentations qui divergent au premier ajustement, sans que
 * rien ne le signale — le défaut que ce dépôt combat partout ailleurs.
 *
 * Ce module n'importe donc RIEN. C'est ce qui le rend lisible par les deux
 * applications, comme `HeroBanner` et `DeviceShowcase`.
 *
 * ══ LE DÉFAUT QU'IL RÉPARE ═════════════════════════════════════════════════
 *
 * `index.css` fixait `--v-accent-foreground: #ffffff`, en dur. C'était juste
 * tant que tous les thèmes du parc avaient un accent sombre — un bleu, un
 * rouge. Ça cesse de l'être à la première marque dont la couleur est CLAIRE :
 * du blanc sur un jaune vif donne un contraste de 1,7:1, très en dessous du
 * seuil AA (4,5:1), et les libellés de boutons deviennent illisibles.
 *
 * Le piège est qu'une palette ne prévient pas : elle s'applique, le site reste
 * « joli » en vignette, et seul quelqu'un qui essaie de LIRE un bouton s'en
 * aperçoit.
 *
 * ══ POURQUOI CETTE FORMULE, ET PAS UNE MOYENNE DES CANAUX ═══════════════════
 *
 * La luminance relative WCAG linéarise chaque canal avant de les pondérer
 * (0,2126 / 0,7152 / 0,0722). Une moyenne simple traiterait le bleu comme le
 * vert, alors que l'œil y est six fois moins sensible — et rendrait « clair »
 * un aplat que personne ne voit clair.
 *
 * On compare ensuite les deux contrastes réellement disponibles, blanc et
 * noir, et on garde le meilleur. C'est un choix binaire assumé : une teinte
 * intermédiaire serait plus « raccord » et moins lisible, et ce jeton sert
 * exactement aux endroits où la lisibilité prime — boutons, badges, pastilles.
 *
 * @returns `#0a0a0a`, `#ffffff`, ou `null` si la couleur n'est pas lisible —
 *   auquel cas l'appelant garde le jeton tel quel plutôt que de poser du noir
 *   au hasard : le défaut connu vaut mieux qu'une valeur calculée sur une
 *   entrée qu'on n'a pas su lire.
 */
export function texteLisibleSur(couleur: string): string | null {
  const hex = String(couleur ?? '').trim().replace('#', '');
  const complet = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(complet)) return null;

  const canal = (i: number) => {
    const v = parseInt(complet.slice(i * 2, i * 2 + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);

  // Contraste WCAG : (Lclair + 0,05) / (Lsombre + 0,05).
  const contrasteBlanc = 1.05 / (L + 0.05);
  const contrasteNoir = (L + 0.05) / 0.05;
  return contrasteNoir > contrasteBlanc ? '#0a0a0a' : '#ffffff';
}

export default { texteLisibleSur };
