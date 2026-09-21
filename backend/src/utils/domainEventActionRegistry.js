import { ACTION_TYPE } from './domainEventConstants.js';
import { assertKnownEventType } from './domainEventRegistry.js';

/**
 * Registre des ACTIONS déclenchées par un événement — hardcodé, code-first.
 *
 * Séparé du registre des événements à dessein : un événement est un FAIT (il s'est
 * passé), une action est une CONSÉQUENCE (ce qu'on en fait). Le fait ne doit pas
 * dépendre de ses conséquences — c'est ce qui permet à un échec d'action de ne
 * jamais remettre en cause le métier.
 *
 * RÈGLE : le destinataire est TOTALEMENT séparé du template. Un template ne porte
 * jamais d'adresse ; c'est `recipientResolver` (code-first, lot suivant) qui la
 * résout à l'exécution.
 *
 * Un événement sans action est parfaitement normal (les événements d'audit Brevo
 * n'en ont aucune) : il est alors DISPATCHED immédiatement.
 */

/**
 * @typedef {object} ActionDefinition
 * @property {string}  actionId          Identifiant STABLE (clé d'idempotence avec eventId).
 * @property {string}  actionType        Doit exister dans EventActionHandlerRegistry.
 * @property {boolean} enabled           false -> exécution SKIPPED, jamais lancée.
 * @property {string}  [templateId]      Template e-mail (lot templates).
 * @property {string}  [recipientResolver] Résolveur de destinataires (lot e-mail).
 * @property {string}  [description]
 */

