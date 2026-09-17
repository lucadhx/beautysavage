import { openEditorialEditor } from './editorialEditor.js';

const API_ROOT = '/api/gestion/mails/template';
const API_TEMPLATES_LIST = '/api/gestion/mails/templates';
const ACTIVE_THEME_ENDPOINT = '/api/vitrine/theme';
const DEFAULT_FUNCTION_NAME = 'vente';
const MODES = { TEXT: 'text', HTML: 'html' };

const THEME_DEFAULTS = {
  primary: '#5f4ff7',
  secondary: '#f24692',
  background: '#f5f4ef',
  surface: '#ffffff',
  text: '#0f172a'
};

// Guardrail: keep mail HTML snippets and preview fallbacks in template literals (`...`) only.
const MAIL_FUNCTION_CONFIGS = {
  vente: {
    label: 'Vente',
    description: 'Fonction VENTE uniquement. Modifiez l’objet et choisissez un mode d’édition.',
    variables: [
      { token: '{{saleId}}', label: 'Identifiant de vente' },
      { token: '{{firstName}}', label: 'Prénom client' },
      { token: '{{lastName}}', label: 'Nom client' },
      { token: '{{amount}}', label: 'Montant payé (euros)' },
      { token: '{{invoiceDownloadUrl}}', label: 'Lien vers la page facture' }
    ],
    placeholders: {
      saleid: 'SALE-1234',
      firstname: 'Jean',
      lastname: 'Dupont',
      amount: '120 €',
      invoiceDownloadUrl: 'https://beautysavage.com/vitrine.html?slug=invoice&token=abc123'
    },
    simulation: {
      enabled: true,
      endpoint: '/api/gestion/mails/simulate-sale',
      label: 'Simuler une vente (test email)'
    },
    editorTitle: 'Édition du corps du mail VENTE',
    editorDescription:
      'Utilisez l’éditeur pour composer le contenu HTML léger du mail de confirmation de vente.'
  },
  password_reset: {
    label: 'Réinitialisation mot de passe',
    description: 'Envoi du lien sécurisé de réinitialisation via le nouveau flux.'
      + ' Ce template s’utilise dans l’éditeur existant.',
    variables: [
      { token: '{{firstName}}', label: 'Prénom client' },
      { token: '{{lastName}}', label: 'Nom client' },
      { token: '{{link}}', label: 'Lien sécurisé' }
    ],
    placeholders: {
      firstname: 'Inès',
      lastname: 'Petit',
      link: 'https://beautysavage/reset-password?token=XXX123'
    },
    simulation: {
      enabled: false
    },
    editorTitle: 'Édition du corps du mail PASSWORD_RESET',
    editorDescription:
      'Rédigez l’email envoyé lors d’une demande de réinitialisation sans divulguer de mot de passe.'
  },
  commission_available: {
    label: 'Commissions disponibles',
    description: 'Email envoyé aux admins le premier jour où le paiement des commissions est disponible.',
    variables: [
      { token: '{{period}}', label: 'Période (mois/année)' },
      { token: '{{amount}}', label: 'Montant total (euros)' },
      { token: '{{daysTotal}}', label: 'Nombre de jours pour payer' },
      { token: '{{platformUrl}}', label: 'Lien vers la plateforme' }
    ],
    placeholders: {
      period: 'Mars 2026',
      amount: '1 234,56',
      daystotal: '15',
      platformurl: 'https://beautysavage.com/gestion.html?module=commissionPayment'
    },
    simulation: { enabled: false },
    editorTitle: 'Édition du corps du mail COMMISSION_AVAILABLE',
    editorDescription: 'Annoncez la disponibilité du paiement avec {{amount}}, {{period}} et {{daysTotal}} jours restants.'
  },
  commission_reminder: {
    label: 'Rappel commission',
    description: 'Email de rappel envoyé X jours avant la date limite de paiement des commissions.',
    variables: [
      { token: '{{period}}', label: 'Période (mois/année)' },
      { token: '{{amount}}', label: 'Montant total (euros)' },
      { token: '{{daysLeft}}', label: 'Jours restants avant échéance' },
      { token: '{{platformUrl}}', label: 'Lien vers la plateforme' }
    ],
    placeholders: {
      period: 'Mars 2026',
      amount: '1 234,56',
      daysleft: '5',
      platformurl: 'https://beautysavage.com/gestion.html?module=commissionPayment'
    },
    simulation: { enabled: false },
    editorTitle: 'Édition du corps du mail COMMISSION_REMINDER',
    editorDescription: 'Rappelez l\'urgence avec {{daysLeft}} jours restants et {{amount}} dû pour {{period}}.'
  },
  commission_last_day: {
    label: 'Dernier jour commission',
    description: 'Email envoyé le dernier jour avant retard de paiement des commissions.',
    variables: [
      { token: '{{period}}', label: 'Période (mois/année)' },
      { token: '{{amount}}', label: 'Montant total (euros)' },
      { token: '{{platformUrl}}', label: 'Lien vers la plateforme' }
    ],
    placeholders: {
      period: 'Mars 2026',
      amount: '1 234,56',
      platformurl: 'https://beautysavage.com/gestion.html?module=commissionPayment'
    },
    simulation: { enabled: false },
    editorTitle: 'Édition du corps du mail COMMISSION_LAST_DAY',
    editorDescription: 'Urgence maximale — dernier jour pour régler {{amount}} pour {{period}}.'
  },
  refund_confirmed: {
    label: 'Remboursement confirmé',
    description: 'Email envoyé au client lorsque son remboursement a été effectué.',
    variables: [
      { token: '{{firstName}}', label: 'Prénom client' },
      { token: '{{lastName}}', label: 'Nom client' },
      { token: '{{formationTitle}}', label: 'Formation' },
      { token: '{{refundAmount}}', label: 'Montant remboursé' },
      { token: '{{refundDateTime}}', label: 'Date / heure' },
      { token: '{{saleId}}', label: 'ID vente' },
      { token: '{{refundId}}', label: 'ID remboursement' },
      { token: '{{siteName}}', label: 'Nom institut' }
    ],
    placeholders: {
      firstname: 'Camille',
      lastname: 'Martin',
      formationtitle: 'Master Brow Artist',
      refundamount: '149.00',
      refunddatetime: '09/03/2026 14:00',
      saleid: 'SALE-123',
      refundid: 'REF-123',
      sitename: 'Beauty Savage'
    },
    simulation: { enabled: false },
    editorTitle: 'Édition du corps du mail REFUND_CONFIRMED',
    editorDescription: 'Confirmez le remboursement avec {{refundAmount}}, la date et les références.'
  }

,
  site_suspended: {
    label: 'Site suspendu',
    description: 'Email automatique envoy? ? tous les admins lors de la suspension globale du site.',
    variables: [
      { token: '{{reason}}', label: 'Motif de suspension' },
      { token: '{{date}}', label: 'Date de suspension' }
    ],
    placeholders: {
      reason: 'Maintenance serveur urgente',
      date: '19/02/2026 18:45'
    },
    simulation: {
      enabled: false
    },
    editorTitle: '?dition du corps du mail SITE_SUSPENDED',
    editorDescription:
      'Expliquez clairement le motif via {{reason}} et indiquez la date {{date}}.'
  },
  site_reactivated: {
    label: 'Site r?activ?',
    description: 'Email automatique envoy? ? tous les admins lors de la r?activation du site.',
    variables: [
      { token: '{{date}}', label: 'Date de r?activation' }
    ],
    placeholders: {
      date: '20/02/2026 09:00'
    },
    simulation: {
      enabled: false
    },
    editorTitle: '?dition du corps du mail SITE_REACTIVATED',
    editorDescription:
      'Annoncez la reprise de service et conservez la variable {{date}}.'
  },
  site_maintenance_start: {
    label: 'Début maintenance',
    description: 'Email automatique envoy? ? tous les admins au lancement de la maintenance.',
    variables: [
      { token: '{{reason}}', label: 'Motif de maintenance' },
      { token: '{{eta}}', label: 'Durée estimée' },
      { token: '{{startedAt}}', label: 'Horodatage de début' },
      { token: '{{date}}', label: 'Date de notification' }
    ],
    placeholders: {
      reason: 'Mise a jour serveur',
      eta: '2 heures',
      startedat: '20/02/2026 10:30',
      date: '20/02/2026 10:30'
    },
    simulation: {
      enabled: false
    },
    editorTitle: '?dition du corps du mail SITE_MAINTENANCE_START',
    editorDescription:
      'Indiquez le motif, la dur?e estim?e et gardez {{startedAt}} pour informer les admins.'
  },
  site_maintenance_end: {
    label: 'Fin maintenance',
    description: 'Email automatique envoy? ? tous les admins ? la fin de la maintenance.',
    variables: [
      { token: '{{reason}}', label: 'Motif de maintenance' },
      { token: '{{eta}}', label: 'Durée estimée' },
      { token: '{{startedAt}}', label: 'Horodatage de début' },
      { token: '{{date}}', label: 'Date de fin' }
    ],
    placeholders: {
      reason: 'Mise a jour serveur',
      eta: '2 heures',
      startedat: '20/02/2026 10:30',
      date: '20/02/2026 12:40'
    },
    simulation: {
      enabled: false
    },
    editorTitle: '?dition du corps du mail SITE_MAINTENANCE_END',
    editorDescription:
      'Confirmez la fin de maintenance en conservant {{reason}}, {{eta}} et {{startedAt}}.'
  },
  email_confirmation_code: {
    label: 'Code confirmation email',
    description: "Template envoyé après inscription client pour vérifier l'email avec un code à 6 chiffres.",
    variables: [
      { token: '{{firstName}}', label: 'Pr?nom du client' },
      { token: '{{email}}', label: 'Email du client' },
      { token: '{{code}}', label: 'Code de v?rification (6 chiffres)' },
      { token: '{{expiresMinutes}}', label: 'Dur?e de validit? du code' }
    ],
    placeholders: {
      firstname: 'Camille',
      email: 'camille@exemple.com',
      code: '381905',
      expiresminutes: '10'
    },
    simulation: {
      enabled: false
    },
    editorTitle: '?dition du corps du mail EMAIL_CONFIRMATION_CODE',
    editorDescription:
      'Conservez les variables {{code}} et {{expiresMinutes}} pour informer clairement du d?lai de validit?.'
  },
  session_cancelled_choice: {
    label: 'Session annul?e',
    description:
      "Email envoyé au client quand l'institut annule une session et doit lui laisser choisir entre remboursement et décalage.",
    variables: [
      { token: '{{siteName}}', label: 'Nom du site' },
      { token: '{{firstName}}', label: 'Pr?nom du client' },
      { token: '{{lastName}}', label: 'Nom du client' },
      { token: '{{formationTitle}}', label: 'Titre de la formation' },
      { token: '{{sessionDateLabel}}', label: 'P?riode de la session' },
      { token: '{{sessionTimeLabel}}', label: 'Horaires de la session' },
      { token: '{{actionUrl}}', label: 'Lien s?curis? vers la page de choix' },
      { token: '{{reason}}', label: 'Motif optionnel' },
      { token: '{{year}}', label: 'Ann?e courante' }
    ],
    placeholders: {
      sitename: 'Beauty Savage',
      firstname: 'Camille',
      lastname: 'Martin',
      formationtitle: 'Master Brow Artist',
      sessiondatelabel: 'du 12 mars 2026 au 14 mars 2026',
      sessiontimelabel: '09:00 - 17:00',
      actionurl: 'https://beautysavage.com/vitrine.html?page=session-cancel-decision&flowId=SCF-123&token=abc',
      reason: "Motif: indisponibilité exceptionnelle de l'institut.",
      year: '2026'
    },
    simulation: {
      enabled: false
    },
    editorTitle: '?dition du corps du mail SESSION_CANCELLED_CHOICE',
    editorDescription:
      'Conservez {{actionUrl}} comme CTA principal et utilisez {{sessionDateLabel}} / {{sessionTimeLabel}} pour d?crire clairement la session annul?e.'
  },
  formation_deleted_choice: {
    label: 'Formation supprimee',
    description: "Email client pour suppression institut d'une formation presentielle avec choix remboursement ou carte cadeau.",
    variables: [
      { token: '{{siteName}}', label: 'Nom institut' },
      { token: '{{firstName}}', label: 'Prenom client' },
      { token: '{{lastName}}', label: 'Nom client' },
      { token: '{{formationTitle}}', label: 'Nom formation' },
      { token: '{{amountPaid}}', label: 'Montant paye' },
      { token: '{{saleId}}', label: 'ID vente' },
      { token: '{{actionUrl}}', label: 'Lien securise' },
      { token: '{{reason}}', label: 'Motif' }
    ],
    placeholders: {
      sitename: 'Beauty Savage',
      firstname: 'Camille',
      lastname: 'Martin',
      formationtitle: 'Master Brow Artist',
      amountpaid: '149.00',
      saleid: 'SALE-123',
      actionurl: 'https://beautysavage.com/vitrine.html?page=session-cancel-decision&flowId=SCF-123&token=abc',
      reason: 'Suppression definitive de la formation.'
    },
    simulation: { enabled: false },
    editorTitle: 'Edition du corps du mail FORMATION_DELETED_CHOICE',
    editorDescription: 'Gardez {{actionUrl}} et rappelez {{amountPaid}} pour le choix remboursement ou carte cadeau.'
  },
  session_updated_choice: {
    label: 'Session modifiee',
    description: "Email client quand l'institut modifie une session et laisse confirmer, decaler ou rembourser.",
    variables: [
      { token: '{{siteName}}', label: 'Nom institut' },
      { token: '{{firstName}}', label: 'Prenom client' },
      { token: '{{lastName}}', label: 'Nom client' },
      { token: '{{formationTitle}}', label: 'Nom formation' },
      { token: '{{sessionDateLabel}}', label: 'Nouvelle date' },
      { token: '{{sessionTimeLabel}}', label: 'Nouveaux horaires' },
      { token: '{{saleId}}', label: 'ID vente' },
      { token: '{{actionUrl}}', label: 'Lien securise' },
      { token: '{{reason}}', label: 'Motif' }
    ],
    placeholders: {
      sitename: 'Beauty Savage',
      firstname: 'Camille',
      lastname: 'Martin',
      formationtitle: 'Master Brow Artist',
      sessiondatelabel: 'le 18 mars 2026',
      sessiontimelabel: '10:00 - 18:00',
      saleid: 'SALE-123',
      actionurl: 'https://beautysavage.com/vitrine.html?page=session-cancel-decision&flowId=SCF-123&token=abc',
      reason: 'Decalage de planning institut.'
    },
    simulation: { enabled: false },
    editorTitle: 'Edition du corps du mail SESSION_UPDATED_CHOICE',
    editorDescription: 'Expliquez la nouvelle date puis gardez {{actionUrl}} pour le choix client.'
  },
  session_rescheduled: {
    label: 'Nouvelle session confirmee',
    description: 'Confirmation client apres validation ou report de session.',
    variables: [
      { token: '{{firstName}}', label: 'Prenom client' },
      { token: '{{lastName}}', label: 'Nom client' },
      { token: '{{formationTitle}}', label: 'Nom formation' },
      { token: '{{sessionDateLabel}}', label: 'Date session' },
      { token: '{{sessionTimeLabel}}', label: 'Horaires' },
      { token: '{{saleId}}', label: 'ID vente' },
      { token: '{{siteName}}', label: 'Nom institut' }
    ],
    placeholders: {
      firstname: 'Camille',
      lastname: 'Martin',
      formationtitle: 'Master Brow Artist',
      sessiondatelabel: 'le 22 mars 2026',
      sessiontimelabel: '09:00 - 17:00',
      saleid: 'SALE-123',
      sitename: 'Beauty Savage'
    },
    simulation: { enabled: false },
    editorTitle: 'Edition du corps du mail SESSION_RESCHEDULED',
    editorDescription: 'Mail de confirmation finale avec les nouvelles informations de session.'
  },
  session_client_cancelled_refund: {
    label: 'Annulation client avec remboursement',
    description: 'Confirmation au client quand il annule sa session et reste eligible au remboursement.',
    variables: [
      { token: '{{firstName}}', label: 'Prenom client' },
      { token: '{{lastName}}', label: 'Nom client' },
      { token: '{{formationTitle}}', label: 'Nom formation' },
      { token: '{{sessionDateLabel}}', label: 'Date session' },
      { token: '{{sessionTimeLabel}}', label: 'Horaires' },
      { token: '{{saleId}}', label: 'ID vente' },
      { token: '{{amountPaid}}', label: 'Montant paye' },
      { token: '{{refundAmount}}', label: 'Montant remboursement' },
      { token: '{{refundStatus}}', label: 'Statut remboursement' },
      { token: '{{trackingUrl}}', label: 'Lien de suivi remboursement' },
      { token: '{{siteName}}', label: 'Nom institut' }
    ],
    placeholders: {
      firstname: 'Camille',
      lastname: 'Martin',
      formationtitle: 'Master Brow Artist',
      sessiondatelabel: 'le 25 mars 2026',
      sessiontimelabel: '09:00 - 17:00',
      saleid: 'SALE-123',
      amountpaid: '149.00',
      refundamount: '149.00',
      refundstatus: 'requested',
      trackingurl: 'https://beautysavage.com/vitrine.html?page=refund-tracking&token=abc123',
      sitename: 'Beauty Savage'
    },
    simulation: { enabled: false },
    editorTitle: 'Edition du corps du mail SESSION_CLIENT_CANCELLED_REFUND',
    editorDescription: 'Annoncez clairement le remboursement et conservez les montants.'
  },
  session_client_cancelled_no_refund: {
    label: 'Annulation client sans remboursement',
    description: 'Confirmation au client quand il annule hors delai et sans remboursement.',
    variables: [
      { token: '{{firstName}}', label: 'Prenom client' },
      { token: '{{lastName}}', label: 'Nom client' },
      { token: '{{formationTitle}}', label: 'Nom formation' },
      { token: '{{sessionDateLabel}}', label: 'Date session' },
      { token: '{{sessionTimeLabel}}', label: 'Horaires' },
      { token: '{{saleId}}', label: 'ID vente' },
      { token: '{{amountPaid}}', label: 'Montant paye' },
      { token: '{{siteName}}', label: 'Nom institut' }
    ],
    placeholders: {
      firstname: 'Camille',
      lastname: 'Martin',
      formationtitle: 'Master Brow Artist',
      sessiondatelabel: 'le 25 mars 2026',
      sessiontimelabel: '09:00 - 17:00',
      saleid: 'SALE-123',
      amountpaid: '149.00',
      sitename: 'Beauty Savage'
    },
    simulation: { enabled: false },
    editorTitle: 'Edition du corps du mail SESSION_CLIENT_CANCELLED_NO_REFUND',
    editorDescription: 'Conservez le rappel CGV et le montant paye.'
  },
  institute_client_cancelled_notice: {
    label: 'Institut annulation client',
    description: "Notification back-office quand un client annule sa session avec indication eligibilite remboursement.",
    variables: [
      { token: '{{customerName}}', label: 'Nom client' },
      { token: '{{clientEmail}}', label: 'Email client' },
      { token: '{{formationTitle}}', label: 'Nom formation' },
      { token: '{{sessionDateLabel}}', label: 'Date session' },
      { token: '{{sessionTimeLabel}}', label: 'Horaires' },
      { token: '{{saleId}}', label: 'ID vente' },
      { token: '{{amountPaid}}', label: 'Montant paye' },
      { token: '{{refundStatus}}', label: 'Eligible remboursement' },
      { token: '{{reason}}', label: 'Motif' }
    ],
    placeholders: {
      customername: 'Camille Martin',
      clientemail: 'camille@example.com',
      formationtitle: 'Master Brow Artist',
      sessiondatelabel: 'le 25 mars 2026',
      sessiontimelabel: '09:00 - 17:00',
      saleid: 'SALE-123',
      amountpaid: '149.00',
      refundstatus: 'eligible',
      reason: 'client_cancel_presentiel'
    },
    simulation: { enabled: false },
    editorTitle: 'Edition du corps du mail INSTITUTE_CLIENT_CANCELLED_NOTICE',
    editorDescription: 'Mail interne avec client, vente, montant et eligibilite remboursement.'
  },
  refund_requested: {
    label: 'Remboursement demande',
    description: 'Mail transactionnel apres creation de la demande de remboursement.',
    variables: [
      { token: '{{firstName}}', label: 'Prenom client' },
      { token: '{{lastName}}', label: 'Nom client' },
      { token: '{{formationTitle}}', label: 'Formation' },
      { token: '{{productName}}', label: 'Produit' },
      { token: '{{refundAmount}}', label: 'Montant remboursement' },
      { token: '{{refundStatus}}', label: 'Statut remboursement' },
      { token: '{{refundDateTime}}', label: 'Date / heure' },
      { token: '{{saleId}}', label: 'ID vente' },
      { token: '{{refundId}}', label: 'ID remboursement' },
      { token: '{{siteName}}', label: 'Nom institut' }
    ],
    placeholders: {
      firstname: 'Camille',
      lastname: 'Martin',
      formationtitle: 'Master Brow Artist',
      productname: '',
      refundamount: '149.00',
      refundstatus: 'requested',
      refunddatetime: '02/03/2026 14:30',
      saleid: 'SALE-123',
      refundid: 'REF-123',
      sitename: 'Beauty Savage'
    },
    simulation: { enabled: false },
    editorTitle: 'Edition du corps du mail REFUND_REQUESTED',
    editorDescription: 'Gardez montant, date/heure et references de vente/remboursement.'
  },
  refund_auto_initiated: {
    label: 'Remboursement auto',
    description: 'Mail transactionnel quand le remboursement est lance automatiquement a J+7.',
    variables: [
      { token: '{{firstName}}', label: 'Prenom client' },
      { token: '{{lastName}}', label: 'Nom client' },
      { token: '{{formationTitle}}', label: 'Formation' },
      { token: '{{refundAmount}}', label: 'Montant remboursement' },
      { token: '{{refundStatus}}', label: 'Statut remboursement' },
      { token: '{{refundDateTime}}', label: 'Date / heure' },
      { token: '{{saleId}}', label: 'ID vente' },
      { token: '{{refundId}}', label: 'ID remboursement' },
      { token: '{{siteName}}', label: 'Nom institut' }
    ],
    placeholders: {
      firstname: 'Camille',
      lastname: 'Martin',
      formationtitle: 'Master Brow Artist',
      refundamount: '149.00',
      refundstatus: 'requested',
      refunddatetime: '09/03/2026 02:00',
      saleid: 'SALE-123',
      refundid: 'REF-123',
      sitename: 'Beauty Savage'
    },
    simulation: { enabled: false },
    editorTitle: 'Edition du corps du mail REFUND_AUTO_INITIATED',
    editorDescription: 'Mail auto J+7, conservez les references et le montant.'
  },
  gift_card_compensation: {
    label: 'Carte cadeau compensation',
    description: 'Mail de confirmation de creation de carte cadeau apres suppression formation.',
    variables: [
      { token: '{{firstName}}', label: 'Prenom client' },
      { token: '{{lastName}}', label: 'Nom client' },
      { token: '{{formationTitle}}', label: 'Formation' },
      { token: '{{saleId}}', label: 'ID vente' },
      { token: '{{amountPaid}}', label: 'Montant paye' },
      { token: '{{giftCardCode}}', label: 'Code carte cadeau' },
      { token: '{{giftCardPassword}}', label: 'Mot de passe' },
      { token: '{{giftCardBalance}}', label: 'Solde carte cadeau' },
      { token: '{{siteName}}', label: 'Nom institut' }
    ],
    placeholders: {
      firstname: 'Camille',
      lastname: 'Martin',
      formationtitle: 'Master Brow Artist',
      saleid: 'SALE-123',
      amountpaid: '129.00',
      giftcardcode: 'AB12CD34',
      giftcardpassword: 'Q7LMN8P2',
      giftcardbalance: '129.00',
      sitename: 'Beauty Savage'
    },
    simulation: { enabled: false },
    editorTitle: 'Edition du corps du mail GIFT_CARD_COMPENSATION',
    editorDescription: 'Conservez le code, le mot de passe et le solde de la carte cadeau.'
  }

};

