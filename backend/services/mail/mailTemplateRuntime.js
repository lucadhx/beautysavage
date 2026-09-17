// services/mail/mailTemplateRuntime.js
// Sprint F3B — Split de mailService (extraction PUREMENT STRUCTURELLE, comportement
// identique). Bloc déplacé verbatim depuis services/mailService.js ; seuls les imports/exports
// et les chemins des imports dynamiques ont été adaptés au nouvel emplacement.

import EmailTemplate from '../../models/EmailTemplate.js';
import { sanitizeEditorialHtml } from '../editableContentService.js';
import { MAIL_THEME, buildThemeStyle, createMailTemplateDefinition, normalizeFunctionName, normalizeMode, sanitizeFullHtml } from './mailRenderer.js';

const TEMPLATE_FUNCTIONS = {
  // C2 — Learning : mails apprenant (éditables ensuite via le Mail Template Studio M6).
  formation_started: createMailTemplateDefinition({
    subject: 'Votre formation {{formationName}} a commencé',
    siteName: '{{siteName}}',
    eyebrow: 'Formation commencée',
    title: 'Bonne formation {{firstName}} !',
    intro: 'Bonjour {{firstName}},',
    paragraphs: ['Vous avez démarré la formation <strong>{{formationName}}</strong>. Avancez à votre rythme, vos progrès sont enregistrés.'],
    detailItems: [{ label: 'Formation', value: '{{formationName}}' }],
    signature: '{{siteName}}'
  }),
  lesson_completed: createMailTemplateDefinition({
    subject: 'Leçon terminée — {{lessonName}}',
    siteName: '{{siteName}}',
    eyebrow: 'Bravo',
    title: 'Une leçon de plus, {{firstName}} !',
    intro: 'Bonjour {{firstName}},',
    paragraphs: ['Vous avez terminé la leçon <strong>{{lessonName}}</strong> de la formation {{formationName}}.'],
    detailItems: [{ label: 'Leçon', value: '{{lessonName}}' }],
    signature: '{{siteName}}'
  }),
  formation_completed: createMailTemplateDefinition({
    subject: 'Félicitations — formation {{formationName}} terminée',
    siteName: '{{siteName}}',
    eyebrow: 'Formation terminée',
    title: 'Bravo {{firstName}}, vous avez terminé !',
    intro: 'Bonjour {{firstName}},',
    paragraphs: ['Vous avez terminé l’intégralité de la formation <strong>{{formationName}}</strong>. Félicitations !', '{{attestationLine}}'],
    detailItems: [{ label: 'Formation', value: '{{formationName}}' }],
    signature: '{{siteName}}'
  }),
  presence_confirmed: createMailTemplateDefinition({
    subject: 'Présence confirmée — {{formationName}}',
    siteName: '{{siteName}}',
    eyebrow: 'Présence validée',
    title: 'Présence confirmée, {{firstName}}',
    intro: 'Bonjour {{firstName}},',
    paragraphs: ['Votre présence à la session de <strong>{{formationName}}</strong> du {{sessionDate}} a bien été enregistrée.'],
    detailItems: [{ label: 'Formation', value: '{{formationName}}' }, { label: 'Date', value: '{{sessionDate}}' }],
    signature: '{{siteName}}'
  }),
  vente: createMailTemplateDefinition({
    subject: 'Confirmation de votre achat chez Beauty Savage',
    siteName: 'Beauty Savage',
    eyebrow: 'Commande confirmée',
    title: 'Votre achat est validé',
    intro: 'Bonjour {{firstName}} {{lastName}},',
    paragraphs: [
      `Merci pour votre confiance. Votre commande <strong>{{saleId}}</strong> a bien été enregistrée pour un montant de <strong>{{amount}} EUR</strong>.`,
      'Votre facture reste disponible à tout moment depuis le bouton ci-dessous.'
    ],
    detailItems: [
      { label: 'ID vente', value: '{{saleId}}' },
      { label: 'Montant payé', value: '{{amount}} EUR' }
    ],
    callout: {
      label: 'Facture',
      content: "Le document téléchargé constitue votre justificatif d'achat."
    },
    cta: {
      label: 'Télécharger la facture',
      url: '{{invoiceDownloadUrl}}'
    },
    footnote: "Si vous avez besoin d'un accompagnement complémentaire, notre équipe reste disponible.",
    signature: "L'équipe Beauty Savage"
  }),
  password_reset: createMailTemplateDefinition({
    subject: 'Réinitialisez votre mot de passe Beauty Savage',
    siteName: 'Beauty Savage',
    eyebrow: 'Sécurité du compte',
    title: 'Réinitialisez votre mot de passe',
    intro: 'Bonjour {{firstName}} {{lastName}},',
    paragraphs: [
      'Nous avons reçu une demande de réinitialisation pour votre compte Beauty Savage.',
      'Utilisez le lien sécurisé ci-dessous pour définir un nouveau mot de passe.'
    ],
    callout: {
      label: 'Important',
      content: "Le lien expire dans 30 minutes. Si vous n'avez pas demandé cette action, ignorez simplement cet email.",
      tone: 'warning'
    },
    cta: {
      label: 'Réinitialiser le mot de passe',
      url: '{{link}}'
    },
    signature: "L'équipe Beauty Savage"
  }),
  // RX-BLOCKER-2 — Invitation manager (expéditeur support). Lien /manager/invitation/:token.
  manager_invitation: createMailTemplateDefinition({
    subject: "Invitation à rejoindre l'espace de gestion Beauty Savage",
    siteName: 'Beauty Savage',
    eyebrow: 'Invitation',
    title: "Bienvenue dans l'équipe",
    intro: 'Bonjour {{firstName}} {{lastName}},',
    paragraphs: [
      "Vous avez été invité(e) à rejoindre l'espace de gestion Beauty Savage en tant que {{roleLabel}}.",
      'Cliquez sur le lien ci-dessous pour définir votre mot de passe et activer votre compte.'
    ],
    callout: {
      label: 'Important',
      content: "Ce lien d'invitation expire dans 7 jours et n'est utilisable qu'une seule fois.",
      tone: 'warning'
    },
    cta: { label: "Accepter l'invitation", url: '{{link}}' },
    signature: "L'équipe Beauty Savage"
  }),
  // RX-BLOCKER-2 — Reset mot de passe manager (expéditeur support). Lien /manager/reinitialiser-mot-de-passe/:token.
  manager_password_reset: createMailTemplateDefinition({
    subject: 'Réinitialisez votre mot de passe — Gestion Beauty Savage',
    siteName: 'Beauty Savage',
    eyebrow: 'Sécurité du compte',
    title: 'Réinitialisez votre mot de passe',
    intro: 'Bonjour {{firstName}} {{lastName}},',
    paragraphs: [
      'Une réinitialisation de mot de passe a été demandée pour votre compte de gestion.',
      'Utilisez le lien sécurisé ci-dessous pour définir un nouveau mot de passe.'
    ],
    callout: {
      label: 'Important',
      content: "Le lien expire dans 30 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.",
      tone: 'warning'
    },
    cta: { label: 'Réinitialiser le mot de passe', url: '{{link}}' },
    signature: "L'équipe Beauty Savage"
  }),
  commission_available: createMailTemplateDefinition({
    subject: 'Commissions {{period}} — paiement disponible',
    siteName: 'Beauty Savage',
    eyebrow: 'Commissions',
    title: 'Les commissions {{period}} sont disponibles',
    intro: 'Bonjour,',
    paragraphs: [
      'Les commissions du mois de <strong>{{period}}</strong> sont maintenant disponibles au règlement sur la plateforme.',
      'Vous disposez de <strong>{{daysTotal}} jours</strong> pour effectuer le paiement.'
    ],
    detailItems: [
      { label: 'Période', value: '{{period}}' },
      { label: 'Montant à régler', value: '{{amount}} EUR' },
      { label: 'Délai de paiement', value: '{{daysTotal}} jours' }
    ],
    cta: {
      label: 'Régler les commissions',
      url: '{{platformUrl}}'
    },
    footnote: 'Passé ce délai, le paiement sera considéré en retard.',
    signature: "L'équipe Beauty Savage"
  }),
  commission_reminder: createMailTemplateDefinition({
    subject: 'Rappel — commissions {{period}} : {{daysLeft}} jour(s) restant(s)',
    siteName: 'Beauty Savage',
    eyebrow: 'Rappel de paiement',
    title: 'Rappel : commissions {{period}} en attente',
    intro: 'Bonjour,',
    paragraphs: [
      'Les commissions du mois de <strong>{{period}}</strong> n\'ont pas encore été réglées.',
      'Il vous reste <strong>{{daysLeft}} jour(s)</strong> pour effectuer le paiement avant qu\'il soit considéré en retard.'
    ],
    detailItems: [
      { label: 'Période', value: '{{period}}' },
      { label: 'Montant à régler', value: '{{amount}} EUR' },
      { label: 'Jours restants', value: '{{daysLeft}} jour(s)' }
    ],
    callout: {
      label: 'Action requise',
      content: 'Connectez-vous à la plateforme de gestion pour procéder au règlement.',
      tone: 'warning'
    },
    cta: {
      label: 'Régler maintenant',
      url: '{{platformUrl}}'
    },
    signature: "L'équipe Beauty Savage"
  }),
  commission_last_day: createMailTemplateDefinition({
    subject: '⚠ Dernier jour — commissions {{period}} à régler aujourd\'hui',
    siteName: 'Beauty Savage',
    eyebrow: 'Dernier rappel',
    title: 'Dernier jour pour régler les commissions {{period}}',
    intro: 'Bonjour,',
    paragraphs: [
      'C\'est le <strong>dernier jour</strong> pour régler les commissions du mois de <strong>{{period}}</strong>.',
      'Passé aujourd\'hui, le paiement sera automatiquement marqué en retard.'
    ],
    detailItems: [
      { label: 'Période', value: '{{period}}' },
      { label: 'Montant à régler', value: '{{amount}} EUR' }
    ],
    callout: {
      label: 'Urgent',
      content: 'Le paiement doit être effectué avant minuit ce soir.',
      tone: 'danger'
    },
    cta: {
      label: 'Régler immédiatement',
      url: '{{platformUrl}}'
    },
    signature: "L'équipe Beauty Savage"
  }),
  site_suspended: createMailTemplateDefinition({
    subject: 'Site suspendu temporairement',
    siteName: 'Beauty Savage',
    eyebrow: 'Statut plateforme',
    title: 'Le site est temporairement suspendu',
    intro: 'Bonjour,',
    paragraphs: [
      'Le site a été suspendu temporairement par le développeur.',
      'Une nouvelle notification vous sera envoyée dès que la plateforme sera réactivée.'
    ],
    detailItems: [
      { label: 'Motif', value: '{{reason}}' },
      { label: 'Date', value: '{{date}}' }
    ],
    callout: {
      label: 'Information',
      content: 'Les parcours clients et achats restent indisponibles tant que la suspension est active.',
      tone: 'danger'
    }
  }),
  site_reactivated: createMailTemplateDefinition({
    subject: 'Site réactivé',
    siteName: 'Beauty Savage',
    eyebrow: 'Statut plateforme',
    title: 'Le site est de nouveau actif',
    intro: 'Bonjour,',
    paragraphs: [
      'La plateforme a été réactivée et les achats sont de nouveau disponibles.'
    ],
    detailItems: [{ label: 'Date', value: '{{date}}' }],
    callout: {
      label: 'Reprise',
      content: "Vous pouvez reprendre l'activité habituelle sur la vitrine et la gestion.",
      tone: 'success'
    }
  }),
  site_maintenance_start: createMailTemplateDefinition({
    subject: 'Maintenance du site démarrée',
    siteName: 'Beauty Savage',
    eyebrow: 'Maintenance',
    title: 'La maintenance a commencé',
    intro: 'Bonjour,',
    paragraphs: [
      "Le site est actuellement en maintenance. Les équipes techniques sont en cours d'intervention."
    ],
    detailItems: [
      { label: 'Motif', value: '{{reason}}' },
      { label: 'Durée estimée', value: '{{eta}}' },
      { label: 'Début', value: '{{startedAt}}' },
      { label: 'Notification', value: '{{date}}' }
    ],
    callout: {
      label: 'Suivi',
      content: "Une notification vous sera envoyée à la fin de l'intervention.",
      tone: 'warning'
    }
  }),
  site_maintenance_end: createMailTemplateDefinition({
    subject: 'Maintenance du site terminée',
    siteName: 'Beauty Savage',
    eyebrow: 'Maintenance',
    title: 'La maintenance est terminée',
    intro: 'Bonjour,',
    paragraphs: [
      'La maintenance est finalisée et le site est de nouveau disponible.'
    ],
    detailItems: [
      { label: 'Motif', value: '{{reason}}' },
      { label: 'Durée estimée', value: '{{eta}}' },
      { label: 'Début', value: '{{startedAt}}' },
      { label: 'Date de fin', value: '{{date}}' }
    ],
    callout: {
      label: 'Disponibilité',
      content: 'Les accès clients et administrateurs peuvent reprendre normalement.',
      tone: 'success'
    }
  }),
  email_confirmation_code: createMailTemplateDefinition({
    subject: 'Confirmez votre email Beauty Savage',
    siteName: 'Beauty Savage',
    eyebrow: 'Vérification email',
    title: 'Confirmez votre adresse email',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      "Utilisez le code ci-dessous pour confirmer l'adresse email associée à votre compte."
    ],
    detailItems: [
      { label: 'Code', value: '{{code}}' },
      { label: 'Email', value: '{{email}}' }
    ],
    callout: {
      label: 'Validité',
      content: "Ce code reste valable pendant {{expiresMinutes}} minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email."
    },
    signature: "L'équipe Beauty Savage"
  }),
  session_cancelled_choice: createMailTemplateDefinition({
    subject: '{{siteName}} | Votre session a été annulée',
    siteName: '{{siteName}}',
    eyebrow: 'Session présentielle',
    title: 'Votre session a été annulée',
    intro: 'Bonjour {{firstName}} {{lastName}},',
    paragraphs: [
      `L'institut a annulé votre session pour <strong>{{formationTitle}}</strong>.`,
      'Vous pouvez choisir une nouvelle session ou demander un remboursement depuis le lien sécurisé ci-dessous.'
    ],
    detailItems: [
      { label: 'Formation', value: '{{formationTitle}}' },
      { label: 'Date session', value: '{{sessionDateLabel}}' },
      { label: 'Horaires', value: '{{sessionTimeLabel}}' }
    ],
    callout: {
      label: 'Délai de réponse',
      content: 'Le lien reste actif pendant 7 jours. Passé ce délai, il devient invalide.',
      tone: 'accent'
    },
    cta: {
      label: 'Choisir une option',
      url: '{{actionUrl}}'
    },
    footnote: '{{reason}}',
    signature: '{{siteName}}'
  }),
  formation_deleted_choice: createMailTemplateDefinition({
    subject: '{{siteName}} | Formation supprimée : choisissez votre option',
    siteName: '{{siteName}}',
    eyebrow: 'Formation présentielle',
    title: 'La formation a été supprimée',
    intro: 'Bonjour {{firstName}} {{lastName}},',
    paragraphs: [
      `L'institut a supprimé la formation <strong>{{formationTitle}}</strong>.`,
      'Vous pouvez choisir entre un remboursement et une carte cadeau du montant payé.'
    ],
    detailItems: [
      { label: 'Formation', value: '{{formationTitle}}' },
      { label: 'Montant payé', value: '{{amountPaid}} EUR' },
      { label: 'ID vente', value: '{{saleId}}' }
    ],
    callout: {
      label: 'Délai de réponse',
      content: 'Le lien reste actif 7 jours. Sans action de votre part, un remboursement sera lancé automatiquement.',
      tone: 'accent'
    },
    cta: {
      label: 'Choisir remboursement ou carte cadeau',
      url: '{{actionUrl}}'
    },
    footnote: '{{reason}}',
    signature: '{{siteName}}'
  }),
  session_updated_choice: createMailTemplateDefinition({
    subject: '{{siteName}} | Votre session a été modifiée',
    siteName: '{{siteName}}',
    eyebrow: 'Session présentielle',
    title: 'Votre session a été modifiée',
    intro: 'Bonjour {{firstName}} {{lastName}},',
    paragraphs: [
      `L'institut a modifié votre session pour <strong>{{formationTitle}}</strong>.`,
      'Vous pouvez confirmer votre présence, décaler votre réservation ou demander un remboursement.'
    ],
    detailItems: [
      { label: 'Formation', value: '{{formationTitle}}' },
      { label: 'Nouvelle date', value: '{{sessionDateLabel}}' },
      { label: 'Nouveaux horaires', value: '{{sessionTimeLabel}}' },
      { label: 'ID vente', value: '{{saleId}}' }
    ],
    callout: {
      label: 'Délai de réponse',
      content: 'Sans réponse sous 7 jours, un remboursement sera lancé automatiquement et le lien deviendra invalide.',
      tone: 'warning'
    },
    cta: {
      label: 'Choisir une option',
      url: '{{actionUrl}}'
    },
    footnote: '{{reason}}',
    signature: '{{siteName}}'
  }),
  service_booking_cancelled_choice: createMailTemplateDefinition({
    subject: '{{siteName}} | Votre réservation a été annulée — {{serviceName}}',
    siteName: '{{siteName}}',
    eyebrow: 'Prestation annulée',
    title: 'Votre réservation a été annulée',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      `L'institut a annulé votre réservation pour <strong>{{serviceName}}</strong> prévue le <strong>{{bookingDate}}</strong> à <strong>{{bookingTime}}</strong>.`,
      'Vous pouvez choisir un nouveau créneau ou demander un remboursement via le lien sécurisé ci-dessous.'
    ],
    detailItems: [
      { label: 'Prestation', value: '{{serviceName}}' },
      { label: 'Date', value: '{{bookingDate}}' },
      { label: 'Horaire', value: '{{bookingTime}}' }
    ],
    callout: {
      label: 'Délai de réponse',
      content: 'Le lien reste actif pendant {{autoRefundDays}} jours. Sans action de votre part, un remboursement sera lancé automatiquement.',
      tone: 'accent'
    },
    cta: {
      label: 'Choisir une option',
      url: '{{actionUrl}}'
    },
    signature: '{{siteName}}'
  }),
  service_booking_rescheduled_admin: createMailTemplateDefinition({
    subject: 'Report de réservation — {{serviceName}}',
    siteName: '{{siteName}}',
    eyebrow: 'Report de réservation',
    title: 'Un client a reporté sa réservation',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      `Le client <strong>{{clientName}}</strong> ({{clientEmail}}) a choisi un nouveau créneau pour <strong>{{serviceName}}</strong>.`
    ],
    detailItems: [
      { label: 'Prestation', value: '{{serviceName}}' },
      { label: 'Ancien créneau', value: '{{oldBookingDate}} à {{oldBookingTime}}' },
      { label: 'Nouveau créneau', value: '{{newBookingDate}} à {{newBookingTime}}' },
      { label: 'Client', value: '{{clientName}} — {{clientEmail}}' }
    ],
    callout: {
      label: 'Information',
      content: 'Le nouveau créneau a été automatiquement confirmé.',
      tone: 'accent'
    },
    signature: '{{siteName}}'
  }),
  session_rescheduled: createMailTemplateDefinition({
    subject: 'Nouvelle session confirmée - {{formationTitle}}',
    siteName: '{{siteName}}',
    eyebrow: 'Confirmation',
    title: 'Votre nouvelle session est confirmée',
    intro: 'Bonjour {{firstName}} {{lastName}},',
    paragraphs: [
      `Votre nouvelle session pour <strong>{{formationTitle}}</strong> est maintenant confirmée.`
    ],
    detailItems: [
      { label: 'Formation', value: '{{formationTitle}}' },
      { label: 'Date session', value: '{{sessionDateLabel}}' },
      { label: 'Horaires', value: '{{sessionTimeLabel}}' },
      { label: 'ID vente', value: '{{saleId}}' }
    ],
    callout: {
      label: 'Présence',
      content: 'Conservez cet email comme récapitulatif de votre réservation mise à jour.',
      tone: 'success'
    },
    signature: '{{siteName}}'
  }),
  session_client_cancelled_refund: createMailTemplateDefinition({
    subject: 'Annulation de session prise en compte - remboursement en cours',
    siteName: '{{siteName}}',
    eyebrow: 'Annulation client',
    title: 'Votre annulation est prise en compte',
    intro: 'Bonjour {{firstName}} {{lastName}},',
    paragraphs: [
      `Votre annulation pour <strong>{{formationTitle}}</strong> a bien été enregistrée.`,
      'Votre remboursement suit maintenant son circuit habituel de traitement.'
    ],
    detailItems: [
      { label: 'Session', value: '{{sessionDateLabel}} - {{sessionTimeLabel}}' },
      { label: 'Montant payé', value: '{{amountPaid}} EUR' },
      { label: 'Montant remboursé', value: '{{refundAmount}} EUR' },
      { label: 'Statut remboursement', value: '{{refundStatus}}' },
      { label: 'ID vente', value: '{{saleId}}' }
    ],
    cta: { label: 'Suivre mon remboursement', url: '{{trackingUrl}}' },
    callout: {
      label: 'CGV',
      content: 'Cette annulation reste éligible au remboursement selon les conditions en vigueur.',
      tone: 'success'
    },
    footnote: 'Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur : <a href="{{trackingUrl}}">{{trackingUrl}}</a>',
    signature: '{{siteName}}'
  }),
  session_client_cancelled_no_refund: createMailTemplateDefinition({
    subject: 'Annulation de session prise en compte - sans remboursement',
    siteName: '{{siteName}}',
    eyebrow: 'Annulation client',
    title: 'Votre annulation est prise en compte',
    intro: 'Bonjour {{firstName}} {{lastName}},',
    paragraphs: [
      `Votre annulation pour <strong>{{formationTitle}}</strong> a bien été enregistrée.`,
      "Conformément aux CGV, aucun remboursement ne s'applique sur cette annulation."
    ],
    detailItems: [
      { label: 'Session', value: '{{sessionDateLabel}} - {{sessionTimeLabel}}' },
      { label: 'Montant payé', value: '{{amountPaid}} EUR' },
      { label: 'ID vente', value: '{{saleId}}' }
    ],
    callout: {
      label: 'CGV',
      content: 'Le dossier reste enregistré comme annulation client hors conditions de remboursement.',
      tone: 'warning'
    },
    signature: '{{siteName}}'
  }),
  institute_client_cancelled_notice: createMailTemplateDefinition({
    subject: 'Client {{customerName}} a annulé la session {{formationTitle}}',
    siteName: 'Beauty Savage',
    eyebrow: 'Back-office institut',
    title: 'Annulation client à traiter',
    intro: 'Bonjour,',
    paragraphs: [
      'Un client a annulé une session présentielle. Vous trouverez ci-dessous le récapitulatif de la vente et du statut de remboursement.'
    ],
    detailItems: [
      { label: 'Client', value: '{{customerName}}' },
      { label: 'Email client', value: '{{clientEmail}}' },
      { label: 'Formation', value: '{{formationTitle}}' },
      { label: 'Session', value: '{{sessionDateLabel}} - {{sessionTimeLabel}}' },
      { label: 'ID vente', value: '{{saleId}}' },
      { label: 'Montant payé', value: '{{amountPaid}} EUR' },
      { label: 'Éligibilité remboursement', value: '{{refundStatus}}' }
    ],
    callout: {
      label: 'Motif',
      content: '{{reason}}',
      tone: 'accent'
    },
    signature: 'Beauty Savage'
  }),
  refund_requested: createMailTemplateDefinition({
    subject: 'Votre demande de remboursement est enregistrée',
    siteName: '{{siteName}}',
    eyebrow: 'Remboursement',
    title: 'Votre demande de remboursement est enregistrée',
    intro: 'Bonjour {{firstName}} {{lastName}},',
    paragraphs: [
      'Votre demande a bien été créée et va suivre le circuit de validation habituel. Le remboursement sera traité sous 5 à 10 jours ouvrés.'
    ],
    detailItems: [
      { label: 'Produit / formation', value: '{{productName}}{{formationTitle}}' },
      { label: 'Montant remboursement', value: '{{refundAmount}} EUR' },
      { label: 'Date / heure', value: '{{refundDateTime}}' },
      { label: 'ID vente', value: '{{saleId}}' },
      { label: 'Référence remboursement', value: '{{refundId}}' }
    ],
    cta: { label: 'Suivre mon remboursement', url: '{{trackingUrl}}' },
    callout: {
      label: 'Suivi de votre remboursement',
      content: "Suivez l'état de votre remboursement en temps réel : {{trackingUrl}}",
      tone: 'accent'
    },
    signature: '{{siteName}}'
  }),
  refund_auto_initiated: createMailTemplateDefinition({
    subject: 'Remboursement lancé automatiquement - {{formationTitle}}',
    siteName: '{{siteName}}',
    eyebrow: 'Remboursement automatique',
    title: 'Votre remboursement a été lancé automatiquement',
    intro: 'Bonjour {{firstName}} {{lastName}},',
    paragraphs: [
      `Le remboursement lié à <strong>{{formationTitle}}</strong> a été déclenché automatiquement à l'issue du délai de réponse. Il sera traité sous 5 à 10 jours ouvrés.`
    ],
    detailItems: [
      { label: 'Montant remboursement', value: '{{refundAmount}} EUR' },
      { label: 'Date / heure', value: '{{refundDateTime}}' },
      { label: 'ID vente', value: '{{saleId}}' },
      { label: 'Référence remboursement', value: '{{refundId}}' }
    ],
    cta: { label: 'Suivre mon remboursement', url: '{{trackingUrl}}' },
    callout: {
      label: 'Information',
      content: "Le lien de décision n'est plus actif après le déclenchement automatique du remboursement.",
      tone: 'warning'
    },
    signature: '{{siteName}}'
  }),
  refund_confirmed: createMailTemplateDefinition({
    subject: 'Votre remboursement a été effectué',
    siteName: '{{siteName}}',
    eyebrow: 'Remboursement confirmé',
    title: 'Votre remboursement a été traité',
    intro: 'Bonjour {{firstName}} {{lastName}},',
    paragraphs: [
      `Le remboursement de <strong>{{refundAmount}} EUR</strong> pour <strong>{{itemDetail}}</strong> a bien été effectué.`,
      'Selon votre banque, les fonds peuvent mettre 2 à 5 jours ouvrés supplémentaires pour apparaître sur votre compte.'
    ],
    detailItems: [
      { label: 'Montant remboursé', value: '{{refundAmount}} EUR' },
      { label: 'Prestation / Formation', value: '{{itemDetail}}' },
      { label: "Date d'exécution", value: '{{refundedAtFormatted}}' },
      { label: 'Référence remboursement', value: '{{refundId}}' }
    ],
    cta: { label: 'Voir le détail', url: '{{trackingUrl}}' },
    footnote: '{{giftcardbalance}}',
    signature: '{{siteName}}'
  }),
  refund_confirmed_service: createMailTemplateDefinition({
    subject: 'Remboursement confirmé — {{serviceName}}',
    siteName: '{{siteName}}',
    eyebrow: 'Remboursement confirmé',
    title: 'Votre remboursement a été effectué',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Votre remboursement pour la prestation <strong>{{serviceName}}</strong> a bien été traité.'
    ],
    detailItems: [
      { label: 'Prestation', value: '{{serviceName}}' },
      { label: 'Date RDV', value: '{{bookingDate}}' },
      { label: 'Heure', value: '{{bookingTime}}' },
      { label: 'Praticienne', value: '{{practitionerName}}' },
      { label: 'Montant remboursé', value: '{{refundAmount}}' },
      { label: 'Remboursé le', value: '{{refundDateTime}}' }
    ],
    signature: '{{siteName}}'
  }),
  gift_card_compensation: createMailTemplateDefinition({
    subject: 'Votre carte cadeau est disponible - {{formationTitle}}',
    siteName: '{{siteName}}',
    eyebrow: 'Carte cadeau',
    title: 'Votre carte cadeau de compensation est prête',
    intro: 'Bonjour {{firstName}} {{lastName}},',
    paragraphs: [
      `Votre carte cadeau de compensation pour <strong>{{formationTitle}}</strong> a été créée.`,
      'Vous pouvez aussi la retrouver dans la rubrique « Mes cartes cadeaux ».'
    ],
    detailItems: [
      { label: 'Code carte', value: '{{giftCardCode}}' },
      { label: 'Mot de passe', value: '{{giftCardPassword}}' },
      { label: 'Solde disponible', value: '{{giftCardBalance}} EUR' },
      { label: 'Montant initial payé', value: '{{amountPaid}} EUR' },
      { label: 'ID vente', value: '{{saleId}}' }
    ],
    callout: {
      label: 'Accès',
      content: 'Conservez ces informations. Elles seront nécessaires pour consulter ou utiliser la carte cadeau.',
      tone: 'accent'
    },
    signature: '{{siteName}}'
  }),
  // M13 — carte cadeau créée à la main par l'institut (paiement sur place). La carte (PDF) est
  // jointe au mail. Les adresses from/to ne sont PAS ici : injectées par le moteur (commerciale→client).
  gift_card_manual_created: createMailTemplateDefinition({
    subject: 'Votre carte cadeau {{instituteName}}',
    siteName: '{{siteName}}',
    eyebrow: 'Carte cadeau',
    title: 'Votre carte cadeau est prête, {{recipientName}} !',
    intro: 'Bonjour {{recipientName}},',
    paragraphs: [
      'Une carte cadeau d\'une valeur de <strong>{{amount}}</strong> vous a été offerte par {{purchaserName}}.',
      '{{message}}',
      'Vous trouverez votre carte cadeau en pièce jointe de cet e-mail.'
    ],
    detailItems: [
      { label: 'Code carte', value: '{{code}}' },
      { label: 'Mot de passe', value: '{{pin}}' },
      { label: 'Montant', value: '{{amount}}' },
      { label: 'Règlement', value: '{{paymentLabel}}' }
    ],
    callout: {
      label: 'Paiement sur place',
      content: 'Cette carte cadeau a été réglée directement à l\'institut ({{paymentLabel}}).',
      tone: 'accent'
    },
    signature: '{{instituteName}}'
  }),
  // M13 — débit manuel d'une carte cadeau par l'institut.
  gift_card_manual_debited: createMailTemplateDefinition({
    subject: 'Mouvement sur votre carte cadeau {{instituteName}}',
    siteName: '{{siteName}}',
    eyebrow: 'Carte cadeau',
    title: 'Un montant a été débité de votre carte cadeau',
    intro: 'Bonjour {{recipientName}},',
    paragraphs: [
      'Un montant de <strong>{{amount}}</strong> a été débité de votre carte cadeau par l\'institut.',
      'Le solde restant de votre carte est désormais de <strong>{{balance}}</strong>.'
    ],
    detailItems: [
      { label: 'Code carte', value: '{{code}}' },
      { label: 'Montant débité', value: '{{amount}}' },
      { label: 'Solde restant', value: '{{balance}}' },
      { label: 'Motif', value: '{{transactionReason}}' }
    ],
    signature: '{{instituteName}}'
  }),
  // M13 — carte cadeau créée via le checkout en ligne (confirmation enrichie).
  gift_card_online_created: createMailTemplateDefinition({
    subject: 'Votre carte cadeau {{instituteName}}',
    siteName: '{{siteName}}',
    eyebrow: 'Carte cadeau',
    title: 'Merci pour votre achat !',
    intro: 'Bonjour {{recipientName}},',
    paragraphs: [
      'Votre carte cadeau d\'une valeur de <strong>{{amount}}</strong> a bien été créée.',
      'Vous trouverez votre carte cadeau en pièce jointe et dans la rubrique « Mes cartes cadeaux ».'
    ],
    detailItems: [
      { label: 'Code carte', value: '{{code}}' },
      { label: 'Mot de passe', value: '{{pin}}' },
      { label: 'Montant', value: '{{amount}}' }
    ],
    signature: '{{instituteName}}'
  }),
  booking_reminder: createMailTemplateDefinition({
    subject: 'Rappel — Votre rendez-vous {{timeLabel}}',
    siteName: '{{siteName}}',
    eyebrow: 'Rappel de rendez-vous',
    title: 'Votre rendez-vous {{timeLabel}}',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Nous vous rappelons votre prochain rendez-vous <strong>{{serviceName}}</strong> prévu le <strong>{{bookingDate}}</strong> à <strong>{{bookingTime}}</strong>.'
    ],
    detailItems: [
      { label: 'Prestation', value: '{{serviceName}}' },
      { label: 'Date', value: '{{bookingDate}}' },
      { label: 'Heure', value: '{{bookingTime}}' },
      { label: 'Praticienne', value: '{{practitionerName}}' },
      { label: 'Paiement', value: '{{paymentType}}' }
    ],
    callout: {
      label: 'Annulation',
      content: 'En cas d\'empêchement, pensez à annuler depuis votre espace personnel au moins {{cancellationDays}} jours avant.',
      tone: 'default'
    },
    signature: '{{siteName}}'
  }),
  booking_confirmed: createMailTemplateDefinition({
    subject: 'Confirmation de votre réservation — {{serviceName}}',
    siteName: '{{siteName}}',
    eyebrow: 'Réservation confirmée',
    title: 'Votre réservation est confirmée !',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Votre réservation pour <strong>{{serviceName}}</strong> le <strong>{{bookingDate}}</strong> à <strong>{{bookingTime}}</strong> a bien été enregistrée.'
    ],
    detailItems: [
      { label: 'Prestation', value: '{{serviceName}}' },
      { label: 'Date', value: '{{bookingDate}}' },
      { label: 'Heure', value: '{{bookingTime}}' },
      { label: 'Praticienne', value: '{{practitionerName}}' },
      { label: 'Paiement', value: '{{paymentType}}' }
    ],
    callout: {
      label: 'Annulation',
      content: 'Vous pouvez annuler gratuitement jusqu\'à {{cancellationDays}} jours avant votre rendez-vous depuis votre espace personnel.',
      tone: 'default'
    },
    signature: '{{siteName}}'
  }),
  booking_cancelled_client: createMailTemplateDefinition({
    subject: 'Annulation de votre réservation — {{serviceName}}',
    siteName: '{{siteName}}',
    eyebrow: 'Réservation annulée',
    title: 'Votre réservation a été annulée',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Votre réservation pour <strong>{{serviceName}}</strong> le <strong>{{bookingDate}}</strong> à <strong>{{bookingTime}}</strong> a bien été annulée.',
      '{{refundSection}}'
    ],
    detailItems: [
      { label: 'Prestation', value: '{{serviceName}}' },
      { label: 'Date', value: '{{bookingDate}}' },
      { label: 'Heure', value: '{{bookingTime}}' },
      { label: 'Praticienne', value: '{{practitionerName}}' },
      { label: 'Remboursement', value: '{{refundAmount}}' }
    ],
    signature: '{{siteName}}'
  }),
  booking_cancelled_refundable: createMailTemplateDefinition({
    subject: 'Annulation confirmée — Remboursement de {{refundAmount}} en cours',
    siteName: '{{siteName}}',
    eyebrow: 'Réservation annulée',
    title: 'Votre réservation a été annulée',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Votre réservation pour <strong>{{serviceName}}</strong> le <strong>{{bookingDate}}</strong> à <strong>{{bookingTime}}</strong> a bien été annulée.',
      '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px;margin:8px 0"><p style="color:#166534;margin:0;font-weight:600">✅ Remboursement de {{refundAmount}} en cours de traitement</p><p style="color:#166534;margin:8px 0 0;font-size:0.9em">Vous recevrez vos fonds sous 5 à 10 jours ouvrés.</p></div>',
      '{{trackingUrl}}'
    ],
    detailItems: [
      { label: 'Prestation', value: '{{serviceName}}' },
      { label: 'Date', value: '{{bookingDate}}' },
      { label: 'Heure', value: '{{bookingTime}}' }
    ],
    signature: '{{siteName}}'
  }),
  booking_cancelled_not_refundable_delay: createMailTemplateDefinition({
    subject: 'Annulation confirmée — {{serviceName}}',
    siteName: '{{siteName}}',
    eyebrow: 'Réservation annulée',
    title: 'Votre réservation a été annulée',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Votre réservation pour <strong>{{serviceName}}</strong> le <strong>{{bookingDate}}</strong> à <strong>{{bookingTime}}</strong> a bien été annulée.',
      `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:16px;margin:8px 0"><p style="color:#991b1b;margin:0;font-weight:600">❌ Cette annulation ne donne pas lieu à un remboursement</p><p style="color:#991b1b;margin:8px 0 0;font-size:0.9em">Le délai d'annulation gratuit de {{cancellationDays}} jour(s) est dépassé.</p></div>`
    ],
    detailItems: [
      { label: 'Prestation', value: '{{serviceName}}' },
      { label: 'Date', value: '{{bookingDate}}' },
      { label: 'Heure', value: '{{bookingTime}}' }
    ],
    signature: '{{siteName}}'
  }),
  booking_cancelled_not_refundable_waiver: createMailTemplateDefinition({
    subject: 'Annulation confirmée — {{serviceName}}',
    siteName: '{{siteName}}',
    eyebrow: 'Réservation annulée',
    title: 'Votre réservation a été annulée',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Votre réservation pour <strong>{{serviceName}}</strong> le <strong>{{bookingDate}}</strong> à <strong>{{bookingTime}}</strong> a bien été annulée.',
      `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:16px;margin:8px 0"><p style="color:#991b1b;margin:0;font-weight:600">❌ Cette annulation ne donne pas lieu à un remboursement</p><p style="color:#991b1b;margin:8px 0 0;font-size:0.9em">Vous avez renoncé à votre droit d'annulation lors de la réservation.</p></div>`
    ],
    detailItems: [
      { label: 'Prestation', value: '{{serviceName}}' },
      { label: 'Date', value: '{{bookingDate}}' },
      { label: 'Heure', value: '{{bookingTime}}' }
    ],
    signature: '{{siteName}}'
  }),
  booking_cancelled_notify_admin: createMailTemplateDefinition({
    subject: 'Annulation client — {{serviceName}} du {{bookingDate}}',
    siteName: '{{siteName}}',
    eyebrow: 'Annulation de réservation',
    title: 'Un client a annulé sa réservation',
    intro: 'Bonjour,',
    paragraphs: [
      'Le client <strong>{{customerName}}</strong> a annulé sa réservation <strong>{{serviceName}}</strong> du <strong>{{bookingDate}}</strong> à <strong>{{bookingTime}}</strong>.',
      '{{refundSection}}'
    ],
    detailItems: [
      { label: 'Client', value: '{{customerName}}' },
      { label: 'Email client', value: '{{clientEmail}}' },
      { label: 'Prestation', value: '{{serviceName}}' },
      { label: 'Date', value: '{{bookingDate}}' },
      { label: 'Heure', value: '{{bookingTime}}' },
      { label: 'Remboursement', value: '{{refundAmount}}' }
    ],
    signature: '{{siteName}}'
  }),
  booking_cancelled_admin: createMailTemplateDefinition({
    subject: 'Votre réservation a été annulée — {{serviceName}}',
    siteName: '{{siteName}}',
    eyebrow: 'Annulation par l\'institut',
    title: 'Votre rendez-vous a été annulé',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Votre réservation pour <strong>{{serviceName}}</strong> le <strong>{{bookingDate}}</strong> à <strong>{{bookingTime}}</strong> a été annulée par notre équipe. {{refundReason}}'
    ],
    detailItems: [
      { label: 'Prestation', value: '{{serviceName}}' },
      { label: 'Date', value: '{{bookingDate}}' },
      { label: 'Heure', value: '{{bookingTime}}' },
      { label: 'Praticienne', value: '{{practitionerName}}' },
      { label: 'Remboursement', value: '{{refundAmount}}' }
    ],
    callout: {
      label: 'Suivi',
      content: 'Retrouvez le suivi de votre remboursement à l\'adresse : <a href="{{trackingUrl}}">{{trackingUrl}}</a>',
      tone: 'default'
    },
    signature: '{{siteName}}'
  }),
  booking_no_show: createMailTemplateDefinition({
    subject: 'Absence constatée — {{serviceName}}',
    siteName: '{{siteName}}',
    eyebrow: 'Absence non signalée',
    title: 'Absence constatée à votre rendez-vous',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Nous avons constaté votre absence à votre rendez-vous <strong>{{serviceName}}</strong> du <strong>{{bookingDate}}</strong> à <strong>{{bookingTime}}</strong> sans annulation préalable.',
      'Si vous aviez réglé un acompte, celui-ci a été conservé conformément à nos conditions.'
    ],
    detailItems: [
      { label: 'Prestation', value: '{{serviceName}}' },
      { label: 'Date', value: '{{bookingDate}}' },
      { label: 'Heure', value: '{{bookingTime}}' }
    ],
    callout: {
      label: 'Information',
      content: 'En cas d\'absences répétées, votre compte peut être suspendu.',
      tone: 'warning'
    },
    signature: '{{siteName}}'
  }),
  booking_suspended: createMailTemplateDefinition({
    subject: 'Votre compte a été suspendu',
    siteName: '{{siteName}}',
    eyebrow: 'Compte suspendu',
    title: 'Accès aux réservations suspendu',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Suite à {{noShowCount}} absence(s) non signalée(s), votre accès aux réservations a été temporairement suspendu.',
      'Contactez-nous pour régulariser votre situation et réactiver votre compte.'
    ],
    detailItems: [
      { label: 'Institut', value: '{{instituteName}}' }
    ],
    callout: {
      label: 'Réactivation',
      content: 'Contactez-nous directement pour réactiver votre compte.',
      tone: 'warning'
    },
    signature: '{{siteName}}'
  }),

  // ── LOT2 — Communications manquantes (P1-12) + templates système ────────────
  payment_failed: createMailTemplateDefinition({
    subject: 'Votre paiement n\'a pas abouti',
    siteName: '{{siteName}}',
    eyebrow: 'Paiement',
    title: 'Le paiement n\'a pas pu être finalisé',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Le paiement de <strong>{{itemDetail}}</strong> d\'un montant de <strong>{{amount}} EUR</strong> n\'a pas abouti.',
      'Aucun montant n\'a été débité. Vous pouvez réessayer votre commande depuis notre site.'
    ],
    detailItems: [
      { label: 'Article', value: '{{itemDetail}}' },
      { label: 'Montant', value: '{{amount}} EUR' }
    ],
    cta: { label: 'Reprendre le paiement', url: '{{actionUrl}}' },
    signature: '{{siteName}}'
  }),
  refund_refused: createMailTemplateDefinition({
    subject: 'Votre demande de remboursement',
    siteName: '{{siteName}}',
    eyebrow: 'Remboursement',
    title: 'Demande de remboursement non retenue',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Après étude, votre demande de remboursement pour <strong>{{itemDetail}}</strong> n\'a pas pu être acceptée.',
      'Motif : {{refundReason}}',
      'Pour toute question, notre équipe reste à votre disposition.'
    ],
    detailItems: [
      { label: 'Article', value: '{{itemDetail}}' }
    ],
    cta: { label: 'Contacter le support', url: '{{actionUrl}}' },
    signature: '{{siteName}}'
  }),
  refund_failed: createMailTemplateDefinition({
    subject: 'Remboursement en cours de traitement',
    siteName: '{{siteName}}',
    eyebrow: 'Remboursement',
    title: 'Un incident technique est survenu',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Votre remboursement de <strong>{{amount}} EUR</strong> pour <strong>{{itemDetail}}</strong> a rencontré un incident technique lors de son traitement.',
      'Pas d\'inquiétude : notre équipe a été alertée et procède à la régularisation. Vous serez tenu(e) informé(e).'
    ],
    detailItems: [
      { label: 'Article', value: '{{itemDetail}}' },
      { label: 'Montant', value: '{{amount}} EUR' }
    ],
    cta: { label: 'Contacter le support', url: '{{actionUrl}}' },
    signature: '{{siteName}}'
  }),
  training_certificate_available: createMailTemplateDefinition({
    subject: 'Votre attestation est disponible — {{formationTitle}}',
    siteName: '{{siteName}}',
    eyebrow: 'Attestation',
    title: 'Félicitations {{firstName}} !',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Votre attestation pour la formation <strong>{{formationTitle}}</strong> est désormais disponible.',
      'Retrouvez-la et téléchargez-la depuis votre espace, rubrique « Mes formations ».'
    ],
    detailItems: [
      { label: 'Formation', value: '{{formationTitle}}' }
    ],
    cta: { label: 'Télécharger mon attestation', url: '{{actionUrl}}' },
    signature: '{{siteName}}'
  }),
  formation_session_reminder: createMailTemplateDefinition({
    subject: 'Rappel — votre session {{formationTitle}}',
    siteName: '{{siteName}}',
    eyebrow: 'Rappel',
    title: 'À bientôt {{firstName}} !',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Petit rappel : votre session de <strong>{{formationTitle}}</strong> approche.',
      'Rendez-vous le <strong>{{sessionDate}}</strong> à <strong>{{sessionTime}}</strong>{{location}}.'
    ],
    detailItems: [
      { label: 'Formation', value: '{{formationTitle}}' },
      { label: 'Date', value: '{{sessionDate}}' },
      { label: 'Heure', value: '{{sessionTime}}' }
    ],
    cta: { label: 'Voir dans mon espace', url: '{{actionUrl}}' },
    signature: '{{siteName}}'
  }),
  gift_card_pin_reset: createMailTemplateDefinition({
    subject: 'Votre carte cadeau — nouveau code',
    siteName: '{{siteName}}',
    eyebrow: 'Carte cadeau',
    title: 'Un nouveau code pour votre carte',
    intro: 'Bonjour {{recipientName}},',
    paragraphs: [
      'Un nouveau code a été généré pour votre carte cadeau. L\'ancien code n\'est plus valable.',
      'Vous trouverez votre carte cadeau mise à jour en pièce jointe.'
    ],
    detailItems: [
      { label: 'Code carte', value: '{{code}}' },
      { label: 'Nouveau mot de passe', value: '{{pin}}' },
      { label: 'Solde', value: '{{balance}}' }
    ],
    signature: '{{instituteName}}'
  }),
  welcome: createMailTemplateDefinition({
    subject: 'Bienvenue chez {{siteName}}',
    siteName: '{{siteName}}',
    eyebrow: 'Bienvenue',
    title: 'Bienvenue {{firstName}} !',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Votre compte a bien été créé. Nous sommes ravis de vous compter parmi nous.',
      'Découvrez nos prestations et formations depuis votre espace.'
    ],
    cta: { label: 'Accéder à mon espace', url: '{{actionUrl}}' },
    signature: '{{siteName}}'
  }),
  email_verified: createMailTemplateDefinition({
    subject: 'Votre adresse e-mail est confirmée',
    siteName: '{{siteName}}',
    eyebrow: 'Compte',
    title: 'Adresse confirmée',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Votre adresse e-mail a bien été vérifiée. Votre compte est désormais pleinement actif.'
    ],
    signature: '{{siteName}}'
  }),
  password_changed: createMailTemplateDefinition({
    subject: 'Votre mot de passe a été modifié',
    siteName: '{{siteName}}',
    eyebrow: 'Sécurité',
    title: 'Mot de passe mis à jour',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Votre mot de passe vient d\'être modifié. Si vous n\'êtes pas à l\'origine de ce changement, contactez-nous immédiatement.'
    ],
    cta: { label: 'Contacter le support', url: '{{actionUrl}}' },
    signature: '{{siteName}}'
  }),
  review_request: createMailTemplateDefinition({
    subject: 'Votre avis sur {{formationTitle}}',
    siteName: '{{siteName}}',
    eyebrow: 'Votre avis',
    title: 'Partagez votre expérience',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Vous avez récemment suivi <strong>{{formationTitle}}</strong>. Votre avis nous aide à nous améliorer et guide les futurs participants.'
    ],
    detailItems: [
      { label: 'Formation', value: '{{formationTitle}}' }
    ],
    cta: { label: 'Laisser un avis', url: '{{actionUrl}}' },
    signature: '{{siteName}}'
  }),

  // ── FORMATION-EVALUATION — décisions d'évaluation (institut → client) ────────
  evaluation_accepted: createMailTemplateDefinition({
    subject: 'Félicitations — diplôme obtenu ({{formationTitle}})',
    siteName: '{{siteName}}',
    eyebrow: 'Diplôme',
    title: 'Bravo {{firstName}}, vous êtes diplômé(e) !',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Votre travail pour la formation <strong>{{formationTitle}}</strong> a été validé par votre formatrice.',
      'Votre diplôme est joint à cet e-mail et disponible dans votre espace.'
    ],
    detailItems: [
      { label: 'Formation', value: '{{formationTitle}}' }
    ],
    cta: { label: 'Voir mon diplôme', url: '{{actionUrl}}' },
    signature: '{{siteName}}'
  }),
  evaluation_refused: createMailTemplateDefinition({
    subject: 'Votre évaluation — {{formationTitle}}',
    siteName: '{{siteName}}',
    eyebrow: 'Évaluation',
    title: 'Votre formatrice vous demande de recommencer',
    intro: 'Bonjour {{firstName}},',
    paragraphs: [
      'Après analyse de votre travail pour <strong>{{formationTitle}}</strong>, votre formatrice vous invite à recommencer votre évaluation.',
      'Motif : {{reason}}'
    ],
    detailItems: [
      { label: 'Formation', value: '{{formationTitle}}' }
    ],
    cta: { label: 'Recommencer', url: '{{actionUrl}}' },
    signature: '{{siteName}}'
  })
};

