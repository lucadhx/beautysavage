export type Role = 'DEV' | 'ADMIN';
export type ReferenceType = 'TEXT' | 'LINK';
export type SiteStatusValue = 'ACTIVE' | 'SUSPENDED';

/**
 * D'OÙ VIENT UNE IDENTITÉ (L12.B-UI).
 *
 * `LOCAL_USER` — un compte de CE projet, avec son mot de passe ici.
 * `PANEL_USER` — une identité L.Y Solution, administrée par le Panel. Ce projet
 *                n'en est pas propriétaire : ni mot de passe, ni suppression.
 */
export type PrincipalType = 'LOCAL_USER' | 'PANEL_USER';

export interface User {
  /**
   * `null` pour une identité fédérée : elle n'a AUCUN document local.
   *
   * Le champ reste dans le type parce que trente écrans le lisent ; le rendre
   * nullable force à traiter le cas plutôt qu'à découvrir un `undefined` à
   * l'exécution.
   */
  _id: string | null;
  email: string;
  name: string;
  role: Role;
  createdAt?: string;
  updatedAt?: string;

  /**
   * Présents UNIQUEMENT sur une identité fédérée — le backend ne les pose que
   * là. Leur absence signifie « compte local », et c'est ce que
   * `principalTypeOf()` lit.
   */
  principalType?: PrincipalType | 'PANEL';
  panelUserId?: string | null;
  source?: string;
}

/**
 * LE TYPE D'UNE IDENTITÉ, LU D'UNE SEULE FAÇON.
 *
 * Le backend marque `principalType: 'PANEL'` sur la vue rendue au manager.
 * Concentrer la lecture ici évite que chaque écran invente son propre test —
 * `user.source === …`, `!user._id`, `user.panelUserId != null` — dont l'un
 * finirait par être faux.
 */
export function principalTypeOf(user: User | null | undefined): PrincipalType {
  if (!user) return 'LOCAL_USER';
  return user.principalType === 'PANEL' || user.principalType === 'PANEL_USER'
    ? 'PANEL_USER'
    : 'LOCAL_USER';
}

/** Cette identité est-elle administrée par le Panel ? */
export function isPanelPrincipal(user: User | null | undefined): boolean {
  return principalTypeOf(user) === 'PANEL_USER';
}

/* ── LE SUIVI D'UN DÉPLOIEMENT PERSISTANT ────────────────────────────────── */

/** L'état d'une étape tel que le BACKEND le persiste — jamais une estimation. */
export interface DeploymentRunStepSnapshot {
  id: string;
  label: string | null;
  status: 'pending' | 'running' | 'ok' | 'warning' | 'error' | 'skipped' | 'cancelled';
  publicMessage: string | null;
  errorCode: string | null;
  critical: boolean;
  startedAt: string | null;
  finishedAt: string | null;
}

/**
 * L'INSTANTANÉ D'UN RUN — de quoi reconstruire la checklist sans avoir assisté
 * au début.
 *
 * C'est la seule source d'où l'écran tire son état. Les événements reçus
 * ensuite ne font que remplacer cet instantané par un plus récent : il n'existe
 * aucun état accumulé côté navigateur qu'un démontage pourrait perdre.
 */
export interface DeploymentRunSnapshot {
  id: string;
  targetId: string;
  targetName: string;
  operationType: string;
  env: string | null;
  status: string;
  /** `true` tant que le moteur peut encore écrire dans ce run. */
  active: boolean;
  currentStepId: string | null;
  finalStepId: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  updatedAt: string | null;
  siteUrl: string | null;
  managerUrl: string | null;
  version: string | null;
  user: string | null;
  errorSummary: unknown;
  steps: DeploymentRunStepSnapshot[];
  /** Dérivée de l'état : deux instantanés identiques portent la même valeur. */
  revision: string;
}

/**
 * `active` et `latest` répondent à deux questions différentes, et les confondre
 * ferait présenter l'échec d'hier comme un déploiement en cours.
 */
export interface DeploymentActiveRun {
  active: boolean;
  run: DeploymentRunSnapshot | null;
  latest: DeploymentRunSnapshot | null;
}

/** Ce que le flux d'observation émet. Toujours un instantané COMPLET. */
export type DeploymentObserveEvent =
  | { type: 'run.snapshot'; snapshot: DeploymentRunSnapshot }
  | { type: 'run.closed'; status: string; snapshot: DeploymentRunSnapshot | null };

/* ── LE WIDGET DE CONNEXION RAPIDE — ENVIRONNEMENT TEST (L12.D) ───────────── */

/** D'où vient l'identité, dans la représentation canonique du projet. */
export type AccountSource = 'LOCAL' | 'PANEL';

/** L'état d'un compte, dit pour un écran. */
export type AccountStatus = 'ACTIVE' | 'DISABLED' | 'PENDING_ACTIVATION';

/**
 * UN COMPTE DU PROJET, DANS LA REPRÉSENTATION CANONIQUE DU BACKEND.
 *
 * C'est ce que rend `GET /accounts` — la même vue que le pont sert au Panel
 * (`projectAccountView.js` côté serveur, champ pour champ).
 *
 * ══ POURQUOI CE TYPE N'EST PAS `User` ══════════════════════════════════════
 *
 * L'écran des comptes lisait `User`, c'est-à-dire le document Mongoose
 * sérialisé : `_id`, `name`. Le jour où la liste est passée à la vue
 * canonique, elle a rendu `id` et `displayName` — et l'écran, qui compilait
 * toujours, a cessé de trouver le moindre identifiant. Éditer un compte
 * rouvrait le formulaire en création, et supprimer ne faisait rien.
 *
 * Le type décrit donc ce que la route rend VRAIMENT. Un prochain écart de
 * contrat deviendra une erreur de compilation, là où celui-ci n'a produit
 * qu'un silence.
 */
export interface ProjectAccountView {
  /** Identifiant STABLE dans le périmètre du projet. */
  id: string;
  displayName: string;
  email: string;
  /** TOUJOURS un rôle de PROJET. */
  role: Role;
  source: AccountSource;
  principalType: PrincipalType;
  enabled: boolean;
  status: AccountStatus;
  /** `null` pour un compte local : il n'est synchronisé de nulle part. */
  lastSyncedAt: string | null;
  createdAt: string | null;
}

/**
 * COMMENT ON ENTRE, SELON CE QU'ON EST.
 *
 * `LOCAL_TEST`     le mécanisme de recette du projet — une session LOCALE.
 * `FEDERATED_TEST` le VRAI parcours fédéré — Panel, assertion signée, callback.
 *
 * C'est la nature du principal qui décide, jamais une préférence d'écran : un
 * `LOCAL_TEST` sur une identité Panel supposerait de lui inventer un compte
 * local, donc un mot de passe.
 */
export type TestLoginMode = 'LOCAL_TEST' | 'FEDERATED_TEST';

/** Pourquoi une ligne n'est pas cliquable. `null` quand elle l'est. */
export type TestLoginBlocker = 'PANEL_NOT_PAIRED' | 'PANEL_ACCESS_REVOKED' | 'LOCAL_DISABLED';

/**
 * LA FORME CANONIQUE D'UNE LIGNE DU WIDGET — UNE seule, pour les DEUX
 * populations.
 *
 * L'écran distingue les catégories par `source` et `principalType`, jamais par
 * la forme de l'objet : deux formes différentes obligeraient chaque composant à
 * deviner laquelle il tient, et l'un d'eux finirait par se tromper.
 */
export interface TestLoginAccount {
  id: string;
  displayName: string;
  email: string;
  /** TOUJOURS un rôle de PROJET. Un SUPER_ADMIN du Panel arrive ici en `DEV`. */
  role: Role;
  source: AccountSource;
  principalType: PrincipalType;
  enabled: boolean;
  status: AccountStatus;
  loginMode: TestLoginMode;
  /**
   * `false` ne veut pas dire « refusé » : l'autorisation appartient au Panel,
   * qui la tranche à l'émission de l'assertion. Cela veut dire « inutile
   * d'essayer », et cela évite un bouton dont on sait déjà qu'il échouera.
   */
  connectable: boolean;
  blockedReason: TestLoginBlocker | null;
}

/** La réponse de `GET /auth/test-accounts`. Vide et fermée hors TEST. */
export interface TestLoginDescription {
  enabled: boolean;
  environment: string;
  federation: { available: boolean; paired: boolean };
  accounts: TestLoginAccount[];
  labels: Record<AccountSource, string>;
}

export interface MediaItem {
  key: string;
  label: string;
  icon: string;
  kind: 'tel' | 'email' | 'url' | 'handle' | 'text';
  value: string;
  enabled: boolean;
  order: number;
}

/**
 * Signataire contractuel d'une entreprise. `null` = non configuré.
 *
 * Deux porteurs, et un seul est encore vivant côté fiche locale :
 *   · `DevCompany.signer`   — publié par le Panel, lecture seule ici ;
 *   · `Company.signer`      — INERTE (voir le champ).
 *
 * Voir docs/CONTRACT_SIGNERS.md.
 */
export interface CompanySigner {
  firstName: string;
  lastName: string;
  jobTitle: string;
  email: string;
}

/**
 * DESCRIPTEUR STABLE D'UN MÉDIA — ce qu'une fiche conserve d'une image.
 *
 * Aucune adresse : l'identité d'un média est sa clé d'objet et son empreinte.
 * L'URL en est DÉRIVÉE à la lecture, contre la destination active du moment.
 *
 * C'est ce qui permet de configurer un projet AVANT son premier déploiement :
 * il n'a alors aucune adresse publique, et il n'en a pas besoin.
 */
export interface StoredMediaDescriptor {
  mediaId?: string | null;
  objectKey: string;
  /** TEST ou PROD — un média ne franchit jamais cette frontière. */
  environment?: 'TEST' | 'PROD' | null;
  mediaType?: string | null;
  sha256?: string | null;
  mime?: string | null;
  size?: number | null;
  width?: number | null;
  height?: number | null;
  version?: number | null;
}

export interface Company {
  _id: string;
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
  /** Chemins de stockage — repli historique, plus l'autorité. */
  logos: { header: string; favicon: string };
  /** LA SOURCE DE VÉRITÉ des médias de marque. */
  logosMedia?: {
    header?: StoredMediaDescriptor | null;
    favicon?: StoredMediaDescriptor | null;
  } | null;
  heroImage: string;
  heroImageMedia?: StoredMediaDescriptor | null;
  /**
   * ADRESSES D'AFFICHAGE — calculées par le serveur à chaque lecture, jamais
   * renvoyées en enregistrant. Indexé par le chemin du média.
   */
  mediaResolution?: Record<string, { url: string | null; published: boolean; fromDescriptor: boolean }>;
  /**
   * INERTE. Le signataire CLIENT est désormais porté par l'entreprise cliente
   * publiée par le Panel (`MyCompanyView.profile.contractualSigner`). Ce champ
   * survit en base pour les fiches historiques ; le serveur l'ignore en
   * écriture et plus rien ne le lit. Ne pas le réafficher, ne pas l'éditer.
   * Voir docs/CLIENT_COMPANY.md.
   */
  signer: CompanySigner | null;
}