const VARIABLE_PATTERN = /{{\s*([a-zA-Z0-9]+)\s*}}/gi;
const VARIABLE_STYLE_CLASSES = {
  bold: 'mail-variable--bold',
  italic: 'mail-variable--italic',
  underline: 'mail-variable--underline'
};
const VARIABLE_FONT_SIZES = [
  { label: 'Petit', value: 'small', className: 'text-small' },
  { label: 'Normal', value: 'normal', className: 'text-base' },
  { label: 'Large', value: 'large', className: 'text-large' },
  { label: 'XL', value: 'xlarge', className: 'text-xlarge' }
];

function getNormalizedMode(value) {
  return value === MODES.HTML ? MODES.HTML : MODES.TEXT;
}

function sanitizeThemeColor(value) {
  const candidate = String(value || '').trim();
  return candidate || null;
}

function resolveDerivedTokens(colors = {}, overrides = {}) {
  const palette = { ...THEME_DEFAULTS, ...colors };
  const surfaceHeader =
    sanitizeThemeColor(overrides.surfaceHeader) ||
    `color-mix(in oklab, ${palette.primary} 26%, ${palette.background} 74%)`;
  const accent =
    sanitizeThemeColor(overrides.accent) ||
    `color-mix(in oklab, ${palette.primary} 70%, ${palette.secondary} 30%)`;
  const accentStrong =
    sanitizeThemeColor(overrides.accentStrong) ||
    `color-mix(in oklab, ${palette.primary} 45%, ${palette.secondary} 55%)`;
  return { surfaceHeader, accent, accentStrong };
}

