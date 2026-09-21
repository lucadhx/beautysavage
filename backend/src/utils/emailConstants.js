/**
 * Constantes du système e-mail.
 *
 * ─── UNE SEULE QUESTION MÉTIER ───────────────────────────────────────────────
 *
 * « Les e-mails partent-ils correctement depuis ce site ? »
 *
 * La réponse ne vient PAS d'un état déclaratif reconstitué depuis Brevo
 * (expéditeur vérifié, domaine authentifié, DKIM, DMARC…), mais d'un ENVOI RÉEL
 * constaté. Le seul fait qui compte est : Brevo a-t-il accepté le dernier envoi
 * de test, oui ou non.
 *
 * C'est pourquoi ce fichier ne connaît ni OTP, ni domaine, ni DNS. Toute la
 * configuration technique Brevo (expéditeur validé, authentification du domaine,
 * enregistrements DNS) se fait dans le tableau de bord Brevo et chez le
 * fournisseur DNS — jamais depuis le Manager, qui n'a pas à en reproduire l'UI.
 */

/**
 * Issue du DERNIER envoi de test, par mode.
 *
 * ─── ACCEPTÉ ≠ LIVRÉ, ET C'EST TOUTE LA CORRECTION ───────────────────────────
 *
 * `POST /v3/smtp/email` qui renvoie un `messageId` signifie UNIQUEMENT « Brevo a
 * accepté la requête de traitement » — pas « l'e-mail est parti », encore moins
 * « il a été reçu ». Brevo peut rejeter le message APRÈS coup, de façon
 * asynchrone (expéditeur non validé, adresse inexistante), et ne le signaler que
 * par webhook. Produire « Fonctionnel » sur la seule foi d'un `messageId` était
 * donc un mensonge : le message affiché comme réussi apparaissait ensuite rejeté
 * dans Brevo.
 *
 * D'où cinq états, et un seul — DELIVERED — qui autorise « Fonctionnel ».
 */
export const EMAIL_TEST_STATUS = Object.freeze({
  /** Aucun envoi de test n'a encore été tenté pour ce mode. */
  NOT_TESTED: 'NOT_TESTED',
  /** Brevo a accepté la requête (messageId reçu). Livraison NON confirmée. */
  ACCEPTED: 'ACCEPTED',
  /**
   * La messagerie du destinataire a TEMPORAIREMENT retardé la remise (`deferred`).
   *
   * Distinct d'`ACCEPTED`, et la distinction compte : `ACCEPTED` dit « nous
   * n'avons aucune nouvelle », `DEFERRED` dit « nous en avons une, et elle
   * explique l'attente ». Les confondre — ce qui était le cas — faisait afficher
   * « la confirmation n'est pas arrivée » alors que le fournisseur avait
   * précisément dit pourquoi elle tardait.
   *
   * Transitoire : une remise ultérieure reste possible, et fréquente.
   */
  DEFERRED: 'DEFERRED',
  /** Le webhook Brevo confirme la livraison. SEUL état « Fonctionnel ». */
  DELIVERED: 'DELIVERED',
  /** Brevo rejette le message APRÈS acceptation (webhook : bounce, blocked…). */
  REJECTED: 'REJECTED',
  /** La requête d'envoi elle-même échoue immédiatement (clé, réseau, 4xx). */
  FAILED: 'FAILED',
});
export const EMAIL_TEST_STATUS_VALUES = Object.values(EMAIL_TEST_STATUS);

/**
 * Statut GLOBAL affiché — dérivé, jamais stocké.
 *
 * Dérivé plutôt que persisté parce qu'il dépend de faits qui bougent
 * indépendamment : la configuration locale, la présence de la clé API du mode
 * actif, et l'issue — évolutive — du dernier test (accepté puis livré, ou rejeté).
 */