/* ══════════════════════════════════════════════════════════════════════════════
   LE CONTENU DU SITE — deux types, et deux seulement.

   `Chapter` porte le récit structuré (Conception, Architecture, L'Expérience) ;
   `SitePage` porte les pages libres composées de blocs. Ils sont le MIROIR des
   schémas mongoose correspondants : ils ne décrivent pas un formulaire, ils
   décrivent ce que l'API rend et accepte. Un champ ajouté au modèle et oublié
   ici disparaîtrait à l'enregistrement, parce que l'écran ne le renvoie pas.
   ══════════════════════════════════════════════════════════════════════════ */

/** Comment les volets d'un chapitre se peignent. Miroir de `CHAPTER_LAYOUTS`. */
export type ChapterLayout = 'PILLARS' | 'STEPS' | 'SPLIT';

export interface ChapterItem {
  _id?: string;
  icon: string;
  label: string;
  title: string;
  text: string;
  image: string;
  imageMedia?: StoredMediaDescriptor | null;
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
  heroImageMedia?: StoredMediaDescriptor | null;
  showInNav: boolean;
  navOrder: number;
  seo: { metaTitle: string; metaDescription: string };
  order: number;
  published: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/* ══════════════════════════════════════════════════════════════════════════════
   LE CONTENU DE LA PAGE D'ACCUEIL

   Un seul document, édité par l'écran « Accueil ». Tous les champs sont
   optionnels côté type : le backend rend un document vide tant que rien n'a
   été saisi, et un formulaire qui exigerait ces clés planterait sur une base
   neuve — c'est-à-dire à la seule minute où personne ne sait encore quoi
   corriger.
   ══════════════════════════════════════════════════════════════════════════════ */

export interface HomeArgument {
  _id?: string;
  icon?: string;
  value?: string;
  title?: string;
  text?: string;
  order?: number;
}

export interface HomeProof {
  _id?: string;
  icon?: string;
  text?: string;
  order?: number;
}

export interface HomeContent {
  _id?: string;
  hero?: {
    kicker?: string;
    title?: string;
    subtitle?: string;
    primaryLabel?: string;
    primaryUrl?: string;
    secondaryLabel?: string;
    secondaryUrl?: string;
    proofs?: HomeProof[];
    /** Le CHEMIN stocké. L'adresse d'affichage arrive dans `heroImageUrl`. */
    image?: string;
    imageMedia?: { width?: number | null; height?: number | null } | null;
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
    /** Le CHEMIN stocké. L'adresse d'affichage arrive dans `showcaseImageUrl`. */
    image?: string;
    imageMedia?: unknown;
  };
  outcomes?: { eyebrow?: string; title?: string; lead?: string; items?: HomeArgument[] };
  positioning?: { eyebrow?: string; title?: string; text?: string };
  trust?: { eyebrow?: string; title?: string; items?: HomeArgument[] };
  invitation?: { title?: string; text?: string; buttonLabel?: string; buttonUrl?: string };
  /**
   * L'ADRESSE D'AFFICHAGE de l'image de maquette — bloc PARALLÈLE, en lecture
   * seule. Le champ stocké reste un chemin : y réécrire l'adresse calculée la
   * ferait persister en base au prochain enregistrement, et c'est exactement
   * le défaut que le descripteur de média supprime.
   */
  heroImageUrl?: string;
  showcaseImageUrl?: string;
}

export type SitePageBlockType =
  | 'HEADING'
  | 'RICH_TEXT'
  | 'IMAGE'
  | 'IMAGE_TEXT'
  | 'STATS'
  | 'FEATURES'
  | 'QUOTE'
  | 'CTA'
  | 'GALLERY'
  | 'TEAM';

export type SitePageBlockWidth = 'NARROW' | 'WIDE' | 'FULL';

export interface SitePageImage {
  _id?: string;
  url: string;
  media?: StoredMediaDescriptor | null;
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
   * ── PROPRES AU BLOC « ÉQUIPE » ────────────────────────────────────────────
   *
   * Optionnels : un élément de « chiffres clés » ou d'« atouts » n'en a aucun
   * usage, et une page enregistrée avant ce type de bloc n'en porte pas. Pour
   * un membre d'équipe, `title` porte le NOM et `text` la biographie.
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
  /** HTML DÉJÀ ASSAINI par le serveur — voir `backend/utils/richText.js`. */
  html: string;
  text: string;
  author: string;
  image: SitePageImage | null;
  imageSide: 'LEFT' | 'RIGHT';
  images: SitePageImage[];
  items: SitePageBlockItem[];
  buttonLabel: string;
  buttonUrl: string;
  width: SitePageBlockWidth;
  surface: boolean;
}

export interface SitePage {
  _id: string;
  title: string;
  slug: string;
  navLabel: string;
  showInNav: boolean;
  navOrder: number;
  intro: string;
  heroImage: string;
  heroImageMedia?: StoredMediaDescriptor | null;
  blocks: SitePageBlock[];
  seo: { metaTitle: string; metaDescription: string };
  order: number;
  published: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface NetworkConfig {
  backendUrl: string;
  managerUrl: string;
  websiteUrl: string;
}
export interface PublicNetwork {
  backendUrl: string;
  websiteUrl: string;
}
/** Sous-ensemble du bootstrap public utilisé hors authentification (page de login). */
export interface PublicBootstrap {
  company: Pick<Company, 'name' | 'logos'> & Partial<Company>;
  devCompany?: DevCompany;
  network?: PublicNetwork;
  suspended: boolean;
}
export interface NetworkConfigResponse {
  network: NetworkConfig;
  updatedAt: string;
  updatedBy: { email: string; name: string } | null;
}
export interface UrlTestResult {
  url: string;
  reachable: boolean;
  statusCode: number | null;
  durationMs: number;
  message: string;
}
export interface NetworkTestResponse {
  backend: UrlTestResult;
  manager: UrlTestResult;
  website: UrlTestResult;
}

export interface ThemeColors {
  background: string;
  foreground: string;
  primary: string;
  accent: string;
  menuBackground?: string;
  menuForeground?: string;
}

export interface Theme {
  _id: string;
  colors: ThemeColors;
  radius: string;
  /** IDS du catalogue de polices (allowlist backend). Absent = défauts historiques. */
  typography?: { headingFont?: string; bodyFont?: string };
}

/* ══════════════════════════════════════════════════════════════════════════════
   CHRONOMÉTRAGE EN DIRECT — le raccordement au prestataire (Apex Timing).
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * UNE SURFACE, TELLE QUE LE REGISTRE DU SERVEUR LA DÉCRIT.
 *
 * L'écran ne connaît ni les chemins, ni les bornes de hauteur, ni le mode de
 * rendu : il les LIT. Recopier un `min`/`max` dans un champ de saisie créerait
 * la seconde vérité que ce module s'emploie à supprimer — le jour où le
 * registre change, le champ refuserait ce que le serveur accepte.
 */
export interface ManagerThemeColors {
  primary: string;
  primaryForeground: string;
  accent: string;
  accentForeground: string;
  background: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  sidebar: string;
  sidebarForeground: string;
}

export interface ManagerTheme {
  _id: string;
  colors: ManagerThemeColors;
  radius: string;
}

export interface SiteStatus {
  _id: string;
  status: SiteStatusValue;
  reason: string;
  suspendedAt: string | null;
  suspendedBy: string;
  /**
   * CAUSE effective de la suspension courante — dérivée par le backend.
   * `CONTRACT` n'apparaît que si la protection contractuelle est active.
   */
  suspensionSource?: 'NONE' | 'TECHNICAL' | 'CONTRACT' | 'PAYMENT_DEFAULT';
  /**
   * L'INSTANTANÉ DES CAUSES ACTIVES (L10.6A) — et non la seule dominante.
   *
   * ══ POURQUOI IL FAUT LES TROIS, ET PAS `suspensionSource` ═════════════
   *
   * `suspensionSource` est l'ÉTIQUETTE de la cause qui prime à l'affichage.
   * Sous maintenance technique, elle vaut `TECHNICAL` alors qu'un défaut de
   * paiement peut être appliqué EN MÊME TEMPS. En conclure « il n'y a pas
   * d'impayé » serait faux, et l'écran cacherait au client la vraie raison
   * pour laquelle il doit payer.
   *
   * La preuve d'une cause est donc son booléen ici, jamais l'étiquette.
   *
   * Optionnel : une fiche antérieure à L10.6A ne le porte pas. `undefined`
   * se lit « je ne sais pas » — pas « aucune cause ».
   */
  causes?: { technical: boolean; contract: boolean; paymentDefault: boolean };
  /**
   * LE LEVIER MANUEL — motif, auteur, date, et intention de prévenir.
   *
   * `reason` vide signifie « aucun motif communiqué ». La chaîne « Aucun »
   * n'est JAMAIS stockée : elle naît au rendu de l'e-mail. Un écran qui
   * l'écrirait en base ferait mentir la donnée.
   */
  technicalSuspension?: {
    active: boolean;
    reason: string;
    suspendedAt: string | null;
    suspendedBy: string;
    /** L'intention exprimée à la suspension — distincte de son résultat. */
    notifyAdminsRequested?: boolean;
    /** La dernière levée, conservée après nettoyage de l'état courant. */
    liftedAt?: string | null;
    liftedBy?: string;
  };
  /**
   * RAPPORT D'ANNONCE — présent UNIQUEMENT dans la réponse à une suspension
   * qui demandait une notification. Il décrit un ENVOI, jamais un état du
   * site : une panne d'e-mail n'a défait aucune suspension.
   */
  notification?: {
    attempted: number;
    sent: number;
    failed: number;
    recipients: number;
    /** `NO_RECIPIENTS`, `ANNOUNCE_FAILED`, `NOT_REQUESTED` — ou `null`. */
    skipped: string | null;
  } | null;
  /**
   * PROTECTION CONTRACTUELLE — l'absence de contrat actif suspend-elle le site ?
   *
   * Optionnel : une fiche antérieure à ce champ ne le porte pas, et l'écran
   * doit alors le lire comme « désactivée » (le comportement historique) sans
   * casser. Le backend, lui, applique déjà `false` par défaut.
   */
  contractProtectionEnabled?: boolean;
}

export interface Reference {
  _id?: string;
  type: ReferenceType;
  icon: string;
  name: string;
  value: string;
  order: number;
}

export interface DevCompany {
  _id: string;
  name: string;
  logo: string;
  slogan: string;
  references: Reference[];
  signer: CompanySigner | null;
}

export interface RoleStyle {
  background: string;
  foreground: string;
}

export interface RoleAppearance {
  _id: string;
  roles: Record<Role, RoleStyle>;
}

/**
 * UN MEMBRE DE L'ÉQUIPE DE L'AGENCE — tel que le Panel le publie.
 *
 * ── POURQUOI CETTE FORME A CHANGÉ ──────────────────────────────────────────
 * Le projet tenait sa propre liste, avec un `name` en un seul champ et un
 * `_id` local. Deux projets opérés par la même agence pouvaient donc annoncer
 * deux équipes différentes, et un départ devait être répercuté autant de fois
 * qu'il y avait de projets.
 *
 * Le Panel est désormais l'autorité : cette interface décrit ce qu'il envoie,
 * pas ce que le projet stockait. Plus d'`_id` — la liste n'appartient plus au
 * projet, elle lui est transmise.
 */
/**
 * DESCRIPTEUR MÉDIA CANONIQUE — ce que le Panel publie à côté d'une URL.
 *
 * ── CE QUE L'URL SEULE NE DISAIT PAS ───────────────────────────────────────
 * Ni si l'image avait changé (aucune empreinte), ni son type réel, ni ses
 * dimensions — donc pas moyen de réserver la place et d'éviter le saut de
 * mise en page —, ni si la projection reçue était plus récente que celle déjà
 * affichée. Le projet ne pouvait que recharger l'adresse et espérer.
 *
 * Tous les champs sauf `url` sont optionnels : une URL EXTERNE, dont le Panel
 * n'a aucune métadonnée, publie l'adresse et rien d'autre plutôt que
 * d'inventer une empreinte.
 */
export interface MediaDescriptor {
  mediaId: string | null;
  /** Absolue et canonique — jamais localhost, jamais un chemin disque. */
  url: string;
  mime: string | null;
  size?: number | null;
  width: number | null;
  height: number | null;
  /** Empreinte du CONTENU : ce qui distingue « même image » d'« autre ». */
  sha256: string | null;
  /** Monotone — une projection plus ancienne est refusée. */
  version: number | null;
  updatedAt?: string | null;
  role?: string | null;
}

export interface TeamMember {
  firstName: string | null;
  lastName: string | null;
  /** La fonction montrée au client, pas un rôle technique. */
  role: string | null;
  email: string | null;
  phone: string | null;
  /** URL absolue, résolue par le Panel au moment de publier. */
  photoUrl: string | null;
  /** Descripteur canonique (Panel ≥ 1.5.0) — `null` sur un Panel antérieur. */
  photo?: MediaDescriptor | null;
  /** Un membre retiré de l'affichage reste publié : il ne s'affiche pas. */
  active: boolean;
  /** Canaux propres à la personne : ligne directe, profil, agenda. */
  references: Reference[];
  order: number;
}

export interface MediaCatalogEntry {
  key: string;
  label: string;
  icon: string;
  kind: MediaItem['kind'];
  placeholder: string;
}

// --- IntegratedAPI (mode fournisseur ≠ ENV applicatif) ---------------------
export type ProviderMode = 'TEST' | 'PROD';

export interface IntegrationField {
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
  /** Créé et stocké automatiquement par l'application (ex. whsec_ Stripe capturé
   *  à la création de l'endpoint distant) — jamais saisi à la main. */
  autoManaged?: boolean;
  prefixHint: string | null;
  prefixByMode: { TEST?: string; PROD?: string } | null;
}

export interface IntegrationCredential {
  configured: boolean;
  maskedValue?: string;
  updatedAt?: string | null;
}

export interface IntegrationModeState {
  configured: boolean;
  verified: boolean;
  baseUrl: string;
  baseUrlDefault: string;
  baseUrlCustom: boolean;
  hasBaseUrl: boolean;
  lastTestedAt: string | null;
  lastTestStatus: 'SUCCESS' | 'FAILED' | null;
  lastTestMessage: string;
  lastTestDetails: Record<string, unknown> | null;
  credentials: Record<string, IntegrationCredential>;
}

export interface IntegratedApi {
  provider: string;
  displayName: string;
  enabled: boolean;
  active: boolean;
  website: string;
  confirmVerb: string;
  fields: IntegrationField[];
  activeMode: ProviderMode;
  applicationEnvironment: ProviderMode; // ENV applicatif — INFORMATIF uniquement
  activeBaseName: string;
  /**
   * L'ENVIRONNEMENT UTILISÉ par cette instance pour ce fournisseur (lot L2).
   * Il découle de l'environnement de l'instance : aucun écran ne le choisit.
   */
  environment: ProviderMode;
  scope: 'ENVIRONMENT' | 'PANEL_GLOBAL';
  /** Le réglage hérité `activeMode` désigne un autre monde. Constat, pas action. */
  legacyModeMismatch: boolean;
  modeUpdatedAt: string | null;
  modeUpdatedBy: string | null;
  modes: Record<ProviderMode, IntegrationModeState>;
  updatedAt: string;
}

export interface IntegrationTestResult {
  status: 'SUCCESS' | 'FAILED';
  message: string;
  provider: string;
  mode: ProviderMode;
  details?: Record<string, unknown>;
  testedAt: string;
}

/* --- Événements système ---------------------------------------------------- */

export type EventDispatchStatus = 'PENDING' | 'DISPATCHING' | 'DISPATCHED' | 'PARTIAL_FAILURE' | 'FAILED';
export type ExecutionStatus = 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'DEAD_LETTER';

export interface EventExecutionView {
  id: string;
  eventId: string;
  actionId: string;
  actionType: string;
  templateId: string | null;
  recipientResolver: string | null;
  recipientKey: string;
  status: ExecutionStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  processedAt: string | null;
  providerMessageId: string | null;
  lastErrorSafe: { code: string; message: string; retryable: boolean };
}

export interface DomainEventView {
  eventId: string;
  type: string;
  entityType: string;
  entityId: string | null;
  actor: { type: string; id: string | null; role: string | null };
  /** Sûr par construction : le backend refuse toute clé sensible à l'émission. */
  payloadSafe: Record<string, unknown>;
  occurredAt: string;
  retentionClass: string;
  dispatchStatus: EventDispatchStatus;
  dispatchAttempts: number;
  lastDispatchAt: string | null;
  lastErrorSafe: { code: string; message: string };
  actions?: { total: number; succeeded: number; failed: number; attempts: number };
  executions?: EventExecutionView[];
}

export interface DomainEventPage {
  events: DomainEventView[];
  nextCursor: string | null;
}

/* --- Configuration e-mail -------------------------------------------------
 *
 * Deux données métier par mode et un fait constaté. Aucun miroir de l'état
 * Brevo (expéditeur vérifié, domaine, DKIM, DMARC, records DNS) : ces états
 * s'administrent dans le tableau de bord Brevo, pas ici.
 */

/**
 * Issue du DERNIER test, par mode.
 *
 * ACCEPTED ≠ DELIVERED : `messageId` reçu ne prouve QUE l'acceptation. Seul
 * `DELIVERED` (confirmé par webhook) autorise « Fonctionnel ». `REJECTED` = rejet
 * asynchrone (bounce, sender refusé) ; `FAILED` = échec immédiat de la requête.
 */
export type EmailTestStatus =
  | 'NOT_TESTED' | 'ACCEPTED' | 'DEFERRED' | 'DELIVERED' | 'REJECTED' | 'FAILED';

/** Statut GLOBAL affiché — DÉRIVÉ par le backend, jamais recalculé ici. */
export type EmailStatus = 'NOT_CONFIGURED' | 'NOT_TESTED' | 'ACCEPTED' | 'FUNCTIONAL' | 'ERROR';

export interface EmailTestState {
  status: EmailTestStatus;
  /** Identifiant interne du test — corrèle test, livraison et webhooks. */
  testExecutionId: string;
  /** Non sensible. Affiché aux DEV seulement — jamais au commerçant. */
  providerMessageIdSafe: string;
  /** Destinataire du dernier test, MASQUÉ. */
  recipientMasked: string;
  /** Dernier destinataire saisi, en clair — pour préremplir la modale. */
  lastRecipient: string;
  /** Brevo a accepté la requête. */
  acceptedAt: string | null;
  /** Livraison CONFIRMÉE par webhook. Seule preuve de « Fonctionnel ». */
  deliveredAt: string | null;
  /** Rejet asynchrone constaté par webhook. */
  rejectedAt: string | null;
  /** Statut BRUT de l'EmailDelivery (SENT/DELIVERED/ERROR…). DEV seulement. */
  deliveryStatus: string | null;
  /** Dernier événement Brevo normalisé appliqué. DEV seulement. */
  providerEvent: string | null;
  lastTestedAt: string | null;
  /** Code métier stable + message déjà présentable. Jamais de texte Brevo brut. */
  lastErrorSafe: { code: string; message: string };
}

/**
 * Autorisation d'envoyer, telle que le backend l'appliquera.
 *
 * Le Manager ne la recalcule PAS : il l'affiche. Le bouton « Envoyer un test »
 * s'appuie dessus pour se désactiver AVANT que l'utilisateur ne se heurte à un
 * refus — l'inverse serait une promesse trahie au clic.
 */
export type EmailOperationalState =
  | 'READY'
  | 'CONFIGURATION_REQUIRED'
  | 'REPAIR_REQUIRED'
  | 'WEBHOOK_UNAVAILABLE';

export type DeliveryServiceStatus = 'operational' | 'degraded' | 'disabled';
export type WebhookConfigurationStatus = 'installed' | 'missing' | 'mismatched' | 'unreachable';

export interface EmailOperational {
  ready: boolean;
  state: EmailOperationalState;
  /** Codes stables + phrases déjà présentables. Jamais de détail technique. */
  blockers: { code: string; message: string }[];
  /**
   * TROIS lectures SÉPARÉES (jamais mélangées dans un même panneau) :
   * canal d'envoi, installation du suivi, activité du suivi.
   */
  canSend?: boolean;
  deliveryServiceStatus?: DeliveryServiceStatus;
  deliveryBlockers?: { code: string; message: string }[];
  trackingBlockers?: { code: string; message: string }[];
  webhookConfigurationStatus?: WebhookConfigurationStatus;
  trackingActivity?: { lastEventAt: string | null; lastEventType: string | null; neverReceived: boolean };
  statusSince?: string | null;
  /**
   * Joignabilité du suivi, à titre INFORMATIF (jamais un blocage d'affichage) :
   * l'installation du webhook et sa dernière activité sont deux notions séparées.
   * « Configuration ✓ » d'un côté, « Dernier événement reçu » de l'autre.
   */
  webhook?: {
    healthStatus?: string | null;
    healthyUntil?: string | null;
    lastReceivedAt?: string | null;
    /** URL RÉSOLUE automatiquement (jamais saisie) + provenance. */
    expectedUrl?: string;
    publicBackendUrl?: string;
    publicUrlSource?: 'NGROK' | 'SYSTEM_CONFIGURATION' | 'ENVIRONMENT' | 'LOCALHOST' | 'NONE';
  } | null;
}

export interface EmailModeConfiguration {
  sender: { email: string; name: string };
  /** PRÉSENCE de la clé du mode — jamais la clé, ni ses derniers caractères. */
  apiKeyConfigured: boolean;
  test: EmailTestState;
  status: EmailStatus;
  operational: EmailOperational;
}

/**
 * Projection canonique de `/api/email-configuration`. Chaque action la renvoie
 * en entier : le Manager remplace son état, il ne le rapièce jamais.
 */
/**
 * Réponse de « Rétablir le service » : la configuration canonique, PLUS le
 * verdict de l'action.
 *
 * `restore.ready` est la seule chose qui autorise un message de succès. Il est
 * distinct de `modes[m].operational.ready` uniquement par son moment : il vaut
 * pour l'instant précis où la sonde a été exécutée.
 */
/**
 * Issue du dernier test, isolée pour le suivi. Charge utile minimale : c'est
 * tout ce qu'il faut pour rafraîchir la carte « Dernier test », et rien de plus.
 *
 * `terminal` vient du SERVEUR : il décide où le suivi s'arrête, pour que le
 * client n'ait pas à redémontrer la liste des états transitoires.
 */
export interface EmailTestStatusView {
  deliveryId: string;
  status: EmailTestStatus;
  terminal: boolean;
  recipientMasked: string;
  lastTestedAt: string | null;
  acceptedAt: string | null;
  deliveredAt: string | null;
  rejectedAt: string | null;
  lastErrorSafe: { code: string; message: string };
}

export interface EmailConfigurationRestore extends EmailConfiguration {
  restore: {
    ready: boolean;
    /** Motif d'échec STABLE, jamais affiché tel quel. */
    code: string;
  };
}

export interface EmailConfiguration {
  /**
   * LE MONDE DANS LEQUEL CE PROJET ENVOIE — `environment`, et rien d'autre.
   *
   * ── LA RÉGRESSION QUE CE NOM CORRIGE ──────────────────────────────────────
   *
   * Le serveur a renommé ce champ `activeMode` → `environment` sans que ce type
   * ni son lecteur ne suivent. `cfg.activeMode` valait donc `undefined`,
   * `selectActiveMode` rendait `null`, et la section tombait dans sa branche de
   * repli : « La configuration des emails n'a pas pu être chargée » s'affichait
   * en permanence — sur une requête qui répondait 200, avec un bouton
   * « Réessayer » qui ne pouvait rien y changer.
   *
   * Un seul nom, des deux côtés. Pas de synonyme toléré, pas d'adaptateur qui
   * accepterait les deux : c'est exactement ce qui laisse une régression de ce
   * genre survivre à sa correction.
   */
  environment: ProviderMode | null;
  modes: Record<ProviderMode, EmailModeConfiguration>;
  updatedAt: string;
}

/*
 * ─── SUPPRIMÉ : types du diagnostic e-mail ──────────────────────────────────
 * Le panneau de diagnostic a été retiré de l'écran (il dupliquait « Tester la
 * configuration » et ses deux boutons étaient inopérants). Le diagnostic vit
 * désormais uniquement côté serveur : `npm run email:diagnostic`.
 */

// --- Contrats --------------------------------------------------------------
export type ContractStatus =
  | 'DRAFT' | 'PENDING_DEV_SIGNATURE' | 'INACTIVE' | 'ACTIVATION_IN_PROGRESS'
  | 'ACTIVE' | 'CANCEL_AT_PERIOD_END' | 'ENDED' | 'CANCELLED' | 'FAILED';

export type SignerRole = 'DEVELOPER' | 'CLIENT';
export type ActivationStep = 'SIGNATURE' | 'LAUNCH_FEE' | 'SUBSCRIPTION' | 'ACTIVATION' | 'DONE';

/**
 * Ce que le projet SAIT du moyen de paiement — c'est-à-dire très peu.
 *
 * Aucune donnée bancaire n'est stockée côté projet : il n'y a donc ni marque de
 * carte, ni quatre derniers chiffres à afficher. Les inventer serait pire que
 * de ne rien dire.
 */
/**
 * L'ISSUE MÉTIER d'une tentative de paiement — jamais un statut Stripe brut.
 *
 * Aucune de ces valeurs ne se déduit du retour navigateur : elles viennent de
 * ce que Stripe a confirmé. `PAID` signifie que l'état local est réconcilié,
 * et c'est la seule condition pour dire à l'utilisateur qu'il a terminé.
 */
export type SubscriptionOutcome =
  | 'NOT_REQUIRED'
  | 'PAID'
  | 'PROCESSING'
  | 'AWAITING_PAYMENT'
  | 'FAILED'
  | 'ENDED'
  | 'TO_PAY';

export interface SubscriptionReconciliation {
  outcome: SubscriptionOutcome;
  /** L'état local a-t-il bougé pendant la réconciliation ? */
  changed: boolean;
  /**
   * L'AUTORITÉ A-T-ELLE RÉPONDU ?
   *
   * `false` signifie que l'état ci-dessous est le DERNIER CONNU, pas un état
   * fraîchement constaté. Annoncer « vérifié » dans ce cas est le pire message
   * possible : l'utilisateur, à qui l'on vient de confirmer la vérification,
   * voit l'écran continuer de réclamer un paiement qu'il a fait — et il en
   * conclut que son règlement a échoué.
   */
  authorityReached: boolean;
  status: string;
  required: boolean;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  lastError: { message: string; at: string } | null;
}

export interface PaymentMethodView {
  hasCustomer: boolean;
  canUpdate: boolean;
  subscriptionRequired: boolean;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}
export type SignatureState = 'NONE' | 'REQUESTED' | 'DEV_SIGNED' | 'FULLY_SIGNED' | 'DECLINED' | 'EXPIRED' | 'CANCELED';
export type LaunchFeeStatus =
  | 'NOT_REQUIRED' | 'PENDING' | 'CHECKOUT_CREATED' | 'PROCESSING'
  | 'PAID' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED';

/** Statut public des frais de lancement (GET /my-contract/launch-fee-status). */
export interface LaunchFeeStatusView {
  required: boolean;
  status: LaunchFeeStatus;
  paidAt: string | null;
  amount: { excludingTax: number; tax: number; includingTax: number; currency: string };
  attempt: number;
  lastError: string | null;
  hasOpenCheckout: boolean;
}

export type SubscriptionStatus =
  | 'NONE' | 'NOT_REQUIRED' | 'PENDING' | 'CHECKOUT_CREATED' | 'INCOMPLETE'
  | 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'UNPAID' | 'PAUSED'
  | 'CANCEL_AT_PERIOD_END' | 'CANCELLED' | 'ENDED' | 'FAILED';

/** Statut public de l'abonnement (GET /my-contract/subscription-status). */
export interface SubscriptionStatusView {
  required: boolean;
  status: SubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  lastError: { message: string; at: string | null } | null;
  amount: { excludingTax: number; tax: number; includingTax: number; currency: string; interval: string };
}

/** Détail d'un paiement pour le DEV (support) — identifiants Stripe raccourcis. */
export interface PaymentDetail {
  _id: string;
  type: string;
  status: string;
  providerMode: ProviderMode;
  applicationEnvironment: ProviderMode;
  amountExcludingTax: number;
  taxAmount: number;
  amountIncludingTax: number;
  currency: string;
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
  attempt: number;
  lastError: string | null;
  paidAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
  refundedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Statut d'une facture Stripe (miroir interne). */
export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'UNCOLLECTIBLE' | 'VOID';

/** Statut d'un paiement (journal interne — plus riche que le statut de facture). */
export type PaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REFUNDED';

/** Type métier d'une facture / d'un paiement. */
export type PaymentType = 'LAUNCH_FEE' | 'SUBSCRIPTION';

/**
 * Résultat d'une réconciliation (sync). `changes` liste les écarts corrigés —
 * vide = l'état local était déjà juste. Ces endpoints ne créent jamais rien.
 */
export interface SyncResult {
  reference?: string;
  changes?: string[];
}

export interface TimelineEvent {
  action: string;
  label: string;
  actorType: 'DEV' | 'ADMIN' | 'SYSTEM' | 'WEBHOOK';
  provider: string | null;
  at: string;
  meta: Record<string, unknown> | null;
}

export interface SignatureZone {
  id: string;
  name: string;
  signerRole: SignerRole;
  page: number;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
  type: string;
}

export interface ContractSigner {
  role: SignerRole;
  displayName: string;
  companyName: string;
  logo: string;
  email: string;
  color: string;
}

/** Identité d'une partie, figée à la validation du contrat (immuable ensuite). */
export interface ContractSignerSnapshot extends CompanySigner {
  companyName: string;
}

export interface ContractSignersSnapshot {
  developer: ContractSignerSnapshot | null;
  client: ContractSignerSnapshot | null;
}

/**
 * « tous les <interval> <unit> » — la périodicité d'un abonnement.
 * Le montant de la ligne est ce qui est débité à CHAQUE échéance, jamais un
 * prix mensuel à multiplier.
 */
export interface Recurrence {
  unit: 'MONTH' | 'YEAR';
  interval: number;
}

export interface PricingLine {
  enabled: boolean;
  amountExcludingTax: number;
  taxRate: number;
  taxAmount: number;
  amountIncludingTax: number;
  currency: string;
  /** La périodicité qui fait foi — le serveur la rend toujours résolue. */
  recurrence?: Recurrence;
  /** HÉRITAGE : l'UNITÉ seule, sous son ancien nom. Ne plus lire directement. */
  interval?: string;
}

export interface PageSize { page: number; width: number; height: number; }

/**
 * L'ÉTAT DE SIGNATURE D'UN CONTRAT, tel que l'API le rend.
 *
 * `provider` dit QUI a servi l'acte — `null` tant qu'aucune demande n'est
 * ouverte. Les écrans ne s'en servent pas pour décider : ils l'affichent au
 * support, qui en a besoin pour savoir où chercher un contrat de 2025.
 */
export interface ContractSignatureView {
  provider: string | null;
  status: string;
  signatureState: SignatureState;
  devSignedAt: string | null;
  /** @deprecated Nom hérité de `clientSignedAt` — même valeur. */
  adminSignedAt: string | null;
  clientSignedAt: string | null;
  hasRequest: boolean;
  /**
   * Le signataire sera-t-il ramené ici automatiquement à la fin du parcours ?
   *
   * FAIT constaté à l'ouverture de la demande, jamais un réglage. Faux =>
   * l'écran doit demander de revenir de soi-même, plutôt que promettre un
   * retour qui n'arrivera pas.
   */
  autoReturn: boolean;
  signers: { role: SignerRole; displayName: string; companyName: string; email: string; signed: boolean; signedAt: string | null }[];
  signatureRequestId?: string | null;
}

export interface Contract {
  /** Une signature doit-elle être réalisée dans ce projet ? Défaut REQUIRED. */
  signatureRequirement?: 'REQUIRED' | 'NOT_REQUIRED';
  /** Faux quand la signature n'est pas requise : l'étape disparaît des parcours. */
  signatureApplicable?: boolean;
  _id: string;
  reference: string;
  name: string;
  status: ContractStatus;
  archived: boolean;
  environment: ProviderMode;
  document: {
    hasOriginal: boolean;
    hasSigned: boolean;
    signedFetchedAt: string | null;
    pageCount: number;
    pageSizes: PageSize[];
    originalUrl: string | null;
    signedUrl: string | null;
    /**
     * LA PREUVE D'AUDIT — qui a signé, quand, depuis où.
     *
     * `hasCertificate` dit ce qui EXISTE sur le stockage ;
     * `referencedCertificate` dit ce que la base annonce. L'écart entre les
     * deux distingue « jamais produit » de « produit puis introuvable », et ces
     * deux situations n'appellent pas la même réponse.
     *
     * Les contrats signés chez le fournisseur historique n'en ont pas : les
     * deux sont faux, et c'est un fait, pas une panne.
     */
    hasCertificate: boolean;
    referencedCertificate: boolean;
    certificateFetchedAt: string | null;
    certificateUrl: string | null;
  };
  signatureConfiguration: {
    version: number;
    versionCount: number;
    locked: boolean;
    signers: ContractSigner[];
    zones: SignatureZone[];
  };
  signersSnapshot: ContractSignersSnapshot;
  pricing: { launchFee: PricingLine; subscription: PricingLine };
  taxRate: number;
  /**
   * Délai de grâce (jours) accordé avant qu'un impayé d'abonnement puisse
   * fermer le site. `null` = AUCUNE politique configurée — l'impayé est suivi
   * mais aucune fermeture automatique n'est programmée. C'est très différent
   * de `0`, qui signifie « aucune clémence, échéance au premier refus ».
   */
  paymentGraceDays: number | null;
  /**
   * LA SIGNATURE — nommée par ce qu'elle est, plus par qui l'exécute.
   *
   * Ce bloc s'appelait `yousign`. Le fournisseur a changé : un contrat ouvert
   * aujourd'hui part chez OpenSign, et un champ nommé d'après l'ancien aurait
   * menti à chaque lecture, dans chaque écran.
   */
  signature: ContractSignatureView;
  /**
   * L'ANCIEN NOM, ENCORE SERVI PAR L'API — en lecture seule, et pour un temps.
   *
   * Le backend rend les deux blocs à l'identique pendant la bascule, pour
   * qu'aucun écran ne casse entre deux déploiements. Rien de neuf ne doit le
   * lire : il disparaîtra avec le retrait de l'ancien fournisseur.
   *
   * @deprecated Lire `signature`.
   */
  yousign: ContractSignatureView;
  stripe: {
    launchFee: {
      status: LaunchFeeStatus;
      paidAt: string | null;
      attempt: number;
      lastError: string | null;
      // Réservés au DEV (support) :
      paymentId?: string | null;
      checkoutSessionId?: string | null;
      paymentIntentId?: string | null;
    };
    subscription: {
      status: SubscriptionStatus;
      currentPeriodStart: string | null;
      currentPeriodEnd: string | null;
      cancelAtPeriodEnd: boolean;
      cancelledAt: string | null;
      endedAt: string | null;
      lastError: { message: string; at: string | null } | null;
      // Réservés au DEV (support) :
      subscriptionId?: string | null;
      productId?: string | null;
      priceId?: string | null;
      latestInvoiceId?: string | null;
    };
    customerId?: string | null;
  };
  activation: { activatedAt: string | null; activatedBy: string | null };
  // Champs dérivés (activationView) :
  step: ActivationStep;
  signed: boolean;
  devSigned: boolean;
  adminSigned: boolean;
  launchFeeRequired: boolean;
  launchFeeSatisfied: boolean;
  subscriptionRequired: boolean;
  subscriptionSatisfied: boolean;
  canActivate: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceView {
  _id: string;
  contractId?: string;
  number: string;
  type: PaymentType | null;
  amountExcludingTax: number;
  taxAmount: number;
  amountIncludingTax: number;
  currency: string;
  status: InvoiceStatus;
  invoiceDate: string | null;
  dueDate: string | null;
  paidAt: string | null;
  hostedInvoiceUrl: string;
  invoicePdfUrl: string;
  /** Nom libre saisi au rattachement manuel (seul champ non dérivé de Stripe). */
  label: string;
  /** Rattachée à la main par un DEV (vs reflétée par webhook/synchronisation). */
  addedManually: boolean;
}

export interface PaymentView {
  _id: string;
  type: PaymentType;
  status: PaymentStatus;
  amountExcludingTax: number;
  taxAmount: number;
  amountIncludingTax: number;
  currency: string;
  paidAt: string | null;
  failedAt: string | null;
  refundedAt: string | null;
  createdAt: string;
}

/**
 * UNE PRESTATION FACTUREE PAR L.Y SOLUTION (L10.5).
 *
 * Elle ne vient d'aucun contrat : c'est un travail ponctuel, facture a part.
 * Tous les montants sont en CENTIMES entiers, et la ventilation est celle que
 * le Panel a FIGEE a la creation — le Manager ne recalcule rien.
 */
export interface PaymentRequestView {
  paymentRequestId: string;
  label: string;
  description: string;
  netAmountCents: number;
  /** Pourcentage. 20 vaut 20 %. Celui du contrat au moment de la facturation. */
  taxRate: number;
  taxAmountCents: number;
  /** Ce qui est reellement debite. C'est ce montant que Stripe encaisse. */
  grossAmountCents: number;
  currency: string;
  status: 'DRAFT' | 'OPEN' | 'PAYMENT_PENDING' | 'PAID' | 'CANCELED' | 'EXPIRED';
  payable: boolean;
  /** La vraie facture Stripe, une fois payee. `null` tant qu'elle n'existe pas. */
  invoiceUrl: string | null;
  invoicePdfUrl: string | null;
  issuedAt: string | null;
  paidAt: string | null;
}

/**
 * UN INCIDENT DE PAIEMENT D'ABONNEMENT (L10.6B-3).
 *
 * ══ CE N'EST PAS UNE SUSPENSION ═════════════════════════════════════════════
 *
 * L'incident naît au PREMIER prélèvement refusé. La cause de suspension, elle,
 * n'apparaît qu'à l'expiration du délai de grâce. Pendant toute la grâce :
 *
 *     incident   = présent      causeActive = false      site = accessible
 *
 * Les trois sont vraies ensemble, et l'écran doit pouvoir les dire ensemble.
 * `causeActive` ne prouve donc JAMAIS que le site est fermé — c'est
 * `SiteStatus` qui répond à cette question, et lui seul.
 *
 * Rien ici n'est décidé par ce projet : tout vient du Panel, qui est l'autorité
 * de la politique de grâce. Le Manager AFFICHE.
 */
export interface SubscriptionIncidentView {
  paymentDefaultId: string;
  contractId: string | null;
  /** Référence technique — volet « Détails », pas la lecture courante. */
  invoiceId: string | null;
  status: 'OPEN' | 'GRACE_EXPIRED' | 'RESOLVED' | 'CLOSED';

