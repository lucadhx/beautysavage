export interface MediaItem {
  key: string;
  label: string;
  icon: string;
  kind: 'tel' | 'email' | 'url' | 'handle' | 'text';
  value: string;
  enabled: boolean;
  order: number;
}

export interface Company {
  name: string;
  tagline: string;
  homeIntro: string;
  satisfiedClients: number;
  /**
   * LES CHIFFRES CLÉS DE L'ACCUEIL — trois au maximum, saisis au Manager.
   *
   * Optionnels : un backend antérieur ne les envoie pas, et l'accueil retombe
   * alors sur les chiffres DÉRIVÉS du contenu (voir `HomePage`).
   */
  keyFigures?: { _id?: string; value: string; label?: string; icon?: string; order?: number }[];
  media: MediaItem[];
  logos: { header: string; favicon: string };
  heroImage: string;
}

/* ══════════════════════════════════════════════════════════════════════════════
   UN CHAPITRE DU RÉCIT — le seul type de contenu structuré du site.

   Il remplace, à lui seul, les huit du moteur d'origine : forfaits, gammes de
   prix, flotte, tracés, avis, questions fréquentes, avant/après, bannières.
   L.Y Solution n'expose pas un catalogue ; elle expose une méthode, et une
   méthode a toujours la même forme — un sur-titre, un titre, un chapô, des
   volets, une phrase qui reste.

   `layout` dit COMMENT les volets se peignent, et c'est une donnée du
   chapitre : les mêmes volets rendus en piliers, en étapes ou en deux espaces
   ne disent pas la même chose.
   ══════════════════════════════════════════════════════════════════════════ */

export type ChapterLayout = 'PILLARS' | 'STEPS' | 'SPLIT';

export interface ChapterItem {
  _id?: string;
  icon: string;
  label: string;
  title: string;
  text: string;
  /** Adresse DÉJÀ RÉSOLUE par le serveur. Vide = le rendu ne peint rien. */
  image: string;
  order: number;
}

export interface ChapterStatement {
  label: string;
  text: string;
}

export interface Chapter {
  _id: string;
  slug: string;
  kicker: string;
  title: string;
  navLabel: string;
  lead: string;
  layout: ChapterLayout;
  items: ChapterItem[];
  statement: ChapterStatement;
  heroImage: string;
  showInNav: boolean;
  navOrder: number;
  seo?: { metaTitle: string; metaDescription: string };
  order: number;
}

/** Palette réduite : 4 couleurs de base, le reste est dérivé en CSS. */
export interface ThemeColors {
  background: string;
  foreground: string;
  primary: string;
  accent: string;
  menuBackground?: string;
  menuForeground?: string;
}
export interface Theme {
  colors: ThemeColors;
  typography?: { headingFont?: string; bodyFont?: string };
  radius: string;
}

export interface SiteStatus {
  status: 'ACTIVE' | 'SUSPENDED';
  reason: string;
  suspendedAt: string | null;
}

export interface Reference {
  type: 'TEXT' | 'LINK';
  icon: string;
  name: string;
  value: string;
}
export interface DevCompany {
  name: string;
  logo: string;
  slogan: string;
  references: Reference[];
}

export type SitePageBlockType =
  | 'HEADING' | 'RICH_TEXT' | 'IMAGE' | 'IMAGE_TEXT'
  | 'STATS' | 'FEATURES' | 'QUOTE' | 'CTA' | 'GALLERY' | 'TEAM';

export interface SitePageImage {
  _id?: string;
  url: string;
  alt: string;
  caption: string;
  order: number;
}

export interface SitePageBlockItem {
  _id?: string;
  icon: string;
  value: string;
  title: string;
  text: string;
  order: number;
  /**
   * ── PROPRES AU BLOC `TEAM` ────────────────────────────────────────────────
   *
   * Optionnels, et pas seulement pour la compatibilité : un backend antérieur
   * ne les envoie pas, et un élément de `STATS` ou de `FEATURES` n'en a aucun
   * usage. `title` porte alors le NOM de la personne et `text` sa biographie.
   */
  role?: string;
  image?: SitePageImage | null;
}

export interface SitePageBlock {
  _id?: string;
  type: SitePageBlockType;
  order: number;
  eyebrow: string;
  title: string;
  subtitle: string;
  /**
   * HTML DÉJÀ ASSAINI PAR LE SERVEUR (`backend/utils/richText.js`).
   *
   * C'est ce qui autorise l'injection directe dans le rendu. Le filtrer une
   * seconde fois ici demanderait une bibliothèque de plus, qui divergerait de
   * celle du serveur — et c'est toujours la plus permissive qui gagne.
   */
  html: string;
  text: string;
  author: string;
  image: SitePageImage | null;
  imageSide: 'LEFT' | 'RIGHT';
  images: SitePageImage[];
  items: SitePageBlockItem[];
  buttonLabel: string;
  buttonUrl: string;
  width: 'NARROW' | 'WIDE' | 'FULL';
  surface: boolean;
}

/** L'ENTRÉE d'une page — ce que le bootstrap porte, sans les blocs. */
export interface SitePageSummary {
  _id: string;
  title: string;
  slug: string;
  navLabel: string;
  showInNav: boolean;
  navOrder: number;
  intro: string;
  heroImage: string;
  order: number;
  seo?: { metaTitle: string; metaDescription: string };
}

