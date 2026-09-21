/**
 * Constantes des demandes de contact.
 *
 * CODE-FIRST, comme le reste du dépôt : les motifs, les statuts et les
 * transitions vivent dans le code. Rien n'est configurable depuis une interface —
 * un motif inventé depuis le Manager produirait des demandes que le libellé
 * d'e-mail ne saurait pas traduire.
 */

/**
 * Motifs de contact. Le frontend envoie le CODE, jamais le libellé.
 *
 * POURQUOI UN CODE ET PAS UN TEXTE LIBRE : le libellé est de l'affichage, il se
 * retraduit et se reformule. Le code, lui, est une donnée : il sert à filtrer, à
 * router, et il traversera un jour une migration. Stocker « Demande de devis »
 * rendrait toute évolution du libellé destructrice pour l'historique.
 */
export const CONTACT_REASON = Object.freeze({
  /** Une entreprise sans présence digitale conçue — le cas nominal. */
  NEW_PRESENCE: 'NEW_PRESENCE',
  /** Une présence existe déjà et doit être reprise entièrement. */
  REDESIGN: 'REDESIGN',
  /** Un site déjà conçu par L.Y — évolution, ajout, reprise en main. */
  EVOLUTION: 'EVOLUTION',
  /** Ni l'un ni l'autre : un confrère, une presse, une proposition. */
  OTHER: 'OTHER',
});
export const CONTACT_REASON_VALUES = Object.values(CONTACT_REASON);

/**
 * Libellés — la SEULE traduction autorisée du code.
 *
 * Vit côté serveur parce que le resolver de variables en a besoin pour l'e-mail :
 * le template reçoit « Demande de devis », pas « QUOTE ». Le Manager et la
 * vitrine ont leur propre copie (ils affichent), mais l'autorité est ici.
 */
export const CONTACT_REASON_LABEL = Object.freeze({
  NEW_PRESENCE: 'Prendre rendez-vous pour une prestation',
  REDESIGN: 'Question sur une formation',
  EVOLUTION: 'Carte cadeau ou achat',
  OTHER: 'Autre demande',
});

/** Libellé d'un motif. Un code inconnu se rend tel quel plutôt que vide. */
export function contactReasonLabel(reason) {
  return CONTACT_REASON_LABEL[reason] || String(reason || '');
}

/** Statuts d'une demande. */
export const CONTACT_STATUS = Object.freeze({
  /** Reçue, personne ne s'en occupe encore. */
  NEW: 'NEW',
  /** Quelqu'un la traite. */
  IN_PROGRESS: 'IN_PROGRESS',
  /** Traitée. */
  RESOLVED: 'RESOLVED',
  /** Sortie du flux (spam passé au travers, doublon, sans objet). */
  ARCHIVED: 'ARCHIVED',
});
export const CONTACT_STATUS_VALUES = Object.values(CONTACT_STATUS);

/**
 * ÉTAT MÉTIER VISIBLE côté client — volontairement réduit à trois valeurs.
 *
 * Dérivé de `firstViewedAt` (lu) et `resolvedAt` (résolu), JAMAIS d'un workflow.
 * Le modèle conserve `status` (NEW/IN_PROGRESS/RESOLVED/ARCHIVED) pour l'historique
 * et le DEV, mais le client ne voit que : non lue → lue → résolue. Pas de
 * ticketing, pas d'attribution, pas de priorité.
 */
export const CONTACT_STATE = Object.freeze({
  UNREAD: 'UNREAD',
  READ: 'READ',
  RESOLVED: 'RESOLVED',
});

/** Dérive l'état visible d'une demande depuis ses horodatages. */
export function contactStateOf(doc) {
  if (doc?.resolvedAt) return CONTACT_STATE.RESOLVED;
  if (doc?.firstViewedAt) return CONTACT_STATE.READ;
  return CONTACT_STATE.UNREAD;
}

/**
 * Transitions autorisées — une table, pas un moteur de workflow.
 *
 * Le besoin est de refuser l'absurde (« archivée » → « en cours » sans repasser
 * par la case départ), pas de modéliser un processus. Une table de 4 entrées se
 * lit d'un coup d'œil ; un moteur configurable demanderait une interface, une
 * validation, et finirait par être configuré une seule fois.
 */
export const CONTACT_STATUS_TRANSITIONS = Object.freeze({
  NEW: [CONTACT_STATUS.IN_PROGRESS, CONTACT_STATUS.RESOLVED, CONTACT_STATUS.ARCHIVED],
  IN_PROGRESS: [CONTACT_STATUS.RESOLVED, CONTACT_STATUS.ARCHIVED],
  RESOLVED: [CONTACT_STATUS.IN_PROGRESS, CONTACT_STATUS.ARCHIVED],
  /** Une archivée revient à zéro : on la remet dans le flux, sans prétendre
   *  reprendre un traitement qui n'a pas eu lieu. */
  ARCHIVED: [CONTACT_STATUS.NEW],
});

