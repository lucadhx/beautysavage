/**
 * Constantes du domaine « contrat ».
 *
 * Le contrat pilote l'activation commerciale du site. Machine à états explicite
 * (pas de booléens contradictoires). Les statuts internes sont INDÉPENDANTS des
 * noms Stripe/Yousign : un mapping traduit les statuts externes vers ceux-ci.
 */

export const CONTRACT_STATUS = Object.freeze({
  DRAFT: 'DRAFT', // création, PDF + config modifiables
  PENDING_DEV_SIGNATURE: 'PENDING_DEV_SIGNATURE', // validé, en attente signature DEV
  INACTIVE: 'INACTIVE', // DEV signé, disponible pour l'ADMIN, site NON actif
  ACTIVATION_IN_PROGRESS: 'ACTIVATION_IN_PROGRESS', // parcours ADMIN en cours
  ACTIVE: 'ACTIVE', // signé + payé + abonné : site actif
  CANCEL_AT_PERIOD_END: 'CANCEL_AT_PERIOD_END', // résilié, actif jusqu'à échéance
  ENDED: 'ENDED', // fin effective (fin de période) : site suspendu
  CANCELLED: 'CANCELLED', // annulé avant activation
  FAILED: 'FAILED', // échec bloquant
});
export const CONTRACT_STATUS_VALUES = Object.values(CONTRACT_STATUS);

/** Statuts « en cours de vie » (un seul contrat peut y être à la fois). */
export const LIVE_CONTRACT_STATUSES = Object.freeze([
  CONTRACT_STATUS.ACTIVE,
  CONTRACT_STATUS.CANCEL_AT_PERIOD_END,
]);

/** Statuts pour lesquels le site peut être servi (contrat honoré). */
export const SITE_SERVEABLE_STATUSES = Object.freeze([
  CONTRACT_STATUS.ACTIVE,
  CONTRACT_STATUS.CANCEL_AT_PERIOD_END, // résilié mais payé jusqu'à la fin de période
]);

/** Étapes du parcours d'activation ADMIN. */
export const ACTIVATION_STEP = Object.freeze({
  SIGNATURE: 'SIGNATURE',
  LAUNCH_FEE: 'LAUNCH_FEE',
  SUBSCRIPTION: 'SUBSCRIPTION',
  ACTIVATION: 'ACTIVATION',
  DONE: 'DONE',
});
export const ACTIVATION_STEP_VALUES = Object.values(ACTIVATION_STEP);

/** Rôles de signataires (V1 : deux parties). */
export const SIGNER_ROLE = Object.freeze({
  DEVELOPER: 'DEVELOPER',
  CLIENT: 'CLIENT',
});
export const SIGNER_ROLE_VALUES = Object.values(SIGNER_ROLE);

export const PAYMENT_TYPE = Object.freeze({
  LAUNCH_FEE: 'LAUNCH_FEE',
  SUBSCRIPTION: 'SUBSCRIPTION',
});
export const PAYMENT_TYPE_VALUES = Object.values(PAYMENT_TYPE);

/**
 * Statut d'un PAIEMENT (journal financier `Payment`). Cycle de vie d'une tentative
 * Stripe unique (frais de lancement) : PENDING (tentative créée) -> PROCESSING
 * (paiement asynchrone en attente de confirmation bancaire) -> PAID | FAILED, ou
 * CANCELLED / EXPIRED (session abandonnée/expirée), REFUNDED (remboursement Stripe).
 */
export const PAYMENT_STATUS = Object.freeze({
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  REFUNDED: 'REFUNDED',
});
export const PAYMENT_STATUS_VALUES = Object.values(PAYMENT_STATUS);

/** Statuts terminaux d'un paiement (jamais retraités par la réconciliation). */
export const PAYMENT_TERMINAL_STATUSES = Object.freeze([
  PAYMENT_STATUS.PAID,
  PAYMENT_STATUS.REFUNDED,
]);

/** Statuts « ouverts » réutilisables (une tentative en cours peut être reprise). */
export const PAYMENT_OPEN_STATUSES = Object.freeze([
  PAYMENT_STATUS.PENDING,
  PAYMENT_STATUS.PROCESSING,
]);

