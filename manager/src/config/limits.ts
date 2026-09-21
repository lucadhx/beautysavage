/**
 * LES LIMITES DU CONTENU — MIROIR du backend, et vérifié comme tel.
 *
 * ══ POURQUOI UN MIROIR, ET NON UN IMPORT ════════════════════════════════════
 *
 * Le backend et le Manager sont deux applications séparées, buildées
 * séparément, déployées séparément. Le Manager n'importe rien de
 * `backend/src` : le faire embarquerait mongoose et zod côté serveur dans un
 * bundle de navigateur, et lierait la construction du Manager à l'arborescence
 * du backend.
 *
 * ══ ALORS COMMENT ÉVITER LA DÉRIVE ? ════════════════════════════════════════
 *
 * Par un TEST, pas par une bonne intention. `limits.parity.test.mjs` lit
 * `backend/src/utils/contentLimits.js` et compare les nombres un à un. Une
 * limite changée d'un seul côté fait échouer la recette du Manager.
 *
 * C'est précisément la dérive qui a produit le défaut d'origine : le serveur
 * refusait au-delà de trois chiffres clés, l'écran cachait son bouton au
 * troisième, et la graine en semait quatre. Trois valeurs, trois fichiers,
 * aucune vérification — et le propriétaire découvrait la contradiction en
 * cliquant sur « Enregistrer ».
 *
 * ══ CE QUE L'ÉCRAN EN FAIT ══════════════════════════════════════════════════
 *
 * Il ne s'en sert pas pour VALIDER — l'autorité reste le serveur — mais pour
 * ne jamais laisser construire un état qu'il refusera : `maxLength` sur les
 * champs, compteur quand la limite est serrée, bouton « Ajouter » désactivé
 * avec sa raison quand la liste est pleine.
 */

/** Les chiffres clés de l'accueil — section « Principes » de la vitrine. */
export const KEY_FIGURE_LIMITS = {
  maxItems: 4,
  valueMax: 24,
  labelMax: 120,
  iconMax: 40,
} as const;

/** Le contenu de la page d'accueil, section par section. */
export const HOME_CONTENT_LIMITS = {
  hero: {
    kickerMax: 60,
    titleMax: 80,
    subtitleMax: 320,
    labelMax: 40,
    urlMax: 200,
    proofs: { maxItems: 4, textMax: 60 },
  },
  showcase: {
    siteNameMax: 40,
    browserUrlMax: 60,
    navItems: { maxItems: 4, textMax: 24 },
    badgeMax: 60,
    headlineMax: 80,
    sublineMax: 140,
    ctaLabelMax: 32,
    cards: { maxItems: 3, titleMax: 32, textMax: 60 },
  },
  outcomes: {
    eyebrowMax: 40,
    titleMax: 90,
    leadMax: 220,
    items: { maxItems: 3, valueMax: 12, titleMax: 60, textMax: 180 },
  },
  positioning: { eyebrowMax: 40, titleMax: 90, textMax: 420 },
  trust: {
    eyebrowMax: 40,
    titleMax: 90,
    items: { maxItems: 4, titleMax: 60, textMax: 140 },
  },
  invitation: { titleMax: 90, textMax: 220, labelMax: 40, urlMax: 200 },
  iconMax: 40,
} as const;

/** Les chapitres du récit — titre, volets. */
export const CHAPTER_LIMITS = {
  titleMax: 160,
  items: { maxItems: 12, titleMax: 160 },
} as const;

/** Les pages éditoriales — titre, blocs. */
export const SITE_PAGE_LIMITS = {
  titleMax: 160,
  blocks: { maxItems: 60 },
} as const;

/**
 * LES MÉDIAS — miroir de `backend/src/services/media/mediaPolicy.js`.
 *
 * ══ POURQUOI L'ÉCRAN DOIT LES CONNAÎTRE ═════════════════════════════════════
 *
 * Le serveur contrôle déjà la taille et le format, et il refuse en français.
 * Mais il refuse APRÈS l'envoi : sur une connexion mobile, l'utilisateur a
 * attendu la montée complète d'un fichier de dix-huit méga-octets pour
 * apprendre qu'il en fallait quinze. La contrainte doit se lire avant de
 * choisir le fichier — c'est la règle générale des formulaires, et un envoi
 * est le cas où elle coûte le plus cher à ignorer.
 *
 * Les valeurs sont exprimées en MÉGA-OCTETS : c'est l'unité dans laquelle un
 * utilisateur voit ses fichiers, et la seule qui rende la phrase utile.
 */
export const MEDIA_LIMITS = {
  'company-logo': { maxMo: 12 },
  'company-favicon': { maxMo: 4 },
  hero: { maxMo: 15 },
  'chapter-image': { maxMo: 15 },
  'gallery-image': { maxMo: 15 },
  'team-photo': { maxMo: 8 },
  'page-image': { maxMo: 15 },
  'commerce-cover': { maxMo: 15 },
} as const;

/** Repli d'un type non listé — jamais plus permissif que le backend. */
export const MEDIA_DEFAULT_MAX_MO = 8;

/** Les formats réellement acceptés, dits comme un utilisateur les nomme. */
export const MEDIA_FORMATS_LISIBLES = 'JPEG, PNG, WebP, GIF, AVIF, TIFF ou SVG';

/**
 * LA PHRASE QUI DIT QU'UNE LISTE EST PLEINE — la même partout.
 *
 * Un bouton qui DISPARAÎT ne dit rien : l'utilisateur cherche ce qu'il a
 * cassé. Un bouton désactivé portant sa raison dit ce qui se passe et combien
 * il faut retirer pour en rajouter un.
 */
export function limiteAtteinte(max: number, quoi: string): string {
  return `${max} ${quoi} au maximum — retirez-en un pour en ajouter un autre.`;
}