const AVAILABLE_FUNCTIONS = new Set(Object.keys(TEMPLATE_FUNCTIONS));




// Runtime resolver (Phase 5A versioning): prefer the PUBLISHED version; fall back
// to a legacy doc whose status is missing/null (pre-migration) so the content sent
// is never changed. Draft/archived versions are NEVER served at runtime.
async function findActiveTemplateDoc(functionName) {
  return (await EmailTemplate.findOne({ functionName, status: 'published' }).lean())
    || (await EmailTemplate.findOne({ functionName, status: null }).lean());
}

async function ensureTemplate(functionName) {

  const normalized = normalizeFunctionName(functionName);

  if (!normalized) return null;

  const existing = await findActiveTemplateDoc(normalized);

  // If a real (non-metadata-only) doc exists, return it as-is
  if (existing && !existing.isMetadataOnly) {
    return existing;
  }

  const defaults = TEMPLATE_FUNCTIONS[normalized];

  if (!defaults) return null;

  const sanitizedBody = sanitizeEditorialHtml(defaults.bodyHtml);

  const payload = {
    subject: String(defaults.subject || ''),
    bodyHtml: sanitizedBody,
    fullHtml: sanitizeFullHtml(defaults.fullHtml),
    mode: normalizeMode(defaults.mode || 'text'),
    isMetadataOnly: false,
    status: 'published',
    version: 1,
    publishedAt: new Date(),
    isSystemDefault: true
  };

  if (existing) {
    // isMetadataOnly doc exists — patch it with proper defaults, preserve categoryId/recipient
    const updated = await EmailTemplate.findOneAndUpdate(
      { functionName: normalized },
      { $set: payload },
      { new: true }
    ).lean();
    return updated;
  }

  const created = await EmailTemplate.create({ functionName: normalized, ...payload });

  return created.toObject();

}