/**
 * Projection métier des frais de lancement dans le contrat (`stripe.launchFee.status`).
 * Vue LISIBLE de l'état courant — source de vérité = le journal `Payment`. Ajoute
 * NOT_REQUIRED (frais non configurés) et CHECKOUT_CREATED (session ouverte, en
 * attente de retour) aux statuts de paiement.
 */
export const LAUNCH_FEE_STATUS = Object.freeze({
  NOT_REQUIRED: 'NOT_REQUIRED',
  PENDING: 'PENDING',
  CHECKOUT_CREATED: 'CHECKOUT_CREATED',
  PROCESSING: 'PROCESSING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  REFUNDED: 'REFUNDED',
});
export const LAUNCH_FEE_STATUS_VALUES = Object.values(LAUNCH_FEE_STATUS);

/**
 * Statut de l'ABONNEMENT — projection lisible dans le contrat
 * (`stripe.subscription.status`). Superset couvrant le cycle Stripe complet +
 * les états métier (NOT_REQUIRED, PENDING, CHECKOUT_CREATED, CANCEL_AT_PERIOD_END).
 * Source de vérité = Stripe (webhooks) + réconciliation. `NONE` = valeur par
 * défaut avant toute évaluation.
 */
export const SUBSCRIPTION_STATUS = Object.freeze({
  NONE: 'NONE',
  NOT_REQUIRED: 'NOT_REQUIRED',
  PENDING: 'PENDING',
  CHECKOUT_CREATED: 'CHECKOUT_CREATED',
  INCOMPLETE: 'INCOMPLETE',
  TRIALING: 'TRIALING',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  UNPAID: 'UNPAID',
  PAUSED: 'PAUSED',
  CANCEL_AT_PERIOD_END: 'CANCEL_AT_PERIOD_END',
  CANCELLED: 'CANCELLED',
  ENDED: 'ENDED',
  FAILED: 'FAILED',
});
export const SUBSCRIPTION_STATUS_VALUES = Object.values(SUBSCRIPTION_STATUS);

/** Statuts d'abonnement conférant l'accès (entitlement actif). */
export const SUBSCRIPTION_ENTITLED_STATUSES = Object.freeze([
  SUBSCRIPTION_STATUS.ACTIVE,
  SUBSCRIPTION_STATUS.TRIALING,
  SUBSCRIPTION_STATUS.CANCEL_AT_PERIOD_END, // résilié mais payé jusqu'à l'échéance
]);

/** Statuts d'abonnement terminaux (jamais recréés ; abonnement clos). */
export const SUBSCRIPTION_TERMINAL_STATUSES = Object.freeze([
  SUBSCRIPTION_STATUS.CANCELLED,
  SUBSCRIPTION_STATUS.ENDED,
  SUBSCRIPTION_STATUS.FAILED,
]);

export const INVOICE_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  OPEN: 'OPEN',
  PAID: 'PAID',
  UNCOLLECTIBLE: 'UNCOLLECTIBLE',
  VOID: 'VOID',
});
export const INVOICE_STATUS_VALUES = Object.values(INVOICE_STATUS);

/** Statut de la demande de signature (interne, mappé depuis Yousign). */
export const SIGNATURE_STATUS = Object.freeze({
  NONE: 'NONE',
  DRAFT: 'DRAFT',
  ONGOING: 'ONGOING',
  DONE: 'DONE',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
  CANCELED: 'CANCELED',
});
export const SIGNATURE_STATUS_VALUES = Object.values(SIGNATURE_STATUS);

/**
 * État de signature DÉRIVÉ (exposé au frontend). Vue « métier » lisible du
 * parcours de signature, calculée depuis yousign.* — jamais un statut arbitraire.
 */
export const SIGNATURE_STATE = Object.freeze({
  NONE: 'NONE', // pas de demande de signature
  REQUESTED: 'REQUESTED', // demande créée, personne n'a signé
  DEV_SIGNED: 'DEV_SIGNED', // développeur signé, en attente ADMIN
  FULLY_SIGNED: 'FULLY_SIGNED', // les deux ont signé (Yousign done)
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
  CANCELED: 'CANCELED',
});