  /**
   * OBSERVATIONS STRIPE, jamais des promesses. L'écran dit « prévue par
   * Stripe » ; il ne dit jamais « nous retenterons », parce que ce projet ne
   * retente rien.
   */
  attemptCount: number;
  nextPaymentAttemptAt: string | null;
  /** `false` = Stripe ne l'a PAS communiquée. Pas « aucune tentative prévue ». */
  nextAttemptKnown: boolean;
  firstFailedAt: string | null;
  lastFailedAt: string | null;

  /** `null` = aucune politique. `0` = aucune clémence. JAMAIS confondus. */
  graceDaysSnapshot: number | null;
  /** Le booléen qui empêche un `if (graceDaysSnapshot)` de fusionner les deux. */
  graceConfigured: boolean;
  graceDeadlineAt: string | null;

  amountDueCents: number;
  currency: string;
  invoiceNumber: string | null;
  /** La facture Stripe du client. Sa page de paiement, s'il veut régler. */
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;

  /** DEMANDÉE — l'intention du Panel. */
  suspensionRequestedAt: string | null;
  /** CONFIRMÉE — le fait constaté. Tant qu'elle manque, rien n'est certain. */
  suspensionConfirmedAt: string | null;
  causeRemovalConfirmedAt: string | null;

  resolvedAt: string | null;
  resolution: string | null;

