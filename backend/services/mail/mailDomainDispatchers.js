// services/mail/mailDomainDispatchers.js
// Sprint F3B — Split de mailService (extraction PUREMENT STRUCTURELLE, comportement
// identique). Bloc déplacé verbatim depuis services/mailService.js ; seuls les imports/exports
// et les chemins des imports dynamiques ont été adaptés au nouvel emplacement.

import Sale from '../../models/Sale.js';
import crypto from 'node:crypto';
import { resolvePublicBaseUrl } from '../system/domainResolver.js';
import { resolveFrontendUrl } from '../system/frontendUrl.js';
import { formatAmount, withMailThemeVars, stripHtml, replaceTemplateVariables, maskEmail } from './mailRenderer.js';
import { loadTemplate } from './mailTemplateRuntime.js';
import { postToBrevo } from './mailBrevoGateway.js';
// S1B — Expéditeur résolu via CommunicationIdentity (module dédié, testable).
import { buildSender, buildSenderForRole } from './mailSenderResolver.js';





function buildPasswordResetLink(token) {
  if (!token) {
    return resolvePublicBaseUrl();
  }
  // RX-GO-2 — flag-aware : Vanilla (/reset-password) tant que OFF ; /app/reinitialiser-mot-de-passe quand ON.
  return resolveFrontendUrl('password-reset', { token });
}

function buildInvoiceDownloadUrl(invoiceToken) {
  if (!invoiceToken) {
    return '';
  }
  // RX-GO-2 — flag-aware : Vanilla (slug=invoice) tant que REACT_OFFICIAL_FRONTEND=OFF ; /app/invoice/:token quand ON.
  return resolveFrontendUrl('invoice', { token: invoiceToken });
}

async function pickRandomSale() {

  const results = await Sale.aggregate([{ $sample: { size: 1 } }]);

  return Array.isArray(results) && results.length ? results[0] : null;

}



async function sendSaleEmail(sale) {

  try {

    if (!sale) {

      return false;

    }

    const customer = sale.customer || {};

    const recipient = String(customer.email || '').trim();

    if (!recipient) {

      console.warn("[mailService] Pas d'email client pour la vente", sale.saleId);

      return false;

    }

    const template = await loadTemplate('vente');

    if (!template) {

      console.warn('[mailService] Template "vente" introuvable');

      return false;

    }

    const saleId = String(sale.saleId || '');

    if (!saleId) {

      console.warn('[mailService] Vente sans saleId, email ignorÃ©');

      return false;

    }
    let invoiceToken = String(sale.invoiceToken || '').trim();

    if (!invoiceToken) {

      const generatedToken = crypto.randomBytes(24).toString('hex');

      const updatedSale = await Sale.findOneAndUpdate(

        { saleId },

        { $set: { invoiceToken: generatedToken } },

        { new: true }

      ).lean();

      invoiceToken = String(updatedSale?.invoiceToken || generatedToken).trim();

    }

    const downloadUrl = buildInvoiceDownloadUrl(invoiceToken);

    if (!downloadUrl) {

      console.warn('[mailService] Lien facture indisponible pour la vente', saleId);

      return false;

    }

    const sender = await buildSender();

    if (!sender) {

      console.warn('[mailService] SENDER_NOT_CONFIGURED: aucune identite expeditrice verifiee, email non envoye');

      return;

    }

    const payloadData = await withMailThemeVars({

      saleid: saleId,

      firstname: customer.firstName || '',

      lastname: customer.lastName || '',

      amount: sale.totalAmount || 0,

      invoicepageurl: downloadUrl,

      invoicedownloadurl: downloadUrl

    });

    const subject = replaceTemplateVariables(template.subject, payloadData) || template.subject;

    const htmlTemplate = template.fullHtml || template.bodyHtml || '';

    const htmlContent = htmlTemplate ? replaceTemplateVariables(htmlTemplate, payloadData, { html: true }) || htmlTemplate : '';

    let textTemplate = template.bodyHtml || '';

    if (!textTemplate && template.fullHtml) {

      textTemplate = stripHtml(template.fullHtml);

    }

    const textContent = textTemplate ? replaceTemplateVariables(textTemplate, payloadData) || textTemplate : '';

    const payload = {

      sender,

      to: [{ email: recipient }],

      subject,

      tags: ['transactional', 'vente']

    };

    if (htmlContent) {

      payload.htmlContent = htmlContent;

    }

    if (textContent) {

      payload.textContent = textContent;

    }

    // P0-2 — Ne jamais logguer le destinataire complet ni les variables (PII). Adresse masquée + booléens.
    console.log('[MailService] payload sent to Brevo:', {
      to: Array.isArray(payload.to) ? payload.to.map(maskEmail) : maskEmail(payload.to),
      subject: payload.subject,
      tags: payload.tags,
      htmlContent: Boolean(payload.htmlContent),
      textContent: Boolean(payload.textContent)
    });

    const success = await postToBrevo(payload, { contextType: 'sale', contextId: String(sale?.saleId || sale?._id || '') });

    if (success) {

      console.log('[mailService] Mail VENTE envoyÃ© pour', sale.saleId, 'Ã ', maskEmail(recipient));

    }

    return success;

  } catch (error) {

    console.error("[mailService] Impossible d'envoyer le mail VENTE", error);

    return false;

  }

}



// ---------------------------------------------------------------------------
// Helpers commissions (collecte des emails admins)
// ---------------------------------------------------------------------------

async function collectAdminAndDevEmails() {
  const { default: User } = await import('../../models/user.js');
  const users = await User.find({ role: { $in: ['admin'] } }).select('email').lean();
  const seen = new Set();
  const emails = [];
  for (const u of users) {
    const email = String(u?.email || '').trim();
    const lower = email.toLowerCase();
    if (!email || seen.has(lower)) continue;
    seen.add(lower);
    emails.push(email);
  }
  return emails;
}

