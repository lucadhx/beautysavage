import mongoose from 'mongoose';
import { mediaDescriptorSchema } from './mediaDescriptor.schema.js';
import { sanitizeRichText } from '../utils/richText.js';

/**
 * UNE PAGE ÉDITORIALE DU SITE — composée de BLOCS, pas d'un champ de texte.
 *
 * ══ POURQUOI DES BLOCS ET PAS UN GRAND ÉDITEUR ══════════════════════════════
 *
 * Un seul champ de texte riche donne au rédacteur la liberté de tout casser :
 * il colle une image dans un paragraphe, elle sort à la taille du fichier ; il
 * met un titre en gras au lieu d'un `h2`, et la page perd sa structure. Le
 * rendu devient alors le reflet exact de la mise en forme du presse-papier.
 *
 * Un bloc, lui, PORTE SA MISE EN PAGE. « Image + texte » sait qu'il alterne
 * côté gauche et côté droit ; « Chiffres clés » sait qu'il s'aligne en grille ;
 * « Galerie » sait qu'elle est cliquable. Le rédacteur choisit CE QU'IL DIT ;
 * la vitrine décide COMMENT ça se voit. C'est ce qui rend une page saisie par
 * un client indiscernable d'une page dessinée.
 *
 * Le texte riche subsiste — dans le bloc qui est fait pour lui, et assaini.
 *
 * ══ LE HTML EST NETTOYÉ ICI, PAS DANS LE CONTRÔLEUR ═════════════════════════
 *
 * Un `setter` de schéma s'exécute sur TOUTE écriture : contrôleur, migration
 * d'import, script de réparation. Le poser dans une route laisserait entrer du
 * HTML non filtré par les deux autres chemins — et l'oubli ne se verrait qu'au
 * moment où il compte.
 */

/** Les natures de blocs. Le rendu de chacune vit dans la vitrine. */
export const BLOCK_TYPES = Object.freeze({
  /** Un titre de section, avec sur-titre optionnel. */
  HEADING: 'HEADING',
  /** Du texte mis en forme — paragraphes, listes, liens. */
  RICH_TEXT: 'RICH_TEXT',
  /** Une image seule, avec légende. */
  IMAGE: 'IMAGE',
  /** Une image et un texte côte à côte, l'image à gauche ou à droite. */
  IMAGE_TEXT: 'IMAGE_TEXT',
  /** Des chiffres clés en grille — « 730 m de piste », « 3 tracés ». */
  STATS: 'STATS',
  /** Des atouts en grille : icône, titre, texte. */
  FEATURES: 'FEATURES',
  /** Une citation mise en avant. */
  QUOTE: 'QUOTE',
  /** Un appel à l'action — titre, texte, bouton. */
  CTA: 'CTA',
  /** Une galerie d'images, cliquable. */
  GALLERY: 'GALLERY',
  /**
   * L'ÉQUIPE — une SECTION PAR PERSONNE, pas une grille de vignettes.
   *
   * ══ POURQUOI CE TYPE N'EST PAS « FEATURES AVEC UNE PHOTO » ════════════════
   *
   * Une grille de cartes traite les gens comme des arguments : quatre tuiles
   * de même taille, un portrait rogné en rond, deux lignes chacun. C'est le
   * rendu de « nos services », appliqué à des personnes — et il dit exactement
   * l'inverse de ce qu'une page « qui sommes-nous » cherche à dire.
   *
   * Ici chaque membre occupe SA section, en pleine largeur, portrait d'un côté
   * et texte de l'autre, le côté alternant d'une personne à la suivante. On
   * lit une personne à la fois, et on a le temps de la lire.
   *
   * C'est aussi ce qui rend la page utile quand elle ne porte qu'UNE personne :
   * une grille d'une seule carte a l'air d'attendre les autres.
   */
  TEAM: 'TEAM',
});
export const BLOCK_TYPE_VALUES = Object.freeze(Object.values(BLOCK_TYPES));

/** Largeur de rendu d'un bloc dans la colonne de lecture. */
export const BLOCK_WIDTHS = Object.freeze({ NARROW: 'NARROW', WIDE: 'WIDE', FULL: 'FULL' });
export const BLOCK_WIDTH_VALUES = Object.freeze(Object.values(BLOCK_WIDTHS));

/**
 * UNE IMAGE DANS UNE PAGE — même contrat que partout ailleurs dans ce projet.
 *
 * Le chemin est un REPLI ; le descripteur fait autorité, et l'adresse est
 * dérivée à la lecture. Une galerie qui stockerait des URL redeviendrait un
 * mur d'images cassées au premier changement de domaine.
 */
const pageImageSchema = new mongoose.Schema(
  {
    url: { type: String, default: '' },
    media: { type: mediaDescriptorSchema, default: null },
    alt: { type: String, default: '' },
    caption: { type: String, default: '' },
    order: { type: Number, default: 0 },
  },
  { _id: true },
);

/**
 * UN ÉLÉMENT de bloc `STATS`, `FEATURES` ou `TEAM` — trois formes, un schéma.
 *
 * `value` porte le chiffre d'une statistique ; `title` le titre d'un atout, ou
 * le NOM d'une personne ; `text` la ligne d'explication de l'un, la biographie
 * de l'autre. Les séparer en trois schémas obligerait à dupliquer l'icône,
 * l'ordre et le nettoyage — pour une distinction que seul le TYPE DU BLOC
 * tranche, et il le tranche déjà.
 *
 * Deux champs n'existent que pour `TEAM`, et ils sont nommés pour ce qu'ils
 * sont plutôt que réutilisés de biais. Faire porter la fonction par `value`
 * aurait économisé une ligne de schéma et coûté la lisibilité de chaque écran
 * qui les touche : personne ne devine que « valeur » veut dire « fonction ».
 */