function getDefaultPreviewTheme() {
  const colors = { ...THEME_DEFAULTS };
  return {
    colors,
    derivedTokens: resolveDerivedTokens(colors, {})
  };
}

const state = {
  container: null,
  view: 'list', // 'list' | 'editor'
  template: {
    functionName: DEFAULT_FUNCTION_NAME,
    subject: '',
    bodyHtml: '',
    fullHtml: '',
    mode: MODES.TEXT,
    updatedAt: null
  },
  loading: false,
  saving: false,
  feedback: { message: '', status: '' },
  editorInstance: null,
  activeMode: MODES.TEXT,
  pendingMode: null,
  simulationLoading: false,
  theme: getDefaultPreviewTheme(),
  activeVariable: null,
  variableToolbar: null,
  draggingVariable: null,
  dropRange: null,
  dropIndicator: null,
  activeFunction: DEFAULT_FUNCTION_NAME,
  variableKeyMap: new Map(),
  listGroups: []
};

function getActiveFunctionName() {
  return state.activeFunction || state.template.functionName || DEFAULT_FUNCTION_NAME;
}

function getFunctionConfig(name) {
  const candidate = String(name || getActiveFunctionName() || '').trim().toLowerCase();
  return MAIL_FUNCTION_CONFIGS[candidate] || MAIL_FUNCTION_CONFIGS[DEFAULT_FUNCTION_NAME];
}