function injectSessionClientCancelledRefundFallback({
  bodyHtml = '',
  fullHtml = ''
} = {}) {
  const fallbackText =
    'Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur : <a href="{{trackingUrl}}">{{trackingUrl}}</a>';
  const fallbackBodyBlock = `<p>${fallbackText}</p>`;
  const fallbackFullBlock = `<p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:${MAIL_THEME.muted};">Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur : <a href="{{trackingUrl}}" style="color:${MAIL_THEME.accent};${buildThemeStyle('color', MAIL_THEME.accent, 'themeaccent', 'theme-accent')}text-decoration:underline;">{{trackingUrl}}</a></p>`;
  const marker =
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:12px;">';

  let nextBody = String(bodyHtml || '');
  let nextFull = String(fullHtml || '');
  let changed = false;

  if (!/copiez-collez ce lien dans votre navigateur/i.test(nextBody)) {
    nextBody += fallbackBodyBlock;
    changed = true;
  }
  if (!/copiez-collez ce lien dans votre navigateur/i.test(nextFull)) {
    if (nextFull.includes(marker)) {
      nextFull = nextFull.replace(marker, `${fallbackFullBlock}${marker}`);
    } else {
      nextFull += fallbackFullBlock;
    }
    changed = true;
  }

  return { bodyHtml: nextBody, fullHtml: nextFull, changed };
}