/** La page COMPLÈTE — chargée à son ouverture. */
export interface SitePage extends SitePageSummary {
  blocks: SitePageBlock[];
}

/* ── DOCUMENTS LÉGAUX ─────────────────────────────────────────────────────
 *
 * Le CONTENU vient du Panel, déjà résolu : les valeurs de l'entreprise, du
 * concepteur et de l'hébergeur y sont substituées, et le site n'en détient
 * aucune copie modifiable. Il n'y a donc ni variable, ni gabarit, ni HTML —
 * seulement du texte dans trois formes.
 *
 * C'est ce qui rend l'affichage sûr par construction : un texte qui ne
 * contient aucune balise ne peut pas en injecter une.
 */
export type LegalDocumentType = 'LEGAL_NOTICE' | 'PRIVACY_POLICY';

export type LegalBlock =
  | { type: 'PARAGRAPH'; text: string }
  | { type: 'LIST'; items: string[] }
  | { type: 'FIELDS'; items: { label: string; value: string }[] };

export interface LegalSection {
  heading: string;
  blocks: LegalBlock[];
}

export interface LegalDocument {
  type: LegalDocumentType;
  title: string;
  /** Identifiant et version du template servi — utiles pour vérifier une publication. */
  templateId: string | null;
  templateVersion: number | null;
  documentVersion: number;
  updatedAt: string | null;
  sections: LegalSection[];
}
/* ══════════════════════════════════════════════════════════════════════════════
   LE CONTENU DE LA PAGE D'ACCUEIL — éditable, jusqu'au libellé des boutons.

   Tout est optionnel : un backend antérieur au modèle `HomeContent` n'envoie
   rien, et l'accueil retombe alors sur le nom et l'accroche de l'entreprise.
   Une page qui exigerait ce bloc rendrait un écran blanc pendant le temps
   d'un déploiement — la seule minute où personne ne peut le corriger.
   ══════════════════════════════════════════════════════════════════════════════ */

export interface HomeArgument {
  _id?: string;
  icon?: string;
  value?: string;
  title?: string;
  text?: string;
  order?: number;
}

export interface HomeContent {
  hero?: {
    kicker?: string;
    title?: string;
    subtitle?: string;
    primaryLabel?: string;
    primaryUrl?: string;
    secondaryLabel?: string;
    secondaryUrl?: string;
    proofs?: { _id?: string; icon?: string; text?: string }[];
    /**
     * L'image de fond de la bannière, RÉSOLUE par le backend. Absente, la
     * bannière retombe sur `company.heroImage` — le champ historique, que les
     * projets du parc renseignent encore.
     */
    image?: string;
    /** Descripteur du media : ses dimensions reservent la place de l image. */
    imageMedia?: { width?: number; height?: number } | null;
  };
  showcase?: {
    browserUrl?: string;
    siteName?: string;
    navItems?: string[];
    headline?: string;
    subline?: string;
    ctaLabel?: string;
    badge?: string;
    cards?: HomeArgument[];
    /** Adresse RÉSOLUE par le backend, comme toute autre image du bootstrap. */
    image?: string;
  };
  outcomes?: { eyebrow?: string; title?: string; lead?: string; items?: HomeArgument[] };
  positioning?: { eyebrow?: string; title?: string; text?: string };
  trust?: { eyebrow?: string; title?: string; items?: HomeArgument[] };
  invitation?: { title?: string; text?: string; buttonLabel?: string; buttonUrl?: string };
}

export interface BootstrapData {
  company: Company;
  /** Le contenu éditorial de l'accueil. Absent sur un backend antérieur. */
  home?: HomeContent;
  theme: Theme;
  siteStatus: SiteStatus;
  devCompany?: DevCompany;
  /**
   * L'entreprise qui édite et opère ce projet, telle que le PANEL la publie.
   * `websiteUrl` est `null` tant qu'aucun site n'est renseigné : le footer
   * affiche alors le nom sans lien.
   */
  developer?: { name: string; websiteUrl: string | null } | null;
  /**
   * LES CHAPITRES ARRIVENT ENTIERS — volets compris.
   *
   * C'est ce qui distingue leur traitement de celui des pages : l'accueil
   * peint ses sections à partir de ces volets, et un aller-retour par chapitre
   * se verrait au premier défilement.
   */
  chapters: Chapter[];
  /** Les ENTRÉES des pages éditoriales — leur contenu se charge à l'ouverture. */
  pages: SitePageSummary[];
  network: { backendUrl: string; websiteUrl: string };
  /**
   * CE QUE LE PIED DE PAGE PEUT PROPOSER — les libellés, jamais le contenu.
   *
   * Un lien codé en dur mènerait à une 404 sur un projet dont le Panel n'a
   * assigné aucun template : un lien mort en pied de chaque page.
   *
   * Optionnel : un backend antérieur ne l'envoie pas, et le pied n'affiche
   * alors simplement aucun lien légal.
   */
  legalDocuments?: { type: LegalDocumentType; title: string }[];
  suspended: boolean;
}