function getCurrentVariables() {
  return getFunctionConfig(getActiveFunctionName()).variables || [];
}

function getCurrentPlaceholders() {
  return getFunctionConfig(getActiveFunctionName()).placeholders || {};
}

function getThemePlaceholders() {
  const colors = state.theme?.colors || THEME_DEFAULTS;
  const derivedTokens = state.theme?.derivedTokens || resolveDerivedTokens(colors, {});
  return {
    themesurfaceheader: derivedTokens.surfaceHeader || THEME_DEFAULTS.background,
    themeaccent: derivedTokens.accent || colors.primary || THEME_DEFAULTS.primary,
    themeaccentstrong: derivedTokens.accentStrong || colors.secondary || THEME_DEFAULTS.secondary,
    colortext: colors.text || THEME_DEFAULTS.text,
    colorsurface: colors.surface || THEME_DEFAULTS.surface,
    themeprimary: derivedTokens.accent || colors.primary || THEME_DEFAULTS.primary,
    themesecondary: derivedTokens.accentStrong || colors.secondary || THEME_DEFAULTS.secondary,
    themebackground: colors.surface || THEME_DEFAULTS.surface,
    themesurface: colors.surface || THEME_DEFAULTS.surface,
    themetext: colors.text || THEME_DEFAULTS.text
  };
}

function getPreviewPlaceholders() {
  return {
    ...getThemePlaceholders(),
    ...getCurrentPlaceholders()
  };
}

function applyPreviewTheme(target) {
  if (!target) return;
  const colors = state.theme?.colors || THEME_DEFAULTS;
  const derivedTokens = state.theme?.derivedTokens || resolveDerivedTokens(colors, {});
  target.style.setProperty('--theme-surface-header', derivedTokens.surfaceHeader || THEME_DEFAULTS.background);
  target.style.setProperty('--theme-accent', derivedTokens.accent || colors.primary || THEME_DEFAULTS.primary);
  target.style.setProperty('--theme-accent-strong', derivedTokens.accentStrong || colors.secondary || THEME_DEFAULTS.secondary);
  target.style.setProperty('--color-text', colors.text || THEME_DEFAULTS.text);
  target.style.setProperty('--color-surface', colors.surface || THEME_DEFAULTS.surface);
}

async function loadPreviewTheme() {
  try {
    const response = await fetch(ACTIVE_THEME_ENDPOINT, { credentials: 'include' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || 'Impossible de charger le theme actif.');
    }
    const theme = payload?.theme || null;
    const colors = { ...THEME_DEFAULTS, ...(theme?.colors || {}) };
    state.theme = {
      colors,
      derivedTokens: resolveDerivedTokens(colors, theme?.derivedTokens || {})
    };
  } catch (error) {
    console.error('Erreur chargement theme preview mail', error);
    state.theme = getDefaultPreviewTheme();
  }
}

function refreshVariableConfig() {
  const variables = getCurrentVariables();
  const map = new Map();
  variables.forEach(variable => {
    const key = getVariableKey(variable.token);
    if (key) {
      map.set(key, variable);
    }
  });
  state.variableKeyMap = map;
  const toolbar = state.container?.querySelector('[data-variable-toolbar]');
  if (toolbar) {
    toolbar.innerHTML = buildToolbarHtml();
  }
}

function buildFunctionOptions() {
  const currentName = getActiveFunctionName();
  return Object.keys(MAIL_FUNCTION_CONFIGS)
    .map(functionName => {
      const config = MAIL_FUNCTION_CONFIGS[functionName];
      const selected = functionName === currentName ? ' selected' : '';
      return `<option value="${functionName}"${selected}>${config.label}</option>`;
    })
    .join('');
}

function updateFunctionDescription() {
  const config = getFunctionConfig(getActiveFunctionName());
  const descriptionNode = state.container?.querySelector('[data-template-description]');
  if (descriptionNode) {
    descriptionNode.textContent = config.description || '';
  }
  const select = state.container?.querySelector('[data-mail-function-select]');
  if (select) {
    select.value = getActiveFunctionName();
  }
}

function getCurrentSimulationConfig() {
  return getFunctionConfig(getActiveFunctionName()).simulation || {};
}

function updateSimulationArea() {
  const section = state.container?.querySelector('[data-mail-simulation]');
  if (!section) return;
  const simulationConfig = getCurrentSimulationConfig();
  const enabled = Boolean(simulationConfig.enabled);
  section.hidden = !enabled;
  const simulateButton = section.querySelector('[data-mail-simulate]');
  if (simulateButton && simulationConfig.label) {
    simulateButton.textContent = simulationConfig.label;
  }
}

async function setActiveFunction(functionName) {
  const normalized = String(functionName || DEFAULT_FUNCTION_NAME).trim().toLowerCase();
  if (!normalized) return;
  if (normalized === state.activeFunction) {
    return;
  }
  state.activeFunction = normalized;
  refreshVariableConfig();
  updateFunctionDescription();
  updateSimulationArea();
  await loadTemplate();
}

function formatTimestamp(value) {
  if (!value) return 'Jamais sauvegarde';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Date inconnue';
  }
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getVariableKey(token) {
  const match = String(token || '').match(/{{\s*([a-zA-Z0-9]+)\s*}}/);
  return match?.[1]?.toLowerCase() || null;
}

function createVariableElement(token) {
  const element = document.createElement('span');
  element.className = 'mail-variable';
  element.setAttribute('contenteditable', 'false');
  element.dataset.variable = token;
  element.textContent = token;
  return element;
}

function getCaretRangeFromPoint(x, y) {
  if (typeof document.caretPositionFromPoint === 'function') {
    const position = document.caretPositionFromPoint(x, y);
    if (position?.offsetNode) {
      const range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
      return range;
    }
  }
  if (typeof document.caretRangeFromPoint === 'function') {
    return document.caretRangeFromPoint(x, y);
  }
  return null;
}

function getRangeClientRect(range) {
  if (!range) return null;
  const rect = range.getBoundingClientRect();
  if (rect) {
    return rect;
  }
  const clientRects = range.getClientRects();
  return clientRects.length ? clientRects[0] : null;
}