  /** Observation, jamais preuve d'accessibilité. Voir l'en-tête. */
  causeActive: boolean;
  reason: string;
}

export interface SubscriptionIncidentsView {
  items: SubscriptionIncidentView[];
  /** Le plus récent des incidents VIVANTS. `null` si tout est réglé. */
  active: SubscriptionIncidentView | null;
}

export interface BillingGroup {
  contractId: string;
  reference: string;
  status: ContractStatus;
  pricing: { launchFee: PricingLine; subscription: PricingLine };
  subscription: { status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean };
  payments: PaymentView[];
  invoices: InvoiceView[];
}

export interface ActivationView {
  step: ActivationStep;
  signed: boolean;
  devSigned: boolean;
  adminSigned: boolean;
  launchFeeRequired: boolean;
  launchFeeSatisfied: boolean;
  subscriptionRequired: boolean;
  subscriptionSatisfied: boolean;
  canActivate: boolean;
}

/* -------------------------------------------------------------------------- *
 * Moteur de déploiement industriel (DEV uniquement)                          *
 * -------------------------------------------------------------------------- */

export type DeploymentTargetType = 'subdomain' | 'domain';
export type DeploymentState = 'NEW' | 'DEPLOYING' | 'DEPLOYED' | 'FAILED';

export interface DeploymentHistoryStep {
  step: string;
  label?: string;
  status: 'ok' | 'error' | 'running';
  durationMs?: number;
}

export interface DeploymentHistoryEntry {
  id: string;
  at: string;
  version: string | null;
  user: string | null;
  durationMs: number | null;
  success: boolean;
  failedStep: string | null;
  error: string | null;
  steps: DeploymentHistoryStep[];
}

export interface DeploymentTarget {
  id: string;
  name: string;
  url: string;
  host: string;
  managerHost: string;
  managerUrl: string;
  type: DeploymentTargetType;
  registrableDomain: string | null;
  subdomain: string | null;
  wildcardBase: string | null;
  sshHost: string | null;
  sshUser: string;
  backendPort: number;
  dbName: string | null;
  remoteRoot: string;
  state: DeploymentState;

