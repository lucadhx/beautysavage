/**
 * LES LIMITES DU CONTENU ÉDITORIAL — écrites UNE fois, ici.
 *
 * ══ LE DÉFAUT QUE CE MODULE FERME ═══════════════════════════════════════════
 *
 * Une même notion — « combien de chiffres clés » — portait TROIS réponses
 * différentes, chacune écrite de bonne foi à un moment différent :
 *
 *   · la graine en semait QUATRE ;
 *   · le validateur en refusait plus de TROIS ;
 *   · l'écran du Manager cachait son bouton « Ajouter » au TROISIÈME.
 *
 * Résultat vécu : le propriétaire ouvrait un écran portant quatre lignes qu'il
 * n'avait pas saisies, modifiait la première, cliquait « Enregistrer », et se
 * faisait refuser par le serveur pour une quatrième ligne qu'il n'avait ni
 * ajoutée ni pu retirer sans comprendre pourquoi. Aucune des trois valeurs
 * n'était « fausse » : c'est leur DISPERSION qui l'était.
 *
 * ══ LA RÈGLE ════════════════════════════════════════════════════════════════
 *
 * Toute limite qu'un utilisateur peut atteindre en éditant du contenu est
 * déclarée ICI, et nulle part ailleurs. Trois consommateurs la lisent :
 *
 *   · les validateurs zod          — l'AUTORITÉ, qui refuse ;
 *   · les graines et migrations    — qui ne doivent jamais semer un document
 *                                    que l'application refuserait ensuite ;
 *   · l'écran du Manager           — par `manager/src/config/limits.ts`, un
 *                                    MIROIR dont la parité est vérifiée par un
 *                                    test qui lit CE fichier.
 *
 * ══ D'OÙ VIENNENT CES NOMBRES ═══════════════════════════════════════════════
 *
 * D'aucune préférence : de ce que la vitrine SAIT RENDRE. Une rangée de
 * principes est une grille `lg:grid-cols-4` ; les tuiles de la maquette sont
 * découpées à trois (`slice(0, 3)`) ; le menu du site fictif à quatre. Un
 * cinquième élément n'aurait pas « débordé » : il aurait disparu en silence,
 * ce qui est pire — l'éditeur aurait cru publier quelque chose qui ne s'affiche
 * nulle part.
 *
 * Les longueurs, elles, sont posées AU-DESSUS de ce que la graine écrit, avec
 * de la marge : une limite qui invaliderait le contenu livré ne serait pas une
 * limite, ce serait un bug (cf. `docs/Controle qualité`, règle des graines).
 */

/* ══════════════════════════════════════════════════════════════════════════
   LES CHIFFRES CLÉS DE L'ACCUEIL — la section « Principes » de la vitrine
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * QUATRE, PARCE QUE LA VITRINE EN DESSINE QUATRE.
 *
 * `HomePage.tsx` rend cette section en `sm:grid-cols-2 lg:grid-cols-4`, avec
 * une numérotation « 01 … 04 ». Le refus à trois venait du moteur d'origine, où
 * la section alignait des CHIFFRES (« 10 000 m² de piste ») et non des mots ;
 * il a survécu au changement de métier sans que la graine, elle, le suive.
 *
 * Le libellé n'est plus un complément de deux mots mais une PHRASE — « Ce qui
 * vous distingue, avant ce qui vous ressemble. » —, d'où 120 caractères là où
 * l'ancien schéma en tolérait 40. C'est ce plafond-là, hérité, qui refusait la
 * graine livrée.
 */
export const KEY_FIGURE_LIMITS = Object.freeze({
  /** Nombre de tuiles — la grille de la vitrine en dessine quatre. */
  maxItems: 4,
  /** Le mot ou le nombre mis en avant : « Identité », « 10 000 m² ». */
  valueMax: 24,
  /** La phrase qui l'explique, sous le mot. */
  labelMax: 120,
  /** Nom d'icône lucide — borné pour ne pas stocker n'importe quoi. */
  iconMax: 40,
});

