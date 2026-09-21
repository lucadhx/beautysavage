import { z } from 'zod';
import { RETENTION_CLASS, EVENT_ERROR_CODES } from './domainEventConstants.js';
import { EventPayloadError } from './eventPayloadSafety.js';

/**
 * Registre CANONIQUE des événements métier — source de vérité unique.
 *
 * Un type absent d'ici n'existe pas : `emit()` le refuse. Pas de DSL, pas de règle
 * en base, pas de création depuis le Manager. Ajouter un événement = ajouter une
 * entrée ici.
 *
 * Chaque entrée porte :
 *  - `description`    : à quoi sert l'événement (lu par l'introspection DEV) ;
 *  - `entityTypes`    : entités auxquelles il peut se rattacher ;
 *  - `payloadSchema`  : schéma zod STRICT du payload sûr ;
 *  - `retentionClass` : combien de temps le conserver (cf. RETENTION_CLASS).
 *
 * ⚠️ Les payloads sont RELUS et exposés (routes DEV, Manager). Ils ne contiennent
 * que des données sûres : adresses masquées, statuts, codes. Jamais d'OTP, de clé,
 * de HTML ni de payload fournisseur brut — `assertSafePayload` refuse ces clés en
 * plus du schéma.
 */

/** Entités auxquelles un événement peut se rattacher. */
export const ENTITY_TYPE = Object.freeze({
  EMAIL_CONFIGURATION: 'EmailConfiguration',
  CONTACT_SUBMISSION: 'ContactSubmission',
  CUSTOMER: 'Customer',
  COMMERCE_SALE: 'CommerceSale',
  CALENDAR_EVENT: 'CalendarEvent',
  CONTRACT: 'Contract',
  SITE: 'Site',
  /** Un compte LOCAL du projet (LOT 2C) — jamais une identité fédérée L.Y Solution. */
  LOCAL_ACCOUNT: 'User',
  /**
   * LA PLATEFORME ELLE-MÊME — ni un contrat, ni un site, ni un compte.
   *
   * Un incident de capacité ou de projection n'appartient à aucun objet
   * métier : le rattacher au contrat en cours ferait apparaître une panne
   * d'infrastructure dans l'historique commercial d'un client.
   */
  PLATFORM: 'Platform',
});

const providerMode = z.enum(['TEST', 'PROD']);

/** Champs communs aux événements Brevo (audit de configuration e-mail). */
const brevoBase = {
  mode: providerMode,
  provider: z.literal('BREVO'),
};

/** Erreur normalisée dans un payload : un code stable + un message borné. */
const safeError = z
  .object({
    code: z.string().max(64).optional(),
    message: z.string().max(300).optional(),
  })
  .strict();

