/**
 * MODÈLES DES E-MAILS CLIENTS — ceux que l'institut envoie à SES clients.
 *
 * Ils vivent ici, dans le projet, et partent par la clé Brevo de l'institut
 * sous son expéditeur : le client reçoit un message de BeautySavage, jamais
 * de la plateforme. Les e-mails d'administration (mot de passe du Manager,
 * notifications internes, facturation de la plateforme) restent ceux du Panel.
 *
 * Chaque modèle décrit un CONTENU, pas une mise en page : `renderInstituteEmail`
 * l'habille aux couleurs de l'institut. `{{variable}}` est remplacée par la
 * valeur mise en forme (date lisible, montant en euros) et échappée ; une ligne
 * de tableau dont la valeur est vide disparaît plutôt que d'afficher un trou.
 *
 * Les variables sont EXACTEMENT celles que produisent les résolveurs existants
 * (`commerceVariableResolver.js`) — le contrat ne change pas.
 */
export const INSTITUTE_TEMPLATES = Object.freeze({
  CUSTOMER_EMAIL_VERIFICATION: {
    subject: '{{verificationCode}} est votre code de vérification',
    preheader: 'Saisissez ce code pour activer votre compte.',
    title: 'Confirmez votre adresse e-mail',
    paragraphs: ['Bonjour {{clientFirstName}},', 'Voici votre code pour activer votre compte. Saisissez-le sur la page de vérification :'],
    code: '{{verificationCode}}',
    note: 'Ce code expire le {{expiresAt}}. Si vous n’êtes pas à l’origine de cette inscription, ignorez simplement cet e-mail.',
  },
  CUSTOMER_PASSWORD_RESET: {
    subject: 'Réinitialisation de votre mot de passe',
    preheader: 'Choisissez un nouveau mot de passe.',
    title: 'Nouveau mot de passe',
    paragraphs: ['Bonjour {{clientFirstName}},', 'Vous avez demandé à réinitialiser le mot de passe de votre espace client. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.'],
    cta: { label: 'Choisir un nouveau mot de passe', url: '{{actionUrl}}' },
    note: 'Ce lien expire le {{expiresAt}}. Si vous n’avez rien demandé, ignorez cet e-mail : votre mot de passe reste inchangé.',
  },
  CUSTOMER_ACCOUNT_CREATED: {
    subject: 'Votre espace client est prêt',
    preheader: 'Choisissez votre mot de passe pour y accéder.',
    title: 'Bienvenue !',
    paragraphs: ['Bonjour {{clientFirstName}},', 'Nous avons créé votre espace client lors de votre réservation. Vous y retrouverez vos rendez-vous, vos achats et vos factures.', 'Choisissez votre mot de passe pour y accéder :'],
    rows: [['Identifiant', '{{clientEmail}}']],
    cta: { label: 'Choisir mon mot de passe', url: '{{actionUrl}}' },
    note: 'Ce lien expire le {{expiresAt}}.',
  },
  COMMERCE_SALE_CONFIRMATION_CLIENT: {
    subject: 'Confirmation de votre commande {{saleNumber}}',
    preheader: 'Merci pour votre commande.',
    title: 'Merci pour votre commande',
    paragraphs: ['Bonjour {{clientFirstName}},', 'Nous avons bien reçu votre commande. En voici le récapitulatif :'],
    list: '{{itemsHtml}}',
    rows: [['Commande', '{{saleNumber}}'], ['Total', '{{totalAmount}}'], ['Paiement', '{{paymentStatus}}']],
    cta: { label: 'Voir ma facture', url: '{{invoiceUrl}}' },
  },
  APPOINTMENT_CONFIRMED_CLIENT: {
    subject: 'Votre rendez-vous {{serviceName}} est confirmé',
    preheader: 'Rendez-vous le {{appointmentStart}}.',
    title: 'Rendez-vous confirmé',
    paragraphs: ['Bonjour {{clientFirstName}},', 'Votre rendez-vous <strong>{{serviceName}}</strong> est confirmé. Nous avons hâte de vous recevoir.'],
    rows: [['Date', '{{appointmentStart}}'], ['Fin prévue', '{{appointmentEnd}}'], ['Déjà réglé', '{{paidAmount}}'], ['Reste à régler sur place', '{{balanceDueAmount}}']],
    cta: { label: 'Voir mon espace client', url: '{{accountUrl}}' },
    note: 'Un empêchement ? Vous pouvez annuler depuis votre espace client, selon les conditions d’annulation de votre réservation.',
  },
  APPOINTMENT_CANCELLED_CLIENT: {
    subject: 'Annulation de votre rendez-vous {{serviceName}}',
    preheader: 'Votre rendez-vous a été annulé.',
    title: 'Rendez-vous annulé',
    paragraphs: ['Bonjour {{clientFirstName}},', 'Votre rendez-vous <strong>{{serviceName}}</strong> a bien été annulé.'],
    rows: [['Date prévue', '{{appointmentStart}}'], ['Fin prévue', '{{appointmentEnd}}'], ['Motif', '{{reason}}'], ['Remboursement', '{{refundAmount}}']],
    note: 'Un remboursement apparaît sur votre moyen de paiement sous quelques jours ouvrés.',
  },
  FORMATION_SESSION_RESCHEDULED_CLIENT: {
    subject: 'Nouvelle date pour votre formation {{trainingTitle}}',
    preheader: 'Votre session a été déplacée.',
    title: 'Votre session change de date',
    paragraphs: ['Bonjour {{clientFirstName}},', 'La session de votre formation <strong>{{trainingTitle}}</strong> a été déplacée.', '{{message}}'],
    rows: [['Ancienne date', '{{previousStart}}'], ['Nouvelle date', '{{newStart}}'], ['Fin', '{{newEnd}}'], ['Lieu', '{{location}}']],
    cta: { label: 'Voir mon espace client', url: '{{accountUrl}}' },
  },
  FORMATION_SESSION_CANCELLED_CLIENT: {
    subject: 'Annulation de votre session {{trainingTitle}}',
    preheader: 'Votre session de formation est annulée.',
    title: 'Session annulée',
    paragraphs: ['Bonjour {{clientFirstName}},', 'Nous sommes désolés : la session de votre formation <strong>{{trainingTitle}}</strong> est annulée.'],
    rows: [['Date prévue', '{{sessionStart}}'], ['Motif', '{{reason}}'], ['Remboursement', '{{refundAmount}}']],
    cta: { label: 'Voir mon espace client', url: '{{accountUrl}}' },
  },
  TRAINING_VALIDATED_CLIENT: {
    subject: 'Félicitations, votre formation {{trainingTitle}} est validée',
    preheader: 'Votre dossier final est validé.',
    title: 'Formation validée 🎉',
    paragraphs: ['Bonjour {{clientFirstName}},', 'Félicitations ! Votre dossier final pour la formation <strong>{{trainingTitle}}</strong> est validé.'],
    quote: '{{comment}}',
    cta: { label: 'Ouvrir mon espace formation', url: '{{accountUrl}}' },
  },
  TRAINING_REJECTED_CLIENT: {
    subject: 'Votre dossier {{trainingTitle}} est à reprendre',
    preheader: 'Quelques points à revoir avant validation.',
    title: 'Dossier à reprendre',
    paragraphs: ['Bonjour {{clientFirstName}},', 'Votre dossier final pour la formation <strong>{{trainingTitle}}</strong> demande encore quelques ajustements avant validation. Voici le retour de votre formatrice :'],
    quote: '{{comment}}',
    cta: { label: 'Reprendre mon dossier', url: '{{accountUrl}}' },
  },
  COMMERCE_GIFT_CARD_CLIENT: {
    subject: 'Votre carte cadeau est prête',
    preheader: 'Téléchargez votre carte cadeau.',
    title: 'Votre carte cadeau est prête',
    paragraphs: ['Bonjour {{clientFirstName}},', 'Merci pour votre achat ! Votre carte cadeau est prête à être offerte.'],
    rows: [['Montant', '{{amount}}'], ['Solde disponible', '{{balance}}'], ['Bénéficiaire', '{{recipientName}}'], ['Code', '{{giftCardCodeMasked}}']],
    cta: { label: 'Télécharger la carte cadeau', url: '{{giftCardPdfUrl}}' },
    note: 'Le code complet figure sur la carte. Conservez-la précieusement : elle se présente au moment du règlement.',
  },
});

export const INSTITUTE_TEMPLATE_IDS = Object.freeze(Object.keys(INSTITUTE_TEMPLATES));

export function isInstituteTemplate(templateId) {
  return Object.prototype.hasOwnProperty.call(INSTITUTE_TEMPLATES, templateId);
}
