import { Customer } from '../../models/Customer.model.js';
import { configuredSiteUrl } from '../../utils/siteOrigin.js';
import { CommerceSale } from '../../models/CommerceSale.model.js';
import { SystemConfiguration } from '../../models/SystemConfiguration.model.js';
import { getSingleton } from '../../utils/singleton.js';
import { EmailVariableResolverError } from './emailVariableResolvers.js';
import { EMAIL_DELIVERY_ERROR_CODES as D } from '../../utils/emailTemplateConstants.js';

const euro = (amountCents = 0) => ({
  amount: Number(amountCents || 0),
  currency: 'EUR',
});

async function customerVariables(customerId) {
  const customer = await Customer.findById(customerId).lean();
  if (!customer) {
    throw new EmailVariableResolverError(D.UNKNOWN_RESOLVER, 'Client introuvable pour cet e-mail.');
  }
  return {
    clientFirstName: customer.firstName || 'cliente',
    clientLastName: customer.lastName || '',
    clientEmail: customer.email,
  };
}

export async function resolveCustomerEmailVerification({ event }) {
  return {
    ...(await customerVariables(event?.entityId || event?.payloadSafe?.customerId)),
    verificationCode: event.payloadSafe.verificationPin,
    expiresAt: event.payloadSafe.expiresAt,
  };
}

export async function resolveCustomerPasswordReset({ event }) {
  return {
    ...(await customerVariables(event?.entityId || event?.payloadSafe?.customerId)),
    actionUrl: event.payloadSafe.actionUrl,
    expiresAt: event.payloadSafe.expiresAt,
  };
}

export async function resolveSaleConfirmationClient({ event }) {
  const sale = await CommerceSale.findById(event?.entityId || event?.payloadSafe?.saleId).lean();
  if (!sale) {
    throw new EmailVariableResolverError(D.UNKNOWN_RESOLVER, 'Vente introuvable pour la confirmation client.');
  }
  const itemsHtml = (sale.lines || [])
    .map((line) => `<li>${escapeHtml(line.productSnapshot?.title || 'Article')} x ${line.quantity || 1}</li>`)
    .join('');
  return {
    ...(await customerVariables(sale.customerId)),
    saleId: String(sale._id),
    saleNumber: sale.saleNumber,
    itemsHtml: `<ul>${itemsHtml}</ul>`,
    totalAmount: euro(sale.totalCents),
    ...(sale.invoice?.pdfUrl ? { invoiceUrl: sale.invoice.pdfUrl } : {}),
    paymentStatus: 'Payee',
  };
}

export async function resolveGiftCardIssuedClient({ event }) {
  const sale = await CommerceSale.findById(event?.entityId || event?.payloadSafe?.saleId).lean();
  return {
    ...(await customerVariables(event?.payloadSafe?.customerId || sale?.customerId)),
    saleId: event.payloadSafe.saleId,
    saleNumber: event.payloadSafe.saleNumber,
    giftCardCodeMasked: event.payloadSafe.giftCardCodeMasked,
    recipientName: event.payloadSafe.recipientName,
    amount: euro(event.payloadSafe.amount),
    balance: euro(event.payloadSafe.amount),
    ...(event.payloadSafe.giftCardPdfUrl ? { giftCardPdfUrl: event.payloadSafe.giftCardPdfUrl } : {}),
  };
}

export async function resolveAppointmentCancelledClient({ event }) {
  return {
    ...(await customerVariables(event?.payloadSafe?.customerId)),
    serviceName: event.payloadSafe.appointmentTitle,
    appointmentStart: event.payloadSafe.appointmentStart,
    appointmentEnd: event.payloadSafe.appointmentEnd,
    refundAmount: euro(event.payloadSafe.refundedAmount),
    reason: event.payloadSafe.reason || 'Annulation institut',
  };
}

/* -------------------------------------------------------------------------- */
/*  Liens                                                                     */
/* -------------------------------------------------------------------------- */

function originFromCors(predicate) {
  return (process.env.CORS_ORIGINS || '').split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .find((origin) => origin && origin.startsWith('https://') && predicate(origin)) || '';
}

/** L'espace client de la vitrine — là où la cliente retrouve RDV, formations, factures. */
async function customerAccountUrl(path = '/espace-client') {
  // L'adresse configurée de CETTE instance (recette ou production), jamais une adresse devinée.
  const site = await configuredSiteUrl() || originFromCors((o) => !o.includes('api.') && !o.includes('manager.'));
  return `${site}${path}`;
}

/**
 * Le Manager, pour les messages adressés à l'institut. Même source que les
 * autres liens Manager du projet (configuration réseau) ; à défaut, l'origine
 * Manager déclarée au CORS — jamais une adresse inventée.
 */