function positionDropIndicator(range, editor) {
  const indicator = state.dropIndicator;
  if (!indicator || !range || !editor) return;
  const editorRect = editor.getBoundingClientRect();
  const rect = getRangeClientRect(range);
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 18;
  const height = Math.max(rect?.height || lineHeight, 1);
  const topBase = rect ? rect.top - editorRect.top : editorRect.height - height;
  const leftBase = rect ? rect.left - editorRect.left : editorRect.width;
  const clampedTop = Math.min(Math.max(topBase, 0), Math.max(editorRect.height - height, 0));
  const clampedLeft = Math.min(Math.max(leftBase, 0), editorRect.width);
  indicator.style.top = `${clampedTop}px`;
  indicator.style.left = `${clampedLeft}px`;
  indicator.style.height = `${height}px`;
  indicator.hidden = false;
}

function hideDropIndicator() {
  if (state.dropIndicator) {
    state.dropIndicator.hidden = true;
  }
  state.dropRange = null;
}

function decorateVariablesForEditor(html = '') {
  if (!html) return '';
  const container = document.createElement('div');
  container.innerHTML = html;
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.includes('{{')) {
          return NodeFilter.FILTER_SKIP;
        }
        const parent = node.parentNode;
        if (parent && parent.closest && parent.closest('.mail-variable')) {
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  let current;
  while ((current = walker.nextNode())) {
    const textNode = current;
    const text = textNode.nodeValue || '';
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    VARIABLE_PATTERN.lastIndex = 0;
    let match;
    while ((match = VARIABLE_PATTERN.exec(text))) {
      const before = text.slice(lastIndex, match.index);
      if (before) {
        fragment.appendChild(document.createTextNode(before));
      }
      const token = match[0];
      const key = match[1]?.toLowerCase();
      if (!key || !state.variableKeyMap.has(key)) {
        fragment.appendChild(document.createTextNode(token));
        lastIndex = VARIABLE_PATTERN.lastIndex;
        continue;
      }
      fragment.appendChild(createVariableElement(token));
      lastIndex = VARIABLE_PATTERN.lastIndex;
    }
    if (lastIndex === 0) {
      continue;
    }
    const remainder = text.slice(lastIndex);
    if (remainder) {
      fragment.appendChild(document.createTextNode(remainder));
    }
    if (fragment.childNodes.length) {
      textNode.parentNode?.replaceChild(fragment, textNode);
    }
  }
  return container.innerHTML;
}

function applyPlaceholderValues(content = '') {
  if (!content) return '';
  const placeholders = getPreviewPlaceholders();
  return String(content).replace(/{{\s*([a-zA-Z0-9]+)\s*}}/gi, (match, key) => {
    const sample = placeholders[key?.toLowerCase()];
    return sample || match;
  });
}

function setSimulationFeedback(message = '', status = '') {
  const container = state.container;
  if (!container) return;
  const target = container.querySelector('[data-simulation-feedback]');
  if (!target) return;
  target.textContent = message;
  if (status) {
    target.dataset.status = status;
  } else {
    delete target.dataset.status;
  }
}

async function triggerTemplateSimulation() {
  const simulationConfig = getCurrentSimulationConfig();
  if (!simulationConfig.enabled || !simulationConfig.endpoint) {
    setSimulationFeedback('Simulation indisponible pour ce template.', 'error');
    return;
  }
  state.simulationLoading = true;
  toggleBusy();
  setSimulationFeedback('Envoi en cours...', 'info');
  try {
    const response = await fetch(simulationConfig.endpoint, {
      method: 'POST',
      credentials: 'include'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || 'Impossible de simuler une vente.');
    }
    const email = payload?.customer?.email || 'le client';
    setSimulationFeedback(`Mail de simulation envoyé à ${email}.`, 'success');
  } catch (error) {
    console.error('Erreur simulation vente', error);
    setSimulationFeedback(error.message || 'Erreur lors de la simulation.', 'error');
  } finally {
    state.simulationLoading = false;
    toggleBusy();
  }
}

function setFeedback(message = '', status = '') {
  state.feedback.message = message;
  state.feedback.status = status;
  const container = state.container;
  if (!container) return;
  const target = container.querySelector('[data-email-feedback]');
  if (!target) return;
  target.textContent = message;
  if (status) {
    target.dataset.status = status;
  } else {
    delete target.dataset.status;
  }
}

let toolbarGlobalsAttached = false;

function getEditorPanel() {
  return state.container?.querySelector('.mail-template-editor-panel');
}

function positionVariableToolbar() {
  const toolbar = state.variableToolbar;
  const variable = state.activeVariable;
  const panel = getEditorPanel();
  if (!toolbar || !variable || !panel) {
    return;
  }
  const panelRect = panel.getBoundingClientRect();
  const varRect = variable.getBoundingClientRect();
  const toolbarRect = toolbar.getBoundingClientRect();
  const offset = 8;
  const top = Math.max(varRect.top - panelRect.top - toolbarRect.height - offset, 0);
  let left = varRect.left - panelRect.left + varRect.width / 2 - toolbarRect.width / 2;
  const maxLeft = panelRect.width - toolbarRect.width - offset;
  if (left < offset) {
    left = offset;
  } else if (left > maxLeft) {
    left = Math.max(maxLeft, offset);
  }
  toolbar.style.top = `${top}px`;
  toolbar.style.left = `${left}px`;
}

function renderVariableReplaceOptions() {
  const toolbar = state.variableToolbar;
  const menuList = toolbar?.querySelector('[data-variable-replace-list]');
  if (!toolbar || !menuList || !state.activeVariable) return;
  const current = state.activeVariable.dataset.variable;
  menuList.innerHTML = getCurrentVariables()
    .filter(variable => variable.token !== current)
    .map(
      variable => `<button type="button" class="variable-toolbar__replace-item" data-variable-replace-value="${variable.token}">${variable.token}</button>`
    )
    .join('');
}

function updateVariableToolbarStyles() {
  const toolbar = state.variableToolbar;
  const target = state.activeVariable;
  if (!toolbar || !target) return;
  toolbar.querySelectorAll('[data-variable-style]').forEach(button => {
    const action = button.dataset.variableStyle;
    const className = VARIABLE_STYLE_CLASSES[action];
    button.classList.toggle('is-active', Boolean(className && target.classList.contains(className)));
  });
  const sizeSelect = toolbar.querySelector('[data-variable-size]');
  if (sizeSelect) {
    const activeSize = VARIABLE_FONT_SIZES.find(option => option.className && target.classList.contains(option.className));
    sizeSelect.value = activeSize ? activeSize.value : 'normal';
  }
}

function showVariableToolbar(variable) {
  if (!state.variableToolbar || !variable) return;
  state.activeVariable = variable;
  const toolbar = state.variableToolbar;
  const menu = toolbar.querySelector('[data-variable-replace-menu]');
  toolbar.removeAttribute('hidden');
  toolbar.classList.add('is-visible');
  if (menu) {
    menu.setAttribute('hidden', 'true');
  }
  renderVariableReplaceOptions();
  updateVariableToolbarStyles();
  positionVariableToolbar();
}

function hideVariableToolbar() {
  const toolbar = state.variableToolbar;
  if (!toolbar) return;
  toolbar.setAttribute('hidden', 'true');
  toolbar.classList.remove('is-visible');
  const menu = toolbar.querySelector('[data-variable-replace-menu]');
  if (menu) {
    menu.setAttribute('hidden', 'true');
  }
  state.activeVariable = null;
}

function applyVariableStyleToActive(action) {
  const target = state.activeVariable;
  if (!target) return;
  const className = VARIABLE_STYLE_CLASSES[action];
  if (!className) return;
  target.classList.toggle(className);
  updateVariableToolbarStyles();
}

function applyVariableFontSizeToActive(value) {
  const target = state.activeVariable;
  if (!target) return;
  VARIABLE_FONT_SIZES.forEach(option => {
    if (option.className) {
      target.classList.remove(option.className);
    }
  });
  const selected = VARIABLE_FONT_SIZES.find(option => option.value === value);
  if (selected && selected.className) {
    target.classList.add(selected.className);
  }
  updateVariableToolbarStyles();
}

function replaceActiveVariableWith(token) {
  const target = state.activeVariable;
  if (!target) return;
  target.dataset.variable = token;
  target.textContent = token;
  showVariableToolbar(target);
}

