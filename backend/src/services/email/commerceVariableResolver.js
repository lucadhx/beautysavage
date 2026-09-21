import { Customer } from '../../models/Customer.model.js';
import { CommerceSale } from '../../models/CommerceSale.model.js';
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
};