/* ══════════════════════════════════════════════════════════════════════════
   LE CONTENU DE LA PAGE D'ACCUEIL
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Les plafonds de la page d'accueil, section par section.
 *
 * Chaque nombre répond à une contrainte de RENDU, pas à un goût :
 *
 *   · `hero.title`      — la promesse tient en trois lignes à 1440 px ; la
 *                         graine a déjà été raccourcie une fois pour cela ;
 *   · `showcase.*`      — la maquette est rendue à ~40 % de sa taille : au-delà
 *                         de ces longueurs, le texte n'est plus lisible ;
 *   · `navItems`        — `DeviceShowcase` coupe à quatre (`slice(0, 4)`) ;
 *   · `showcase.cards`  — il coupe à trois (`slice(0, 3)`) ;
 *   · `outcomes.items`  — grille `md:grid-cols-3` ;
 *   · `trust.items`     — grille `lg:grid-cols-4`.
 *
 * Les trois `slice()` de la vitrine sont la raison d'être des trois `maxItems`
 * correspondants : sans refus côté serveur, la coupe reste SILENCIEUSE.
 */
export const HOME_CONTENT_LIMITS = Object.freeze({
  hero: Object.freeze({
    kickerMax: 60,
    titleMax: 80,
    subtitleMax: 320,
    labelMax: 40,
    urlMax: 200,
    proofs: Object.freeze({ maxItems: 4, textMax: 60 }),
  }),
  showcase: Object.freeze({
    siteNameMax: 40,
    browserUrlMax: 60,
    navItems: Object.freeze({ maxItems: 4, textMax: 24 }),
    badgeMax: 60,
    headlineMax: 80,
    sublineMax: 140,
    ctaLabelMax: 32,
    cards: Object.freeze({ maxItems: 3, titleMax: 32, textMax: 60 }),
  }),
  outcomes: Object.freeze({
    eyebrowMax: 40,
    titleMax: 90,
    leadMax: 220,
    items: Object.freeze({ maxItems: 3, valueMax: 12, titleMax: 60, textMax: 180 }),
  }),
  positioning: Object.freeze({ eyebrowMax: 40, titleMax: 90, textMax: 420 }),
  trust: Object.freeze({
    eyebrowMax: 40,
    titleMax: 90,
    items: Object.freeze({ maxItems: 4, titleMax: 60, textMax: 140 }),
  }),
  invitation: Object.freeze({ titleMax: 90, textMax: 220, labelMax: 40, urlMax: 200 }),
  /** Nom d'icône lucide, partout où une icône est choisie. */
  iconMax: 40,
});

/* ══════════════════════════════════════════════════════════════════════════
   LES CHAPITRES ET LES PAGES ÉDITORIALES
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * LES DEUX RÉFÉRENTIELS DE CONTENU — mêmes plafonds, même autorité.
 *
 * Ces nombres existaient déjà : `content.validator.js` les portait en clair
 * (`.max(160)`, `.max(12)`, `.max(60)`), et l'écran des chapitres RECOPIAIT le
 * douze dans un `disabled={volets.length >= 12}`. Deux écritures, aucun lien —
 * la configuration exacte qui a produit le défaut des chiffres clés, à ceci
 * près que les deux valeurs coïncidaient encore.
 *
 * Les longueurs, elles, n'étaient dites NULLE PART à l'utilisateur : un titre
 * de 161 caractères se composait sans obstacle et se refusait à
 * l'enregistrement.
 */
export const CHAPTER_LIMITS = Object.freeze({
  /** Le titre du chapitre, et celui de chacun de ses volets. */
  titleMax: 160,
  items: Object.freeze({ maxItems: 12, titleMax: 160 }),
});

export const SITE_PAGE_LIMITS = Object.freeze({
  titleMax: 160,
  /**
   * Soixante blocs : ce n'est pas une contrainte de rendu mais une garde de
   * VOLUME — au-delà, une page cesse d'être une page et le document devient
   * lourd à relire, à projeter et à publier.
   */
  blocks: Object.freeze({ maxItems: 60 }),
});

export default { KEY_FIGURE_LIMITS, HOME_CONTENT_LIMITS, CHAPTER_LIMITS, SITE_PAGE_LIMITS };