export const EMAIL_STATUS = Object.freeze({
  /** Nom, adresse ou clé API manquants. */
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  /** Configuration complète, mais jamais éprouvée par un envoi réel. */
  NOT_TESTED: 'NOT_TESTED',
  /** Dernier test accepté par Brevo, livraison pas encore confirmée. */
  ACCEPTED: 'ACCEPTED',
  /** Livraison du dernier test CONFIRMÉE par webhook. */
  FUNCTIONAL: 'FUNCTIONAL',
  /** Dernier test rejeté ou en échec d'envoi. */
  ERROR: 'ERROR',
});

/**
 * Codes d'erreur STABLES d'un envoi de test. Le Manager s'appuie sur EUX pour
 * choisir sa phrase — jamais sur le texte renvoyé par Brevo, qui n'est ni
 * traduit, ni stable, ni toujours présentable.
 *
 * La liste est volontairement COURTE : six causes qu'un commerçant peut
 * comprendre. Tout le reste tombe dans `SERVICE_UNAVAILABLE`, parce qu'un
 * message plus précis n'aiderait personne à agir.
 *
 * `NETWORK_ERROR` et `SERVICE_UNAVAILABLE` sont DISTINCTS, et la distinction
 * compte : le premier dit « nous n'avons pas pu joindre Brevo » (souvent notre
 * réseau, notre pare-feu, notre DNS), le second « Brevo a répondu qu'il ne
 * pouvait pas ». Les confondre enverrait chercher la panne du mauvais côté.
 */
export const EMAIL_ERROR_CODES = Object.freeze({
  /** Aucun nom ou aucune adresse enregistrés pour ce mode. */
  SENDER_NOT_CONFIGURED: 'SENDER_NOT_CONFIGURED',
  /** Aucune clé API Brevo pour le mode actif. */
  API_KEY_MISSING: 'API_KEY_MISSING',
  /** Brevo a refusé la clé (401/403) : clé invalide ou IP serveur non autorisée. */
  API_KEY_INVALID: 'API_KEY_INVALID',
  /**
   * Adresse expéditrice non autorisée par Brevo. Vaut pour un refus IMMÉDIAT
   * (400 à l'envoi) comme pour un rejet ASYNCHRONE constaté par webhook
   * (« sender is not valid », « validate your sender », « authenticate your
   * domain »). Le seul échec réparable par un geste du commerçant chez Brevo.
   */
  SENDER_REFUSED: 'SENDER_REFUSED',
  /** Adresse destinataire malformée — refus LOCAL, avant tout appel. */
  RECIPIENT_INVALID: 'RECIPIENT_INVALID',
  /**
   * Le destinataire n'a pas pu recevoir : rebond, adresse inexistante, blocage
   * côté réception. Constaté APRÈS acceptation, par webhook (hard/soft bounce,
   * invalid). Distinct de RECIPIENT_INVALID (forme) : ici la forme était valide.
   */
  RECIPIENT_REJECTED: 'RECIPIENT_REJECTED',
  /** Boîte destinataire momentanément indisponible (soft bounce) : peut réussir plus tard. */
  MAILBOX_UNAVAILABLE: 'MAILBOX_UNAVAILABLE',
  /** Le destinataire (ou son serveur) a classé le message en spam. */
  SPAM_REJECTED: 'SPAM_REJECTED',
  /** Erreur fournisseur signalée APRÈS acceptation, sans cause identifiable. */
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  /** Brevo injoignable : réseau, DNS, délai dépassé. Aucune réponse reçue. */
  NETWORK_ERROR: 'NETWORK_ERROR',
  /** Brevo a répondu, mais ne peut pas envoyer : quota, débit, panne (402/429/5xx). */
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  /**
   * Le suivi de livraison n'est pas opérationnel : l'envoi a été refusé AVANT
   * tout appel à Brevo. Rien n'est parti. Distinct de SERVICE_UNAVAILABLE, qui
   * dit « Brevo ne peut pas » : ici, c'est NOUS qui refusons — parce qu'envoyer
   * sans pouvoir constater l'issue reviendrait à afficher un succès inventé.
   */
  NOT_OPERATIONAL: 'BREVO_NOT_OPERATIONAL',
});

