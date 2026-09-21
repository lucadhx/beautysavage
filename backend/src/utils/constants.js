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

export const SITE_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
});

export const MAX_GALLERY_IMAGES = 50;

// URL publiques par défaut (SystemConfiguration.network). Centralisées ici :
// ne jamais coder ces valeurs à plusieurs endroits.
export const NETWORK_DEFAULTS = Object.freeze({
  backendUrl: 'http://localhost:6100',
  managerUrl: 'http://localhost:6101',
  websiteUrl: 'http://localhost:6102',
});

/**
 * Social / contact media catalog. Each medium is preconfigured; the admin
 * simply enables the ones they want and fills the appropriate value.
 * `kind` drives the input type + validation on the frontend.
 */
export const MEDIA_CATALOG = [
  /*
    L'EXEMPLE NE DÉSIGNE PERSONNE — et c'est une exigence, pas un détail.

    Le repère valait `contact@ly-solution.com` : l'adresse RÉELLE du projet
    source. Recopiée par le moteur de duplication, elle proposait à un garage,
    à une entreprise de nettoyage ou à un circuit de karting de saisir
    l'adresse d'une autre société comme exemple de la sienne — et un exemple
    qui décrit quelqu'un d'autre finit par être saisi tel quel.

    `exemple.fr` n'appartient à aucun client et ne peut recevoir aucun message.
  */
  { key: 'email', label: 'Adresse e-mail', icon: 'Mail', kind: 'email', placeholder: 'contact@exemple.fr' },
  { key: 'phone', label: 'Téléphone', icon: 'Phone', kind: 'tel', placeholder: '+33 6 12 34 56 78' },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'MessageCircle', kind: 'tel', placeholder: '+33 6 12 34 56 78' },
  { key: 'linkedin', label: 'LinkedIn', icon: 'Linkedin', kind: 'url', placeholder: 'https://www.linkedin.com/company/...' },
  { key: 'instagram', label: 'Instagram', icon: 'Instagram', kind: 'handle', placeholder: '@lysolution' },
  { key: 'address', label: 'Adresse', icon: 'MapPin', kind: 'text', placeholder: 'Nice, France' },
];

export const MEDIA_KEYS = MEDIA_CATALOG.map((m) => m.key);