/** @type {Record<string, ActionDefinition[]>} */
export const DOMAIN_EVENT_ACTION_REGISTRY = Object.freeze({
  // --- Audit Brevo : AUCUNE action -------------------------------------------
  // Ces événements existent pour la trace, pas pour déclencher quoi que ce soit.
  // Ils sont volontairement absents de ce registre (zéro action -> DISPATCHED).

  // --- Contact ---------------------------------------------------------------
  'contact.submitted': [
    {
      actionId: 'notify-admins-contact-submitted',
      actionType: ACTION_TYPE.SEND_EMAIL,
      // ACTIVÉE (lot contact) : le template, son résolveur de variables et la
      // chaîne d'envoi existent. Une exécution est créée PAR administrateur.
      //
      // Rappel de l'invariant : si cette action échoue, la demande de contact
      // reste enregistrée et consultable dans le Manager. Une notification est
      // une conséquence, jamais une condition.
      enabled: true,
      templateId: 'CONTACT_ADMIN_NOTIFICATION',
      // Destinataires MÉTIER (Company.contactNotificationRecipients) ; à défaut,
      // les comptes ADMIN valides (JAMAIS les DEV, jamais l'adresse support) ;
      // à défaut, échec explicite EMAIL_RECIPIENTS_NOT_FOUND. La règle vit dans
      // resolveContactRecipients — ce commentaire n'est qu'un pointeur.
      recipientResolver: 'CONTACT_NOTIFICATION_RECIPIENTS',
      // Reply-To = le VISITEUR : répondre à la notification écrit directement au
      // demandeur, sans copier-coller son adresse. Le From reste notre expéditeur.
      replyToVariable: 'contact.email',
      description: "Notifie les destinataires d'une nouvelle demande de contact.",
    },
  ],

  'customer.email_verification.requested': [
    {
      actionId: 'send-customer-email-verification-code',
      actionType: ACTION_TYPE.SEND_EMAIL,
      enabled: true,
      templateId: 'CUSTOMER_EMAIL_VERIFICATION',
      recipientResolver: 'CUSTOMER_EMAIL',
      description: 'Envoie au client son code de verification e-mail.',
    },
  ],
  'customer.password_reset.requested': [
    {
      actionId: 'send-customer-password-reset',
      actionType: ACTION_TYPE.SEND_EMAIL,
      enabled: true,
      templateId: 'CUSTOMER_PASSWORD_RESET',
      recipientResolver: 'CUSTOMER_EMAIL',
      description: 'Envoie au client son lien de reinitialisation.',
    },
  ],
  'commerce.sale.paid': [
    {
      actionId: 'send-customer-sale-confirmation',
      actionType: ACTION_TYPE.SEND_EMAIL,
      enabled: true,
      templateId: 'COMMERCE_SALE_CONFIRMATION_CLIENT',
      recipientResolver: 'CUSTOMER_EMAIL',
      description: 'Confirme au client sa commande BeautySavage.',
    },
  ],
  'commerce.gift_card.issued': [
    {
      actionId: 'send-customer-gift-card-issued',
      actionType: ACTION_TYPE.SEND_EMAIL,
      enabled: true,
      templateId: 'COMMERCE_GIFT_CARD_CLIENT',
      recipientResolver: 'CUSTOMER_EMAIL',
      description: 'Envoie au client les informations de carte cadeau.',
    },
  ],
  'appointment.cancelled': [
    {
      actionId: 'send-customer-appointment-cancelled',
      actionType: ACTION_TYPE.SEND_EMAIL,
      enabled: true,
      templateId: 'APPOINTMENT_CANCELLED_CLIENT',
      recipientResolver: 'CUSTOMER_EMAIL',
      description: "Previent le client de l'annulation d'un rendez-vous.",
    },
  ],

  // --- Encaissement des frais de lancement -----------------------------------
  //
  // ══ POURQUOI CE MESSAGE EXISTE, ALORS QUE STRIPE ENVOIE DÉJÀ UN REÇU ══════
  //
  // Le reçu Stripe prouve qu'une carte a été débitée. Il ne dit pas ce que le
  // client vient d'acheter, ni ce qui se passe ensuite, ni où retrouver son
  // contrat. C'est précisément ce que le client cherche après avoir payé —
  // et c'est le seul moment du parcours où il ne recevait rien de nous.
  //
  // AUCUN message « DEV » ici : un encaissement nominal n'appelle aucune
  // intervention technique. L'inscrire aux alertes développeur aurait appris à
  // l'équipe à les ignorer.
  'launch_fee.paid': [
    {
      actionId: 'notify-admins-launch-fee-paid',
      actionType: ACTION_TYPE.SEND_EMAIL,
      enabled: true,
      /**
       * L12 — UN SEUL MODÈLE POUR TOUS LES RÈGLEMENTS.
       *
       * `CONTRACT_PAYMENT_RECEIVED_ADMIN` ne parlait que des frais de lancement
       * et ne portait aucun lien de facture. Le remplacer ici SUFFIT à le
       * retirer de la déclaration d'usage du projet — celle-ci est dérivée de
       * ce registre — et son instance, avec tout son historique, reste en base
       * côté Panel. Voir Panel/docs/PROTOCOL.md § « RETIRER un modèle ».
       */
      templateId: 'PAYMENT_CONFIRMED_ADMIN',
      recipientResolver: 'ADMIN_EMAILS',
      description: "Confirme au client l'encaissement des frais de lancement.",
    },
  ],

  // --- Encaissement d'un cycle d'abonnement ---------------------------------
  //
  // ══ POURQUOI IL MANQUAIT, ET CE QUE SON ABSENCE COÛTAIT ═══════════════════
  //
  // Les frais de lancement étaient confirmés, l'abonnement ne l'était pas. Un
  // client réglait son premier mois, puis tous les suivants, sans jamais
  // recevoir autre chose que le reçu du prestataire de paiement — lequel prouve
  // un débit sans dire ce qu'il couvre ni pour quelle période. C'était le seul
  // encaissement récurrent du parcours, et le seul dont personne ne parlait.
  //
  // ══ POURQUOI PAR RÈGLEMENT, ET NON À L'ACTIVATION ════════════════════════
  //
  // `subscription.activated` ne décrit qu'une transition, qui n'arrive qu'une
  // fois. Un abonnement encaisse tous les mois : s'y accrocher aurait confirmé
  // le premier prélèvement et tu tous les autres.
  //
  // AUCUN message « DEV » : un prélèvement nominal n'appelle aucune
  // intervention technique, et l'inscrire aux alertes développeur apprendrait
  // à les ignorer. Le Panel, lui, prévient ses SUPER_ADMIN par son propre
  // chemin, sur le fait financier projeté.
  'subscription.paid': [
    {
      actionId: 'notify-admins-subscription-paid',
      actionType: ACTION_TYPE.SEND_EMAIL,
      enabled: true,
      templateId: 'PAYMENT_CONFIRMED_ADMIN',
      recipientResolver: 'ADMIN_EMAILS',
      description: "Confirme au client l'encaissement d'un cycle d'abonnement.",
    },
  ],

  // --- Impayé d'abonnement ---------------------------------------------------
  //
  // ══ LA CADENCE EST PORTÉE PAR L'ÉVÉNEMENT, PAS PAR L'ACTION ══════════════
  //
  // Trois messages au maximum sur toute la vie d'un impayé : ouverture, grâce
  // épuisée, régularisation. Aucune relance périodique — ni ici, ni ailleurs.
  //
  // C'est un choix, et il tient à qui relance : STRIPE retente le prélèvement
  // selon son propre calendrier et prévient déjà le porteur de la carte.
  // Ajouter notre propre cadence produirait deux voix qui se contredisent sur
  // les dates, pour un même impayé. Nous parlons aux MOMENTS où l'état change,
  // c'est-à-dire quand nous avons quelque chose de neuf à dire.
  'contract.payment.overdue': [
    {
      actionId: 'notify-admins-payment-overdue',
      actionType: ACTION_TYPE.SEND_EMAIL,
      enabled: true,
      templateId: 'CONTRACT_PAYMENT_OVERDUE_ADMIN',
      recipientResolver: 'ADMIN_EMAILS',
      description: "Prévient le client qu'un prélèvement a échoué, pendant que le service tourne encore.",
    },
  ],

  /*
    LA RELANCE — le seul message de ce registre qui peut partir PLUSIEURS fois
    pour le même impayé, et c'est voulu.

    Sa répétition n'est pas un défaut d'idempotence : chaque envoi correspond à
    une tentative RÉELLEMENT nouvelle du prestataire de paiement. La garde est
    en amont, dans l'applicateur : un compteur qui n'a pas bougé n'émet aucun
    événement, donc aucun message.
  */
  'contract.payment.retry_failed': [
    {
      actionId: 'notify-admins-payment-retry-failed',
      actionType: ACTION_TYPE.SEND_EMAIL,
      enabled: true,
      templateId: 'CONTRACT_PAYMENT_RETRY_FAILED_ADMIN',
      recipientResolver: 'ADMIN_EMAILS',
      description: "Relance le client après une nouvelle tentative refusée, avant l'échéance.",
    },
  ],

  'contract.payment.overdue_critical': [
    {
      actionId: 'notify-admins-payment-overdue-critical',
      actionType: ACTION_TYPE.SEND_EMAIL,
      enabled: true,
      templateId: 'CONTRACT_PAYMENT_OVERDUE_CRITICAL_ADMIN',
      recipientResolver: 'ADMIN_EMAILS',
      description: "Alerte le client que le délai de grâce est épuisé et qu'une action est requise.",
    },
  ],
  //
  // ══ CE QU'ON N'ENVOIE PAS ICI, ET POURQUOI ═══════════════════════════════
  //
  // Une alerte à l'équipe technique a été écrite, puis RETIRÉE. Le Panel envoie
  // déjà `SITE_SUSPENDED_PAYMENT_DEFAULT_TEAM` à tous ses comptes au moment où
  // la suspension est CONFIRMÉE — et c'est lui l'autorité : il détient la
  // politique de grâce, il décide de la fermeture, il sait quand elle a
  // réellement eu lieu.
  //
  // Doubler ce message depuis le projet aurait prévenu la même population deux
  // fois pour un seul incident, à deux instants proches, depuis le côté qui
  // n'est PAS l'autorité — avec le risque d'annoncer une fermeture que le
  // Panel n'a pas encore prononcée. Ce que le projet ajoute, et lui seul, c'est
  // l'avertissement AU CLIENT avant la fermeture : le Panel, lui, ne parle
  // qu'une fois le site déjà fermé.
  //

  'contract.payment.recovered': [
    {
      actionId: 'notify-admins-payment-recovered',
      actionType: ACTION_TYPE.SEND_EMAIL,
      enabled: true,
      templateId: 'CONTRACT_PAYMENT_RECOVERED_ADMIN',
      recipientResolver: 'ADMIN_EMAILS',
      description: "Confirme au client que son impayé est régularisé.",
    },
  ],

  /* --- Incident technique — RAPPORTÉ, plus envoyé (L12.1) -------------------
   *
   * ══ CE QUI ÉTAIT ÉCRIT ICI, ET POURQUOI ÇA NE MARCHAIT PAS ════════════════
   *
   * Une action `SEND_EMAIL` sur `PLATFORM_INCIDENT_DEV_ALERT`, active, avec un
   * résolveur de destinataires soigné. Elle n'a jamais pu produire un seul
   * e-mail : ce modèle est une communication de L.Y Solution vers l'équipe
   * technique — il nomme des composants internes et ne porte jamais l'apparence
   * du client — donc de portée PANEL. Un projet ne peut pas demander une portée
   * PANEL : le rendu opposait `EMAIL_TEMPLATE_NOT_DECLARED_BY_PROJECT`, et
   * l'échec se rangeait dans une livraison que personne ne relisait.
   *
   * ══ POURQUOI ON N'A PAS BASCULÉ LE MODÈLE EN PORTÉE PROJECT ═══════════════
   *
   * C'était le geste le plus court. Il aurait fait entrer une communication
   * interne dans le catalogue éditable d'un client, au seul motif que l'appel
   * partait de chez lui. L'ownership suit la communication, jamais l'origine
   * des faits.
   *
   * Le projet RAPPORTE désormais l'incident au control plane, qui décide de
   * l'alerte, de ses destinataires et de son contenu. Le passage par la file
   * durable du pont ajoute ce qui manquait le plus : un incident survenu
   * pendant que le Panel était injoignable — le cas le plus probable — n'est
   * plus perdu.
   */
  'platform.incident.raised': [
    {
      actionId: 'report-platform-incident',
      actionType: ACTION_TYPE.REPORT_INCIDENT,
      enabled: true,
      description: "Rapporte l'incident technique à la plateforme, qui décide de l'alerte.",
    },
  ],

  // --- Résiliation -----------------------------------------------------------
  'contract.cancel_at_period_end': [
    {
      actionId: 'notify-admins-cancellation',
      actionType: ACTION_TYPE.SEND_EMAIL,
      enabled: false,
      templateId: 'CONTRACT_CANCELLATION_ADMIN_CONFIRMATION',
      recipientResolver: 'ADMIN_EMAILS',
      description: "Confirme la résiliation à l'entreprise cliente.",
    },
    {
      actionId: 'notify-devs-cancellation',
      actionType: ACTION_TYPE.SEND_EMAIL,
      enabled: false,
      templateId: 'CONTRACT_CANCELLATION_DEV_NOTIFICATION',
      recipientResolver: 'DEV_EMAILS',
      description: "Prévient l'équipe de développement de la résiliation.",
    },
  ],
});

