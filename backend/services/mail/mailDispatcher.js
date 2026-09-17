// services/mail/mailDispatcher.js
// Pré-React E2 (refactor) — SEAM (couture) structurelle, sans modification de comportement.
// Point d'entrée unifié de l'envoi d'e-mails transactionnels. mailService.js (~3845 lignes)
// mélange aujourd'hui : runtime de templates, résolution de contexte, passerelle Brevo,
// tracking et dispatch. Ce module matérialise la frontière `services/mail/` (rapport 120) :
// les orchestrateurs importent les fonctions d'envoi ICI, ce qui permettra de scinder
// progressivement mailService (mailTemplateRuntime / mailContextResolver / mailBrevoGateway /
// mailTrackingService) sans toucher aux appelants. Aucune logique n'est déplacée pour l'instant.

export {
  // Ventes & factures
  sendSaleEmail,
  // Commissions (plateforme / dev account)
  sendCommissionAvailableEmail,
  sendCommissionReminderEmail,
  sendCommissionLastDayEmail,
  sendCommissionInvoiceEmail,
  // Comptes & sécurité
  sendPasswordResetEmail,
  sendEmailConfirmationCodeEmail,
  // Cycle de vie du site (maintenance / suspension)
  sendSiteSuspendedEmail,
  sendSiteReactivatedEmail,
  sendSiteMaintenanceStartEmail,
  sendSiteMaintenanceEndEmail,
  // Sessions de formation
  sendSessionCancelledChoiceEmail,
  sendFormationDeletedChoiceEmail,
  sendSessionUpdatedChoiceEmail,
  sendSessionRescheduledEmail,
  sendClientSessionCancellationEmail,
  sendInstituteClientCancelledNoticeEmail,
  // Remboursements
  sendRefundRequestedEmail,
  sendRefundAutoInitiatedEmail,
  sendRefundConfirmedEmail,
  sendGiftCardCompensationEmail,
  // Réservations de prestations
  sendBookingConfirmedEmail,
  sendServiceCancellationChoiceEmail,
  sendServiceRescheduledAdminEmail,
  sendBookingCancelledEmail,
  sendBookingCancelledNotifyAdminEmail,
  sendBookingCancelledByAdminEmail,
  sendNoShowEmail,
  sendBookingSuspendedEmail,
  sendBookingReminderEmail
} from '../mailService.js';