export const DOMAIN_EVENT_REGISTRY = Object.freeze({
  /* --- Configuration e-mail (audit) --------------------------------------- */
  //
  // Trois faits, pas un de plus : l'identité a changé, un envoi de test a réussi,
  // un envoi de test a échoué. Les anciens événements de vérification d'expéditeur
  // et d'authentification de domaine ont disparu avec les parcours qui les
  // produisaient — ces états sont administrés chez Brevo, pas ici.

  'email.sender.updated': {
    type: 'email.sender.updated',
    description: "Le nom d'expéditeur ou l'adresse support a été modifié pour ce mode.",
    entityTypes: [ENTITY_TYPE.EMAIL_CONFIGURATION],
    retentionClass: RETENTION_CLASS.AUDIT,
    payloadSchema: z
      .object({
        ...brevoBase,
        // Adresse MASQUÉE : la trace n'a pas besoin de la boîte complète.
        senderEmailMasked: z.string().max(254),
        // L'ADRESSE a-t-elle changé, ou seulement le nom d'affichage ? Un
        // changement d'adresse invalide le dernier test ; un changement de nom non.
        emailChanged: z.boolean(),
      })
      .strict(),
  },

  'email.test.accepted': {
    type: 'email.test.accepted',
    description: "Brevo a ACCEPTÉ l'envoi de test (messageId reçu). Livraison non encore confirmée.",
    entityTypes: [ENTITY_TYPE.EMAIL_CONFIGURATION],
    retentionClass: RETENTION_CLASS.AUDIT,
    payloadSchema: z
      .object({
        ...brevoBase,
        senderEmailMasked: z.string().max(254),
        recipientMasked: z.string().max(254),
        // Non sensible : sert à retrouver la livraison chez Brevo si besoin.
        messageIdSafe: z.string().max(200),
      })
      .strict(),
  },

  'email.test.failed': {
    type: 'email.test.failed',
    description: "Brevo a refusé l'envoi de test : la configuration e-mail ne fonctionne pas.",
    entityTypes: [ENTITY_TYPE.EMAIL_CONFIGURATION],
    retentionClass: RETENTION_CLASS.AUDIT,
    payloadSchema: z
      .object({
        ...brevoBase,
        senderEmailMasked: z.string().max(254),
        recipientMasked: z.string().max(254),
        error: safeError,
      })
      .strict(),
  },

  /* --- Contact (déclaré ; branché au lot « formulaire de contact ») ------- */

  'contact.submitted': {
    type: 'contact.submitted',
    description: 'Une demande de contact a été soumise depuis la vitrine.',
    entityTypes: [ENTITY_TYPE.CONTACT_SUBMISSION],
    retentionClass: RETENTION_CLASS.OPERATIONAL,
    payloadSchema: z
      .object({
        /**
         * Identifiant de la demande. Doublonne volontairement `entityId` : il
         * rend le payload lisible seul dans l'interface DEV, là où `entityId`
         * sert à l'indexation. Le resolver, lui, s'appuie sur `entityId`.
         */
        submissionId: z.string().max(64),
        // Le CONTENU du message ne transite PAS par l'événement : il vit dans
        // ContactSubmission, sa seule copie. L'événement ne porte que de quoi
        // router l'action et reconnaître la demande.
        contactName: z.string().max(120),
        /**
         * MASQUÉE (`j***@exemple.fr`). Le journal est relu et exposé par les
         * routes DEV : il ne doit pas devenir une seconde réserve d'adresses.
         * L'adresse complète vit dans ContactSubmission — le resolver l'y lit.
         */
        contactEmailMasked: z.string().max(254),
        /**
         * L'ENTREPRISE — non masquée, et c'est délibéré.
         *
         * Ce n'est pas une donnée personnelle : c'est une raison sociale, une
         * information publique par nature. C'est aussi la SEULE chose qui rend
         * un événement relisible sans rouvrir la demande — « Atelier Dupont »
         * dit ce que `j***@exemple.fr` ne dit pas.
         *
         * Le CONTENU du projet, lui, ne transite toujours pas par l'événement.
         */
        contactCompany: z.string().max(160),
        reason: z.string().max(64),
        submittedAt: z.string().max(40),
        source: z.string().max(32),
        pageUrl: z.string().max(500).optional(),
        companyId: z.string().max(64).optional(),
      })
      .strict(),
  },

  'customer.registered': {
    type: 'customer.registered',
    description: "Un compte client a ete cree depuis la vitrine.",
    entityTypes: [ENTITY_TYPE.CUSTOMER],
    retentionClass: RETENTION_CLASS.OPERATIONAL,
    payloadSchema: z.object({
      customerId: z.string().max(64),
      customerEmailMasked: z.string().max(254),
      registeredAt: z.string().max(40),
    }).strict(),
  },

  'customer.email_verification.requested': {
    type: 'customer.email_verification.requested',
    description: "Un code de verification e-mail client doit etre envoye.",
    entityTypes: [ENTITY_TYPE.CUSTOMER],
    retentionClass: RETENTION_CLASS.OPERATIONAL,
    payloadSchema: z.object({
      customerId: z.string().max(64),
      customerEmailMasked: z.string().max(254),
      verificationPin: z.string().regex(/^[0-9]{6}$/),
      expiresAt: z.string().max(40),
      requestedAt: z.string().max(40),
    }).strict(),
  },

  'customer.email_verified': {
    type: 'customer.email_verified',
    description: "L'adresse e-mail d'un client a ete verifiee.",
    entityTypes: [ENTITY_TYPE.CUSTOMER],
    retentionClass: RETENTION_CLASS.OPERATIONAL,
    payloadSchema: z.object({
      customerId: z.string().max(64),
      verifiedAt: z.string().max(40),
    }).strict(),
  },

  'customer.password_reset.requested': {
    type: 'customer.password_reset.requested',
    description: "Un lien de reinitialisation de mot de passe client doit etre envoye.",
    entityTypes: [ENTITY_TYPE.CUSTOMER],
    retentionClass: RETENTION_CLASS.OPERATIONAL,
    payloadSchema: z.object({
      customerId: z.string().max(64),
      customerEmailMasked: z.string().max(254),
      actionUrl: z.string().max(500),
      expiresAt: z.string().max(40),
      requestedAt: z.string().max(40),
    }).strict(),
  },

  'commerce.sale.paid': {
    type: 'commerce.sale.paid',
    description: "Une vente vitrine est confirmee payee.",
    entityTypes: [ENTITY_TYPE.COMMERCE_SALE],
    retentionClass: RETENTION_CLASS.OPERATIONAL,
    payloadSchema: z.object({
      saleId: z.string().max(64),
      saleNumber: z.string().max(64),
      customerId: z.string().max(64),
      totalAmount: z.number().int().nonnegative(),
      invoiceUrl: z.string().max(500).optional(),
      paidAt: z.string().max(40),
    }).strict(),
  },

  'commerce.gift_card.issued': {
    type: 'commerce.gift_card.issued',
    description: "Une carte cadeau a ete emise apres achat.",
    entityTypes: [ENTITY_TYPE.COMMERCE_SALE],
    retentionClass: RETENTION_CLASS.OPERATIONAL,
    payloadSchema: z.object({
      saleId: z.string().max(64),
      saleNumber: z.string().max(64),
      customerId: z.string().max(64),
      giftCardCodeMasked: z.string().max(80),
      recipientName: z.string().max(160),
      amount: z.number().int().nonnegative(),
      giftCardPdfUrl: z.string().max(500).optional(),
      issuedAt: z.string().max(40),
    }).strict(),
  },

  'appointment.cancelled': {
    type: 'appointment.cancelled',
    description: "Un rendez-vous ou bloc calendrier a ete annule.",
    entityTypes: [ENTITY_TYPE.CALENDAR_EVENT],
    retentionClass: RETENTION_CLASS.OPERATIONAL,
    payloadSchema: z.object({
      calendarEventId: z.string().max(64),
      customerId: z.string().max(64).optional(),
      appointmentTitle: z.string().max(180),
      appointmentStart: z.string().max(40),
      appointmentEnd: z.string().max(40),
      refundedAmount: z.number().int().nonnegative(),
      reason: z.string().max(300),
      cancelledAt: z.string().max(40),
    }).strict(),
  },

  /* --- Contrat ------------------------------------------------------------ */

  'contract.cancel_requested': {
    type: 'contract.cancel_requested',
    description: "Une résiliation a été demandée sur un contrat actif.",
    entityTypes: [ENTITY_TYPE.CONTRACT],
    retentionClass: RETENTION_CLASS.AUDIT,
    payloadSchema: z
      .object({
        reference: z.string().max(64),
        // Qui a résilié — le rôle suffit, l'identité est dans `actor`.
        cancelledByRole: z.enum(['DEV', 'ADMIN', 'SYSTEM']),
        currentPeriodEnd: z.string().max(40).nullable(),
        // Résiliation IMMÉDIATE (ENV=TEST uniquement, LOT recette) : absent en
        // PROD — le comportement historique n'émet pas ces champs.
        immediate: z.boolean().optional(),
        environment: z.enum(['TEST', 'PROD']).optional(),
      })
      .strict(),
  },

  'contract.cancel_at_period_end': {
    type: 'contract.cancel_at_period_end',
    description: "Le contrat est passé en résiliation à échéance (fin de période).",
    entityTypes: [ENTITY_TYPE.CONTRACT],
    retentionClass: RETENTION_CLASS.AUDIT,
    payloadSchema: z
      .object({
        reference: z.string().max(64),
        currentPeriodEnd: z.string().max(40).nullable(),
      })
      .strict(),
  },

  'contract.ended': {
    type: 'contract.ended',
    description: "Le contrat a pris fin (échéance atteinte).",
    entityTypes: [ENTITY_TYPE.CONTRACT],
    retentionClass: RETENTION_CLASS.AUDIT,
    payloadSchema: z
      .object({
        reference: z.string().max(64),
        endedAt: z.string().max(40).nullable(),
      })
      .strict(),
  },

  /* --- Impayé d'abonnement : les TROIS moments qui méritent un message ----- */
  //
  // ══ POURQUOI TROIS ÉVÉNEMENTS, ET PAS UN AVEC UN CHAMP `severity` ═════════
  //
  // Parce qu'ils ne s'adressent pas au même moment de la vie du client, et que
  // le registre d'ACTIONS est indexé par type. Un type unique aurait obligé
  // chaque action à relire le payload pour décider si elle s'applique — c'est-
  // à-dire à remettre la règle de routage dans le handler, là où personne ne la
  // relit. Trois types, trois décisions lisibles dans le registre d'actions.
  //
  // ══ CE QUI LES DÉCLENCHE, ET POURQUOI ILS NE SPAMMENT PAS ════════════════
  //
  // Ils sont émis par l'APPLICATEUR d'incident, sur TRANSITION d'état — jamais
  // à chaque livraison. Chaque émission porte une `idempotencyKey` construite
  // sur `(incident, état)` : la même livraison rejouée dix fois, un rattrapage
  // de journal, deux instances qui appliquent en parallèle produisent un seul
  // fait, donc un seul e-mail. Voir §22 de la recette.

  'contract.payment.overdue': {
    type: 'contract.payment.overdue',
    description:
      "Un prélèvement d'abonnement a échoué : l'impayé est ouvert, le délai de grâce court encore.",
    entityTypes: [ENTITY_TYPE.CONTRACT],
    retentionClass: RETENTION_CLASS.OPERATIONAL,
    payloadSchema: z
      .object({
        paymentDefaultId: z.string().max(64),
        reference: z.string().max(64),
        attemptCount: z.number().int().nonnegative(),
        amountDueCents: z.number().int().nonnegative(),
        currency: z.string().max(8),
        /** `null` = aucune politique de grâce ; `0` = aucune clémence. */
        graceDaysSnapshot: z.number().int().nonnegative().nullable(),
        graceDeadlineAt: z.string().max(40).nullable(),
        invoiceNumber: z.string().max(64).nullable(),
      })
      .strict(),
  },

  /**
   * UNE NOUVELLE TENTATIVE A ÉTÉ REFUSÉE — pendant que la grâce court encore.
   *
   * ══ CE QUI LE DISTINGUE DE `overdue` ══════════════════════════════════════
   *
   * `overdue` naît UNE fois, à l'ouverture de l'impayé. Celui-ci naît à chaque
   * tentative RÉELLEMENT nouvelle du prestataire de paiement. C'est
   * `attemptCount` qui fait la différence, et lui seul : une livraison rejouée
   * porte le même compteur et ne produit donc aucun second événement.
   *
   * Le compteur figure dans la clé d'idempotence pour cette raison exacte.
   */
  'contract.payment.retry_failed': {
    type: 'contract.payment.retry_failed',
    description:
      "Une nouvelle tentative de prélèvement a été refusée, l'impayé restant ouvert.",
    entityTypes: [ENTITY_TYPE.CONTRACT],
    retentionClass: RETENTION_CLASS.OPERATIONAL,
    payloadSchema: z
      .object({
        paymentDefaultId: z.string().max(64),
        reference: z.string().max(64),
        /** Le compteur du prestataire — ce qui prouve qu'il s'agit d'un NOUVEL échec. */
        attemptCount: z.number().int().nonnegative(),
        /** Celui de l'état précédent : la preuve de la progression, journalisée. */
        previousAttemptCount: z.number().int().nonnegative(),
        amountDueCents: z.number().int().nonnegative(),
        currency: z.string().max(8),
        /** `null` = aucune politique de grâce ; `0` = aucune clémence. */
        graceDaysSnapshot: z.number().int().nonnegative().nullable(),
        graceDeadlineAt: z.string().max(40).nullable(),
        /** L'échéance d'origine : le premier refus, jamais recalculé. */
        firstFailedAt: z.string().max(40).nullable(),
        invoiceNumber: z.string().max(64).nullable(),
      })
      .strict(),
  },

  'contract.payment.overdue_critical': {
    type: 'contract.payment.overdue_critical',
    description:
      "Le délai de grâce est épuisé : le service est menacé et une action du client est requise.",
    entityTypes: [ENTITY_TYPE.CONTRACT],
    retentionClass: RETENTION_CLASS.OPERATIONAL,
    payloadSchema: z
      .object({
        paymentDefaultId: z.string().max(64),
        reference: z.string().max(64),
        attemptCount: z.number().int().nonnegative(),
        amountDueCents: z.number().int().nonnegative(),
        currency: z.string().max(8),
        graceDeadlineAt: z.string().max(40).nullable(),
        invoiceNumber: z.string().max(64).nullable(),
        /**
         * DEMANDÉE ≠ APPLIQUÉE. Le message ne doit pas annoncer une fermeture
         * à un client dont le site répond encore — même distinction que
         * `SubscriptionIncidentCard`.
         */
        suspensionRequested: z.boolean(),
        suspensionConfirmed: z.boolean(),
      })
      .strict(),
  },

  'contract.payment.recovered': {
    type: 'contract.payment.recovered',
    description: "L'impayé est régularisé : le client a payé, l'incident est clos.",
    entityTypes: [ENTITY_TYPE.CONTRACT],
    retentionClass: RETENTION_CLASS.OPERATIONAL,
    payloadSchema: z
      .object({
        paymentDefaultId: z.string().max(64),
        reference: z.string().max(64),
        amountDueCents: z.number().int().nonnegative(),
        currency: z.string().max(8),
        resolution: z.string().max(32).nullable(),
        resolvedAt: z.string().max(40).nullable(),
        /** Le site avait-il réellement été fermé ? Le message n'est pas le même. */
        wasSuspended: z.boolean(),
      })
      .strict(),
  },

  /* --- Incident technique : le seul fait qui s'adresse aux DÉVELOPPEURS ---- */
  //
  // ══ UN SEUL TYPE, ET C'EST UN CHOIX ══════════════════════════════════════
  //
  // Contrairement aux impayés, les incidents techniques s'adressent TOUS à la
  // même population, appellent TOUS le même geste (aller voir), et n'ont pas de
  // cadence propre. Trois types — capacité, projection, déploiement — auraient
  // produit trois entrées de registre d'actions identiques à un mot près, donc
  // trois occasions de diverger. Le `kind` distingue la nature dans le message ;
  // le routage, lui, n'a rien à distinguer.
  //
  // ⚠️ Ce fait n'est PAS un journal d'erreurs. Il est réservé aux pannes
  // DURABLES qui exigent une intervention humaine : une capacité qui a épuisé
  // ses tentatives, une projection définitivement refusée. Un échec transitoire
  // qui se répare tout seul au passage suivant n'a rien à faire ici — le
  // journal technique le porte déjà, et l'inscrire réveillerait l'équipe pour
  // un incident déjà clos.

  'platform.incident.raised': {
    type: 'platform.incident.raised',
    description:
      "Un incident technique DURABLE requiert l'intervention d'un développeur du projet.",
    entityTypes: [ENTITY_TYPE.PLATFORM],
    retentionClass: RETENTION_CLASS.OPERATIONAL,
    payloadSchema: z
      .object({
        /** Ce qui est tombé — jamais un message libre, toujours une famille connue. */
        kind: z.enum([
          'CAPABILITY_FAILURE',
          'PANEL_PROJECTION_FAILURE',
          'DEPLOYMENT_FAILURE',
          'SERVICE_UNAVAILABLE',
        ]),
        /** Le composant précis : `billing.checkout.create`, `CONTRACT`, un run… */
        component: z.string().max(120),
        environment: z.enum(['TEST', 'PROD']),
        /** Combien de fois la panne a été constatée avant d'alerter. */
        occurrences: z.number().int().positive(),
        firstSeenAt: z.string().max(40),
        error: safeError,
      })
      .strict(),
  },

  /* --- Réservés : déclarés pour la suite, jamais émis à ce stade ---------- */
  // Déclarer maintenant fige le vocabulaire et évite qu'un lot ultérieur invente
  // un type divergent. Aucun code ne les émet : `emit()` les accepterait, mais
  // aucun appelant n'existe.

  'contract.created': {
    type: 'contract.created',
    description: 'Un contrat a été créé. (Réservé — non émis.)',
    entityTypes: [ENTITY_TYPE.CONTRACT],
    retentionClass: RETENTION_CLASS.AUDIT,
    payloadSchema: z.object({ reference: z.string().max(64) }).strict(),
  },
  'contract.dev_signed': {
    type: 'contract.dev_signed',
    description: 'Le développeur a signé le contrat. (Réservé — non émis.)',
    entityTypes: [ENTITY_TYPE.CONTRACT],
    retentionClass: RETENTION_CLASS.AUDIT,
    payloadSchema: z.object({ reference: z.string().max(64) }).strict(),
  },
  'contract.client_signed': {
    type: 'contract.client_signed',
    description: 'Le client a signé le contrat. (Réservé — non émis.)',
    entityTypes: [ENTITY_TYPE.CONTRACT],
    retentionClass: RETENTION_CLASS.AUDIT,
    payloadSchema: z.object({ reference: z.string().max(64) }).strict(),
  },
  'contract.fully_signed': {
    type: 'contract.fully_signed',
    description: 'Le contrat est signé par toutes les parties. (Réservé — non émis.)',
    entityTypes: [ENTITY_TYPE.CONTRACT],
    retentionClass: RETENTION_CLASS.AUDIT,
    payloadSchema: z.object({ reference: z.string().max(64) }).strict(),
  },
  /**
   * ÉMIS DEPUIS LE LOT « MAILS MÉTIER » — il ne l'était pas.
   *
   * Il reste déclaré ici, à sa place historique, plutôt que déplacé : changer
   * un type de section n'ajoute rien et rendrait illisible le diff du jour où
   * il a commencé à servir. Ce qui change, c'est qu'un appelant existe
   * (`payment.service.js`, à l'encaissement constaté) et qu'une action y est
   * branchée.
   *
   * Émis APRÈS l'encaissement acté, en best-effort : un e-mail qui ne part pas
   * ne défait pas un paiement.
   */
  'launch_fee.paid': {
    type: 'launch_fee.paid',
    description: 'Les frais de lancement ont été encaissés (constat Stripe, via webhook ou réconciliation).',
    entityTypes: [ENTITY_TYPE.CONTRACT],
    retentionClass: RETENTION_CLASS.AUDIT,
    payloadSchema: z
      .object({
        reference: z.string().max(64),
        amountIncludingTax: z.number().int().nonnegative(),
        currency: z.string().max(8),
        /** Quand l'argent est réellement entré — pas quand on l'a appris. */
        paidAt: z.string().max(40).nullable().optional(),
      })
      .strict(),
  },
  /**
   * UN CYCLE D'ABONNEMENT ENCAISSÉ (L12).
   *
   * ══ POURQUOI UN ÉVÉNEMENT PAR RÈGLEMENT, ET NON PAR ACTIVATION ═══════════
   *
   * `subscription.activated` — juste en dessous, et toujours non émis — décrit
   * une TRANSITION qui n'arrive qu'une fois. Or ce que le client doit recevoir,
   * et ce que L.Y Solution doit voir passer, c'est un ENCAISSEMENT : il s'en
   * produit un par mois, par trimestre ou par an, indéfiniment. Confondre les
   * deux aurait confirmé le premier prélèvement et tu tous les suivants.
   *
   * Émis depuis `subscription.service.markInvoicePaid`, c'est-à-dire le seul
   * point que traversent ET le webhook `invoice.paid` ET la réconciliation.
   * Aucune redirection navigateur n'y participe.
   */
  'subscription.paid': {
    type: 'subscription.paid',
    description: "Un règlement d'abonnement a été encaissé (constat Stripe, via webhook ou réconciliation).",
    entityTypes: [ENTITY_TYPE.CONTRACT],
    retentionClass: RETENTION_CLASS.AUDIT,
    payloadSchema: z
      .object({
        reference: z.string().max(64),
        /** Le règlement local — c'est lui qui porte l'idempotence de l'envoi. */
        paymentId: z.string().max(64),
        invoiceId: z.string().max(80),
        amountIncludingTax: z.number().int().nonnegative(),
        currency: z.string().max(8),
        /** Quand l'argent est réellement entré — pas quand on l'a appris. */
        paidAt: z.string().max(40).nullable().optional(),
        periodStart: z.string().max(40).nullable().optional(),
        periodEnd: z.string().max(40).nullable().optional(),
      })
      .strict(),
  },
  'subscription.activated': {
    type: 'subscription.activated',
    description: "L'abonnement est actif. (Réservé — non émis.)",
    entityTypes: [ENTITY_TYPE.CONTRACT],
    retentionClass: RETENTION_CLASS.AUDIT,
    payloadSchema: z.object({ reference: z.string().max(64) }).strict(),
  },
  'site.activated': {
    type: 'site.activated',
    description: 'Le site a été activé. (Réservé — non émis.)',
    entityTypes: [ENTITY_TYPE.SITE],
    retentionClass: RETENTION_CLASS.OPERATIONAL,
    payloadSchema: z.object({ reason: z.string().max(120) }).strict(),
  },
  'site.suspended': {
    type: 'site.suspended',
    description: 'Le site a été suspendu. (Réservé — non émis.)',
    entityTypes: [ENTITY_TYPE.SITE],
    retentionClass: RETENTION_CLASS.OPERATIONAL,
    payloadSchema: z.object({ reason: z.string().max(120) }).strict(),
  },

  /* --- Amorçage du premier développeur local (LOT 2C) ---------------------- */
  //
  // ══ POURQUOI CES SIX FAITS, ET POURQUOI ILS SONT EN AUDIT ══════════════════
  //
  // Ils racontent l'histoire complète d'un accès d'administration : qui a été
  // créé, quand le lien est parti, qui s'en est servi, ce qui a échoué, et
  // quels comptes hérités portaient encore un secret universel. C'est
  // exactement la question qu'on pose après un incident — et c'est pourquoi
  // elle ne peut pas se résoudre en relisant des lignes de log rotées.
  //
  // Les adresses sont MASQUÉES et les tokens absents : la garde
  // `assertSafePayload` refuserait de toute façon une clé qui ressemble à un
  // secret, mais un schéma qui n'en demande pas est une garantie plus forte
  // qu'une garde qui en refuse.

  'localdev.created': {
    type: 'localdev.created',
    description:
      'LOCAL_DEV_CREATED — un compte local a été créé sans mot de passe, en attente d’activation.',
    entityTypes: [ENTITY_TYPE.LOCAL_ACCOUNT],
    retentionClass: RETENTION_CLASS.AUDIT,
    payloadSchema: z
      .object({
        emailMasked: z.string().max(254),
        role: z.enum(['DEV', 'ADMIN']),
        origin: z.enum(['BOOTSTRAP', 'LEGACY_MIGRATION']),
      })
      .strict(),
  },
  'localdev.activation.sent': {
    type: 'localdev.activation.sent',
    description: "LOCAL_DEV_ACTIVATION_SENT — l'e-mail d'activation a été accepté par la plateforme.",
    entityTypes: [ENTITY_TYPE.LOCAL_ACCOUNT],
    retentionClass: RETENTION_CLASS.AUDIT,
    payloadSchema: z
      .object({
        emailMasked: z.string().max(254),
        expiresMinutes: z.number().int().positive(),
        reason: z.enum(['BOOTSTRAP', 'RESEND', 'LEGACY_MIGRATION']),
      })
      .strict(),
  },
  'localdev.activated': {
    type: 'localdev.activated',
    description: 'LOCAL_DEV_ACTIVATED — le titulaire a choisi son mot de passe ; le compte est actif.',
    entityTypes: [ENTITY_TYPE.LOCAL_ACCOUNT],
    retentionClass: RETENTION_CLASS.AUDIT,
    payloadSchema: z
      .object({
        emailMasked: z.string().max(254),
        role: z.enum(['DEV', 'ADMIN']),
      })
      .strict(),
  },
  'localdev.activation.failed': {
    type: 'localdev.activation.failed',
    description:
      "LOCAL_DEV_ACTIVATION_FAILED — l'e-mail d'activation n'a pas pu partir, ou un lien invalide a été présenté.",
    entityTypes: [ENTITY_TYPE.LOCAL_ACCOUNT],
    retentionClass: RETENTION_CLASS.AUDIT,
    payloadSchema: z
      .object({
        emailMasked: z.string().max(254).optional(),
        stage: z.enum(['SEND', 'CONSUME']),
        error: safeError,
      })
      .strict(),
  },
  'localdev.legacy.detected': {
    type: 'localdev.legacy.detected',
    description:
      'LOCAL_DEV_LEGACY_DETECTED — un compte porte encore un mot de passe universel historique (preuve par comparaison de hash).',
    entityTypes: [ENTITY_TYPE.LOCAL_ACCOUNT],
    retentionClass: RETENTION_CLASS.AUDIT,
    payloadSchema: z
      .object({
        emailMasked: z.string().max(254),
        role: z.enum(['DEV', 'ADMIN']),
        classification: z.enum(['LOCAL_DEV_LEGACY', 'LOCAL_DEV_REAL', 'UNKNOWN']),
      })
      .strict(),
  },
  'localdev.legacy.disabled': {
    type: 'localdev.legacy.disabled',
    description:
      "LOCAL_DEV_LEGACY_DISABLED — un compte hérité a perdu son mot de passe universel (désactivé ou converti en attente d'activation).",
    entityTypes: [ENTITY_TYPE.LOCAL_ACCOUNT],
    retentionClass: RETENTION_CLASS.AUDIT,
    payloadSchema: z
      .object({
        emailMasked: z.string().max(254),
        role: z.enum(['DEV', 'ADMIN']),
        strategy: z.enum(['DISABLE', 'CONVERT']),
      })
      .strict(),
  },
});