async function ensureSessionClientCancelledRefundFallback(template = null) {
  if (!template) return template;
  const { bodyHtml, fullHtml, changed } = injectSessionClientCancelledRefundFallback({
    bodyHtml: template.bodyHtml,
    fullHtml: template.fullHtml
  });
  if (!changed) {
    return { ...template, mode: normalizeMode(template.mode) };
  }
  const updated = await EmailTemplate.findOneAndUpdate(
    { functionName: 'session_client_cancelled_refund' },
    {
      $set: {
        bodyHtml: sanitizeEditorialHtml(bodyHtml),
        fullHtml: sanitizeFullHtml(fullHtml)
      }
    },
    { new: true }
  ).lean();
  if (updated) {
    updated.mode = normalizeMode(updated.mode);
    return updated;
  }
  return { ...template, bodyHtml, fullHtml, mode: normalizeMode(template.mode) };
}



async function loadTemplate(functionName) {

  const normalized = normalizeFunctionName(functionName);

  if (!normalized || !AVAILABLE_FUNCTIONS.has(normalized)) {

    return null;

  }

  const template = await findActiveTemplateDoc(normalized);

  if (template && !template.isMetadataOnly) {
    if (normalized === 'session_client_cancelled_refund') {
      return ensureSessionClientCancelledRefundFallback(template);
    }
    template.mode = normalizeMode(template.mode);
    return template;
  }

  const generated = await ensureTemplate(normalized);
  // Merge category metadata from the isMetadataOnly doc if present
  if (generated && template?.isMetadataOnly) {
    generated.categoryId = template.categoryId;
    generated.recipient = template.recipient;
  }
  return generated;

}