export const WEBHOOK_PROVIDER = Object.freeze({ STRIPE: 'STRIPE', YOUSIGN: 'YOUSIGN' });
export const WEBHOOK_PROVIDER_VALUES = Object.values(WEBHOOK_PROVIDER);

/**
 * ══ L'ÉTAT D'UN ÉVÉNEMENT REÇU — ET NON SA SEULE EXISTENCE ══════════════════
 *
 * ── LE DÉFAUT QUE CETTE MACHINE FERME ──────────────────────────────────────
 *
 * `PENDING` était écrit AVANT le traitement, comme verrou. La question posée au
 * rejeu était « la ligne existe-t-elle ? », et la réponse valait acquittement :
 *
 *     webhook → ligne PENDING → CRASH → Stripe rejoue → « doublon »
 *                                                     → effet métier PERDU
 *
 * La ligne prouvait qu'on avait VU l'événement, pas qu'on l'avait APPLIQUÉ. Le
 * rejeu du fournisseur — la seule réparation offerte, et elle était gratuite —
 * était refusé au nom d'une idempotence qui ne protégeait plus rien.
 *
 *     L'EXISTENCE D'UNE LIGNE N'EST PAS LA PREUVE D'UN TRAITEMENT.
 *
 * ── LA MACHINE ─────────────────────────────────────────────────────────────
 *
 *   PENDING  ──réclamation──▶  PROCESSING  ──▶  PROCESSED    terminal
 *                                   │       ──▶  IGNORED      terminal
 *                                   │       ──▶  FAILED       reprenable
 *                                   │       ──▶  DEAD_LETTER  terminal, supervisé
 *                                   └── bail expiré ──▶ reprenable
 */
export const WEBHOOK_PROCESSING_STATUS = Object.freeze({
  /** Enregistré, jamais réclamé. N'existe plus qu'en héritage : une ligne neuve naît PROCESSING. */
  PENDING: 'PENDING',
  /** Réclamé, sous bail. Un second processus n'y touche pas. */
  PROCESSING: 'PROCESSING',
  /** Appliqué. **Le seul état où un rejeu est un doublon SÛR.** */
  PROCESSED: 'PROCESSED',
  /** Échec REPRENABLE : dépendance indisponible, redémarrage, délai dépassé. */
  FAILED: 'FAILED',
  /** Reçu, sans effet à produire (hors périmètre, mode inactif). Terminal. */
  IGNORED: 'IGNORED',
  /**
   * On renonce, et on le dit. Erreur terminale, ou trop de tentatives.
   *
   * Jamais silencieux : c'est ce qui distingue un abandon assumé d'un événement
   * perdu. Sans lui, un événement toxique échouerait à chaque rejeu et à chaque
   * démarrage, indéfiniment.
   */
  DEAD_LETTER: 'DEAD_LETTER',
});

/** Les états d'où plus rien ne repart. Un rejeu s'y arrête, sans effet. */
export const WEBHOOK_TERMINAL_STATUSES = Object.freeze([
  WEBHOOK_PROCESSING_STATUS.PROCESSED,
  WEBHOOK_PROCESSING_STATUS.IGNORED,
  WEBHOOK_PROCESSING_STATUS.DEAD_LETTER,
]);

export const AUDIT_ACTOR_TYPE = Object.freeze({
  DEV: 'DEV',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM',
  WEBHOOK: 'WEBHOOK',
});
export const AUDIT_ACTOR_TYPE_VALUES = Object.values(AUDIT_ACTOR_TYPE);