export const DOMAIN_EVENT_TYPES = Object.freeze(Object.keys(DOMAIN_EVENT_REGISTRY));

export function isKnownEventType(type) {
  return Object.prototype.hasOwnProperty.call(DOMAIN_EVENT_REGISTRY, type);
}

export function eventDefinition(type) {
  return DOMAIN_EVENT_REGISTRY[type] || null;
}

/** Refuse un type inconnu — aucun événement hors registre n'entre en base. */
export function assertKnownEventType(type) {
  if (!isKnownEventType(type)) {
    throw new EventPayloadError(
      EVENT_ERROR_CODES.UNKNOWN_EVENT_TYPE,
      `Type d'événement inconnu : « ${type} ». Déclarez-le dans DomainEventRegistry.`,
      { type }
    );
  }
  return DOMAIN_EVENT_REGISTRY[type];
}

/** Valide le payload contre le schéma du registre. Renvoie le payload parsé. */
export function validateEventPayload(type, payload) {
  const def = assertKnownEventType(type);
  const parsed = def.payloadSchema.safeParse(payload);
  if (!parsed.success) {
    const detail = parsed.error.errors
      .map((e) => `${e.path.join('.') || 'racine'}: ${e.message}`)
      .join(' · ');
    throw new EventPayloadError(
      EVENT_ERROR_CODES.INVALID_PAYLOAD,
      `Payload invalide pour « ${type} » — ${detail}`,
      { type }
    );
  }
  return parsed.data;
}

/**
 * Introspection SÛRE du registre (routes DEV / documentation). N'expose jamais les
 * schémas zod eux-mêmes, seulement leur description.
 */
export function describeRegistry() {
  return DOMAIN_EVENT_TYPES.map((type) => {
    const def = DOMAIN_EVENT_REGISTRY[type];
    return {
      type: def.type,
      description: def.description,
      entityTypes: def.entityTypes,
      retentionClass: def.retentionClass,
    };
  });
}
