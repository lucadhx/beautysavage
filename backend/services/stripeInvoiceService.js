import Invoice from '../models/Invoice.js';
import ServiceBooking from '../models/ServiceBooking.js';
import User from '../models/user.js';
import { getVendorConfig } from '../config/invoiceVendorConfig.js';
import { getStripeClient } from './stripe/stripeConfigService.js';
import { VAT_LEGAL_LABEL } from '../constants/tax.js';

// LOT1 — accès Stripe institut consolidé sur l'accesseur canonique `getStripeClient`.
const getStripe = getStripeClient;

function toCents(value) {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.round(amount * 100);
}

function resolveItemDescription(item = {}) {
  return String(item?.name || item?.title || item?.type || 'Article').trim() || 'Article';
}

function buildVendorAddress(vendor = {}) {
  const line1 = String(vendor?.address?.line1 || '').trim();
  const postalCode = String(vendor?.address?.postal_code || '').trim();
  const city = String(vendor?.address?.city || '').trim();
  return [line1, [postalCode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

function toStripeCustomFieldValue(value, fallback = '') {
  const normalized = String(value || '').trim();
  const safeValue = normalized || String(fallback || '').trim();
  return safeValue.slice(0, 40);
}

function buildStripeInvoiceIdempotencyPrefix(sale) {
  const saleId = String(sale?.saleId || '').trim() || String(sale?._id || '').trim();
  return saleId ? `stripe-invoice:${saleId}` : '';
}

function buildStripeInvoiceCreateIdempotencyKey(sale) {
  const prefix = buildStripeInvoiceIdempotencyPrefix(sale);
  return prefix ? `${prefix}:create` : '';
}

function buildStripeCustomerIdempotencyKey(user) {
  const userId = String(user?._id || '').trim();
  return userId ? `stripe-invoice:customer:${userId}` : '';
}

function buildStripeInvoiceLineIdempotencyKey(sale, lineType, lineIdentity, amount) {
  const prefix = buildStripeInvoiceIdempotencyPrefix(sale);
  if (!prefix) return '';
  const normalizedAmount = Number.isFinite(Number(amount)) ? Math.round(Number(amount)) : 0;
  return `${prefix}:${lineType}:${String(lineIdentity || '').trim() || 'line'}:${normalizedAmount}`;
}

function buildStripeInvoiceFinalizeIdempotencyKey(sale, suffix) {
  const prefix = buildStripeInvoiceIdempotencyPrefix(sale);
  return prefix ? `${prefix}:${suffix}` : '';
}

export async function createStripeInvoiceForSale(sale, user) {
  if (!sale?._id || !sale?.saleId) {
    return null;
  }
  if (!user?._id) {
    return null;
  }

  const existingInvoice = await Invoice.findOne({ saleId: String(sale.saleId) }).lean();
  if (existingInvoice?.stripeInvoiceId) {
    return existingInvoice;
  }

  const stripe = await getStripe();

  let customerId = String(user.stripeCustomerId || '').trim();
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: `${String(user.firstName || '').trim()} ${String(user.lastName || '').trim()}`.trim() || user.email,
      metadata: { userId: user._id.toString() }
    }, {
      idempotencyKey: buildStripeCustomerIdempotencyKey(user)
    });
    customerId = customer.id;
    await User.findByIdAndUpdate(user._id, { stripeCustomerId: customerId });
  }

  const vendor = getVendorConfig();
  const vendorAddress = buildVendorAddress(vendor);
  const vendorName = String(vendor.name || '').trim() || 'Beauty Savage';
  const vendorEmail = String(vendor.email || '').trim() || 'contact@beautysavage.fr';
  const vendorSiret = String(vendor.siret || '').trim() || 'Non renseigne';
  const vendorVatMention =
    String(vendor.vatMention || '').trim() || VAT_LEGAL_LABEL;
  const customFields = [
    {
      name: 'Vendeur',
      value: toStripeCustomFieldValue(`${vendorName} - ${vendorEmail}`, vendorName)
    },
    { name: 'SIRET', value: toStripeCustomFieldValue(vendorSiret, 'Non renseigne') },
    {
      name: 'Adresse',
      value: toStripeCustomFieldValue(vendorAddress, 'Adresse non renseignee')
    },
    {
      name: 'Mention TVA',
      value: toStripeCustomFieldValue(
        vendorVatMention,
        'TVA non applicable, article 293B du CGI'
      )
    }
  ];

  const invoice = await stripe.invoices.create({
    customer: customerId,
    currency: 'eur',
    auto_advance: false,
    collection_method: 'charge_automatically',
    description: `Achat Beauty Savage - ${sale._id}`,
    custom_fields: customFields,
    metadata: {
      saleId: sale._id.toString(),
      userId: user._id.toString()
    }
  }, {
    idempotencyKey: buildStripeInvoiceCreateIdempotencyKey(sale)
  });

  const isServiceSale = Array.isArray(sale.items) && sale.items.some(i => i.type === 'service');
  const serviceBookingDoc = isServiceSale
    ? await ServiceBooking.findOne({ saleId: String(sale.saleId) }).select('paymentType totalPrice depositAmount').lean()
    : null;
  const depositRatio = (
    serviceBookingDoc?.paymentType === 'deposit' &&
    serviceBookingDoc?.totalPrice > 0 &&
    Number.isFinite(Number(sale.totalAmount))
  )
    ? Number(sale.totalAmount) / serviceBookingDoc.totalPrice
    : 1;

  for (const [index, item] of Array.isArray(sale.items) ? sale.items.entries() : []) {
    const baseAmount = toCents(item?.finalPrice ?? item?.price ?? item?.basePrice ?? 0);
    const amount = depositRatio === 1 ? baseAmount : Math.round(baseAmount * depositRatio);
    if (amount <= 0) continue;
    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: invoice.id,
      description: resolveItemDescription(item),
      amount,
      currency: 'eur'
    }, {
      idempotencyKey: buildStripeInvoiceLineIdempotencyKey(
        sale,
        'item',
        `${item?.type || 'item'}:${item?.itemId || index}`,
        amount
      )
    });
  }

  if (Array.isArray(sale.giftCardUsage) && sale.giftCardUsage.length > 0) {
    const totalGiftCard = sale.giftCardUsage.reduce((sum, usage) => {
      const amountUsed = Number(usage?.amountUsed || 0);
      return sum + (Number.isFinite(amountUsed) ? amountUsed : 0);
    }, 0);
    if (totalGiftCard > 0) {
      await stripe.invoiceItems.create({
        customer: customerId,
        invoice: invoice.id,
        description: 'Carte cadeau utilisee',
        amount: -toCents(totalGiftCard),
        currency: 'eur'
      }, {
        idempotencyKey: buildStripeInvoiceLineIdempotencyKey(
          sale,
          'gift-card',
          sale.giftCardUsage.map(usage => `${usage?.giftCardId || usage?.code || 'gift-card'}`).join('|'),
          -toCents(totalGiftCard)
        )
      });
    }
  }

  const finalized = await stripe.invoices.finalizeInvoice(
    invoice.id,
    {},
    {
      idempotencyKey: buildStripeInvoiceFinalizeIdempotencyKey(sale, 'finalize')
    }
  );

  await stripe.invoices.pay(
    invoice.id,
    { paid_out_of_band: true },
    {
      idempotencyKey: buildStripeInvoiceFinalizeIdempotencyKey(sale, 'pay')
    }
  );

  return Invoice.findOneAndUpdate(
    { saleId: String(sale.saleId) },
    {
      $set: {
        userId: sale.userId,
        totalAmount: Number.isFinite(Number(sale.totalAmount)) ? Number(sale.totalAmount) : 0,
        invoiceDate: sale.createdAt ? new Date(sale.createdAt) : new Date(),
        status: 'finalized',
        stripeInvoiceId: finalized.id,
        stripeInvoiceNumber: finalized.number,
        stripeInvoicePdfUrl: finalized.invoice_pdf,
        stripeHostedUrl: finalized.hosted_invoice_url,
        // C2 — la facture Stripe attachée devient la facture officielle/fiscale.
        documentKind: 'stripe_official',
        official: true
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}