/** Actions d'audit tracées (libre mais catalogué pour cohérence). */
export const CONTRACT_AUDIT_ACTION = Object.freeze({
  CREATED: 'CREATED',
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  SIGNATURE_CONFIGURED: 'SIGNATURE_CONFIGURED',
  VALIDATED_LOCKED: 'VALIDATED_LOCKED',
  DEV_SIGNATURE_STARTED: 'DEV_SIGNATURE_STARTED',
  DEV_SIGNED: 'DEV_SIGNED',
  ADMIN_SIGNED: 'ADMIN_SIGNED',
  FULLY_SIGNED: 'FULLY_SIGNED',
  SIGNED_PDF_FETCHED: 'SIGNED_PDF_FETCHED',
  /**
   * La PREUVE D'AUDIT est arrivée au dossier.
   *
   * Une ligne à part de `SIGNED_PDF_FETCHED` : les deux pièces arrivent
   * séparément, et peuvent arriver à des moments différents. Une seule ligne
   * pour les deux laisserait croire qu'on a le certificat quand on n'a que le
   * contrat — sur un dossier juridique, c'est la mauvaise erreur.
   */
  SIGNATURE_CERTIFICATE_FETCHED: 'SIGNATURE_CERTIFICATE_FETCHED',
  SIGNATURE_FAILED: 'SIGNATURE_FAILED', // refusée / expirée / annulée
  SIGNATURE_RESTARTED: 'SIGNATURE_RESTARTED',
  CHECKOUT_CREATED: 'CHECKOUT_CREATED',
  PAYMENT_PROCESSING: 'PAYMENT_PROCESSING',
  PAYMENT_SUCCEEDED: 'PAYMENT_SUCCEEDED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_CANCELLED: 'PAYMENT_CANCELLED',
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',
  PAYMENT_SYNCED: 'PAYMENT_SYNCED',
  SUBSCRIPTION_CHECKOUT_CREATED: 'SUBSCRIPTION_CHECKOUT_CREATED',
  SUBSCRIPTION_ACTIVATED: 'SUBSCRIPTION_ACTIVATED',
  SUBSCRIPTION_PAYMENT_SUCCEEDED: 'SUBSCRIPTION_PAYMENT_SUCCEEDED',
  SUBSCRIPTION_PAYMENT_FAILED: 'SUBSCRIPTION_PAYMENT_FAILED',
  SUBSCRIPTION_PAST_DUE: 'SUBSCRIPTION_PAST_DUE',
  SUBSCRIPTION_ENDED: 'SUBSCRIPTION_ENDED',
  SUBSCRIPTION_SYNCED: 'SUBSCRIPTION_SYNCED',
  ACTIVATED: 'ACTIVATED',
  /**
   * LE CLIENT EST ALLÉ CHEZ LE FOURNISSEUR — et il faut pouvoir le raconter.
   *
   * L'ouverture du portail n'est PAS un acte financier : elle ne change ni le
   * contrat, ni l'abonnement. Elle explique en revanche ce qui arrive juste
   * après — un moyen de paiement remplacé, une résiliation programmée — et
   * l'attribue à une personne, là où les lignes suivantes ne portent que
   * `WEBHOOK`. Sans elle, la résiliation surgit du provider sans cause visible.
   *
   * Cette action était écrite en chaîne littérale par le contrôleur, donc
   * absente de la table des libellés : le Manager affichait
   * `BILLING_PORTAL_OPENED` en clair au client.
   */
  BILLING_PORTAL_OPENED: 'BILLING_PORTAL_OPENED',
  CANCELLATION_REQUESTED: 'CANCELLATION_REQUESTED',
  /**
   * LA RÉSILIATION PROGRAMMÉE A ÉTÉ RETIRÉE — un acte à part entière.
   *
   * Distincte de `CANCELLATION_REQUESTED` et non son annulation implicite : le
   * dossier doit pouvoir raconter qu'un client a résilié PUIS s'est ravisé. Une
   * seule ligne pour les deux laisserait croire que la première n'a jamais eu
   * lieu — or elle a eu lieu, elle a été affichée, et elle explique pourquoi
   * quelqu'un a peut-être appelé entre-temps.
   */
  CANCELLATION_REVOKED: 'CANCELLATION_REVOKED',
  CONTRACT_ENDED: 'CONTRACT_ENDED',
  SITE_SUSPENDED: 'SITE_SUSPENDED',
  SITE_ACTIVATED: 'SITE_ACTIVATED',
  /** La protection contractuelle a été activée ou désactivée. */
  CONTRACT_PROTECTION_CHANGED: 'CONTRACT_PROTECTION_CHANGED',
  /**
   * Le délai de grâce en cas d'impayé a été fixé, modifié ou retiré (L10.6B-1).
   *
   * Cette politique décide du jour où un site peut être fermé pour une facture
   * refusée. La changer est une décision commerciale, et elle laisse une trace
   * datée et nominative — pas une modification silencieuse d'un réglage.
   */
  PAYMENT_GRACE_POLICY_CHANGED: 'PAYMENT_GRACE_POLICY_CHANGED',
  /**
   * ══ LA SUSPENSION MANUELLE, ET SA REPRISE (L10.6 FINAL) ═══════════════════
   *
   * DISTINCTES de `SITE_SUSPENDED` / `SITE_ACTIVATED`, et il faut les deux
   * paires. Celles-là décrivent le RÉSULTAT dérivé — l'accessibilité vient de
   * basculer, quelle qu'en soit la cause. Celles-ci décrivent l'ACTE : un
   * humain a posé, ou retiré, la cause manuelle.
   *
   * Les confondre perdrait le cas le plus intéressant : poser une suspension
   * manuelle sur un site DÉJÀ fermé pour impayé ne fait basculer aucun statut,
   * donc n'écrit aucun `SITE_SUSPENDED` — et l'acte serait invisible. Le
   * retirer plus tard laisserait le site fermé, sans trace de qui l'avait
   * posé ni pourquoi.
   *
   * ══ POURQUOI DANS CE JOURNAL, ET NON DANS L'ACTIVITÉ ══════════════════════
   *
   * L'activité d'exploitation est BORNÉE : elle raconte ce qui vient de se
   * passer. Le motif d'une fermeture, son auteur et la date de sa levée
   * doivent survivre à cette fenêtre — c'est ce qu'on relit six mois plus tard
   * quand un client demande pourquoi son site avait été coupé. Le journal
   * d'audit n'a ni TTL ni plafond, et ne porte jamais de secret.
   */
  SITE_MANUAL_SUSPENSION_APPLIED: 'SITE_MANUAL_SUSPENSION_APPLIED',
  SITE_MANUAL_SUSPENSION_LIFTED: 'SITE_MANUAL_SUSPENSION_LIFTED',
  RECONCILED: 'RECONCILED',
  ARCHIVED: 'ARCHIVED',
});