function copyActiveVariable() {
  const token = state.activeVariable?.dataset?.variable;
  if (!token) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(token).catch(() => {});
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = token;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function handleDocumentMouseDown(event) {
  const toolbar = state.variableToolbar;
  if (!toolbar || toolbar.hasAttribute('hidden')) return;
  const target = event.target;
  if (toolbar.contains(target) || target.closest('.mail-variable')) {
    return;
  }
  hideVariableToolbar();
}

function handleGlobalKeyDown(event) {
  if (event.key === 'Escape') {
    hideVariableToolbar();
  }
}

function handleToolbarReposition() {
  if (!state.variableToolbar) return;
  if (!state.variableToolbar.hasAttribute('hidden')) {
    positionVariableToolbar();
  }
}

function attachVariableToolbarGlobals() {
  if (toolbarGlobalsAttached) return;
  document.addEventListener('mousedown', handleDocumentMouseDown);
  document.addEventListener('keydown', handleGlobalKeyDown);
  window.addEventListener('resize', handleToolbarReposition);
  window.addEventListener('scroll', handleToolbarReposition, true);
  toolbarGlobalsAttached = true;
}

function toggleBusy(flags = {}) {
  const { loading = false, saving = false } = flags;
  const container = state.container;
  if (!container) return;
  const saveButton = container.querySelector('[data-mail-save]');
  const editButton = container.querySelector('[data-template-edit-body]');
  const subjectInput = container.querySelector('[data-template-subject]');
  const htmlEditor = container.querySelector('[data-html-editor]');
  const simulateButton = container.querySelector('[data-mail-simulate]');
  if (saveButton) {
    saveButton.disabled = saving || loading;
  }
  if (editButton) {
    editButton.disabled = loading || state.activeMode !== MODES.TEXT;
  }
  if (subjectInput) {
    subjectInput.disabled = loading;
  }
  if (htmlEditor) {
    htmlEditor.disabled = loading || saving;
  }
  if (simulateButton) {
    simulateButton.disabled = loading || saving || state.simulationLoading;
  }
}

function getModeContent(mode) {
  return mode === MODES.HTML ? state.template.fullHtml : state.template.bodyHtml;
}

function hasContentForMode(mode) {
  const value = getModeContent(mode);
  return Boolean(value && String(value).trim());
}

function renderModeState() {
  const container = state.container;
  if (!container) return;
  const switchButtons = container.querySelectorAll('[data-mode-switch]');
  switchButtons.forEach(button => {
    const target = button.dataset.modeSwitch;
    const active = target === state.activeMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const textPane = container.querySelector('[data-text-pane]');
  const htmlPane = container.querySelector('[data-html-pane]');
  if (textPane) {
    textPane.hidden = state.activeMode !== MODES.TEXT;
  }
  if (htmlPane) {
    htmlPane.hidden = state.activeMode !== MODES.HTML;
  }
  const htmlEditor = container.querySelector('[data-html-editor]');
  if (htmlEditor) {
    htmlEditor.value = state.template.fullHtml || '';
  }
  const editButton = container.querySelector('[data-template-edit-body]');
  if (editButton) {
    editButton.disabled = state.activeMode !== MODES.TEXT || state.loading;
  }
}

function openModeWarning(target) {
  const container = state.container;
  if (!container) return;
  const overlay = container.querySelector('[data-mode-warning]');
  if (!overlay) return;
  overlay.removeAttribute('hidden');
  overlay.dataset.targetMode = target;
  container.querySelector('[data-mode-warning-message]')?.scrollIntoView({ block: 'nearest' });
}

function closeModeWarning() {
  const container = state.container;
  if (!container) return;
  const overlay = container.querySelector('[data-mode-warning]');
  if (!overlay) return;
  overlay.setAttribute('hidden', 'true');
  delete overlay.dataset.targetMode;
  state.pendingMode = null;
}

function setActiveMode(mode) {
  if (!mode || (mode !== MODES.TEXT && mode !== MODES.HTML)) {
    return;
  }
  if (state.activeMode === mode) {
    return;
  }
  state.activeMode = mode;
  renderModeState();
  renderPreview();
}

function attemptModeSwitch(targetMode) {
  if (!targetMode || targetMode === state.activeMode) return;
  if (hasContentForMode(state.activeMode)) {
    state.pendingMode = targetMode;
    openModeWarning(targetMode);
    return;
  }
  setActiveMode(targetMode);
}

function confirmModeChange() {
  const target = state.pendingMode;
  closeModeWarning();
  if (target) {
    setActiveMode(target);
  }
}

function renderPreview() {
  const container = state.container;
  if (!container) return;
  const preview = container.querySelector('[data-template-preview]');
  if (preview) {
    applyPreviewTheme(preview);
    if (state.activeMode === MODES.HTML) {
      const htmlContent = state.template.fullHtml || state.template.bodyHtml || '';
      preview.innerHTML = htmlContent
        ? applyPlaceholderValues(htmlContent)
        : `<p class="muted">Collez votre HTML pour voir l'aperçu en direct.</p>`;
    } else {
      const textContent = state.template.bodyHtml || '';
      preview.innerHTML = textContent
        ? applyPlaceholderValues(textContent)
        : `<p class="muted">Utilisez l'éditeur pour ecrire le corps du mail.</p>`;
    }
  }
  const timestamp = container.querySelector('[data-template-updated]');
  if (timestamp) {
    timestamp.textContent = formatTimestamp(state.template.updatedAt);
  }
  const subjectInput = container.querySelector('[data-template-subject]');
  if (subjectInput) {
    subjectInput.value = state.template.subject;
  }
}

function buildToolbarHtml() {
  return getCurrentVariables().map(variable => {
    return `<button type="button" draggable="true" class="mail-variable-button" data-variable="${variable.token}">
      ${variable.token}
      <small>${variable.label}</small>
    </button>`;
  }).join('');
}

function attachEvents() {
  const container = state.container;
  if (!container) return;
  const saveButton = container.querySelector('[data-mail-save]');
  const editButton = container.querySelector('[data-template-edit-body]');
  const subjectInput = container.querySelector('[data-template-subject]');
  const toolbar = container.querySelector('[data-variable-toolbar]');
  const contextToolbar = container.querySelector('[data-variable-context-toolbar]');
  const htmlEditor = container.querySelector('[data-html-editor]');
  const switchButtons = container.querySelectorAll('[data-mode-switch]');
  const warningConfirm = container.querySelector('[data-mode-warning-confirm]');
  const warningCancel = container.querySelector('[data-mode-warning-cancel]');
  const simulateButton = container.querySelector('[data-mail-simulate]');
  const functionSelect = container.querySelector('[data-mail-function-select]');

  saveButton?.addEventListener('click', event => {
    event.preventDefault();
    saveTemplate();
  });

  editButton?.addEventListener('click', event => {
    event.preventDefault();
    if (state.activeMode !== MODES.TEXT) {
      setFeedback("Activez le mode texte pour utiliser l'éditeur actuel.", 'error');
      return;
    }
    openBodyEditor();
  });

  subjectInput?.addEventListener('input', event => {
    state.template.subject = event.target.value;
  });

  toolbar?.addEventListener('click', event => {
    const button = event.target.closest('[data-variable]');
    if (!button) return;
    event.preventDefault();
    const token = button.dataset.variable;
    insertVariable(token);
  });

  const handleVariableDragStart = event => {
    const button = event.target.closest('[data-variable]');
    if (!button) return;
    const token = button.dataset.variable;
    if (!token) return;
    state.draggingVariable = token;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('text/plain', token);
    }
  };

  const handleVariableDragEnd = () => {
    state.draggingVariable = null;
    hideDropIndicator();
  };

  toolbar?.addEventListener('dragstart', handleVariableDragStart);
  toolbar?.addEventListener('dragend', handleVariableDragEnd);

  if (contextToolbar) {
    state.variableToolbar = contextToolbar;
    attachVariableToolbarGlobals();
    contextToolbar.addEventListener('click', event => {
      const actionButton = event.target.closest('[data-variable-action]');
      if (!actionButton) return;
      event.preventDefault();
      const action = actionButton.dataset.variableAction;
      if (action === 'replace') {
        const menu = contextToolbar.querySelector('[data-variable-replace-menu]');
        if (!menu) return;
        if (menu.hasAttribute('hidden')) {
          renderVariableReplaceOptions();
          menu.removeAttribute('hidden');
        } else {
          menu.setAttribute('hidden', 'true');
        }
        return;
      }
      if (action === 'delete') {
        state.activeVariable?.remove();
        hideVariableToolbar();
        return;
      }
      if (action === 'copy') {
        copyActiveVariable();
        return;
      }
      const styleTarget = actionButton.dataset.variableStyle;
      if (styleTarget) {
        applyVariableStyleToActive(styleTarget);
      }
    });
    const replaceList = contextToolbar.querySelector('[data-variable-replace-list]');
    replaceList?.addEventListener('click', event => {
      const option = event.target.closest('[data-variable-replace-value]');
      if (!option) return;
      replaceActiveVariableWith(option.dataset.variableReplaceValue);
      const menu = contextToolbar.querySelector('[data-variable-replace-menu]');
      if (menu) {
        menu.setAttribute('hidden', 'true');
      }
    });
    const sizeSelect = contextToolbar.querySelector('[data-variable-size]');
    sizeSelect?.addEventListener('change', event => {
      applyVariableFontSizeToActive(event.target.value);
    });
  }

  htmlEditor?.addEventListener('input', event => {
    state.template.fullHtml = event.target.value || '';
    renderPreview();
  });

  simulateButton?.addEventListener('click', event => {
    event.preventDefault();
    triggerTemplateSimulation();
  });

  functionSelect?.addEventListener('change', event => {
    event.preventDefault();
    const target = event.target;
    if (target) {
      setActiveFunction(target.value);
    }
  });

  switchButtons.forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      const target = button.dataset.modeSwitch;
      attemptModeSwitch(target);
    });
  });

  warningConfirm?.addEventListener('click', event => {
    event.preventDefault();
    confirmModeChange();
  });

  warningCancel?.addEventListener('click', event => {
    event.preventDefault();
    closeModeWarning();
  });
}