async function managerUrl(path) {
  const cfg = await getSingleton(SystemConfiguration);
  const base = (cfg?.network?.managerUrl || originFromCors((o) => o.includes('manager.'))).replace(/\/+$/, '');
  if (!base) {
    throw new EmailVariableResolverError(
      D.UNKNOWN_RESOLVER,
      "L'URL du Manager n'est pas configuree (Configuration systeme -> reseau) : impossible de construire le lien.",
    );
  }
  return `${base}${path}`;
}

async function customerIdentity(customerId) {
  const customer = await Customer.findById(customerId).lean();
  if (!customer) {
    throw new EmailVariableResolverError(D.UNKNOWN_RESOLVER, 'Client introuvable pour cet e-mail.');
  }
  return {
    clientName: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.email,
    clientEmail: customer.email,
  };
}

/* -------------------------------------------------------------------------- */
/*  Rendez-vous, compte, vente, formation                                     */
/* -------------------------------------------------------------------------- */

export async function resolveAppointmentConfirmedClient({ event }) {
  const p = event.payloadSafe;
  return {
    ...(await customerVariables(p.customerId)),
    serviceName: p.appointmentTitle,
    appointmentStart: p.appointmentStart,
    appointmentEnd: p.appointmentEnd,
    paidAmount: euro(p.paidAmount),
    balanceDueAmount: euro(p.balanceDueAmount),
    accountUrl: await customerAccountUrl(),
  };
}

export async function resolveCustomerAccountCreated({ event }) {
  return {
    ...(await customerVariables(event?.entityId || event?.payloadSafe?.customerId)),
    actionUrl: event.payloadSafe.actionUrl,
    expiresAt: event.payloadSafe.expiresAt,
  };
}

export async function resolveSaleAdminNotification({ event }) {
  const sale = await CommerceSale.findById(event?.entityId || event?.payloadSafe?.saleId).lean();
  if (!sale) {
    throw new EmailVariableResolverError(D.UNKNOWN_RESOLVER, 'Vente introuvable pour la notification institut.');
  }
  const itemsHtml = (sale.lines || [])
    .map((line) => `<li>${escapeHtml(line.productSnapshot?.title || 'Article')} x ${line.quantity || 1}</li>`)
    .join('');
  return {
    ...(await customerIdentity(sale.customerId)),
    saleNumber: sale.saleNumber,
    itemsHtml: `<ul>${itemsHtml}</ul>`,
    totalAmount: euro(sale.totalCents),
    managerSaleUrl: await managerUrl(`/commerce/ventes/${sale._id}`),
  };
}

export async function resolveTrainingSubmissionAdmin({ event }) {
  const p = event.payloadSafe;
  return {
    ...(await customerIdentity(p.customerId)),
    trainingTitle: p.trainingTitle,
    attemptLabel: `Tentative n°${p.attempt}`,
    scoreLabel: typeof p.scorePercent === 'number' ? `${p.scorePercent} %` : 'Sans questionnaire note',
    managerSubmissionUrl: await managerUrl(`/commerce/validation-formations/${p.submissionId}`),
  };
}

export async function resolveTrainingDecisionClient({ event }) {
  const p = event.payloadSafe;
  return {
    ...(await customerVariables(p.customerId)),
    trainingTitle: p.trainingTitle,
    // Une validation sans mot de la formatrice laisserait un cadre vide dans l'e-mail.
    comment: p.comment || (event.type === 'training.submission.validated'
      ? 'Bravo pour la qualite de votre travail.'
      : 'Ajustez votre dossier puis renvoyez-le.'),
    accountUrl: await customerAccountUrl('/espace-client/formations'),
  };
}

export async function resolveSessionRescheduledClient({ event }) {
  const p = event.payloadSafe;
  return {
    ...(await customerVariables(p.customerId)),
    trainingTitle: p.trainingTitle,
    previousStart: p.previousStart,
    newStart: p.newStart,
    newEnd: p.newEnd,
    location: p.location || 'Institut',
    message: p.message || 'Votre place est conservee a la nouvelle date. Si elle ne vous convient pas, repondez a cet e-mail.',
    accountUrl: await customerAccountUrl('/espace-client/formations'),
  };
}

export async function resolveSessionCancelledClient({ event }) {
  const p = event.payloadSafe;
  return {
    ...(await customerVariables(p.customerId)),
    trainingTitle: p.trainingTitle,
    sessionStart: p.sessionStart,
    reason: p.reason,
    refundAmount: euro(p.refundedAmount),
    accountUrl: await customerAccountUrl('/espace-client'),
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default {
  resolveCustomerEmailVerification,
  resolveCustomerPasswordReset,
  resolveSaleConfirmationClient,
  resolveGiftCardIssuedClient,
  resolveAppointmentCancelledClient,
  resolveAppointmentConfirmedClient,
  resolveCustomerAccountCreated,
  resolveSaleAdminNotification,
  resolveTrainingSubmissionAdmin,
  resolveTrainingDecisionClient,
  resolveSessionRescheduledClient,
  resolveSessionCancelledClient,
};