/**
 * Messages SÛRS associés aux codes — la trace PERSISTÉE de l'échec.
 *
 * Aucun ne contient de stack, de payload fournisseur, de corps brut Brevo ni de
 * code interne : le commerçant lit une cause, pas un diagnostic.
 *
 * ⚠️ Ce ne sont PAS les phrases affichées. La copie produit vit dans le Manager
 * (`lib/emailConfiguration.ts`, `TEST_ERROR_META`), parce qu'elle se retouche
 * bien plus souvent que le code métier — et la retoucher ici n'améliorerait pas
 * les traces déjà écrites en base. Le Manager mappe le CODE ; ces messages ne
 * servent que de repli et d'audit.
 */
export const EMAIL_ERROR_MESSAGES = Object.freeze({
  [EMAIL_ERROR_CODES.SENDER_NOT_CONFIGURED]:
    "Renseignez le nom d'expéditeur et l'adresse email support avant d'envoyer un test.",
  [EMAIL_ERROR_CODES.API_KEY_MISSING]: "Aucune clé API Brevo n'est configurée.",
  [EMAIL_ERROR_CODES.API_KEY_INVALID]: 'La clé API Brevo est invalide.',
  [EMAIL_ERROR_CODES.SENDER_REFUSED]:
    "L'adresse email utilisée comme expéditeur n'a pas encore été autorisée dans le compte Brevo.",
  [EMAIL_ERROR_CODES.RECIPIENT_INVALID]: "L'adresse destinataire est invalide.",
  [EMAIL_ERROR_CODES.RECIPIENT_REJECTED]: "L'adresse destinataire n'a pas pu recevoir le message.",
  [EMAIL_ERROR_CODES.MAILBOX_UNAVAILABLE]: "La boîte du destinataire est momentanément indisponible.",
  [EMAIL_ERROR_CODES.SPAM_REJECTED]: "Le message a été classé en spam par le destinataire.",
  [EMAIL_ERROR_CODES.PROVIDER_ERROR]: "Brevo a signalé une erreur après acceptation du message.",
  [EMAIL_ERROR_CODES.NETWORK_ERROR]: 'Impossible de contacter Brevo.',
  [EMAIL_ERROR_CODES.SERVICE_UNAVAILABLE]: "Le service d'envoi est momentanément indisponible.",
  [EMAIL_ERROR_CODES.NOT_OPERATIONAL]:
    "L'envoi est temporairement indisponible car le suivi de livraison Brevo n'est pas opérationnel. " +
    'Configurez ou réparez le webhook avant d’envoyer.',
});

/**
 * Message sûr d'un CODE métier, avec repli neutre : jamais de texte fournisseur.
 *
 * ⚠️ Le nom est explicite à dessein. Cette fonction s'appelait `safeErrorMessage`,
 * comme celle d'`eventPayloadSafety` — qui, elle, prend un MESSAGE et le tronque.
 * Deux fonctions homonymes acceptant toutes deux une chaîne : se tromper d'import
 * ne produisait aucune erreur, seulement un résultat silencieusement faux (un code
 * affiché tel quel, ou un message remplacé par un repli générique). Un piège armé
 * qui n'attendait qu'un import machinal.
 */
export function messageForErrorCode(code) {
  return EMAIL_ERROR_MESSAGES[code] || EMAIL_ERROR_MESSAGES[EMAIL_ERROR_CODES.SERVICE_UNAVAILABLE];
}

/**
 * Un texte de refus fournisseur désigne-t-il l'EXPÉDITEUR (et non le
 * destinataire) ? Motifs constatés dans les rejets Brevo « sender not valid ».
 *
 * Le texte n'est utilisé QUE pour classer — il n'est jamais affiché au client.
 */
export function looksLikeSenderRejection(reasonText) {
  return /\bsender\b|not valid|validate your sender|authenticate your domain|unauthori[sz]ed sender/i.test(
    String(reasonText || '')
  );
}

/** Longueurs maximales — mêmes bornes côté validateur et côté Manager. */
export const SENDER_NAME_MAX = 70;
export const SENDER_EMAIL_MAX = 254;