function insertVariable(token) {
  if (state.activeMode === MODES.TEXT) {
    const editor = state.editorInstance?.editor;
    if (!editor) {
      setFeedback("Ouvrez l'éditeur pour inserer une variable.", 'error');
      return;
    }
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) {
      setFeedback('Positionnez le curseur dans le corps du mail.', 'error');
      return;
    }
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const variableElement = createVariableElement(token);
    range.insertNode(variableElement);
    range.setStartAfter(variableElement);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    editor.focus();
    return;
  }
  const container = state.container;
  if (!container) return;
  const htmlEditor = container.querySelector('[data-html-editor]');
  if (!htmlEditor) return;
  const start = htmlEditor.selectionStart;
  const end = htmlEditor.selectionEnd;
  const value = htmlEditor.value || '';
  const inserted = value.slice(0, start) + token + value.slice(end);
  htmlEditor.value = inserted;
  const position = start + token.length;
  htmlEditor.setSelectionRange(position, position);
  htmlEditor.dispatchEvent(new Event('input', { bubbles: true }));
  htmlEditor.focus();
}

function openBodyEditor() {
  setFeedback('');
  let cleanupVariableInteractions = null;
  const editorConfig = getFunctionConfig(getActiveFunctionName());
  state.editorInstance = openEditorialEditor({
    title: editorConfig.editorTitle,
    description: editorConfig.editorDescription,
    label: 'Corps HTML',
    initialHtml: decorateVariablesForEditor(state.template.bodyHtml || ''),
    onSave: html => {
      state.template.bodyHtml = html || '';
      renderPreview();
    },
    onClose: () => {
      cleanupVariableInteractions?.();
      hideVariableToolbar();
      state.editorInstance = null;
    }
  });
  const editorBody = state.editorInstance?.editor;
  if (editorBody) {
    const dropIndicator = document.createElement('div');
    dropIndicator.className = DROP_INDICATOR_CLASS;
    dropIndicator.hidden = true;
    dropIndicator.setAttribute('aria-hidden', 'true');
    editorBody.appendChild(dropIndicator);
    state.dropIndicator = dropIndicator;

    const handleVariableClick = event => {
      const variable = event.target.closest('.mail-variable');
      if (variable) {
        event.preventDefault();
        showVariableToolbar(variable);
        return;
      }
      hideVariableToolbar();
    };

    const handleDragOver = event => {
      if (!state.draggingVariable || state.activeMode !== MODES.TEXT) {
        hideDropIndicator();
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
      const range = getCaretRangeFromPoint(event.clientX, event.clientY);
      if (!range || !range.startContainer || !editorBody.contains(range.startContainer)) {
        hideDropIndicator();
        return;
      }
      state.dropRange = range;
      positionDropIndicator(range, editorBody);
    };

    const handleDrop = event => {
      if (!state.draggingVariable || state.activeMode !== MODES.TEXT) {
        hideDropIndicator();
        return;
      }
      event.preventDefault();
      const token = event.dataTransfer?.getData('text/plain') || state.draggingVariable;
      const dropRange = state.dropRange;
      if (!token || !dropRange) {
        hideDropIndicator();
        return;
      }
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(dropRange);
      }
      state.draggingVariable = null;
      insertVariable(token);
      hideDropIndicator();
    };

    const handleDragLeave = event => {
      if (!state.draggingVariable) return;
      const related = event.relatedTarget;
      if (related && editorBody.contains(related)) {
        return;
      }
      hideDropIndicator();
    };

    const handleDragEnd = () => {
      hideDropIndicator();
    };

    editorBody.addEventListener('click', handleVariableClick);
    editorBody.addEventListener('dragover', handleDragOver);
    editorBody.addEventListener('drop', handleDrop);
    editorBody.addEventListener('dragleave', handleDragLeave);
    editorBody.addEventListener('dragend', handleDragEnd);

    cleanupVariableInteractions = () => {
      editorBody.removeEventListener('click', handleVariableClick);
      editorBody.removeEventListener('dragover', handleDragOver);
      editorBody.removeEventListener('drop', handleDrop);
      editorBody.removeEventListener('dragleave', handleDragLeave);
      editorBody.removeEventListener('dragend', handleDragEnd);
      hideDropIndicator();
      dropIndicator.remove();
      state.dropIndicator = null;
    };
  }
}

async function loadTemplate() {
  if (!state.container) return;
  state.loading = true;
  toggleBusy({ loading: true });
  setFeedback('');
  try {
    const params = new URLSearchParams({ functionName: getActiveFunctionName() });
    const response = await fetch(`${API_ROOT}?${params.toString()}`, {
      credentials: 'include'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || 'Impossible de charger le template.');
    }
    const template = payload.template || {};
    const resolvedMode = getNormalizedMode(template.mode || (template.fullHtml ? MODES.HTML : MODES.TEXT));
    const functionName = template.functionName || getActiveFunctionName();
    state.template = {
      functionName,
      subject: template.subject || '',
      bodyHtml: template.bodyHtml || '',
      fullHtml: template.fullHtml || '',
      mode: resolvedMode,
      updatedAt: template.updatedAt || null
    };
    state.activeMode = resolvedMode;
    state.pendingMode = null;
    renderModeState();
    renderPreview();
    state.activeFunction = functionName;
    updateFunctionDescription();
    updateSimulationArea();
    refreshVariableConfig();
  } catch (error) {
    console.error('Erreur chargement template mail', error);
    setFeedback(error.message || 'Erreur de chargement.', 'error');
  } finally {
    state.loading = false;
    toggleBusy({ loading: false });
  }
}

async function saveTemplate() {
  if (!state.container) return;
  state.saving = true;
  toggleBusy({ saving: true });
  setFeedback('');
  try {
    const response = await fetch(API_ROOT, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        functionName: getActiveFunctionName(),
        subject: state.template.subject,
        bodyHtml: state.template.bodyHtml,
        fullHtml: state.template.fullHtml,
        mode: state.activeMode
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || "Echec de l'enregistrement.");
    }
    const template = payload.template || {};

    state.template = {
      functionName: template.functionName || state.template.functionName,
      subject: template.subject || state.template.subject,
      bodyHtml: template.bodyHtml || state.template.bodyHtml,
      fullHtml: template.fullHtml || state.template.fullHtml,
      mode: template.mode ? getNormalizedMode(template.mode) : state.template.mode,
      updatedAt: template.updatedAt || new Date().toISOString()
    };
    state.activeMode = state.template.mode;
    state.pendingMode = null;
    renderModeState();
    renderPreview();
    setFeedback('Template enregistre.', 'success');
  } catch (error) {
    console.error('Erreur sauvegarde template mail', error);
    setFeedback(error.message || "Impossible d'enregistrer.", 'error');
  } finally {
    state.saving = false;
    toggleBusy({ saving: false });
  }
}

