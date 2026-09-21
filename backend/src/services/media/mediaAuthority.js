/**
 * L'AUTORITÉ D'UN MÉDIA — la frontière, et il n'y en a qu'une.
 *
 * ══ LE DÉFAUT QUE CE MODULE FERME ═══════════════════════════════════════════
 *
 * La projection décidait « média du projet » sur la présence d'une CLÉ D'OBJET :
 *
 *     if (descriptor?.objectKey) resolveProjectMediaUrl(descriptor, env)
 *
 * Cette condition confond « possède un objectKey » avec « appartient au
 * projet ». Le Panel décrit ses propres médias exactement de la même façon —
 * clé, empreinte, dimensions. Le logo du développeur, servi par
 * `panel.ly-solution.com`, était donc recomposé contre le domaine du CLIENT :
 *
 *     https://panel.ly-solution.com/uploads/7dda…-bd65e2ad257b.webp   (vrai)
 *     https://demo-sbauto06.ly-solution.com/uploads/7dda…webp         (404)
 *
 * ══ CE QUE CE MODULE REFUSE DE FAIRE ════════════════════════════════════════
 *
 * Déduire. Ni l'hôte, ni la clé d'objet, ni l'identifiant de média, ni le type
 * métier, ni la position du champ, ni l'appelant ne disent à QUI un média
 * appartient. Une seule chose le dit : le descripteur, parce que son émetteur
 * l'a écrit.
 *
 * ══ LA SEULE TOLÉRANCE, ET ELLE EST EN LECTURE SEULE ════════════════════════
 *
 * Les projections persistées AVANT ce champ n'ont pas d'autorité déclarée.
 * Elles restent lisibles — mais l'autorité leur est alors donnée par le SCHÉMA
 * du champ qui les porte, déclaré par l'appelant, jamais devinée à partir de
 * leur contenu. Hors de cette compatibilité explicitement prévue :
 *
 *     FAIL CLOSED.
 *
 * Aucun repli PANEL → PROJECT, aucun repli PROJECT → PANEL. Une image absente
 * se voit ; une image prise chez quelqu'un d'autre, non.
 */

/** Le média appartient au Panel : il reste sur le Panel, et y est servi. */
export const PANEL = 'PANEL';
/** Le média appartient au projet : son adresse suit la destination active. */
export const PROJECT = 'PROJECT';

const AUTORITES = new Set([PANEL, PROJECT]);

/** Hôtes qui ne désignent que la machine courante. */
const HOTES_LOCAUX = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]']);

/**
 * Un objet est-il un DESCRIPTEUR, ou un simple vide ?
 *
 * On ne teste PAS `objectKey` seul : un descripteur du Panel n'en porte pas
 * toujours, et le tester ferait retomber ces médias sur la chaîne historique —
 * c'est-à-dire sur l'adresse qu'on cherche précisément à ne plus lire.
 */
export function isMediaDescriptor(valeur) {
  if (!valeur || typeof valeur !== 'object') return false;
  return Boolean(valeur.authority || valeur.objectKey || valeur.url || valeur.mediaId);
}

/** L'autorité DÉCLARÉE par le descripteur, ou `null` s'il n'en déclare pas. */
export function declaredAuthority(descriptor) {
  const brut = String(descriptor?.authority ?? '').trim().toUpperCase();
  return AUTORITES.has(brut) ? brut : null;
}

/**
 * QUI DÉTIENT CE MÉDIA.
 *
 * @param {object|null} descriptor
 * @param {object} [contexte]
 * @param {'PANEL'|'PROJECT'|null} [contexte.legacyAuthority]
 *        L'autorité que le SCHÉMA du champ garantit pour les projections
 *        antérieures à `authority`. L'appelant la déclare parce qu'il connaît
 *        le champ qu'il lit ; elle n'est jamais tirée du descripteur lui-même.
 * @returns {'PANEL'|'PROJECT'|null}  `null` = inconnue, donc refusée.
 */
export function authorityOf(descriptor, { legacyAuthority = null } = {}) {
  if (!isMediaDescriptor(descriptor)) return null;

  const declaree = declaredAuthority(descriptor);
  if (declaree) return declaree;

  const heritee = String(legacyAuthority ?? '').trim().toUpperCase();
  return AUTORITES.has(heritee) ? heritee : null;
}

