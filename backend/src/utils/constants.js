export const ROLES = Object.freeze({
  DEV: 'DEV',
  ADMIN: 'ADMIN',
});

export const ROLE_VALUES = Object.values(ROLES);

/**
 * ÉTAT D'UN COMPTE LOCAL (LOT 2C).
 *
 * `PENDING_ACTIVATION` n'est pas un compte « désactivé » : c'est un compte qui
 * n'a JAMAIS eu de mot de passe. La nuance compte — il n'y a rien à révoquer,
 * rien à faire fuiter, et l'activation n'est pas une réactivation.
 */
export const USER_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  PENDING_ACTIVATION: 'PENDING_ACTIVATION',
});

export const USER_STATUS_VALUES = Object.values(USER_STATUS);

/**
 * ── HÉRITAGE — deux valeurs qui en portaient trois ──────────────────────────
 *
 * `PRICING_MODES` reste servi par `/meta` et lu par les items tarifés
 * (prestations complémentaires, suppléments) le temps de leur propre bascule.
 * Il ne décrit PLUS la tarification d'un pack : voir `PRICE_KINDS`.
 *
 * Le défaut qu'il portait mérite d'être écrit, parce qu'il a coûté cher :
 * `FIXED` ne voulait pas dire « prix fixe » à l'affichage. La vitrine rendait
 * « dès 80 € » et le Manager nommait l'option « À partir de ». Il était donc
 * IMPOSSIBLE d'annoncer un prix ferme — un forfait à 80 € s'affichait
 * « dès 80 € », et « à partir de 700 € » n'était juste que par accident.
 */
export const PRICING_MODES = Object.freeze({
  FIXED: 'FIXED', // prix fixe
  QUOTE: 'QUOTE', // sur devis
});

/**
 * LA NATURE D'UN MONTANT — et elle ne dit rien du devis.
 *
 * ══ POURQUOI DEUX AXES, ET NON UNE ÉNUMÉRATION DE PLUS ══════════════════════
 *
 * « Combien ça coûte » et « faut-il vous rappeler » sont deux questions
 * indépendantes, et les fondre dans un seul champ interdit le cas le plus
 * courant du métier : « à partir de 700 €, sur devis ». Une énumération à
 * quatre valeurs l'aurait couvert ; elle en aurait exigé six à la prochaine
 * combinaison. Deux axes en couvrent quatre, et resteront justes.
 *
 *   FIXED  le montant est FERME            → « 80 € »
 *   FROM   le montant est un PLANCHER      → « À partir de 80 € »
 *   NONE   il n'y a pas de montant public  → rien, ou « Sur devis »
 */
export const PRICE_KINDS = Object.freeze({
  FIXED: 'FIXED',
  FROM: 'FROM',
  NONE: 'NONE',
});

export const PRICE_KIND_VALUES = Object.freeze(Object.values(PRICE_KINDS));

/**
 * DE QUOI UNE LIGNE INCLUSE EST FAITE.
 *
 * `TEXT` est une ligne libre — ce que le forfait comprend, écrit à la main.
 * `PACK_REF` DÉSIGNE un autre forfait par son identifiant, jamais par son nom :
 * renommer « Simply One » en « Simply One Premium » doit se voir partout sans
 * migration, et un nom recopié aurait figé l'ancien.
 */
export const INCLUDED_ITEM_TYPES = Object.freeze({
  TEXT: 'TEXT',
  PACK_REF: 'PACK_REF',
});

export const INCLUDED_ITEM_TYPE_VALUES = Object.freeze(Object.values(INCLUDED_ITEM_TYPES));

export const REFERENCE_TYPES = Object.freeze({
  TEXT: 'TEXT',
  LINK: 'LINK',
});

export const SITE_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
});

export const MAX_GALLERY_IMAGES = 50;

// Jours de la semaine — identifiants techniques stables (jamais les libellés FR).
export const WEEK_DAYS = [
  { id: 'monday', label: 'Lundi' },
  { id: 'tuesday', label: 'Mardi' },
  { id: 'wednesday', label: 'Mercredi' },
  { id: 'thursday', label: 'Jeudi' },
  { id: 'friday', label: 'Vendredi' },
  { id: 'saturday', label: 'Samedi' },
  { id: 'sunday', label: 'Dimanche' },
];
export const DAY_IDS = WEEK_DAYS.map((d) => d.id);

export const DEFAULT_TIMEZONE = 'Europe/Paris';

// URL publiques par défaut (SystemConfiguration.network). Centralisées ici :
// ne jamais coder ces valeurs à plusieurs endroits.
export const NETWORK_DEFAULTS = Object.freeze({
  backendUrl: 'http://localhost:6070',
  managerUrl: 'http://localhost:6071',
  websiteUrl: 'http://localhost:6062',
});

// Limites de caractères des bannières promotionnelles (voir promotion module).
export const PROMO_LIMITS = { mainText: 60, secondaryText: 90, ctaLabel: 24 };

/**
 * Social / contact media catalog. Each medium is preconfigured; the admin
 * simply enables the ones they want and fills the appropriate value.
 * `kind` drives the input type + validation on the frontend.
 */
export const MEDIA_CATALOG = [
  { key: 'phone', label: 'Téléphone', icon: 'Phone', kind: 'tel', placeholder: '+33 6 12 34 56 78' },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'MessageCircle', kind: 'tel', placeholder: '+33 6 12 34 56 78' },
  { key: 'email', label: 'Email', icon: 'Mail', kind: 'email', placeholder: 'contact@entreprise.com' },
  { key: 'instagram', label: 'Instagram', icon: 'Instagram', kind: 'handle', placeholder: '@monentreprise' },
  { key: 'facebook', label: 'Facebook', icon: 'Facebook', kind: 'url', placeholder: 'https://facebook.com/...' },
  { key: 'tiktok', label: 'TikTok', icon: 'Music2', kind: 'handle', placeholder: '@monentreprise' },
  { key: 'snapchat', label: 'Snapchat', icon: 'Ghost', kind: 'handle', placeholder: 'monentreprise' },
  { key: 'googleMaps', label: 'Google Maps', icon: 'MapPin', kind: 'url', placeholder: 'https://maps.google.com/...' },
  { key: 'address', label: 'Adresse', icon: 'Home', kind: 'text', placeholder: '12 rue du Lavage, 06000 Nice' },
];

export const MEDIA_KEYS = MEDIA_CATALOG.map((m) => m.key);