/** Actions d'un type d'événement (tableau vide si aucune). */
export function actionsForEvent(eventType) {
  return DOMAIN_EVENT_ACTION_REGISTRY[eventType] || [];
}

/**
 * Cohérence du registre — exécuté par les tests. Un `actionId` dupliqué pour un
 * même événement casserait silencieusement l'index unique d'idempotence.
 */
export function validateActionRegistry() {
  const problems = [];
  for (const [eventType, actions] of Object.entries(DOMAIN_EVENT_ACTION_REGISTRY)) {
    try {
      assertKnownEventType(eventType);
    } catch {
      problems.push(`Événement inconnu dans le registre d'actions : ${eventType}`);
    }
    const ids = actions.map((a) => a.actionId);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (duplicates.length > 0) {
      problems.push(`actionId dupliqué pour ${eventType} : ${[...new Set(duplicates)].join(', ')}`);
    }
    for (const action of actions) {
      if (!action.actionId) problems.push(`actionId manquant pour ${eventType}`);
      if (!Object.values(ACTION_TYPE).includes(action.actionType)) {
        problems.push(`actionType inconnu pour ${eventType}/${action.actionId} : ${action.actionType}`);
      }
      if (typeof action.enabled !== 'boolean') {
        problems.push(`enabled doit être explicite pour ${eventType}/${action.actionId}`);
      }
      // Un template sans destinataire (ou l'inverse) est une erreur de conception :
      // l'un ne sert à rien sans l'autre.
      if (action.actionType === ACTION_TYPE.SEND_EMAIL) {
        if (!action.templateId) problems.push(`templateId manquant pour ${eventType}/${action.actionId}`);
        if (!action.recipientResolver) {
          problems.push(`recipientResolver manquant pour ${eventType}/${action.actionId}`);
        }
      }
    }
  }
  return problems;
}

/** Introspection sûre (routes DEV). */
export function describeActionRegistry() {
  return Object.entries(DOMAIN_EVENT_ACTION_REGISTRY).map(([eventType, actions]) => ({
    eventType,
    actions: actions.map((a) => ({
      actionId: a.actionId,
      actionType: a.actionType,
      enabled: a.enabled,
      templateId: a.templateId || null,
      recipientResolver: a.recipientResolver || null,
      description: a.description || '',
    })),
  }));
}