async function saveTemplate(functionName, subject, bodyHtml, fullHtml, mode = 'text') {

  const normalized = normalizeFunctionName(functionName);

  if (!normalized || !AVAILABLE_FUNCTIONS.has(normalized)) {

    throw new Error('Fonction de template inconnue');

  }

  const sanitizedHtml = sanitizeEditorialHtml(bodyHtml || '');

  const sanitizedFullHtml = sanitizeFullHtml(fullHtml || '');

  const payload = {

    subject: String(subject || '').trim(),

    bodyHtml: sanitizedHtml,

    fullHtml: sanitizedFullHtml,

    mode: normalizeMode(mode)

  };

  const updated = await EmailTemplate.findOneAndUpdate(

    { functionName: normalized, status: { $in: ['published', null] } },

    {

      $set: {

        status: 'published',

        subject: payload.subject,

        bodyHtml: payload.bodyHtml,

        fullHtml: payload.fullHtml,

        mode: payload.mode,

        updatedAt: new Date()

      }

    },

    {

      new: true,

      upsert: true,

      setDefaultsOnInsert: true

    }

  ).lean();

  return updated;

}



export {
  TEMPLATE_FUNCTIONS,
  AVAILABLE_FUNCTIONS,
  findActiveTemplateDoc,
  ensureTemplate,
  injectSessionClientCancelledRefundFallback,
  ensureSessionClientCancelledRefundFallback,
  loadTemplate,
  saveTemplate
};
