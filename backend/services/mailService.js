// services/mailService.js
// Sprint F3B — FAÇADE de compatibilité. mailService (~3845 lignes) a été scindé en modules
// focalisés sous services/mail/ : mailRenderer (rendu/thème), mailTemplateRuntime (templates +
// load/save), mailBrevoGateway (postToBrevo), mailDomainDispatchers (fonctions métier send*),
// mailTrackingService (SendLog), mailContextResolver. Ce module re-exporte l'API publique
// historique inchangée (les importateurs et les tests qui mockent mailService restent valides).

import { TEMPLATE_FUNCTIONS, AVAILABLE_FUNCTIONS, loadTemplate, saveTemplate } from './mail/mailTemplateRuntime.js';
export { loadTemplate, saveTemplate } from './mail/mailTemplateRuntime.js';
export { postToBrevo } from './mail/mailBrevoGateway.js';
export {
  sendSaleEmail,
  sendPaymentFailedEmail,
  sendRefundRefusedEmail,
  sendRefundFailedEmail,
  sendCertificateAvailableEmail,
  sendFormationSessionReminderEmail,
  sendCommissionAvailableEmail,
  sendCommissionReminderEmail,
  sendCommissionLastDayEmail,
  sendCommissionInvoiceEmail,
  sendPasswordResetEmail,
  sendEmailConfirmationCodeEmail,
  sendStatusMail,
  sendSiteSuspendedEmail,
  sendSiteReactivatedEmail,
  sendSiteMaintenanceStartEmail,
  sendSiteMaintenanceEndEmail,
  sendSessionCancelledChoiceEmail,
  sendSingleTemplateMail,
  sendFormationDeletedChoiceEmail,
  sendSessionUpdatedChoiceEmail,
  sendRefundRequestedEmail,
  sendRefundAutoInitiatedEmail,
  sendRefundConfirmedEmail,
  sendSessionRescheduledEmail,
  sendClientSessionCancellationEmail,
  sendInstituteClientCancelledNoticeEmail,
  sendGiftCardCompensationEmail,
  sendPremiumHtmlEmail,
  sendBookingConfirmedEmail,
  sendServiceCancellationChoiceEmail,
  sendServiceRescheduledAdminEmail,
  sendBookingCancelledEmail,
  sendBookingCancelledNotifyAdminEmail,
  sendBookingCancelledByAdminEmail,
  sendNoShowEmail,
  sendBookingSuspendedEmail,
  sendBookingReminderEmail,
  simulateSaleEmail
} from './mail/mailDomainDispatchers.js';

export const mailTemplateDefaults = TEMPLATE_FUNCTIONS;
export const mailFunctions = Array.from(AVAILABLE_FUNCTIONS);