  /**
   * ENVIRONNEMENT de la destination — IMMUABLE après création.
   *
   * Il était choisi au moment de déployer, avec PROD par défaut : la même
   * destination pouvait basculer d'un monde à l'autre entre deux mises en
   * ligne, et un clic de trop publiait en production.
   */
  environment: 'TEST' | 'PROD';

  /**
   * CE QUE LA DESTINATION OCCUPE ENCORE SUR LE SERVEUR — volontairement
   * distinct de `state`, qui décrit le dernier déploiement. Une destination
   * peut avoir été « déployée » avec succès ET être vidée aujourd'hui.
   */
  lifecycleStatus: DestinationLifecycleStatus;
  lifecycleLabel: string;
  quarantineEnabled: boolean;
  emptiedAt: string | null;
  deletedAt: string | null;
  lastError: { step: string | null; code: string | null; message: string | null; at: string | null } | null;

  /* Ce que le BACKEND autorise — l'écran l'affiche, il ne le redécide pas. */
  canDeploy: boolean;
  canDeprovision: boolean;
  canDelete: boolean;
  /** La destination occupe-t-elle encore le serveur ? (cycle de vie, pas version) */
  occupiesServer: boolean;
  /** Deployee sans version connue : le hash manque, pas le deploiement. */
  versionUnknown: boolean;

  currentVersion: string | null;
  lastDeployedAt: string | null;
  history: DeploymentHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export type DestinationLifecycleStatus =
  | 'ACTIVE' | 'DEPROVISIONING' | 'EMPTY' | 'DEPROVISION_FAILED' | 'DELETED';

/**
 * L'ÉTAT RÉEL DU SERVEUR, relevé avant un retrait.
 *
 * Chaque valeur est LUE sur la machine, jamais déduite d'une fiche : c'est
 * précisément parce que la fiche pouvait mentir qu'on va la vider.
 */
export interface DestinationInspection {
  target: DeploymentTarget;
  inventory: {
    exists: boolean;
    siteRoot: string;
    pm2Name: string;
    files: number;
    size: string | null;
    uploads: number;
    storage: number;
    persistentFiles: number;
    outboundSymlinks: string[];
    servedHosts?: string[];
  };
  requiresPersistentDataConfirmation: boolean;
  blockedBySymlinks: boolean;
}

export interface VpsSession {
  sessionId: string;