const blockItemSchema = new mongoose.Schema(
  {
    icon: { type: String, default: 'Sparkles' },
    /** Le chiffre d'une statistique — « 730 m », « 3 ». Texte : l'unité compte. */
    value: { type: String, default: '' },
    title: { type: String, default: '' },
    text: { type: String, default: '' },

    /* ── TEAM ────────────────────────────────────────────────────────────── */
    /** La fonction de la personne — « Fondateur », « Conception d'interface ». */
    role: { type: String, default: '' },
    /**
     * Le portrait. Même contrat que toutes les images du projet : le
     * descripteur fait autorité, l'adresse en est dérivée à la lecture.
     *
     * Facultatif, et la vitrine le prévoit : une personne sans photo garde sa
     * section, avec ses initiales à la place du portrait. Un membre d'équipe
     * qui ne veut pas de sa photo en ligne est un cas ordinaire, pas une
     * fiche incomplète.
     */
    image: { type: pageImageSchema, default: null },
    order: { type: Number, default: 0 },
  },
  { _id: true },
);

const blockSchema = new mongoose.Schema(
  {
    type: { type: String, enum: BLOCK_TYPE_VALUES, required: true },
    order: { type: Number, default: 0 },

    /* ── HEADING ─────────────────────────────────────────────────────────── */
    eyebrow: { type: String, default: '' },
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },

    /* ── RICH_TEXT · IMAGE_TEXT · QUOTE ──────────────────────────────────── */
    /**
     * Le HTML de l'auteur, ASSAINI À L'ÉCRITURE. Voir `utils/richText.js` :
     * ce qui est stocké est déjà sûr, et la vitrine l'injecte sans filtrer une
     * seconde fois avec une autre bibliothèque.
     */
    html: { type: String, default: '', set: (v) => sanitizeRichText(v) },
    /** Texte NU — citation, légende. Jamais interprété comme du HTML. */
    text: { type: String, default: '' },
    /** L'auteur d'une citation. */
    author: { type: String, default: '' },

    /* ── IMAGE · IMAGE_TEXT ──────────────────────────────────────────────── */
    image: { type: pageImageSchema, default: null },
    /** De quel côté l'image se place dans un bloc « image + texte ». */
    imageSide: { type: String, enum: ['LEFT', 'RIGHT'], default: 'LEFT' },

    /* ── GALLERY ─────────────────────────────────────────────────────────── */
    images: { type: [pageImageSchema], default: [] },

    /* ── STATS · FEATURES ────────────────────────────────────────────────── */
    items: { type: [blockItemSchema], default: [] },

    /* ── CTA ─────────────────────────────────────────────────────────────── */
    buttonLabel: { type: String, default: '' },
    /**
     * La destination du bouton. Interne (`/contact`) ou externe (`https://…`).
     * Le rendu choisit `<Link>` ou `<a>` d'après la forme — l'auteur n'a pas à
     * déclarer laquelle, il colle simplement ce qu'il a.
     */
    buttonUrl: { type: String, default: '' },

    /* ── Commun ──────────────────────────────────────────────────────────── */
    width: { type: String, enum: BLOCK_WIDTH_VALUES, default: BLOCK_WIDTHS.NARROW },
    /**
     * Le bloc repose-t-il sur une surface décalée du fond ?
     *
     * C'est ce qui donne son RYTHME à une longue page : une alternance de
     * bandes. Laissé au rédacteur, parce que lui seul sait où sa page respire.
     */
    surface: { type: Boolean, default: false },
  },
  { _id: true },
);

const sitePageSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    /** Le libellé dans le menu — souvent plus court que le titre de la page. */
    navLabel: { type: String, default: '' },
    /**
     * LA PAGE FIGURE-T-ELLE AU MENU ?
     *
     * Distinct de `published` : une page peut être en ligne et atteignable par
     * un lien sans encombrer une barre de navigation qui n'a pas dix places.
     */
    showInNav: { type: Boolean, default: true },
    navOrder: { type: Number, default: 0 },

    /** Le chapô, sous le titre de la page. Texte nu. */
    intro: { type: String, default: '' },
    heroImage: { type: String, default: '' },
    heroImageMedia: { type: mediaDescriptorSchema, default: null },

    blocks: { type: [blockSchema], default: [] },

    /**
     * RÉFÉRENCEMENT — vide veut dire « dérive-le du contenu ».
     *
     * On ne recopie pas le titre dans `metaTitle` à la création : deux valeurs
     * identiques divergent à la première modification de l'une, et c'est
     * toujours celle qu'on ne voit pas qui reste en arrière.
     */
    seo: {
      metaTitle: { type: String, default: '' },
      metaDescription: { type: String, default: '' },
    },

    order: { type: Number, default: 0 },
    published: { type: Boolean, default: true },
  },
  { timestamps: true },
);

sitePageSchema.index({ published: 1, navOrder: 1 });

export const SitePage = mongoose.model('SitePage', sitePageSchema);
export default SitePage;