/** Taux de TVA par défaut (France, configurable par contrat). Jamais figé en dur. */
export const DEFAULT_TAX_RATE = 20; // %

/**
 * Borne du délai de grâce en cas d'impayé (jours).
 *
 * Un an. Ce n'est pas une politique recommandée, c'est un garde-fou de saisie :
 * au-delà, un chiffre tapé de travers cesse d'être une clémence et devient un
 * abandon silencieux de la créance. Il n'existe DÉLIBÉRÉMENT aucune valeur par
 * défaut : voir `updatePaymentGracePolicy`.
 */
export const MAX_PAYMENT_GRACE_DAYS = 365;

export const CURRENCY = 'EUR';
/**
 * La signature doit-elle être réalisée DANS ce projet ?
 * NOT_REQUIRED = le document chargé est déjà signé en externe, ou aucune
 * signature supplémentaire n'est requise dans le parcours d'activation :
 * AUCUN appel Yousign, étape signature ABSENTE de la guideline, paiement direct.
 */
export const SIGNATURE_REQUIREMENT = Object.freeze({ REQUIRED: 'REQUIRED', NOT_REQUIRED: 'NOT_REQUIRED' });
export const SIGNATURE_REQUIREMENT_VALUES = Object.freeze(Object.values(SIGNATURE_REQUIREMENT));