  expiresAt: number;
}

export interface PreflightCheck {
  id: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail: string | null;
}

export interface PreflightResult {
  ok: boolean;
  target: {
    host: string;
    type: DeploymentTargetType;
    wildcardBase: string | null;
    subdomain: string | null;
    requiresDedicatedCert: boolean;
    requiresDnsCheck: boolean;
  };
  checks: PreflightCheck[];
  failedChecks: PreflightCheck[];
}

export interface DeployStepEvent {
  step: string;
  label?: string;
  status: 'running' | 'ok' | 'error';
  durationMs?: number;
  detail?: unknown;
  error?: { code: string; message: string };
}

/**
 * `DeployResult` a été SUPPRIMÉ avec la route qui le produisait.
 *
 * Il décrivait la réponse UNIQUE de `POST /deployment/deploy` — un déploiement
 * rendu d'un bloc, à la fin. Le parcours réel est un FLUX (`DeployStreamEvent`),
 * et laisser traîner le type de l'ancien aurait suffi à faire réécrire la route
 * qui va avec.
 */

export interface DuplicationResult {
  project: string;
  path: string;
  state: string;
  dbTest: { name: string; created: boolean };
  dbProd: { name: string; created: boolean };
  copy: { files: number; dirs: number };
  logs: string[];
  /** Checklist DÉRIVÉE du registre et de l'exécution — jamais une troisième liste. */
  checklist?: { id: string; target?: string; status: DuplicationPhaseStatus; label: string }[];
  adminAccount?: { email: string; role: string; status: string };
  devAccount?: { email: string; name?: string; status: string };
}

/**
 * LE MODE D'EXÉCUTION. Un préflight exécute le PROLOGUE d'un déploiement puis
 * s'arrête : même moteur, sous-ensemble d'étapes déclaré par le registre.
 */
export type DeploymentRunMode = 'DEPLOYMENT' | 'PRECHECK';

/**
 * LA DÉFINITION d'une étape de déploiement, servie par le backend
 * (`GET /deployment/phases`). L'interface n'en tient plus de copie.
 */
export interface DeploymentStepContract {
  id: string;
  order: number;
  label: string;
  /** Libellé alternatif en préflight, DÉCLARÉ par le registre. */
  precheckLabel?: string;
  icon: string;
  group: string;
  modes: DeploymentRunMode[];
  required: boolean;
  blocking: boolean;
  visible: boolean;
  /** Dépend du contexte (fournisseur DNS configuré, par exemple). */
  conditional?: boolean;
  /** L'étape après laquelle la nouvelle version est publiquement joignable. */
  publicationBoundary?: boolean;
}

/** État visuel d'une étape de la checklist live. */
export type LiveStepStatus = 'pending' | 'running' | 'ok' | 'warning' | 'error' | 'skipped' | 'cancelled';

interface DeployEventBase {
  sequenceNumber: number;
  timestamp: string;
  deploymentRunId: string | null;
}

/** Évènement du flux de déploiement en direct (NDJSON, canonique). */
export type DeployStreamEvent = DeployEventBase &
  (
    | { type: 'deployment.started'; siteUrl: string; managerUrl: string; version: string }
    | {
        type: 'step.started' | 'step.succeeded' | 'step.failed' | 'step.warning' | 'step.skipped' | 'step.progress';
        stepId: string;
        label: string;
        status: LiveStepStatus;
        publicMessage?: string | null;
        technicalMessage?: string | null;
        errorCode?: string | null;
        durationMs?: number | null;
      }
    | { type: 'deployment.succeeded'; status: 'ok'; siteUrl: string; managerUrl: string; version: string }
    | { type: 'deployment.failed'; status: 'error'; finalStepId?: string; errorCode?: string; message?: string }
    /**
     * L'ÉTAT PERSISTANT N'A PAS ATTEINT SA FORME FINALE.
     *
     * Émis quand la mise en ligne a abouti sur le serveur mais que la
     * destination n'a pas pu être enregistrée « déployée ». L'écran ne doit
     * PAS annoncer un succès : il ferait coexister une réussite affichée et un
     * badge « Publication… ».
     */
    /**
     * LE BACKEND VA REDEMARRER — annoncé AVANT la coupure.
     *
     * Sans cet évènement, le frontend voyait un flux tronqué et affichait une
     * erreur serveur générique pour une coupure parfaitement prévue.
     */
    | { type: 'backend_restarting'; message: string; runId: string; expectedProcessName: string | null; expectedPort: number | null }
    | { type: 'deployment.finalization_failed'; code: string; message: string }
    | { type: 'deployment.not_finalized'; code: string; message: string; state: string | null; lifecycleStatus: string | null }
    | {
      type: 'deployment.report_ready'; ok: boolean; status: string; finalStepId: string;
      /** Faux quand la destination n'a pas atteint son état final. */
      finalized?: boolean;
      finalizationError?: string | null;
      targetState?: string | null;
    }
  );

export interface RunStep {
  id: string;
  label: string;
  order: number;
  status: LiveStepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  publicMessage: string | null;
  technicalMessage: string | null;
  errorCode: string | null;
  retryable: boolean | null;
  critical: boolean;
  warnings: string[];
}

export type OperationType = 'PRECHECK' | 'DEPLOYMENT' | 'ROLLBACK' | 'HEALTHCHECK' | 'BACKUP';

export interface DeploymentRunSummary {
  id: string;
  targetId: string;
  targetName: string;
  operationType: OperationType;
  siteUrl: string;
  siteHost: string;
  managerUrl: string;
  managerHost: string;
  sshHost: string | null;
  sshUser: string;
  status: 'running' | 'ok' | 'warning' | 'error' | 'cancelled' | 'interrupted';
  finalStepId: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  version: string | null;
  summary: string | null;
  user: string | null;
}

/**
 * UNE ENTRÉE DU JOURNAL FORENSIQUE.
 *
 * Elle a déjà traversé le sanitizer côté serveur : aucun secret ne peut s'y
 * trouver. C'est là que la garantie est tenue — pas dans un composant
 * d'affichage qu'on pourrait oublier de mettre à jour.
 */
export interface RunJournalEntry {
  at: string;
  source: 'ENGINE' | 'HTTP' | 'SSH' | 'PM2' | 'SOCKET' | 'WORKER' | 'FINALIZATION' | 'BRIDGE' | 'SYSTEM';
  level: 'debug' | 'info' | 'warning' | 'error';
  eventCode: string;
  stepId: string | null;
  message: string | null;
  details: unknown;
  pid: number | null;
  port: number | null;
  processName: string | null;
  requestId: string | null;
  errorCode: string | null;
  stack: string | null;
}

export interface DeploymentRunFull extends DeploymentRunSummary {
  steps: RunStep[];
  structuredReport: unknown;
  markdownReport: string | null;
  errorSummary: { code?: string; message?: string; step?: string } | null;
  warnings: string[];
  /** Le journal forensique — vide pour les runs antérieurs à l'instrumentation. */
  journal?: RunJournalEntry[];
  /** Le verdict de finalisation : pourquoi un succès n'en est pas un. */
  finalization?: {
    attemptedAt: string;
    succeeded: boolean;
    error: string | null;
    targetState: string | null;
    checks: Record<string, unknown> | null;
  } | null;
}

/** Évènement du flux de duplication en direct (NDJSON). */
/**
 * LE VOCABULAIRE FERMÉ DES ÉTATS DE PHASE — miroir du registre backend.
 *
 * Il en existait deux (`failed` côté moteur, `error` côté écran), et le Manager
 * traduisait l'un en l'autre. Le registre backend (`duplication.phases.js`)
 * fixe désormais ces cinq valeurs, et une garde d'architecture vérifie que
 * cette union les reproduit exactement — la seule recopie manuelle du contrat,
 * et elle est surveillée.
 */
export type DuplicationPhaseStatus = 'pending' | 'running' | 'ok' | 'error' | 'skipped';

/**
 * LA DÉFINITION d'une phase, servie par le backend. Le Manager n'en tient plus
 * de copie : il la DEMANDE (`GET /deployment/duplication/phases`).
 */
export interface DuplicationPhaseContract {
  id: string;
  order: number;
  label: string;
  icon: string;
  group: string;
  dynamic: boolean;
  required: boolean;
  blocking: boolean;
}

/**
 * L'ÉVÉNEMENT porte des FAITS, jamais de présentation : ni `label`, ni `order`.
 * Ils se résolvent depuis le contrat à l'arrivée — les transporter recréerait
 * une seconde source de vérité, celle qui gagnerait puisqu'elle arrive après.
 */
export interface DuplicationPhaseEvent {
  type: 'phase';
  phase: string;
  status: DuplicationPhaseStatus;
  /** Renseignée pour une instance d'une famille dynamique (`backend`, `manager`…). */
  target?: string;
  /** Motif d'un `skipped`. */
  reason?: string;
  command?: string;
  targets?: string[];
  projectCount?: number;
  durationMs?: number;
}

export type DuplicateStreamEvent =
  | DuplicationPhaseEvent
  | ({ type: 'result' } & DuplicationResult)
  | { type: 'error'; code: string; message: string };

// Plan de contrôle des déploiements (P2)
export interface ControlTarget {
  id: string;
  projectKey: string;
  name: string;
  targetEnvironment: 'TEST' | 'PROD';
  siteHostname: string;
  managerHostname: string;
  apiHostname: string;
  siteUrl: string;
  managerUrl: string;
  apiUrl: string;
  backendPort: number;
  status: string;
  healthStatus: string;
  currentVersion: string | null;
  currentCommit: string | null;
  currentReleaseId: string | null;
  previousReleaseId: string | null;
  lastDeploymentRunId: string | null;
  lastSuccessfulDeploymentAt: string | null;
  lastHealthcheckAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ControlRelease {
  id: string;
  targetId: string;
  releaseKey: string;
  version: string | null;
  commitHash: string | null;
  status: string;
  deploymentRunId: string | null;
  activatedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Templates e-mail (DEV)
//
// Les identifiants et les variables viennent du CODE backend : ces types
// décrivent ce que l'API SERT, jamais ce que le Manager peut inventer. Il n'y a
// volontairement aucun type « création de template ».
// ---------------------------------------------------------------------------

export type EmailVariableType =
  | 'TEXT' | 'EMAIL' | 'PHONE' | 'DATE' | 'DATETIME' | 'MONEY' | 'URL' | 'BOOLEAN' | 'SAFE_HTML';

export interface EmailVariable {
  key: string;
  label: string;
  description: string;
  type: EmailVariableType;
  required: boolean;
}

export interface EmailValidationError {
  code: string;
  message: string;
  /** Ligne du HTML, quand l'erreur y est localisable. */
  line?: number;
  /** Clé concernée, pour les erreurs de variable. */
  variable?: string;
}

/** Validation calculée par le SERVEUR. Le Manager ne juge jamais la sécurité. */
export interface EmailTemplateValidation {
  valid: boolean;
  errors: EmailValidationError[];
}

/** Ligne de liste — le HTML complet n'y figure pas. */
/**
 * ── LES MODÈLES D'E-MAIL, VUS PAR UN CONSOMMATEUR (L12.1) ───────────────────
 *
 * Ces types décrivaient une base de modèles LOCALE, que ce Manager éditait :
 * brouillon, champs modifiables, versions, restauration. Cette base n'existe
 * plus. Le contenu appartient au Panel — il en est la seule autorité — et ce
 * qui suit décrit ce que le Panel SERT, tel qu'il le résoudrait à l'envoi.
 *
 * `usable` / `unusableReason` remplacent `valid` / `errorCount` : la question
 * n'est plus « ce contenu est-il bien écrit ? » (le Panel s'en charge, et lui
 * seul peut le corriger) mais « cet e-mail partirait-il aujourd'hui, et sinon
 * pourquoi ? ». C'est la seule question à laquelle un consommateur ait besoin
 * de répondre.
 */
export interface EmailTemplateSummary {
  templateId: string;
  name: string;
  description: string;
  subject: string;
  enabled: boolean;
  /** Une instance existe-t-elle réellement pour cette portée ? */
  configured: boolean;
  /** L'envoi aboutirait-il en l'état ? */
  usable: boolean;
  unusableReason: string | null;
  unusableMessage: string;
  version: number;
  source: 'PANEL' | 'PROJECT' | 'REGISTRY_DEFAULT' | null;
  category: string;
  /** À qui appartient la communication : le projet, ou L.Y Solution. */
  ownedBy: 'PANEL' | 'PROJECT';
  scope: { scopeType: 'PANEL' | 'PROJECT'; scopeId: string | null; label: string };
  variableCount: number;
  variableContractFingerprint: string;
  retentionClass: string | null;
  updatedAt: string | null;
}

export interface EmailTemplateDetail {
  templateId: string;
  name: string;
  description: string;
  subject: string;
  html: string;
  enabled: boolean;
  configured: boolean;
  usable: boolean;
  unusableReason: string | null;
  unusableMessage: string;
  version: number;
  source: 'PANEL' | 'PROJECT' | 'REGISTRY_DEFAULT' | null;
  scope: { scopeType: 'PANEL' | 'PROJECT'; scopeId: string | null; label: string };
  ownedBy: 'PANEL' | 'PROJECT';
  contract: {
    category: string;
    allowedVariables: string[];
    requiredVariables: string[];
    fingerprint: string;
  };
  variables: EmailVariable[];
  updatedAt: string | null;
}

/**
 * L'APERÇU RENDU PAR LE PANEL, avec SES variables d'exemple.
 *
 * Il ne porte plus de `validation` : valider un contenu suppose de pouvoir le
 * corriger, et ce Manager ne le peut pas. Un modèle irrendable se dit par
 * `usable: false` et sa raison — l'action attendue est d'ouvrir le Panel, pas
 * de relire un compte d'erreurs ici.
 */
export interface EmailTemplatePreview {
  templateId: string;
  subject: string | null;
  html: string | null;
  usedVariables?: string[];
  usable: boolean;
  configured: boolean;
  version: number;
  source: 'PANEL' | 'PROJECT' | 'REGISTRY_DEFAULT' | null;
  unusableReason: string | null;
  unusableMessage: string;
  sampleVariables: Record<string, unknown>;
  renderError: { code: string; message: string; details: EmailValidationError[] } | null;
  scope: { scopeType: 'PANEL' | 'PROJECT'; scopeId: string | null; label: string };
}

/** Ce que CE projet déclare consommer — sa seule autorité en la matière. */
export interface EmailTemplateUsageEntry {
  templateId: string;
  eventActions: string[];
  directConsumer: { source: string; reason: string } | null;
}

export interface EmailTemplateTestResult {
  templateId: string;
  operationId: string;
  providerMessageId: string | null;
  templateScope?: string | null;
  templateVersion?: number | null;
  sender?: { email: string; name: string };
  message: string;
}

export interface EmailBlocker {
  code: string;
  message: string;
}

/**
 * Prérequis d'envoi, calculés côté serveur.
 *
 * `blockers` empêche l'envoi. `warnings` reste dans le contrat mais n'est plus
 * alimenté : le domaine n'est plus évalué ici, il s'administre chez Brevo.
 */
export interface EmailReadiness {
  ready: boolean;
  blockers: EmailBlocker[];
  warnings: EmailBlocker[];
  context: {
    providerMode: 'TEST' | 'PROD' | null;
    sender: { name: string; email: string };
    template: { templateId: string; version?: number; enabled?: boolean; configured?: boolean; name?: string } | null;
  };
}

/**
 * ⚠️ `SENT` = Brevo a ACCEPTÉ. `DELIVERED` = le destinataire a reçu, et SEUL un
 * webhook peut l'affirmer. Ne jamais présenter l'un pour l'autre.
 */
export type EmailDeliveryStatus =
  | 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'BLOCKED' | 'DELIVERED' | 'BOUNCED'
  // Refus INTERNE avant tout appel fournisseur — ni un échec d'envoi, ni un rejet.
  | 'PRECONDITION_FAILED'
  // Suivi réel (webhooks transactionnels Brevo)
  | 'DEFERRED' | 'SOFT_BOUNCED' | 'HARD_BOUNCED' | 'INVALID' | 'SPAM' | 'ERROR' | 'UNSUBSCRIBED';

/** Type d'événement fournisseur NORMALISÉ (jamais un code brut Brevo). */
export type NormalizedEventType =
  | 'ACCEPTED' | 'SENT' | 'DELIVERED' | 'DEFERRED' | 'SOFT_BOUNCE' | 'HARD_BOUNCE'
  | 'BLOCKED' | 'SPAM' | 'INVALID' | 'ERROR' | 'UNSUBSCRIBED'
  | 'OPENED' | 'UNIQUE_OPENED' | 'PROXY_OPEN' | 'UNIQUE_PROXY_OPEN' | 'CLICKED';

export type WebhookProcessingStatus =
  | 'RECEIVED' | 'PROCESSED' | 'UNMATCHED' | 'IGNORED' | 'FAILED';

/** Engagement — historisé À PART. Jamais une preuve de lecture/intention. */
export interface EmailDeliveryEngagement {
  openCount: number;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  clickCount: number;
  firstClickedAt: string | null;
  lastClickedAt: string | null;
}

export interface EmailDeliveryView {
  deliveryId: string;
  eventId: string | null;
  actionExecutionId: string | null;
  templateId: string;
  templateVersion: number;
  provider: string;
  providerMode: 'TEST' | 'PROD';
  sender: { name: string; emailMasked: string };
  recipientEmailMasked: string;
  /** Sujet NON rendu (placeholders conservés) : aucune donnée personnelle. */
  subjectSnapshot: string;
  status: EmailDeliveryStatus;
  providerMessageId: string | null;
  attempts: number;
  lastErrorSafe: { code: string; message: string; retryable: boolean };
  sentAt: string | null;
  deliveredAt: string | null;
  lastEventType: NormalizedEventType | null;
  lastEventAt: string | null;
  engagement: EmailDeliveryEngagement;
  createdAt: string;
}

/** Une transition de la timeline d'une livraison. */
export interface EmailDeliveryTimelineEvent {
  webhookEventId: string;
  type: NormalizedEventType;
  occurredAt: string | null;
  receivedAt: string | null;
  statusBefore: EmailDeliveryStatus | null;
  statusAfter: EmailDeliveryStatus | null;
  diagnosticSafe: { code: string; message: string };
}

export interface EmailDeliveryDetail extends EmailDeliveryView {
  timeline: EmailDeliveryTimelineEvent[];
}

export interface EmailDeliveryPage {
  deliveries: EmailDeliveryView[];
  nextCursor: string | null;
}

/** Journal fournisseur — projection sûre (jamais idempotencyKey/recipientHash). */
export interface BrevoWebhookEventView {
  webhookEventId: string;
  providerMode: 'TEST' | 'PROD';
  providerMessageIdShort: string | null;
  eventType: string;
  normalizedEventType: NormalizedEventType | null;
  recipientEmailMasked: string;
  occurredAt: string | null;
  receivedAt: string | null;
  deliveryId: string | null;
  matched: boolean;
  processingStatus: WebhookProcessingStatus;
  rawPayloadSafe: Record<string, string>;
  lastErrorSafe: { code: string; message: string };
}

export interface BrevoWebhookEventPage {
  events: BrevoWebhookEventView[];
  nextCursor: string | null;
}

export type WebhookConfigStatus = 'NOT_CONFIGURED' | 'CONFIGURED' | 'OUT_OF_SYNC' | 'ERROR';

/** État de configuration du webhook Brevo (par mode). JAMAIS de secret. */
/* --- Webhooks gérés (vue GÉNÉRIQUE multi-providers) ------------------------ */

/** Descripteur d'un webhook géré — jamais de secret, seulement sa référence. */
export interface ManagedWebhookDescriptor {
  provider: string;
  category: string;
  mode: ProviderMode;
  expectedUrl: string;
  expectedEvents: string[];
  secretReference: string;
  remoteWebhookId: string | null;
  remoteStatus: string;
  lastSyncStatus: 'OK' | 'ERROR' | 'NEVER' | 'NOT_APPLICABLE';
  lastSyncError: { code: string; message: string } | null;
  lastSyncAt: string | null;
  lastReceivedEventAt: string | null;
  lastReceivedEventType: string | null;
  publicBackendUrl: string;
  publicUrlSource: string;
  webhookReady: boolean;
  supportsRemoteSync: boolean;
  secretConfigured?: boolean;
}

export type WebhookCapabilities = {
  createWebhook: boolean;
  updateWebhook: boolean;
  deleteWebhook: boolean;
  listWebhooks: boolean;
  repairWebhook: boolean;
  /** 'diagnostic' = meilleur diagnostic possible (aucune API n'offre d'événement de test officiel). */
  testWebhook: boolean | 'diagnostic';
};

/**
 * Rapport d'exécution PERSISTÉ d'une action webhook (Synchroniser/Réparer/
 * Tester). Construit et masqué côté backend ; `text` est le rapport complet
 * prêt à copier — le Manager ne fabrique jamais ce contenu lui-même.
 */
export interface WebhookRunReport {
  version: number;
  provider: string;
  mode: ProviderMode;
  action: 'sync' | 'repair' | 'test';
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  backendUrl: string;
  webhookUrl: string;
  urlSource: string;
  webhookReady: boolean;
  capabilities: WebhookCapabilities | null;
  credential: 'OK' | 'MISSING' | 'UNKNOWN';
  secretConfigured: boolean;
  remote: {
    status: string;
    webhookId: string | null;
    lastSyncAt: string | null;
    lastReceivedAt: string | null;
    lastReceivedType: string | null;
    lastError: { code: string; message: string } | null;
  } | null;
  results: Array<Record<string, unknown>>;
  remoteResponse: string;
  error: { code: string; message: string; stack: string } | null;
  diagnostic: string;
  suggestedFix: string;
  /** Rapport texte complet, secrets masqués — contenu du bouton « Copier le rapport ». */
  text: string;
}

export interface ProviderWebhooksEntry {
  provider: string;
  supportsWebhooks: boolean;
  capabilities?: WebhookCapabilities | null;
  webhooks: ManagedWebhookDescriptor[];
  error?: { code: string; message: string };
  /** Dernier rapport persisté (peu importe le bouton), null avant la première action. */
  lastRunReport?: WebhookRunReport | null;
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
}

export interface ManagedWebhooksPayload {
  mode: ProviderMode;
  providers: ProviderWebhooksEntry[];
}

export interface ProviderWebhooksActionReport {
  provider: string;
  supportsWebhooks?: boolean;
  skipped?: boolean;
  reason?: string;
  results: Array<Record<string, unknown> & { category?: string; ok?: boolean; skipped?: boolean }>;
  error?: { code: string; message: string };
  /** Rapport d'exécution complet, également persisté côté backend. */
  runReport?: WebhookRunReport;
}

export interface BrevoWebhookState {
  mode: 'TEST' | 'PROD';
  status: WebhookConfigStatus;
  webhookId: string | null;
  webhookUrl: string;
  expectedUrl: string;
  urlReady: boolean;
  subscribedEvents: string[];
  authenticationType: string;
  active: boolean;
  secretConfigured: boolean;
  lastSyncedAt: string | null;
  lastReceivedAt: string | null;
  previousSecretValidUntil: string | null;
  lastErrorSafe: { code: string; message: string };
}

/** Résultat d'une action de configuration (sync/diagnose/rotate/disable). */
export interface BrevoWebhookActionResult {
  state: BrevoWebhookState;
  created?: boolean;
  adopted?: boolean;
  updated?: boolean;
  rotated?: boolean;
  differences?: string[];
  status?: WebhookConfigStatus;
}

/*
 * `EmailTestSendResult` A ÉTÉ SUPPRIMÉ (L12.1) — remplacé par
 * `EmailTemplateTestResult`.
 *
 * L'ancien décrivait une LIVRAISON du projet : `deliveryId`, `attempts`,
 * `templateVersion` locale, `context` de readiness. L'envoi de test empruntait
 * en effet le pipeline du projet, avec des variables de démonstration locales.
 *
 * Il est désormais exécuté par le Panel, avec ses variables d'exemple et son
 * modèle : ce qui revient est un accusé d'acceptation, pas une livraison
 * suivie. Conserver l'ancienne forme aurait obligé à inventer un `deliveryId`
 * qui ne désigne rien.
 */

// ---------------------------------------------------------------------------
// Demandes de contact (ADMIN + DEV)
//
// Les motifs et les statuts viennent du CODE backend. Les transitions autorisées
// sont fournies par le SERVEUR au cas par cas (`allowedTransitions`) : le Manager
// ne recopie pas la table, il ne peut donc pas la laisser diverger.
// ---------------------------------------------------------------------------

export type ContactReason = 'INFORMATION' | 'QUOTE' | 'WEBSITE_ISSUE' | 'SERVICE_QUESTION' | 'OTHER';

/** État métier VISIBLE — dérivé des horodatages. Pas de workflow, pas d'attribution. */
export type ContactState = 'UNREAD' | 'READ' | 'RESOLVED';

/** `NONE` = aucune notification déclenchée (l'émission a échoué : voir §fenêtre de perte). */
export type ContactNotificationStatus = 'NONE' | 'PENDING' | 'SENT' | 'PARTIAL' | 'FAILED' | 'SKIPPED';

export interface ContactNotificationCounts {
  sent: number;
  failed: number;
  pending: number;
  skipped: number;
}

export interface ContactNotificationSummary {
  status: ContactNotificationStatus;
  eventId: string | null;
  counts: ContactNotificationCounts;
  total: number;
}

export interface ContactNotificationRecipient {
  executionId: string;
  executionStatus: string;
  attempts: number;
  maxAttempts: number;
  availableAt: string | null;
  /** Masquée (`j***@exemple.fr`) : le journal n'en connaît pas d'autre. */
  recipientEmailMasked: string | null;
  /** ⚠️ Jamais `DELIVERED` sans webhook fournisseur. */
  deliveryStatus: string | null;
  providerMessageId: string | null;
  sentAt: string | null;
  lastErrorSafe: { code: string; message: string; retryable: boolean };
}

/** Le détail est un résumé ENRICHI : même forme, plus les destinataires. */
export interface ContactNotificationDetail extends ContactNotificationSummary {
  dispatchStatus: string | null;
  occurredAt?: string;
  recipients: ContactNotificationRecipient[];
}

export interface ContactSubmissionSummary {
  submissionId: string;
  contact: { name: string; email: string; phone: string };
  reason: ContactReason;
  state: ContactState;
  submittedAt: string;
  readAt: string | null;
  resolvedAt: string | null;
  /** Extrait — le message complet n'est servi qu'au détail. */
  messagePreview: string;
  notification?: ContactNotificationSummary | null;
}

export interface ContactSubmissionDetail extends ContactSubmissionSummary {
  message: string;
  pageUrl: string;
  referrerUrl: string;
  source: string;
  metadataSafe: { userAgentFamily: string; locale: string };
  createdAt: string;
  updatedAt: string;
  notification: ContactNotificationDetail;
}

export interface ContactSubmissionPage {
  items: ContactSubmissionSummary[];
  /** Pagination par CURSEUR composite : immunisée contre une insertion entre deux pages. */
  nextCursor: string | null;
  hasMore: boolean;
  unreadCount: number;
}

/** Décision DEV prise pour une tentative de soumission (diagnostics anti-abus). */
export type ContactDecision = 'ACCEPTED' | 'DUPLICATE' | 'REJECTED_AS_SPAM';

export interface ContactDiagnosticEntry {
  at: string;
  decision: ContactDecision;
  reason: string | null;
  emailMasked: string;
  submissionId: string | null;
}

export interface ContactDiagnostics {
  decisions: ContactDiagnosticEntry[];
}

export interface ContactSubmissionFilters {
  /** Onglet : demandes actives (non résolues) ou archives (résolues). */
  resolved: boolean;
  reason: ContactReason | '';
  search: string;
}

/**
 * CONNEXION AU PANEL — miroir EXACT de ce que renvoie
 * `GET /api/panel-connection/status` (panelBridge.controller.js).
 *
 * Ne contient jamais le bridgeToken ni la moindre valeur d'identifiant : le
 * backend n'en expose que les noms de clés, et l'interface n'en demande pas
 * davantage.
 */
/**
 * IDENTITÉ DÉVELOPPEUR publiée par le Panel — telle que le projet l'a reçue.
 *
 * Le Manager l'affiche en LECTURE SEULE : le Panel en est l'autorité. Les
 * champs sont optionnels parce qu'un Panel antérieur peut n'en publier qu'une
 * partie — le projet n'invente rien à la place.
 */
export interface PanelCompanyConfiguration {
  companyId: string;
  slug: string;
  environment: string;
  version: number | null;
  identity: { name?: string; legalName?: string | null; tagline?: string | null } | null;
  branding: {
    logoUrl?: string | null;
    faviconUrl?: string | null;
    /** Descripteurs canoniques (Panel ≥ 1.5.0), à côté des URL historiques. */
    logo?: MediaDescriptor | null;
    favicon?: MediaDescriptor | null;
  } | null;
  domains: { websiteUrl?: string | null } | null;
  signer: { firstName?: string; lastName?: string; jobTitle?: string; email?: string } | null;
  references: { type: 'TEXT' | 'LINK'; icon?: string; name?: string; value?: string; order?: number }[];
  /** L'équipe publiée — vide tant qu'aucune entreprise n'a été diffusée. */
  team: TeamMember[];
  appliedAt: string | null;
  source: 'BOOTSTRAP' | 'SYNC' | null;
}

/**
 * L'ADRESSE POSTALE D'UNE ENTREPRISE — décomposée, jamais une chaîne libre.
 *
 * Stripe attend `line1` / `postal_code` / `city` / `country`, et une facture
 * électronique exigera la même décomposition. Recoller puis redécouper une
 * chaîne libre est une heuristique qui échoue sur le premier lieu-dit.
 */
export interface ClientCompanyAddress {
  line1?: string | null;
  line2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
}

/**
 * L'ENTREPRISE CLIENTE — l'identité JURIDIQUE de ce projet, publiée par le Panel.
 *
 * ══ NE PAS CONFONDRE AVEC `Company` ══════════════════════════════════════════
 *
 *   Company              la fiche COMMERCIALE de ce site : enseigne, slogan,
 *                        logos, horaires. Éditée dans ce Manager.
 *   ClientCompanyProfile CETTE interface : la société qui exploite le site —
 *                        raison sociale, SIREN, adresse de facturation,
 *                        signataire contractuel. LECTURE SEULE.
 *
 * « Garage Dupont » peut être l'enseigne d'une « SARL DUPONT AUTOMOBILES » : la
 * première s'affiche sur le site, la seconde sur la facture.
 *
 * Tous les champs sont optionnels : une fiche peut être en cours de
 * constitution côté Panel, et le projet n'invente rien à la place.
 */
export interface ClientCompanyProfile {
  clientCompanyId: string;
  version?: number;
  environment: 'TEST' | 'PROD';
  status?: string;
  legalName: string;
  tradingName?: string | null;
  legalForm?: string | null;
  siren?: string | null;
  siret?: string | null;
  vatNumber?: string | null;
  registrationCity?: string | null;
  registeredOffice?: ClientCompanyAddress | null;
  billingAddress?: ClientCompanyAddress | null;
  billingEmail?: string | null;
  phone?: string | null;
  website?: string | null;
  contractualSigner?: {
    firstName?: string;
    lastName?: string;
    jobTitle?: string;
    email?: string;
  } | null;
  readiness?: ClientCompanyReadiness | null;
}

/**
 * LE VERDICT DE COMPLÉTUDE — calculé par le PANEL, jamais ici.
 *
 * La complétude est une décision de FACTURATION : elle appartient à l'émetteur
 * des factures. Deux implémentations divergeraient au premier changement de
 * mention obligatoire — par exemple le SIREN, qui devient obligatoire sur la
 * facture électronique française au 1er septembre 2026.
 */
export interface ClientCompanyReadiness {
  state: 'READY' | 'MISSING_COMPANY' | 'MISSING_BILLING_IDENTITY' | 'MISSING_SIGNER';
  ready: boolean;
  billing: { ready: boolean; missing: string[] };
  signing: { ready: boolean; missing: string[] };
  archived?: boolean;
}

/** Ce que l'écran « Mon entreprise » reçoit. */
export interface MyCompanyView {
  linked: boolean;
  company: ClientCompanyProfile | null;
  readiness: ClientCompanyReadiness;
  appliedAt: string | null;
  /** Qui contacter pour faire corriger — publié par le Panel, jamais en dur. */
  support: { providerName: string | null; contactEmail: string | null };
}

export interface PanelConnectionStatus {
  paired: boolean;
  pairing: {
    panelUrl: string | null;
    panelName: string | null;
    projectId: string | null;
    pairedAt: string | null;
  };
  bridge: { state?: string } | null;
  /**
   * L'ÉTAT DE LA FILE DE LIVRAISON — distinct de l'état du PONT.
   *
   * `bridge.state` décrit le transport ; `outbox` décrit ce qui passe
   * réellement. Une instance CONNECTED dont toutes les écritures métier sont
   * refusées par le contrat du Panel est un état parfaitement possible, et
   * c'est exactement celui qu'on veut rendre visible.
   *
   * `rejected` compte les écritures REFUSÉES et non encore réparées. Elles ne
   * sont pas perdues : elles sont conservées et réaffirmées.
   */
  outbox: {
    pending: number;
    rejected: number;
    oldestRejection?: {
      entityType: string;
      failureClass: string | null;
      code: string | null;
      since: string | null;
      rejections: number;
    };
  };
  scheduler: unknown;
  /** Dernière identité reçue du Panel, ou `null` si aucune. */
  company: PanelCompanyConfiguration | null;
  /** Ce que le .env du projet propose — sert à pré-remplir sans ressaisie. */
  suggested: {
    panelUrl: string | null;
    publicBackendUrl: string | null;
    hasPairingCode: boolean;
  };
}

/** Réponse de `POST /api/panel-connection/pair`. */
export interface PanelPairResult {
  paired: boolean;
  panelName: string | null;
  panelUrl: string | null;
  projectId: string | null;
  discovered: {
    company: string | null;
    companyVersion: number | null;
    /**
     * Combien d'API intégrées ont été REFUSÉES à l'appairage. Depuis le lot L4,
     * aucun identifiant fournisseur ne franchit le pont : un Panel à jour n'en
     * envoie pas, un Panel antérieur en envoie et se voit refusé.
     */
    integratedApisRefused: number;
  };
}

// Version du backend (manifeste de build ou repli Git)
export interface VersionInfo {
  project: string;
  commitHash: string | null;
  shortCommit: string | null;
  branch: string | null;
  builtAt: string | null;
  isDirty: boolean;
  source: 'manifest' | 'git' | 'unavailable';
}