const RECIPIENT_LABELS = {
  client: 'Client',
  institute: 'Institut',
  both: 'Client & Institut'
};

async function fetchTemplateList() {
  try {
    const response = await fetch(API_TEMPLATES_LIST, { credentials: 'include' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || 'Impossible de charger les templates.');
    return payload.groups || [];
  } catch (error) {
    console.error('Erreur chargement liste templates', error);
    return [];
  }
}

function buildListHtml(groups) {
  if (!groups.length) {
    return '<p class="muted mtm-empty">Aucun template disponible.</p>';
  }
  return groups.map(group => {
    const categoryName = group.category?.name || 'Sans catégorie';
    const templatesHtml = group.templates.map(tpl => {
      const config = MAIL_FUNCTION_CONFIGS[tpl.functionName] || {};
      const label = config.label || tpl.functionName;
      const description = config.description || '';
      const recipientLabel = RECIPIENT_LABELS[tpl.recipient] || tpl.recipient;
      const edited = tpl.isMetadataOnly === false && tpl.updatedAt
        ? `<span class="mtm-card__edited">Modifié ${new Date(tpl.updatedAt).toLocaleDateString('fr-FR')}</span>`
        : '';
      return `
        <div class="mtm-card" data-function-name="${tpl.functionName}">
          <div class="mtm-card__body">
            <div class="mtm-card__meta">
              <strong class="mtm-card__label">${label}</strong>
              <span class="mtm-card__recipient mtm-badge mtm-badge--${tpl.recipient}">${recipientLabel}</span>
            </div>
            ${description ? `<p class="mtm-card__description">${description}</p>` : ''}
            ${edited}
          </div>
          <button type="button" class="secondary-button mtm-card__edit" data-edit-function="${tpl.functionName}">Éditer</button>
        </div>`;
    }).join('');
    return `
      <div class="mtm-group">
        <h3 class="mtm-group__title">${categoryName}</h3>
        <div class="mtm-cards">${templatesHtml}</div>
      </div>`;
  }).join('');
}

async function renderListView() {
  const container = state.container;
  if (!container) return;
  state.view = 'list';

  const listSection = container.querySelector('[data-mtm-list]');
  const editorSection = container.querySelector('[data-mtm-editor]');
  if (listSection) listSection.hidden = false;
  if (editorSection) editorSection.hidden = true;

  const listContent = container.querySelector('[data-mtm-list-content]');
  if (listContent) {
    listContent.innerHTML = '<p class="muted">Chargement...</p>';
  }

  state.listGroups = await fetchTemplateList();
  if (listContent) {
    listContent.innerHTML = buildListHtml(state.listGroups);
  }
}

async function openEditorForFunction(functionName) {
  const container = state.container;
  if (!container) return;
  state.view = 'editor';

  const listSection = container.querySelector('[data-mtm-list]');
  const editorSection = container.querySelector('[data-mtm-editor]');
  if (listSection) listSection.hidden = true;
  if (editorSection) editorSection.hidden = false;

  await setActiveFunction(functionName);
}

export async function renderModule(container) {
  if (!container) return;
  state.container = container;
  container.innerHTML = `
    <section class="module-panel" data-module-root>

      <!-- LIST VIEW -->
      <div data-mtm-list>
        <header>
          <h2>Templates email</h2>
        </header>
        <div class="manager-section mtm-list-section" data-mtm-list-content>
          <p class="muted">Chargement...</p>
        </div>
      </div>

      <!-- EDITOR VIEW -->
      <div data-mtm-editor hidden>
        <header>
          <div class="mtm-editor-header">
            <button type="button" class="secondary-button mtm-back-btn" data-mtm-back>← Retour</button>
            <h2>Editeur de template mail</h2>
          </div>
          <div class="mail-template-header-controls">
            <p class="muted" data-template-description></p>
          </div>
        </header>
        <div class="manager-section mail-template-section">
          <div class="mail-template-header">
            <div>
              <strong>Objet du mail</strong>
              <input type="text" class="text-field" data-template-subject placeholder="Objet du mail..." />
            </div>
            <small class="muted">Derniere mise a jour : <span data-template-updated>...</span></small>
          </div>
          <div class="mail-template-simulation" data-mail-simulation>
            <button type="button" class="secondary-button" data-mail-simulate>
              Simuler une vente (test email)
            </button>
            <span class="form-message" data-simulation-feedback></span>
          </div>
          <div class="mail-template-mode-switch">
            <button type="button" class="mode-button" data-mode-switch="text">Mode TEXTE</button>
            <button type="button" class="mode-button" data-mode-switch="html">Mode FULL HTML</button>
          </div>
          <div class="mail-template-body">
            <div class="mail-variable-toolbar" data-variable-toolbar aria-label="Variables disponibles">
              ${buildToolbarHtml()}
            </div>
            <div class="mail-template-editor-grid">
              <div class="mail-template-editor-panel">
                <div class="mail-variable-context-toolbar" data-variable-context-toolbar hidden>
                  <div class="mail-variable-context-toolbar__panel">
                    <div class="mail-variable-context-toolbar__actions">
                      <button type="button" data-variable-action="replace">Remplacer</button>
                      <button type="button" data-variable-action="delete">Supprimer</button>
                      <button type="button" data-variable-action="copy">Copier</button>
                    </div>
                    <div class="mail-variable-context-toolbar__separator" aria-hidden="true"></div>
                    <div class="mail-variable-context-toolbar__styles">
                      <button type="button" data-variable-action="style" data-variable-style="bold">B</button>
                      <button type="button" data-variable-action="style" data-variable-style="italic">I</button>
                      <button type="button" data-variable-action="style" data-variable-style="underline">U</button>
                      <select data-variable-size>
                        <option value="">Taille</option>
                        <option value="small">Petit</option>
                        <option value="normal">Normal</option>
                        <option value="large">Large</option>
                        <option value="xlarge">XL</option>
                      </select>
                    </div>
                    <div class="mail-variable-context-toolbar__replace" data-variable-replace-menu hidden>
                      <p>Remplacer par :</p>
                      <div class="mail-variable-context-toolbar__replace-list" data-variable-replace-list></div>
                    </div>
                  </div>
                </div>
                <div class="mail-text-pane" data-text-pane>
                  <p class="muted">Le mode TEXTE utilise le meme editeur CMS que la version precedente.</p>
                  <p class="muted">Cliquez sur "Modifier le corps" pour acceder a l'éditeur.</p>
                </div>
                <div class="mail-html-pane" data-html-pane hidden>
                  <label class="mail-html-label">HTML libre</label>
                  <textarea class="code-textarea" data-html-editor placeholder="Collez votre HTML brut ici ..."></textarea>
                  <p class="muted">Previsualisation instantanee a droite, sans execution de script.</p>
                </div>
              </div>
              <div class="mail-template-preview" data-template-preview>
                <p class="muted">Chargement en cours...</p>
              </div>
            </div>
          </div>
          <div class="form-actions mail-template-actions">
            <button type="button" class="primary-button" data-mail-save>Enregistrer le template</button>
            <button type="button" class="secondary-button" data-template-edit-body>Modifier le corps</button>
          </div>
          <p class="form-message" data-email-feedback></p>
          <div class="modal-overlay" data-mode-warning hidden>
            <div class="modal-panel">
              <p data-mode-warning-message>Votre contenu actuel sera perdu si vous changez de mode.</p>
              <div class="modal-actions">
                <button type="button" class="primary-button" data-mode-warning-confirm>Confirmer</button>
                <button type="button" class="secondary-button" data-mode-warning-cancel>Annuler</button>
              </div>
            </div>
          </div>
        </div>
      </div>

    </section>
  `;

  refreshVariableConfig();
  updateFunctionDescription();
  updateSimulationArea();
  setSimulationFeedback('', '');
  await loadPreviewTheme();
  renderModeState();
  renderPreview();
  attachEvents();

  // Attach list-view events
  container.addEventListener('click', event => {
    const editBtn = event.target.closest('[data-edit-function]');
    if (editBtn) {
      event.preventDefault();
      void openEditorForFunction(editBtn.dataset.editFunction);
      return;
    }
    const backBtn = event.target.closest('[data-mtm-back]');
    if (backBtn) {
      event.preventDefault();
      void renderListView();
    }
  });

  // Start with list view
  await renderListView();
}