/** La transition est-elle permise ? Le backend reste l'autorité. */
export function canTransition(from, to) {
  if (from === to) return false; // un no-op n'est pas une transition
  return (CONTACT_STATUS_TRANSITIONS[from] || []).includes(to);
}

/** Source de la demande. Une seule aujourd'hui — le champ existe pour la suite. */
export const CONTACT_SOURCE = Object.freeze({
  PUBLIC_WEBSITE: 'PUBLIC_WEBSITE',
});
export const CONTACT_SOURCE_VALUES = Object.values(CONTACT_SOURCE);

/**
 * Codes métier STABLES. Le frontend s'appuie sur EUX, jamais sur le texte d'un
 * message : un libellé se retraduit, un code non.
 */
export const CONTACT_ERROR_CODES = Object.freeze({
  CONTACT_NAME_REQUIRED: 'CONTACT_NAME_REQUIRED',
  CONTACT_NAME_TOO_LONG: 'CONTACT_NAME_TOO_LONG',
  CONTACT_COMPANY_REQUIRED: 'CONTACT_COMPANY_REQUIRED',
  CONTACT_COMPANY_TOO_LONG: 'CONTACT_COMPANY_TOO_LONG',
  CONTACT_ACTIVITY_TOO_LONG: 'CONTACT_ACTIVITY_TOO_LONG',
  CONTACT_EMAIL_INVALID: 'CONTACT_EMAIL_INVALID',
  CONTACT_PHONE_INVALID: 'CONTACT_PHONE_INVALID',
  CONTACT_REASON_INVALID: 'CONTACT_REASON_INVALID',
  CONTACT_MESSAGE_REQUIRED: 'CONTACT_MESSAGE_REQUIRED',
  CONTACT_MESSAGE_TOO_LONG: 'CONTACT_MESSAGE_TOO_LONG',
  CONTACT_PAGE_URL_INVALID: 'CONTACT_PAGE_URL_INVALID',
  CONTACT_RATE_LIMITED: 'CONTACT_RATE_LIMITED',
  /**
   * Rejet anti-abus. ⚠️ N'est JAMAIS renvoyé au visiteur : le formulaire répond
   * un succès neutre (cf. contactAbuse.js §réponse neutre). Ce code n'existe que
   * pour le journal serveur.
   */
  CONTACT_SPAM_REJECTED: 'CONTACT_SPAM_REJECTED',
  /** Transition de statut interdite (Manager). */
  CONTACT_STATUS_TRANSITION_INVALID: 'CONTACT_STATUS_TRANSITION_INVALID',
  CONTACT_NOT_FOUND: 'CONTACT_NOT_FOUND',
});

// --- Bornes ------------------------------------------------------------------

export const MAX_NAME_LENGTH = 120;
/**
 * L'ENTREPRISE ET SON ACTIVITÉ — les deux champs que le plan de site exige.
 *
 * « Entreprise, activité, projet, coordonnées — le strict nécessaire. » Écrits
 * dans le message, ils auraient été noyés dans le texte libre et impossibles à
 * lire d'un coup d'œil dans une liste ; ce sont pourtant les deux premières
 * choses qu'on veut savoir d'une demande. Ils sont donc des CHAMPS.
 *
 * `activity` est court par construction : « garage », « karting »,
 * « architecte d'intérieur ». Une borne large inviterait à y écrire un
 * paragraphe, qui a sa place dans le projet, juste en dessous.
 */
export const MAX_COMPANY_LENGTH = 160;
export const MAX_ACTIVITY_LENGTH = 120;
export const MAX_EMAIL_LENGTH = 254; // RFC 5321
export const MAX_PHONE_LENGTH = 32;
export const MAX_MESSAGE_LENGTH = 4000;
export const MIN_MESSAGE_LENGTH = 1;
export const MAX_URL_LENGTH = 500;

/** Pagination : borne dure côté serveur, jamais laissée au client. */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/**
 * Rétention des demandes — DOCUMENTAIRE, aucune suppression automatique.
 *
 * ⚠️ AUCUN index TTL n'est posé, et c'est délibéré : une demande de contact est
 * une donnée métier (un prospect, une réclamation), pas un log. La supprimer
 * automatiquement au bout de N mois est une DÉCISION MÉTIER qui n'a pas été
 * prise. Un TTL aveugle effacerait des demandes qu'on voulait garder.
 *
 * La durée ci-dessous est une RECOMMANDATION (alignée sur RETENTION_DAYS.
 * OPERATIONAL des événements) pour le jour où la politique sera décidée. La purge
 * sera alors un script explicite, comme pour les événements.
 */
export const CONTACT_RETENTION = Object.freeze({
  class: 'CONTACT_SUBMISSION',
  recommendedDays: 365,
  automatic: false,
});