// ---------------------------------------------------------------------------
// commission_available — commissions du mois disponibles
// ---------------------------------------------------------------------------
async function sendCommissionAvailableEmail({ toEmails, period, amount, daysTotal, platformUrl, context }) {
  try {
    const recipients = normalizeRecipientEmails(toEmails);
    if (!recipients.length) return false;
    return await sendStatusMail({
      templateKey: 'commission_available',
      fromRole: 'support',
      toEmails: recipients,
      templateVars: {
        period: String(period || ''),
        amount: String(amount || '0'),
        daystotal: String(daysTotal || ''),
        platformurl: String(platformUrl || '')
      },
      tag: 'commission_available',
      context
    });
  } catch (err) {
    console.error('[mailService] sendCommissionAvailableEmail error', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// commission_reminder — rappel de paiement
// ---------------------------------------------------------------------------
async function sendCommissionReminderEmail({ toEmails, period, amount, daysLeft, platformUrl, context }) {
  try {
    const recipients = normalizeRecipientEmails(toEmails);
    if (!recipients.length) return false;
    return await sendStatusMail({
      templateKey: 'commission_reminder',
      fromRole: 'support',
      toEmails: recipients,
      templateVars: {
        period: String(period || ''),
        amount: String(amount || '0'),
        daysleft: String(daysLeft ?? ''),
        platformurl: String(platformUrl || '')
      },
      tag: 'commission_reminder',
      context
    });
  } catch (err) {
    console.error('[mailService] sendCommissionReminderEmail error', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// commission_last_day — dernier jour pour payer
// ---------------------------------------------------------------------------
async function sendCommissionLastDayEmail({ toEmails, period, amount, platformUrl }) {
  try {
    const recipients = normalizeRecipientEmails(toEmails);
    if (!recipients.length) return false;
    return await sendStatusMail({
      templateKey: 'commission_last_day',
      fromRole: 'support',
      toEmails: recipients,
      templateVars: {
        period: String(period || ''),
        amount: String(amount || '0'),
        platformurl: String(platformUrl || '')
      },
      tag: 'commission_last_day'
    });
  } catch (err) {
    console.error('[mailService] sendCommissionLastDayEmail error', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// (legacy — supprimé, conservé temporairement pour ne pas casser les imports)
// ---------------------------------------------------------------------------
async function sendCommissionInvoiceEmail(invoice, invoiceDownloadUrl) {

  try {

    if (!invoice || !invoiceDownloadUrl) {

      console.warn('[mailService] Lien de téléchargement introuvable, envoi ignoré');

      return false;

    }

    console.log('[MailService] commission_invoice payload received:', {
      invoiceId: invoice._id,
      invoiceDownloadUrl,
      recipients: Array.isArray(invoice.emailRecipients) ? invoice.emailRecipients : []
    });

    const recipients = Array.isArray(invoice.emailRecipients) ? invoice.emailRecipients : [];

    const uniqueRecipients = [];

    const seen = new Set();

    for (const raw of recipients) {

      const candidate = String(raw || '').trim();

      if (!candidate) {

        continue;

      }

      const key = candidate.toLowerCase();

      if (seen.has(key)) {

        continue;

      }

      seen.add(key);

      uniqueRecipients.push(candidate);

    }

    if (!uniqueRecipients.length) {

      console.warn('[mailService] Aucune adresse destinataire pour la facture de commission', invoice.month || invoice._id);

      return false;

    }

    const template = await loadTemplate('commission_invoice');

    if (!template) {

      console.warn('[mailService] Template "commission_invoice" introuvable');

      return false;

    }

    const sender = await buildSender();

    if (!sender) {

      console.warn('[mailService] SENDER_NOT_CONFIGURED: aucune identite expeditrice verifiee, email non envoye');

      return false;

    }

    const payloadData = await withMailThemeVars({

      period: invoice.periodLabel || '',

      amount: invoice.totalCommissionAmount || 0,

      invoiceDownloadUrl,

      invoicedownloadurl: invoiceDownloadUrl

    });

    const subject = replaceTemplateVariables(template.subject, payloadData) || template.subject;

    const htmlTemplate = template.fullHtml || template.bodyHtml || '';

    const htmlContent = htmlTemplate

      ? replaceTemplateVariables(htmlTemplate, payloadData, { html: true }) || htmlTemplate

      : '';

    let textTemplate = template.bodyHtml || '';

    if (!textTemplate && template.fullHtml) {

      textTemplate = stripHtml(template.fullHtml);

    }

    const textContent = textTemplate

      ? replaceTemplateVariables(textTemplate, payloadData) || textTemplate

      : '';

    const payload = {

      sender,

      to: uniqueRecipients.map(email => ({ email })),

      subject,

      tags: ['transactional', 'commission_invoice']

    };

    if (htmlContent) {

      payload.htmlContent = htmlContent;

    }

    if (textContent) {

      payload.textContent = textContent;

    }

    const success = await postToBrevo(payload);

    if (success) {

      console.log('[mailService] Mail COMMISSION_INVOICE envoyé pour', invoice.month || invoice._id);

    }

    return success;

  } catch (error) {

    console.error("[mailService] Impossible d'envoyer le mail COMMISSION_INVOICE", error);

    return false;

  }

}



async function sendPasswordResetEmail(user, token) {

  try {

    if (!user || !token) {

      return false;

    }

    const recipient = String(user.email || '').trim();

    if (!recipient) {

      console.warn('[mailService] Aucun email utilisateur pour le reset de mot de passe', user?._id);

      return false;

    }

    const template = await loadTemplate('password_reset');

    if (!template) {

      console.warn('[mailService] Template "password_reset" introuvable');

      return false;

    }

    const sender = await buildSender();

    if (!sender) {

      console.warn('[mailService] SENDER_NOT_CONFIGURED: aucune identite expeditrice verifiee, email non envoye');

      return false;

    }

    const payloadData = await withMailThemeVars({

      firstname: user.firstName || '',

      lastname: user.lastName || '',

      link: buildPasswordResetLink(token)

    });

    const subject = replaceTemplateVariables(template.subject, payloadData) || template.subject;

    const htmlTemplate = template.fullHtml || template.bodyHtml || '';

    const htmlContent = htmlTemplate

      ? replaceTemplateVariables(htmlTemplate, payloadData, { html: true }) || htmlTemplate

      : '';

    let textTemplate = template.bodyHtml || '';

    if (!textTemplate && template.fullHtml) {

      textTemplate = stripHtml(template.fullHtml);

    }

    const textContent = textTemplate

      ? replaceTemplateVariables(textTemplate, payloadData) || textTemplate

      : '';

    const payload = {

      sender,

      to: [{ email: recipient }],

      subject,

      tags: ['transactional', 'password_reset']

    };

    if (htmlContent) {

      payload.htmlContent = htmlContent;

    }

    if (textContent) {

      payload.textContent = textContent;

    }

    const success = await postToBrevo(payload, { contextType: 'user', contextId: String(user?._id || '') || null });

    if (success) {

      console.log('[mailService] Mail PASSWORD_RESET envoyÃ© pour', user._id, 'Ã ', maskEmail(recipient));

    }

    return success;

  } catch (error) {

    console.error("[mailService] Impossible d'envoyer le mail PASSWORD_RESET", error);

    return false;

  }

}

async function sendEmailConfirmationCodeEmail({
  toEmail,
  firstName = '',
  email = '',
  code = '',
  expiresMinutes = 10
} = {}) {

  try {
    const recipient = String(toEmail || '').trim();
    const normalizedCode = String(code || '').trim();
    if (!recipient || !normalizedCode) {
      return false;
    }

    const template = await loadTemplate('email_confirmation_code');
    if (!template) {
      console.warn('[mailService] Template "email_confirmation_code" introuvable');
      return false;
    }

    const sender = await buildSender();
    if (!sender) {
      console.warn('[mailService] SENDER_NOT_CONFIGURED: aucune identite expeditrice verifiee, email non envoye');
      return false;
    }

    const payloadData = await withMailThemeVars({
      firstname: firstName || '',
      email: email || recipient,
      code: normalizedCode,
      expiresminutes: Number.isFinite(Number(expiresMinutes)) ? Number(expiresMinutes) : 10
    });

    const subject = replaceTemplateVariables(template.subject, payloadData) || template.subject;
    const htmlTemplate = template.fullHtml || template.bodyHtml || '';
    const htmlContent = htmlTemplate
      ? replaceTemplateVariables(htmlTemplate, payloadData, { html: true }) || htmlTemplate
      : '';
    let textTemplate = template.bodyHtml || '';
    if (!textTemplate && template.fullHtml) {
      textTemplate = stripHtml(template.fullHtml);
    }
    const textContent = textTemplate
      ? replaceTemplateVariables(textTemplate, payloadData) || textTemplate
      : '';

    const payload = {
      sender,
      to: [{ email: recipient }],
      subject,
      tags: ['transactional', 'email_confirmation_code']
    };
    if (htmlContent) payload.htmlContent = htmlContent;
    if (textContent) payload.textContent = textContent;

    const success = await postToBrevo(payload);
    if (success) {
      console.log('[mailService] Mail EMAIL_CONFIRMATION_CODE envoye a', maskEmail(recipient));
    }
    return success;
  } catch (error) {
    console.error('[mailService] Impossible d envoyer le mail EMAIL_CONFIRMATION_CODE', error);
    return false;
  }

}

function normalizeRecipientEmails(toEmails = []) {

  const unique = [];

  const seen = new Set();

  for (const raw of toEmails) {

    const email = String(raw || '').trim();

    const key = email.toLowerCase();

    if (!email || seen.has(key)) continue;

    seen.add(key);

    unique.push(email);

  }

  return unique;

}



// P1-1 — `fromRole` par défaut 'commerciale' (institut → client). Les appelants plateforme/technique
// (commission, incident de site) passent `fromRole: 'support'` pour honorer la conformité expéditeur.
async function sendStatusMail({ templateKey, toEmails, templateVars, tag, context, fromRole = 'commerciale' }) {

  const recipients = normalizeRecipientEmails(toEmails);

  if (!recipients.length) {

    console.warn('[mailService] Aucun destinataire pour', templateKey);

    return false;

  }

  const template = await loadTemplate(templateKey);

  if (!template) {

    console.warn('[mailService] Template introuvable', templateKey);

    return false;

  }

  const sender = await buildSenderForRole(fromRole);

  if (!sender) {

    console.warn('[mailService] SENDER_NOT_CONFIGURED: aucune identite expeditrice verifiee, email non envoye');

    return false;

  }

  const themedTemplateVars = await withMailThemeVars(templateVars);

  const subject = replaceTemplateVariables(template.subject, themedTemplateVars) || template.subject;

  const htmlTemplate = template.fullHtml || template.bodyHtml || '';

  const htmlContent = htmlTemplate

    ? replaceTemplateVariables(htmlTemplate, themedTemplateVars, { html: true }) || htmlTemplate

    : '';

  let textTemplate = template.bodyHtml || '';

  if (!textTemplate && template.fullHtml) {

    textTemplate = stripHtml(template.fullHtml);

  }

  const textContent = textTemplate

    ? replaceTemplateVariables(textTemplate, themedTemplateVars) || textTemplate

    : '';

  const payload = {

    sender,

    to: recipients.map(email => ({ email })),

    subject,

    tags: ['transactional', String(tag || templateKey).trim().toLowerCase()]

  };

  if (htmlContent) payload.htmlContent = htmlContent;

  if (textContent) payload.textContent = textContent;

  return postToBrevo(payload, context || {});

}



async function sendSiteSuspendedEmail({ toEmails = [], reason = '', date = '' } = {}) {

  try {

    return await sendStatusMail({

      templateKey: 'site_suspended',
      fromRole: 'support',

      toEmails,

      templateVars: { reason, date },

      tag: 'site_suspended'

    });

  } catch (error) {

    console.error('[mailService] Impossible d envoyer le mail SITE_SUSPENDED', error);

    return false;

  }

}



async function sendSiteReactivatedEmail({ toEmails = [], date = '' } = {}) {

  try {

    return await sendStatusMail({

      templateKey: 'site_reactivated',
      fromRole: 'support',

      toEmails,

      templateVars: { date },

      tag: 'site_reactivated'

    });

  } catch (error) {

    console.error('[mailService] Impossible d envoyer le mail SITE_REACTIVATED', error);

    return false;

  }

}

async function sendSiteMaintenanceStartEmail({
  toEmails = [],
  reason = '',
  eta = '',
  date = '',
  startedAt = ''
} = {}) {

  try {

    return await sendStatusMail({

      templateKey: 'site_maintenance_start',
      fromRole: 'support',

      toEmails,

      templateVars: { reason, eta, date, startedat: startedAt },

      tag: 'site_maintenance_start'

    });

  } catch (error) {

    console.error('[mailService] Impossible d envoyer le mail SITE_MAINTENANCE_START', error);

    return false;

  }

}

async function sendSiteMaintenanceEndEmail({
  toEmails = [],
  reason = '',
  eta = '',
  date = '',
  startedAt = ''
} = {}) {

  try {

    return await sendStatusMail({

      templateKey: 'site_maintenance_end',
      fromRole: 'support',

      toEmails,

      templateVars: { reason, eta, date, startedat: startedAt },

      tag: 'site_maintenance_end'

    });

  } catch (error) {

    console.error('[mailService] Impossible d envoyer le mail SITE_MAINTENANCE_END', error);

    return false;

  }

}



function isValidActionUrl(value) {

  const candidate = String(value || '').trim();

  if (!candidate) return false;

  try {

    const parsed = new URL(candidate);

    return parsed.protocol === 'http:' || parsed.protocol === 'https:';

  } catch (_error) {

    return false;

  }

}

async function sendSessionCancelledChoiceEmail({
  toEmail,
  siteName = 'Beauty Savage',
  firstName = '',
  lastName = '',
  formationTitle = '',
  sessionDateLabel = '',
  sessionTimeLabel = '',
  actionUrl = '',
  reason = '',
  year = new Date().getFullYear()
} = {}) {

  const recipient = String(toEmail || '').trim();
  if (!recipient) {
    return false;
  }

  if (!isValidActionUrl(actionUrl)) {
    console.warn('[mailService][DEV] session_cancelled_choice actionUrl invalide', {
      recipient,
      actionUrl
    });
    return false;
  }

  try {

    return await sendStatusMail({

      templateKey: 'session_cancelled_choice',

      toEmails: [recipient],

      templateVars: {
        sitename: siteName,
        firstname: firstName,
        lastname: lastName,
        formationtitle: formationTitle,
        sessiondatelabel: sessionDateLabel,
        sessiontimelabel: sessionTimeLabel,
        actionurl: actionUrl,
        reason,
        year
      },

      tag: 'session_cancelled_choice'

    });

  } catch (error) {

    console.error('[mailService] Impossible d envoyer le mail SESSION_CANCELLED_CHOICE', error);

    return false;

  }

}

async function sendSingleTemplateMail({
  templateKey,
  toEmail,
  templateVars = {},
  tag = '',
  context
} = {}) {
  const recipient = String(toEmail || '').trim();
  if (!recipient) return false;
  const actionUrl = String(templateVars?.actionurl || '').trim();
  if (actionUrl && !isValidActionUrl(actionUrl)) {
    console.warn('[mailService] actionUrl invalide', { templateKey, recipient: maskEmail(recipient), actionUrl });
    return false;
  }
  try {
    return await sendStatusMail({
      templateKey,
      toEmails: [recipient],
      templateVars,
      tag: tag || templateKey,
      context
    });
  } catch (error) {
    console.error('[mailService] Impossible d envoyer le mail', templateKey, error);
    return false;
  }
}

function buildCommonMailVars({
  siteName = 'Beauty Savage',
  instituteName = '',
  firstName = '',
  lastName = '',
  customerName = '',
  clientEmail = '',
  formationTitle = '',
  formationName = '',
  productName = '',
  sessionDateLabel = '',
  sessionTimeLabel = '',
  actionUrl = '',
  saleId = '',
  amountPaid = 0,
  refundAmount = 0,
  refundStatus = '',
  refundDateTime = '',
  refundId = '',
  reason = '',
  year = new Date().getFullYear(),
  giftCardCode = '',
  giftCardPassword = '',
  giftCardBalance = 0,
  trackingUrl = '',
  refundedAtFormatted = '',
  itemDetail = '',
  serviceName = '',
  bookingDate = '',
  bookingTime = '',
  practitionerName = ''
} = {}) {
  const fullNameFromParts = `${String(firstName || '').trim()} ${String(lastName || '').trim()}`.trim();
  const normalizedCustomerName =
    String(customerName || '').trim() ||
    fullNameFromParts ||
    String(clientEmail || '').trim();
  return {
    sitename: siteName,
    institutename: instituteName || siteName,
    firstname: firstName,
    lastname: lastName,
    customername: normalizedCustomerName,
    clientemail: clientEmail,
    formationtitle: formationTitle || formationName,
    formationname: formationName || formationTitle,
    productname: productName,
    sessiondatelabel: sessionDateLabel,
    sessiontimelabel: sessionTimeLabel,
    actionurl: actionUrl,
    saleid: saleId,
    amountpaid: amountPaid,
    refundamount: refundAmount,
    refundstatus: refundStatus,
    refunddatetime: refundDateTime,
    refundid: refundId,
    reason,
    year,
    giftcardcode: giftCardCode,
    giftcardpassword: giftCardPassword,
    giftcardbalance: giftCardBalance,
    trackingurl: trackingUrl,
    refundedatformatted: refundedAtFormatted,
    itemdetail: itemDetail || formationTitle || formationName || serviceName || '',
    servicename: serviceName,
    bookingdate: bookingDate,
    bookingtime: bookingTime,
    practitionername: practitionerName
  };
}

async function sendFormationDeletedChoiceEmail({
  toEmail,
  siteName = 'Beauty Savage',
  firstName = '',
  lastName = '',
  clientEmail = '',
  formationTitle = '',
  amountPaid = 0,
  saleId = '',
  actionUrl = '',
  reason = ''
} = {}) {
  return sendSingleTemplateMail({
    templateKey: 'formation_deleted_choice',
    toEmail,
    tag: 'formation_deleted_choice',
    templateVars: buildCommonMailVars({
      siteName,
      firstName,
      lastName,
      clientEmail,
      formationTitle,
      amountPaid,
      saleId,
      actionUrl,
      reason
    })
  });
}

async function sendSessionUpdatedChoiceEmail({
  toEmail,
  siteName = 'Beauty Savage',
  firstName = '',
  lastName = '',
  clientEmail = '',
  formationTitle = '',
  sessionDateLabel = '',
  sessionTimeLabel = '',
  saleId = '',
  actionUrl = '',
  reason = ''
} = {}) {
  return sendSingleTemplateMail({
    templateKey: 'session_updated_choice',
    toEmail,
    tag: 'session_updated_choice',
    templateVars: buildCommonMailVars({
      siteName,
      firstName,
      lastName,
      clientEmail,
      formationTitle,
      sessionDateLabel,
      sessionTimeLabel,
      saleId,
      actionUrl,
      reason
    })
  });
}

async function sendRefundRequestedEmail({
  toEmail,
  siteName = 'Beauty Savage',
  firstName = '',
  lastName = '',
  clientEmail = '',
  formationName = '',
  productName = '',
  amount = 0,
  refundId = '',
  refundStatus = 'requested',
  refundDateTime = '',
  saleId = '',
  trackingUrl = ''
} = {}) {
  return sendSingleTemplateMail({
    templateKey: 'refund_requested',
    toEmail,
    tag: 'refund_requested',
    templateVars: buildCommonMailVars({
      siteName,
      firstName,
      lastName,
      clientEmail,
      formationName,
      productName,
      refundAmount: amount,
      refundStatus,
      refundDateTime,
      refundId,
      saleId,
      trackingUrl
    })
  });
}

async function sendRefundAutoInitiatedEmail({
  toEmail,
  siteName = 'Beauty Savage',
  firstName = '',
  lastName = '',
  clientEmail = '',
  formationName = '',
  amount = 0,
  refundId = '',
  refundStatus = 'requested',
  refundDateTime = '',
  saleId = '',
  trackingUrl = ''
} = {}) {
  return sendSingleTemplateMail({
    templateKey: 'refund_auto_initiated',
    toEmail,
    tag: 'refund_auto_initiated',
    templateVars: buildCommonMailVars({
      siteName,
      firstName,
      lastName,
      clientEmail,
      formationName,
      refundAmount: amount,
      refundStatus,
      refundDateTime,
      refundId,
      saleId,
      trackingUrl
    })
  });
}

async function sendRefundConfirmedEmail({
  toEmail,
  siteName = 'Beauty Savage',
  firstName = '',
  lastName = '',
  formationName = '',
  itemDetail = '',
  isService = false,
  serviceName = '',
  bookingDate = '',
  bookingTime = '',
  practitionerName = '',
  amount = 0,
  refundId = '',
  refundedAt = '',
  giftCardRecredited = false,
  giftCardRecreditAmount = 0,
  trackingUrl = ''
} = {}) {
  if (!toEmail) return false;
  const giftCardNote = giftCardRecredited && giftCardRecreditAmount > 0
    ? `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(giftCardRecreditAmount)} EUR ont également été recrédités sur votre carte cadeau.`
    : '';

  const templateKey = isService ? 'refund_confirmed_service' : 'refund_confirmed';
  const tag = isService ? 'refund_confirmed_service' : 'refund_confirmed';

  if (isService) {
    const refundAmountStr = amount > 0
      ? `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} €`
      : '';
    return sendSingleTemplateMail({
      templateKey,
      toEmail,
      tag,
      context: { contextType: 'refund_request', contextId: String(refundId || '') || null },
      templateVars: buildCommonMailVars({
        siteName,
        firstName,
        lastName,
        serviceName,
        bookingDate,
        bookingTime,
        practitionerName,
        refundAmount: refundAmountStr,
        refundDateTime: refundedAt,
        refundId,
        trackingUrl
      })
    });
  }

  return sendSingleTemplateMail({
    templateKey,
    toEmail,
    tag,
    context: { contextType: 'refund_request', contextId: String(refundId || '') || null },
    templateVars: buildCommonMailVars({
      siteName,
      firstName,
      lastName,
      formationName: isService ? '' : formationName,
      refundAmount: amount,
      refundId,
      refundedAtFormatted: refundedAt,
      giftCardBalance: giftCardNote,
      trackingUrl,
      itemDetail: itemDetail || formationName,
      serviceName: '',
      bookingDate: '',
      bookingTime: ''
    })
  });
}

async function sendSessionRescheduledEmail({
  toEmail,
  siteName = 'Beauty Savage',
  firstName = '',
  lastName = '',
  clientEmail = '',
  formationName = '',
  sessionDateLabel = '',
  sessionTimeLabel = '',
  saleId = ''
} = {}) {
  return sendSingleTemplateMail({
    templateKey: 'session_rescheduled',
    toEmail,
    tag: 'session_rescheduled',
    templateVars: buildCommonMailVars({
      siteName,
      firstName,
      lastName,
      clientEmail,
      formationName,
      sessionDateLabel,
      sessionTimeLabel,
      saleId
    })
  });

}

async function sendClientSessionCancellationEmail({
  toEmail,
  siteName = 'Beauty Savage',
  firstName = '',
  lastName = '',
  clientEmail = '',
  formationTitle = '',
  sessionDateLabel = '',
  sessionTimeLabel = '',
  saleId = '',
  amountPaid = 0,
  refundAmount = 0,
  refundStatus = '',
  trackingUrl = '',
  eligibleRefund = false
} = {}) {
  return sendSingleTemplateMail({
    templateKey: eligibleRefund
      ? 'session_client_cancelled_refund'
      : 'session_client_cancelled_no_refund',
    toEmail,
    tag: eligibleRefund ? 'session_client_cancelled_refund' : 'session_client_cancelled_no_refund',
    templateVars: buildCommonMailVars({
      siteName,
      firstName,
      lastName,
      clientEmail,
      formationTitle,
      sessionDateLabel,
      sessionTimeLabel,
      saleId,
      amountPaid,
      refundAmount,
      refundStatus: refundStatus || (eligibleRefund ? 'eligible' : 'non_eligible'),
      trackingUrl
    })
  });
}

async function sendInstituteClientCancelledNoticeEmail({
  toEmails = [],
  siteName = 'Beauty Savage',
  customerName = '',
  clientEmail = '',
  formationTitle = '',
  sessionDateLabel = '',
  sessionTimeLabel = '',
  saleId = '',
  amountPaid = 0,
  eligibleRefund = false,
  reason = ''
} = {}) {
  const recipients = normalizeRecipientEmails(toEmails);
  if (!recipients.length) return false;
  try {
    return await sendStatusMail({
      templateKey: 'institute_client_cancelled_notice',
      toEmails: recipients,
      tag: 'institute_client_cancelled_notice',
      templateVars: buildCommonMailVars({
        siteName,
        customerName,
        clientEmail,
        formationTitle,
        sessionDateLabel,
        sessionTimeLabel,
        saleId,
        amountPaid,
        refundStatus: eligibleRefund ? 'eligible' : 'non_eligible',
        reason
      })
    });
  } catch (error) {
    console.error('[mailService] Impossible d envoyer le mail INSTITUTE_CLIENT_CANCELLED_NOTICE', error);
    return false;
  }
}

async function sendGiftCardCompensationEmail({
  toEmail,
  siteName = 'Beauty Savage',
  firstName = '',
  lastName = '',
  clientEmail = '',
  formationTitle = '',
  saleId = '',
  amountPaid = 0,
  giftCardCode = '',
  giftCardPassword = '',
  giftCardBalance = 0
} = {}) {
  return sendSingleTemplateMail({
    templateKey: 'gift_card_compensation',
    toEmail,
    tag: 'gift_card_compensation',
    templateVars: buildCommonMailVars({
      siteName,
      firstName,
      lastName,
      clientEmail,
      formationTitle,
      saleId,
      amountPaid,
      giftCardCode,
      giftCardPassword,
      giftCardBalance
    })
  });
}

// ─── Booking emails ────────────────────────────────────────────────────────

function escapeBookingHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendPremiumHtmlEmail({ toEmail, subject, htmlContent, tag = 'booking', context }) {
  const recipient = String(toEmail || '').trim();
  if (!recipient) return false;
  const sender = await buildSender();
  if (!sender) return false;
  const payload = {
    sender,
    to: [{ email: recipient }],
    subject,
    htmlContent,
    tags: ['transactional', tag]
  };
  return postToBrevo(payload, context || {});
}

async function sendBookingConfirmedEmail({ booking } = {}) {
  const toEmail = booking?.clientId?.email;
  if (!toEmail) return false;
  try {
    const service = booking.serviceId;
    const practitioner = booking.practitionerId;
    const client = booking.clientId;
    const startAt = booking.startAt ? new Date(booking.startAt) : null;

    const bookingDate = startAt
      ? startAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : '';
    const bookingTime = startAt
      ? startAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : '';

    const isDeposit = booking.paymentType === 'deposit';
    const paymentType = isDeposit ? 'Acompte' : 'Paiement complet';
    const depositAmount = isDeposit && booking.depositAmount != null
      ? `${Number(booking.depositAmount).toFixed(2)} €`
      : '';
    const remainingAmount = isDeposit && booking.totalPrice != null && booking.depositAmount != null
      ? `${(Number(booking.totalPrice) - Number(booking.depositAmount)).toFixed(2)} €`
      : '';

    const template = await loadTemplate('booking_confirmed');

    if (!template) {
      console.warn('[mailService] Template "booking_confirmed" introuvable');
      return false;
    }

    const sender = await buildSender();
    if (!sender) {
      console.warn('[mailService] SENDER_NOT_CONFIGURED: aucune identite expeditrice verifiee, email non envoye');
      return false;
    }

    const variables = await withMailThemeVars({
      firstname: client?.firstName || '',
      lastname: client?.lastName || '',
      sitename: 'Beauty Savage',
      servicename: service?.name || 'Prestation',
      bookingdate: bookingDate,
      bookingtime: bookingTime,
      bookingdatetime: bookingDate && bookingTime ? `${bookingDate} à ${bookingTime}` : '',
      practitionername: practitioner?.displayName || '',
      cancellationdays: String(booking.cancellationPolicySnapshot?.cancellationDays ?? 7),
      timelabel: '',
      bookingid: booking.bookingId || '',
      paymenttype: paymentType,
      depositamount: depositAmount,
      remainingamount: remainingAmount
    });

    const subject = replaceTemplateVariables(template.subject, variables) || template.subject;
    const htmlTemplate = template.fullHtml || template.bodyHtml || '';
    const htmlContent = htmlTemplate ? replaceTemplateVariables(htmlTemplate, variables, { html: true }) || htmlTemplate : '';
    let textTemplate = template.bodyHtml || '';
    if (!textTemplate && template.fullHtml) {
      textTemplate = stripHtml(template.fullHtml);
    }
    const textContent = textTemplate ? replaceTemplateVariables(textTemplate, variables) || textTemplate : '';

    const payload = {
      sender,
      to: [{ email: String(toEmail).trim() }],
      subject,
      tags: ['transactional', 'booking_confirmed']
    };
    if (htmlContent) payload.htmlContent = htmlContent;
    if (textContent) payload.textContent = textContent;

    const success = await postToBrevo(payload, { contextType: 'service_booking', contextId: String(booking?._id || '') });
    if (success) {
      console.log('[mailService] Mail BOOKING_CONFIRMED envoyé à', toEmail);
    }
    return success;
  } catch (err) {
    console.error('[mailService] sendBookingConfirmedEmail error', err);
    return false;
  }
}

async function sendServiceCancellationChoiceEmail({
  toEmail,
  siteName = 'Beauty Savage',
  firstName = '',
  serviceName = '',
  bookingDate = '',
  bookingTime = '',
  actionUrl = '',
  autoRefundDays = 7
} = {}) {
  const recipient = String(toEmail || '').trim();
  if (!recipient) return false;
  if (!isValidActionUrl(actionUrl)) {
    console.warn('[mailService] sendServiceCancellationChoiceEmail actionUrl invalide', {
      recipient,
      actionUrl
    });
    return false;
  }
  try {
    return await sendStatusMail({
      templateKey: 'service_booking_cancelled_choice',
      toEmails: [recipient],
      templateVars: {
        sitename: siteName,
        firstname: firstName,
        servicename: serviceName,
        bookingdate: bookingDate,
        bookingtime: bookingTime,
        actionurl: actionUrl,
        autorefunddays: String(autoRefundDays)
      },
      tag: 'service_booking_cancelled_choice'
    });
  } catch (error) {
    console.error('[mailService] sendServiceCancellationChoiceEmail error', error);
    return false;
  }
}

async function sendServiceRescheduledAdminEmail({
  practitionerEmail,
  practitionerFirstName = '',
  clientName = '',
  clientEmail = '',
  serviceName = '',
  oldBookingDate = '',
  oldBookingTime = '',
  newBookingDate = '',
  newBookingTime = ''
} = {}) {
  const recipient = String(practitionerEmail || '').trim();
  if (!recipient) return false;
  try {
    return await sendStatusMail({
      templateKey: 'service_booking_rescheduled_admin',
      toEmails: [recipient],
      templateVars: {
        firstname: practitionerFirstName,
        clientname: clientName,
        clientemail: clientEmail,
        servicename: serviceName,
        oldbookingdate: oldBookingDate,
        oldbookingtime: oldBookingTime,
        newbookingdate: newBookingDate,
        newbookingtime: newBookingTime
      },
      tag: 'service_booking_rescheduled_admin'
    });
  } catch (error) {
    console.error('[mailService] sendServiceRescheduledAdminEmail error', error);
    return false;
  }
}

async function sendBookingCancelledEmail({
  booking,
  eligibleRefund = false,
  refundAmount = 0,
  refundRequest = null,
  waiverSigned = false
} = {}) {
  const toEmail = booking?.clientId?.email || (typeof booking?.clientId === 'string' ? null : null);
  if (!toEmail) return false;
  try {
    const service = booking.serviceId;
    const practitioner = booking.practitionerId;
    const client = booking.clientId;
    const startAt = booking.startAt ? new Date(booking.startAt) : null;

    const bookingDate = startAt
      ? startAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : '';
    const bookingTime = startAt
      ? startAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : '';

    const refundAmountStr = refundAmount > 0 ? `${formatAmount(refundAmount)} €` : '';

    const trackingLinkHtml = refundRequest?.trackingToken
      ? `<p style="margin:8px 0 0"><a href="${resolveFrontendUrl('refund-tracking', { token: refundRequest.trackingToken })}" style="color:#166534">Suivre mon remboursement →</a></p>`
      : '';

    let templateName;
    if (eligibleRefund) {
      templateName = 'booking_cancelled_refundable';
    } else if (waiverSigned) {
      templateName = 'booking_cancelled_not_refundable_waiver';
    } else {
      templateName = 'booking_cancelled_not_refundable_delay';
    }

    const template = await loadTemplate(templateName);
    if (!template) {
      console.warn(`[mailService] Template "${templateName}" introuvable`);
      return false;
    }

    const sender = await buildSender();
    if (!sender) {
      console.warn('[mailService] SENDER_NOT_CONFIGURED: aucune identite expeditrice verifiee, email non envoye');
      return false;
    }

    const variables = await withMailThemeVars({
      firstname: client?.firstName || '',
      lastname: client?.lastName || '',
      sitename: 'Beauty Savage',
      servicename: service?.name || 'Prestation',
      bookingdate: bookingDate,
      bookingtime: bookingTime,
      practitionername: practitioner?.displayName || '',
      refundamount: refundAmountStr,
      trackingurl: trackingLinkHtml,
      cancellationdays: String(booking.consumerWaiverSnapshot?.refundDays ?? 7),
      bookingid: booking.bookingId || ''
    });

    const subject = replaceTemplateVariables(template.subject, variables) || template.subject;
    const htmlTemplate = template.fullHtml || template.bodyHtml || '';
    const htmlContent = htmlTemplate ? replaceTemplateVariables(htmlTemplate, variables, { html: true }) || htmlTemplate : '';
    let textTemplate = template.bodyHtml || '';
    if (!textTemplate && template.fullHtml) {
      textTemplate = stripHtml(template.fullHtml);
    }
    const textContent = textTemplate ? replaceTemplateVariables(textTemplate, variables) || textTemplate : '';

    const payload = {
      sender,
      to: [{ email: String(toEmail).trim() }],
      subject,
      tags: ['transactional', templateName]
    };
    if (htmlContent) payload.htmlContent = htmlContent;
    if (textContent) payload.textContent = textContent;

    const success = await postToBrevo(payload);
    if (success) {
      console.log(`[mailService] Mail ${templateName.toUpperCase()} envoyé à`, toEmail);
    }
    return success;
  } catch (err) {
    console.error('[mailService] sendBookingCancelledEmail error', err);
    return false;
  }
}

async function sendBookingCancelledNotifyAdminEmail({
  booking,
  eligibleRefund = false,
  refundAmount = 0,
  refundRequest = null
} = {}) {
  try {
    // Récupérer l'email de la praticienne de la réservation
    const { default: PractitionerProfile } = await import('../../models/PractitionerProfile.js');
    const profile = await PractitionerProfile.findById(booking.practitionerId)
      .populate('userId', 'email firstName lastName').lean();
    const practitionerEmail = profile?.userId?.email;
    if (!practitionerEmail) {
      console.warn('[mailService] sendBookingCancelledNotifyAdminEmail: praticienne sans email, email ignoré');
      return false;
    }

    // Récupérer le client depuis la DB pour avoir nom + email exacts
    const { default: User } = await import('../../models/user.js');
    const client = await User.findById(booking.clientId).select('email firstName lastName').lean();
    const clientFullName = client
      ? `${client.firstName || ''} ${client.lastName || ''}`.trim()
      : '';
    const customerName = clientFullName || client?.email || 'Client inconnu';
    const clientEmail = client?.email || '';

    const service = booking.serviceId;
    const practitioner = booking.practitionerId;
    const startAt = booking.startAt ? new Date(booking.startAt) : null;

    const bookingDate = startAt
      ? startAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : '';
    const bookingTime = startAt
      ? startAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : '';

    const refundAmountStr = eligibleRefund && refundAmount > 0 ? `${formatAmount(refundAmount)} €` : '';

    const refundSection = eligibleRefund && refundAmount > 0
      ? `Un remboursement de <strong>${formatAmount(refundAmount)} €</strong> sera traité dans les prochains jours ouvrés.`
      : eligibleRefund
        ? 'Un remboursement sera traité dans les prochains jours ouvrés.'
        : 'Cette annulation ne donne pas lieu à un remboursement.';

    // practitionerName depuis le profil populé ou le champ displayName si déjà populé
    const practitionerDisplayName = profile?.displayName || practitioner?.displayName || '';

    const template = await loadTemplate('booking_cancelled_notify_admin');
    if (!template) {
      console.warn('[mailService] Template "booking_cancelled_notify_admin" introuvable');
      return false;
    }

    const sender = await buildSender();
    if (!sender) {
      console.warn('[mailService] SENDER_NOT_CONFIGURED: aucune identite expeditrice verifiee, email non envoye');
      return false;
    }

    const variables = await withMailThemeVars({
      customername: customerName,
      clientemail: clientEmail,
      sitename: 'Beauty Savage',
      servicename: service?.name || 'Prestation',
      bookingdate: bookingDate,
      bookingtime: bookingTime,
      practitionername: practitionerDisplayName,
      refundsection: refundSection,
      refundamount: refundAmountStr
    });

    const subject = replaceTemplateVariables(template.subject, variables) || template.subject;
    const htmlTemplate = template.fullHtml || template.bodyHtml || '';
    const htmlContent = htmlTemplate ? replaceTemplateVariables(htmlTemplate, variables, { html: true }) || htmlTemplate : '';
    let textTemplate = template.bodyHtml || '';
    if (!textTemplate && template.fullHtml) {
      textTemplate = stripHtml(template.fullHtml);
    }
    const textContent = textTemplate ? replaceTemplateVariables(textTemplate, variables) || textTemplate : '';

    const payload = {
      sender,
      to: [{ email: practitionerEmail }],
      subject,
      tags: ['transactional', 'booking_cancelled_notify_admin']
    };
    if (htmlContent) payload.htmlContent = htmlContent;
    if (textContent) payload.textContent = textContent;
    const ok = await postToBrevo(payload);
    if (ok) {
      console.log('[mailService] Mail BOOKING_CANCELLED_NOTIFY_ADMIN envoyé à praticienne', practitionerEmail);
    }
    return ok;
  } catch (err) {
    console.error('[mailService] sendBookingCancelledNotifyAdminEmail error', err);
    return false;
  }
}

async function sendBookingCancelledByAdminEmail({
  booking,
  eligibleRefund = false,
  refundAmount = 0,
  refundRequest = null,
  refundReason = ''
} = {}) {
  const toEmail = booking?.clientId?.email;
  if (!toEmail) return false;
  try {
    const service = booking.serviceId;
    const practitioner = booking.practitionerId;
    const client = booking.clientId;
    const startAt = booking.startAt ? new Date(booking.startAt) : null;

    const bookingDate = startAt
      ? startAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : '';
    const bookingTime = startAt
      ? startAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : '';

    const refundAmountStr = refundAmount > 0 ? `${formatAmount(refundAmount)} €` : '';

    const trackingUrl = refundRequest?.trackingToken
      ? resolveFrontendUrl('refund-tracking', { token: refundRequest.trackingToken })
      : '';

    const template = await loadTemplate('booking_cancelled_admin');
    if (!template) {
      console.warn('[mailService] Template "booking_cancelled_admin" introuvable');
      return false;
    }

    const sender = await buildSender();
    if (!sender) {
      console.warn('[mailService] SENDER_NOT_CONFIGURED: aucune identite expeditrice verifiee, email non envoye');
      return false;
    }

    const variables = await withMailThemeVars({
      firstname: client?.firstName || '',
      lastname: client?.lastName || '',
      sitename: 'Beauty Savage',
      servicename: service?.name || 'Prestation',
      bookingdate: bookingDate,
      bookingtime: bookingTime,
      practitionername: practitioner?.displayName || '',
      refundamount: refundAmountStr,
      refundreason: refundReason,
      trackingurl: trackingUrl
    });

    const subject = replaceTemplateVariables(template.subject, variables) || template.subject;
    const htmlTemplate = template.fullHtml || template.bodyHtml || '';
    const htmlContent = htmlTemplate ? replaceTemplateVariables(htmlTemplate, variables, { html: true }) || htmlTemplate : '';
    let textTemplate = template.bodyHtml || '';
    if (!textTemplate && template.fullHtml) {
      textTemplate = stripHtml(template.fullHtml);
    }
    const textContent = textTemplate ? replaceTemplateVariables(textTemplate, variables) || textTemplate : '';

    const payload = {
      sender,
      to: [{ email: String(toEmail).trim() }],
      subject,
      tags: ['transactional', 'booking_cancelled_admin']
    };
    if (htmlContent) payload.htmlContent = htmlContent;
    if (textContent) payload.textContent = textContent;

    const success = await postToBrevo(payload);
    if (success) {
      console.log('[mailService] Mail BOOKING_CANCELLED_ADMIN envoyé à', toEmail);
    }
    return success;
  } catch (err) {
    console.error('[mailService] sendBookingCancelledByAdminEmail error', err);
    return false;
  }
}

async function sendNoShowEmail({ booking } = {}) {
  const toEmail = booking?.clientId?.email;
  if (!toEmail) return false;
  try {
    const service = booking.serviceId;
    const client = booking.clientId;
    const startAt = booking.startAt ? new Date(booking.startAt) : null;

    const bookingDate = startAt
      ? startAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : '';
    const bookingTime = startAt
      ? startAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : '';

    const template = await loadTemplate('booking_no_show');
    if (!template) {
      console.warn('[mailService] Template "booking_no_show" introuvable');
      return false;
    }

    const sender = await buildSender();
    if (!sender) {
      console.warn('[mailService] SENDER_NOT_CONFIGURED: aucune identite expeditrice verifiee, email non envoye');
      return false;
    }

    const variables = await withMailThemeVars({
      firstname: client?.firstName || '',
      sitename: 'Beauty Savage',
      servicename: service?.name || 'Prestation',
      bookingdate: bookingDate,
      bookingtime: bookingTime
    });

    const subject = replaceTemplateVariables(template.subject, variables) || template.subject;
    const htmlTemplate = template.fullHtml || template.bodyHtml || '';
    const htmlContent = htmlTemplate ? replaceTemplateVariables(htmlTemplate, variables, { html: true }) || htmlTemplate : '';
    let textTemplate = template.bodyHtml || '';
    if (!textTemplate && template.fullHtml) {
      textTemplate = stripHtml(template.fullHtml);
    }
    const textContent = textTemplate ? replaceTemplateVariables(textTemplate, variables) || textTemplate : '';

    const payload = {
      sender,
      to: [{ email: String(toEmail).trim() }],
      subject,
      tags: ['transactional', 'booking_no_show']
    };
    if (htmlContent) payload.htmlContent = htmlContent;
    if (textContent) payload.textContent = textContent;

    const success = await postToBrevo(payload);
    if (success) {
      console.log('[mailService] Mail BOOKING_NO_SHOW envoyé à', toEmail);
    }
    return success;
  } catch (err) {
    console.error('[mailService] sendNoShowEmail error', err);
    return false;
  }
}

async function sendBookingSuspendedEmail({
  toEmail,
  firstName = '',
  noShowCount = 0,
  suspensionThreshold = 0,
  instituteName = 'Beauty Savage'
} = {}) {
  if (!toEmail) return false;
  try {
    const template = await loadTemplate('booking_suspended');
    if (!template) {
      console.warn('[mailService] Template "booking_suspended" introuvable');
      return false;
    }

    const sender = await buildSender();
    if (!sender) {
      console.warn('[mailService] SENDER_NOT_CONFIGURED: aucune identite expeditrice verifiee, email non envoye');
      return false;
    }

    const variables = await withMailThemeVars({
      firstname: firstName,
      sitename: 'Beauty Savage',
      institutename: instituteName,
      noshowcount: String(noShowCount),
      suspensionthreshold: String(suspensionThreshold)
    });

    const subject = replaceTemplateVariables(template.subject, variables) || template.subject;
    const htmlTemplate = template.fullHtml || template.bodyHtml || '';
    const htmlContent = htmlTemplate ? replaceTemplateVariables(htmlTemplate, variables, { html: true }) || htmlTemplate : '';
    let textTemplate = template.bodyHtml || '';
    if (!textTemplate && template.fullHtml) {
      textTemplate = stripHtml(template.fullHtml);
    }
    const textContent = textTemplate ? replaceTemplateVariables(textTemplate, variables) || textTemplate : '';

    const payload = {
      sender,
      to: [{ email: String(toEmail).trim() }],
      subject,
      tags: ['transactional', 'booking_suspended']
    };
    if (htmlContent) payload.htmlContent = htmlContent;
    if (textContent) payload.textContent = textContent;

    const success = await postToBrevo(payload);
    if (success) {
      console.log('[mailService] Mail BOOKING_SUSPENDED envoyé à', toEmail);
    }
    return success;
  } catch (err) {
    console.error('[mailService] sendBookingSuspendedEmail error', err);
    return false;
  }
}

async function sendBookingReminderEmail({ booking, hoursAhead = 24 } = {}) {
  const toEmail = booking?.clientId?.email;
  if (!toEmail) return false;
  try {
    const service = booking.serviceId;
    const practitioner = booking.practitionerId;
    const client = booking.clientId;
    const startAt = booking.startAt ? new Date(booking.startAt) : null;

    const timeLabel = hoursAhead <= 24
      ? 'demain'
      : hoursAhead >= 48
        ? `dans ${Math.round(hoursAhead / 24)} jours`
        : `dans ${hoursAhead} heure${hoursAhead > 1 ? 's' : ''}`;

    const bookingDate = startAt
      ? startAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : '';
    const bookingTime = startAt
      ? startAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : '';

    const isDeposit = booking.paymentType === 'deposit';
    const paymentType = isDeposit ? 'Acompte' : 'Paiement complet';
    const depositAmount = isDeposit && booking.depositAmount != null
      ? `${Number(booking.depositAmount).toFixed(2)} €`
      : '';
    const remainingAmount = isDeposit && booking.totalPrice != null && booking.depositAmount != null
      ? `${(Number(booking.totalPrice) - Number(booking.depositAmount)).toFixed(2)} €`
      : '';

    const template = await loadTemplate('booking_reminder');

    if (!template) {
      console.warn('[mailService] Template "booking_reminder" introuvable');
      return false;
    }

    const sender = await buildSender();
    if (!sender) {
      console.warn('[mailService] SENDER_NOT_CONFIGURED: aucune identite expeditrice verifiee, email non envoye');
      return false;
    }

    const variables = await withMailThemeVars({
      firstname: client?.firstName || '',
      lastname: client?.lastName || '',
      sitename: 'Beauty Savage',
      servicename: service?.name || 'Prestation',
      bookingdate: bookingDate,
      bookingtime: bookingTime,
      bookingdatetime: bookingDate && bookingTime ? `${bookingDate} à ${bookingTime}` : '',
      practitionername: practitioner?.displayName || '',
      cancellationdays: String(booking.cancellationPolicySnapshot?.cancellationDays ?? 7),
      timelabel: timeLabel,
      bookingid: booking.bookingId || '',
      paymenttype: paymentType,
      depositamount: depositAmount,
      remainingamount: remainingAmount
    });

    const subject = replaceTemplateVariables(template.subject, variables) || template.subject;
    const htmlTemplate = template.fullHtml || template.bodyHtml || '';
    const htmlContent = htmlTemplate ? replaceTemplateVariables(htmlTemplate, variables, { html: true }) || htmlTemplate : '';
    let textTemplate = template.bodyHtml || '';
    if (!textTemplate && template.fullHtml) {
      textTemplate = stripHtml(template.fullHtml);
    }
    const textContent = textTemplate ? replaceTemplateVariables(textTemplate, variables) || textTemplate : '';

    const payload = {
      sender,
      to: [{ email: String(toEmail).trim() }],
      subject,
      tags: ['transactional', 'booking_reminder']
    };
    if (htmlContent) payload.htmlContent = htmlContent;
    if (textContent) payload.textContent = textContent;

    const success = await postToBrevo(payload);
    if (success) {
      console.log('[mailService] Mail BOOKING_REMINDER envoyé à', toEmail);
    }
    return success;
  } catch (err) {
    console.error('[mailService] sendBookingReminderEmail error', err);
    return false;
  }
}

async function simulateSaleEmail() {

  const sale = await pickRandomSale();

  if (!sale) {

    console.warn('[mailService] Aucune vente existante pour la simulation VENTE.');

    return { sale: null, success: false };

  }

  const success = await sendSaleEmail(sale);

  return { sale, success };

}




// ── LOT2 — Communications manquantes (P1-12). Envois directs commerciale → client, thin wrappers
// sur sendSingleTemplateMail (rendu + échappement + validation actionUrl inclus). Best-effort.
async function sendPaymentFailedEmail({ toEmail, firstName = '', itemDetail = '', amount = '', actionUrl = '' } = {}) {
  if (!toEmail) return false;
  return sendSingleTemplateMail({
    templateKey: 'payment_failed',
    toEmail,
    templateVars: { firstname: firstName, itemdetail: itemDetail, amount: String(amount), actionurl: actionUrl },
    tag: 'payment_failed',
    context: { contextType: 'payment' }
  });
}

async function sendRefundRefusedEmail({ toEmail, firstName = '', itemDetail = '', refundReason = '', actionUrl = '' } = {}) {
  if (!toEmail) return false;
  return sendSingleTemplateMail({
    templateKey: 'refund_refused',
    toEmail,
    templateVars: { firstname: firstName, itemdetail: itemDetail, refundreason: refundReason, actionurl: actionUrl },
    tag: 'refund_refused',
    context: { contextType: 'refund_request' }
  });
}

async function sendRefundFailedEmail({ toEmail, firstName = '', itemDetail = '', amount = '', actionUrl = '' } = {}) {
  if (!toEmail) return false;
  return sendSingleTemplateMail({
    templateKey: 'refund_failed',
    toEmail,
    templateVars: { firstname: firstName, itemdetail: itemDetail, amount: String(amount), actionurl: actionUrl },
    tag: 'refund_failed',
    context: { contextType: 'refund_request' }
  });
}

async function sendCertificateAvailableEmail({ toEmail, firstName = '', formationTitle = '', actionUrl = '' } = {}) {
  if (!toEmail) return false;
  return sendSingleTemplateMail({
    templateKey: 'training_certificate_available',
    toEmail,
    templateVars: { firstname: firstName, formationtitle: formationTitle, actionurl: actionUrl },
    tag: 'training_certificate_available',
    context: { contextType: 'formation' }
  });
}

async function sendFormationSessionReminderEmail({ toEmail, firstName = '', formationTitle = '', sessionDate = '', sessionTime = '', location = '', actionUrl = '' } = {}) {
  if (!toEmail) return false;
  return sendSingleTemplateMail({
    templateKey: 'formation_session_reminder',
    toEmail,
    templateVars: {
      firstname: firstName,
      formationtitle: formationTitle,
      sessiondate: sessionDate,
      sessiontime: sessionTime,
      location: location ? ` — ${location}` : '',
      actionurl: actionUrl
    },
    tag: 'formation_session_reminder',
    context: { contextType: 'formation_session' }
  });
}

export {
  buildSender,
  sendPaymentFailedEmail,
  sendRefundRefusedEmail,
  sendRefundFailedEmail,
  sendCertificateAvailableEmail,
  sendFormationSessionReminderEmail,
  buildPasswordResetLink,
  buildInvoiceDownloadUrl,
  pickRandomSale,
  sendSaleEmail,
  collectAdminAndDevEmails,
  sendCommissionAvailableEmail,
  sendCommissionReminderEmail,
  sendCommissionLastDayEmail,
  sendCommissionInvoiceEmail,
  sendPasswordResetEmail,
  sendEmailConfirmationCodeEmail,
  normalizeRecipientEmails,
  sendStatusMail,
  sendSiteSuspendedEmail,
  sendSiteReactivatedEmail,
  sendSiteMaintenanceStartEmail,
  sendSiteMaintenanceEndEmail,
  isValidActionUrl,
  sendSessionCancelledChoiceEmail,
  sendSingleTemplateMail,
  buildCommonMailVars,
  sendFormationDeletedChoiceEmail,
  sendSessionUpdatedChoiceEmail,
  sendRefundRequestedEmail,
  sendRefundAutoInitiatedEmail,
  sendRefundConfirmedEmail,
  sendSessionRescheduledEmail,
  sendClientSessionCancellationEmail,
  sendInstituteClientCancelledNoticeEmail,
  sendGiftCardCompensationEmail,
  escapeBookingHtml,
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
};
