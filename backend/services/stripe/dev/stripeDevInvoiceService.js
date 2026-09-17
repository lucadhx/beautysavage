// services/stripe/dev/stripeDevInvoiceService.js
// Sprint F2B — Extraction PUREMENT STRUCTURELLE de la facture Stripe Dev officielle des
// commissions mensuelles hors de commissionPaymentController. Aucune modification de
// comportement : `generateCommissionInvoice` déplacée verbatim.
//
// Le client Dev est importé du shim `utils/stripeDevClient` (accesseur mockable par les tests).
// Compte OPTIONNEL : sans client Dev, la génération est un no-op (comme l'historique).

import Contract from '../../../models/Contract.js';
import CommissionPayment from '../../../models/CommissionPayment.js';
import Sale from '../../../models/Sale.js';
import RefundRequest from '../../../models/RefundRequest.js';
import { getStripeDevClient } from '../../../utils/stripeDevClient.js';

// Noms de mois en français pour les labels
const MONTH_NAMES_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

export async function generateCommissionInvoice(commissionPayment) {
  const stripeDevClient = await getStripeDevClient();
  if (!stripeDevClient) return;

  const monthLabel = `${MONTH_NAMES_FR[commissionPayment.month]} ${commissionPayment.year}`;

  // Récupérer le customerId depuis le contrat actif
  const contract = await Contract.findOne({ status: 'active' }).lean();
  let customerId = contract?.monthlyFee?.stripeCustomerId;

  if (!customerId) {
    // Créer un customer de secours
    const customer = await stripeDevClient.customers.create({
      metadata: { context: 'commissions', month: String(commissionPayment.month), year: String(commissionPayment.year) }
    });
    customerId = customer.id;
  }

  // Créer la facture
  const invoice = await stripeDevClient.invoices.create({
    customer: customerId,
    auto_advance: false,
    currency: 'eur',
    description: `Commissions Beauty Savage — ${monthLabel}`,
    metadata: {
      commissionPaymentId: String(commissionPayment._id),
      month: String(commissionPayment.month),
      year: String(commissionPayment.year)
    }
  });

  // Résoudre les IDs custom (SALE-xxx, REF-xxx) depuis les _id MongoDB
  const saleMongoIds = (commissionPayment.sales || []).map(s => s.saleId).filter(Boolean);
  const refundMongoIds = (commissionPayment.refunds || []).map(r => r.refundId).filter(Boolean);

  const [populatedSales, populatedRefunds] = await Promise.all([
    saleMongoIds.length
      ? Sale.find({ _id: { $in: saleMongoIds } }).select({ saleId: 1 }).lean()
      : Promise.resolve([]),
    refundMongoIds.length
      ? RefundRequest.find({ _id: { $in: refundMongoIds } }).select({ refundId: 1 }).lean()
      : Promise.resolve([])
  ]);

  const saleIdMap = {};
  populatedSales.forEach(s => { saleIdMap[s._id.toString()] = s.saleId; });

  const refundIdMap = {};
  populatedRefunds.forEach(r => { refundIdMap[r._id.toString()] = r.refundId; });

  // Line items — ventes
  for (const sale of (commissionPayment.sales || [])) {
    const saleDateStr = sale.saleDate
      ? new Date(sale.saleDate).toLocaleDateString('fr-FR')
      : '—';
    const commissionLabel = sale.commissionType === 'percentage'
      ? `${sale.commissionRate}%`
      : `${sale.commissionRate} € fixe`;
    const customSaleId = saleIdMap[sale.saleId?.toString()] || sale.saleId;
    const desc = `${customSaleId} · ${sale.formationType || 'Formation'} · ${saleDateStr} · Commission ${commissionLabel}`;

    await stripeDevClient.invoiceItems.create({
      customer: customerId,
      invoice: invoice.id,
      description: desc,
      amount: Math.round((sale.commissionAmount || 0) * 100),
      currency: 'eur'
    });
  }

  // Line items — remboursements (négatifs)
  for (const refund of (commissionPayment.refunds || [])) {
    const refundDateStr = refund.refundedAt
      ? new Date(refund.refundedAt).toLocaleDateString('fr-FR')
      : '—';
    const commissionLabel = refund.commissionType === 'percentage'
      ? `${refund.commissionRate}%`
      : `${refund.commissionRate} € fixe`;
    const customRefundId = refundIdMap[refund.refundId?.toString()] || refund.refundId;
    const customSaleId = saleIdMap[refund.saleId?.toString()] || refund.saleId;
    const desc = `${customRefundId} → ${customSaleId} · ${refundDateStr} · Commission ${commissionLabel}`;

    await stripeDevClient.invoiceItems.create({
      customer: customerId,
      invoice: invoice.id,
      description: desc,
      amount: -Math.round((refund.commissionAmount || 0) * 100),
      currency: 'eur'
    });
  }

  // Finaliser et marquer payé hors-bande
  const finalized = await stripeDevClient.invoices.finalizeInvoice(invoice.id);
  await stripeDevClient.invoices.pay(invoice.id, { paid_out_of_band: true });

  // Persister les références
  await CommissionPayment.findByIdAndUpdate(commissionPayment._id, {
    stripeInvoiceId: finalized.id,
    stripeInvoicePdfUrl: finalized.invoice_pdf || null
  });
}