/**
 * ADRESSE D'UN MÉDIA DÉTENU PAR LE PANEL — son URL, telle qu'elle a été publiée.
 *
 * ── AUCUNE RECOMPOSITION ────────────────────────────────────────────────────
 * On ne touche ni à l'hôte, ni au chemin. Le Panel a résolu cette adresse
 * contre SA destination active au moment où il l'a publiée ; la recomposer ici
 * reviendrait à décider, depuis le projet, où vivent les fichiers de quelqu'un
 * d'autre. C'est exactement le défaut d'origine.
 *
 * ── CE QUI EST VÉRIFIÉ, ET POURQUOI ─────────────────────────────────────────
 *   · adresse ABSOLUE : un chemin relatif serait servi par le site du client ;
 *   · HTTPS hors boucle locale : une image en clair casse la page en HTTPS ;
 *   · `publicationState` = PUBLISHED quand il est déclaré : un média que le
 *     Panel sait local n'est joignable de nulle part ailleurs ;
 *   · environnement compatible : une image de recette n'a rien à faire en
 *     production, et réciproquement.
 *
 * Un descripteur qui échoue ici rend `null` — jamais une adresse approchante.
 */
export function resolvePanelOwnedMedia(descriptor, environment = null) {
  const brut = String(descriptor?.url ?? '').trim();
  if (!brut) return { url: null, absolute: false, reason: 'PANEL_SANS_ADRESSE' };
  if (!/^https?:\/\//i.test(brut)) return { url: null, absolute: false, reason: 'PANEL_ADRESSE_RELATIVE' };

  let adresse;
  try {
    adresse = new URL(brut);
  } catch {
    return { url: null, absolute: false, reason: 'PANEL_ADRESSE_ILLISIBLE' };
  }

  const hote = adresse.hostname.toLowerCase();
  const local = HOTES_LOCAUX.has(hote);
  // HTTPS exigé partout SAUF sur une boucle locale : un Panel de développement
  // se sert lui-même en clair, et l'exiger interdirait tout aperçu local.
  if (!local && adresse.protocol !== 'https:') {
    return { url: null, absolute: false, reason: 'PANEL_SANS_TLS' };
  }

  // `publicationState` n'est pas porté par les projections antérieures. Absent, on ne
  // conclut rien : une projection antérieure reste lisible. Déclaré autre que
  // PUBLISHED, il dit que personne d'autre ne peut atteindre ce fichier.
  const etat = descriptor?.publicationState ?? null;
  if (etat && etat !== 'PUBLISHED') {
    return { url: null, absolute: false, reason: 'PANEL_NON_PUBLIE' };
  }

  if (descriptor?.environment && environment && descriptor.environment !== environment) {
    return { url: null, absolute: false, reason: 'ENVIRONNEMENT_DIFFERENT' };
  }

  return { url: brut, absolute: !local, reason: 'PANEL_ADRESSE_PUBLIEE' };
}

/**
 * LE COMMUTATEUR — une autorité, une résolution, et rien entre les deux.
 *
 * @param {object|null} descriptor
 * @param {object} [contexte]
 * @param {string|null} [contexte.environment]      environnement du LECTEUR
 * @param {'PANEL'|'PROJECT'|null} [contexte.legacyAuthority]
 * @returns {Promise<{url:string|null, absolute:boolean, reason:string, authority:string|null}>}
 */
export async function resolveMediaUrl(descriptor, { environment = null, legacyAuthority = null } = {}) {
  const autorite = authorityOf(descriptor, { legacyAuthority });

  switch (autorite) {
    case PANEL:
      return { ...resolvePanelOwnedMedia(descriptor, environment), authority: PANEL };

    case PROJECT: {
      const { resolveProjectMediaUrl } = await import('./projectMedia.service.js');
      return { ...(await resolveProjectMediaUrl(descriptor, environment)), authority: PROJECT };
    }

    default:
      /**
       * FAIL CLOSED. On ne « tente » pas l'une puis l'autre : un descripteur
       * dont on ignore l'autorité résolu au hasard produirait, une fois sur
       * deux, l'adresse d'un fichier appartenant à quelqu'un d'autre.
       */
      return { url: null, absolute: false, reason: 'AUTORITE_INCONNUE', authority: null };
  }
}

/**
 * LE DESCRIPTEUR EST-IL DANS L'AUTORITÉ ATTENDUE PAR CE CHAMP ?
 *
 * Un champ de branding du Panel ne doit jamais recevoir un média du projet, ni
 * l'inverse. Le contrôle est structurel : il ne corrige rien, il REFUSE.
 */
export function assertAuthority(descriptor, attendue) {
  const declaree = declaredAuthority(descriptor);
  return declaree === null || declaree === attendue;
}

export default {
  PANEL,
  PROJECT,
  isMediaDescriptor,
  declaredAuthority,
  authorityOf,
  resolvePanelOwnedMedia,
  resolveMediaUrl,
  assertAuthority,
};