/**
 * ══ LA RÉCURRENCE D'UN ABONNEMENT — DEUX DIMENSIONS, JAMAIS UNE ═════════════
 *
 * Une périodicité contractuelle se dit « tous les N <unité> » : `3 MONTH`,
 * `1 YEAR`, `2 YEAR`. Ce vocabulaire ne connaît QUE l'unité ; le nombre de pas
 * vit à côté, dans `recurrence.interval`.
 *
 * ══ POURQUOI CES DEUX SEULES UNITÉS ═════════════════════════════════════════
 *
 * Elles couvrent tout ce qu'un contrat sait exprimer, et surtout tout ce que
 * Stripe sait facturer sans que nous ayons à le simuler. `WEEK` et `DAY`
 * existent chez le fournisseur mais n'ont jamais désigné un engagement
 * commercial ici : les ajouter serait ouvrir un cas qu'aucun écran, aucune
 * facture et aucun courriel ne sait dire.
 *
 * Le module de récurrence FINANCIÈRE du Panel (`services/finance/recurrence.js`)
 * porte en plus `DAY`, parce qu'un coût récurrent n'est pas un abonnement
 * vendu. Les deux vocabulaires se rejoignent sur la FORME — `{ unit, interval }`
 * — sans se confondre sur le domaine.
 */
export const SUBSCRIPTION_RECURRENCE_UNITS = Object.freeze({ MONTH: 'MONTH', YEAR: 'YEAR' });
export const SUBSCRIPTION_RECURRENCE_UNIT_VALUES = Object.freeze(
  Object.values(SUBSCRIPTION_RECURRENCE_UNITS)
);

/**
 * ══ LE PLAFOND D'INTERVALLE — CELUI DU FOURNISSEUR, PAS UN AVIS ═════════════
 *
 * Stripe refuse tout Price dont la période dépasse TROIS ANS. La borne n'est
 * donc pas une préférence de saisie : c'est la limite au-delà de laquelle la
 * création du tarif échoue — et elle échouerait au pire moment, au clic sur
 * « souscrire », des semaines après que le contrat a été signé sur une
 * périodicité que personne ne pourra jamais facturer.
 *
 * On la fait respecter DÈS LA SAISIE, par unité, parce que « 36 » ne veut pas
 * dire la même chose en mois qu'en années :
 *
 *     MONTH → 36  (trois ans, exprimés en mois)
 *     YEAR  →  3  (les mêmes trois ans)
 *
 * Un plafond unique aurait laissé passer « tous les 36 ans ».
 */
export const MAX_SUBSCRIPTION_INTERVAL_BY_UNIT = Object.freeze({
  [SUBSCRIPTION_RECURRENCE_UNITS.MONTH]: 36,
  [SUBSCRIPTION_RECURRENCE_UNITS.YEAR]: 3,
});

/**
 * La récurrence par défaut : tous les mois. C'est ce que portait tout le parc
 * avant ce lot, et ce qu'un contrat neuf propose tant que rien n'est choisi.
 */
export const DEFAULT_SUBSCRIPTION_RECURRENCE = Object.freeze({
  unit: SUBSCRIPTION_RECURRENCE_UNITS.MONTH,
  interval: 1,
});

/**
 * ══ HÉRITAGE : `pricing.subscription.interval` (CHAÎNE) ═════════════════════
 *
 * Avant ce lot, la périodicité tenait dans un seul champ `interval` valant
 * `MONTH` ou `YEAR` — donc une UNITÉ portant le nom d'un intervalle. Le champ
 * survit sur le modèle le temps de la transition (voir `subscriptionRecurrence.js`
 * pour la priorité de lecture, et le backfill de `config/bootstrap.js`), mais
 * plus aucune décision métier ne s'y adosse.
 *
 * Les alias ci-dessous existent pour que le code non encore relu continue de
 * fonctionner à l'identique. Ils désignent l'UNITÉ, jamais un intervalle.
 */
export const SUBSCRIPTION_INTERVALS = SUBSCRIPTION_RECURRENCE_UNITS;
export const SUBSCRIPTION_INTERVAL_VALUES = SUBSCRIPTION_RECURRENCE_UNIT_VALUES;
/** Compat historique : unité par défaut. */
export const SUBSCRIPTION_INTERVAL = SUBSCRIPTION_RECURRENCE_UNITS.MONTH;
