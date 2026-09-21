import mongoose from 'mongoose';
import { mediaDescriptorSchema } from './mediaDescriptor.schema.js';

/**
 * UN CHAPITRE DU RÉCIT L.Y — et c'est le SEUL modèle de contenu structuré.
 *
 * ══ CE QU'IL REMPLACE, ET POURQUOI UN SEUL SUFFIT ═══════════════════════════
 *
 * Le moteur vient d'un projet de karting. Il y portait huit modèles de contenu
 * — `Service`, `Kart`, `Circuit`, `PricingRange`, `Review`, `Faq`,
 * `BeforeAfter`, `PromotionBanner` — parce qu'un circuit vend huit choses
 * différentes : des forfaits tarifés par gamme et par machine, une flotte, des
 * tracés, des avis, des questions fréquentes.
 *
 * L.Y Solution ne vend rien de tel. Elle expose une VISION en quatre chapitres
 * — Conception, Architecture, L'Expérience, Présenter un projet — et chacun a
 * exactement la même forme : un sur-titre, un titre, un chapô, une suite de
 * volets, et parfois une phrase qui les résume.
 *
 * Huit modèles pour une seule forme, c'était huit écrans de Manager, huit
 * routes, huit projections média et huit occasions de diverger. Un seul modèle
 * les remplace, et le `layout` dit COMMENT ses volets se peignent.
 *
 * ══ CE QU'IL N'EST PAS ══════════════════════════════════════════════════════
 *
 * Ce n'est PAS une page éditoriale : celles-ci existent déjà (`SitePage`),
 * composées de blocs libres, et servent ce que le client rédige au fil de
 * l'eau. Un chapitre est l'inverse — une structure FERMÉE, dessinée une fois,
 * dont seul le texte change. C'est ce qui permet à la vitrine de lui donner
 * une mise en scène propre au lieu d'un rendu de blocs générique.
 *
 * ══ AUCUN PRIX, NULLE PART ══════════════════════════════════════════════════
 *
 * Le plan de site est explicite : pas de page tarifs, pas de catalogue, pas de
 * grille. Un champ de montant ici finirait par s'afficher.
 */

/**
 * COMMENT LES VOLETS D'UN CHAPITRE SE PEIGNENT.
 *
 * C'est une donnée du chapitre, pas une constante de la vitrine : « Conception »
 * aligne des piliers, « L'Expérience » déroule des étapes numérotées, et
 * « Architecture » oppose deux espaces. Le même contenu rendu des trois façons
 * dirait trois choses différentes.
 */
export const CHAPTER_LAYOUTS = Object.freeze({
  /** Volets côte à côte, à égalité — « identité · direction · expérience ». */
  PILLARS: 'PILLARS',
  /** Volets numérotés, dans l'ordre — « 01 échange … 04 livraison ». */
  STEPS: 'STEPS',
  /** Deux faces opposées, puis ce qui les relie — « espace public / privé ». */
  SPLIT: 'SPLIT',
});
export const CHAPTER_LAYOUT_VALUES = Object.freeze(Object.values(CHAPTER_LAYOUTS));

/**
 * UN VOLET — un titre, un texte, et de quoi le distinguer à l'œil.
 *
 * `label` porte le mot de tête (« IDENTITÉ », « 01 — ÉCHANGE ») ; il est
 * distinct de `title` parce que le plan de site les distingue, et parce qu'un
 * rendu en étapes met le label en évidence là où un rendu en piliers le pose
 * en filet au-dessus du titre.
 *
 * `image` est FACULTATIVE et suit le contrat média du projet : le descripteur
 * fait autorité, la chaîne n'est qu'un repli, et l'adresse est dérivée à la
 * lecture (voir `mediaProjection.service.js`).
 */
const chapterItemSchema = new mongoose.Schema(
  {
    /** Nom d'icône Lucide — jamais un chemin d'image. */
    icon: { type: String, default: 'Minus' },
    label: { type: String, default: '', trim: true },
    title: { type: String, required: true, trim: true },
    text: { type: String, default: '' },
    image: { type: String, default: '' },
    imageMedia: { type: mediaDescriptorSchema, default: null },
    order: { type: Number, default: 0 },
  },
  { _id: true },
);

/**
 * LA PHRASE QUI RÉSUME LE CHAPITRE — « Nous ne choisissons pas un design. »
 *
 * Un sous-document plutôt que deux champs plats : vide, il n'existe pas, et le
 * rendu n'a pas à décider si une citation sans texte mais avec un auteur doit
 * s'afficher. Le plan de site l'appelle « PRINCIPE » sur Conception et
 * « MESSAGE CLÉ » sur Architecture — d'où `label`.
 */
const statementSchema = new mongoose.Schema(
  {
    label: { type: String, default: '', trim: true },
    text: { type: String, default: '', trim: true },
  },
  { _id: false },
);

const chapterSchema = new mongoose.Schema(
  {
    /**
     * LE SLUG EST L'ADRESSE, et il est saisi — jamais dérivé du titre.
     *
     * Dérivé, il changerait le jour où le client corrige une majuscule dans le
     * titre, et tous les liens déjà partagés mourraient en silence. Il est
     * unique : `/conception` ne peut pas désigner deux chapitres.
     */
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },

    /** Le sur-titre — « 02 / CONCEPTION ». Purement typographique. */
    kicker: { type: String, default: '', trim: true },
    title: { type: String, required: true, trim: true },
    /** Le libellé au menu, souvent plus court que le titre. */
    navLabel: { type: String, default: '', trim: true },
    /** Le chapô, sous le titre. Texte nu — jamais du HTML. */
    lead: { type: String, default: '' },

    layout: {
      type: String,
      enum: CHAPTER_LAYOUT_VALUES,
      default: CHAPTER_LAYOUTS.PILLARS,
    },

    items: { type: [chapterItemSchema], default: [] },
    statement: { type: statementSchema, default: () => ({}) },

    heroImage: { type: String, default: '' },
    heroImageMedia: { type: mediaDescriptorSchema, default: null },

    /**
     * LE CHAPITRE FIGURE-T-IL AU MENU ?
     *
     * Distinct de `published`, exactement comme sur `SitePage` : un chapitre
     * peut être en ligne et atteignable par un lien sans occuper une des
     * quatre places d'une barre de navigation qui en a quatre.
     */
    showInNav: { type: Boolean, default: true },
    navOrder: { type: Number, default: 0 },

    /**
     * RÉFÉRENCEMENT — vide veut dire « dérive-le du contenu ».
     *
     * On ne recopie pas le titre à la création : deux valeurs identiques
     * divergent à la première modification de l'une, et c'est toujours celle
     * qu'on ne voit pas qui reste en arrière.
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

// Sert la requête de la vitrine : find({ published }).sort({ navOrder, order })
chapterSchema.index({ published: 1, navOrder: 1, order: 1 });

export const Chapter = mongoose.model('Chapter', chapterSchema);
export default Chapter;
