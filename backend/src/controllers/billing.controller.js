import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, created } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { Contract } from '../models/Contract.model.js';
import { Payment } from '../models/Payment.model.js';
import { Invoice } from '../models/Invoice.model.js';
import * as billingSvc from '../services/billing.service.js';

/**
 * Facturation. L'ADMIN ne voit que ses données contractuelles (V1 mono-société :
 * tous les contrats non archivés lui appartiennent) ; le DEV a une vue globale.
 * Ne jamais exposer de clé, de donnée bancaire ni de secret : uniquement les
 * liens de facture HÉBERGÉS par Stripe et des montants.
 */

function serializePayment(p) {
  return {
    _id: p._id,
    contractId: p.contractId,
    type: p.type,
    status: p.status,
    amountExcludingTax: p.amountExcludingTax,
    taxAmount: p.taxAmount,
    amountIncludingTax: p.amountIncludingTax,
    currency: p.currency,
    paidAt: p.paidAt,
    failedAt: p.failedAt,
    refundedAt: p.refundedAt,
    createdAt: p.createdAt,
  };
}

function serializeInvoice(inv) {
  return {
    _id: inv._id,
    contractId: inv.contractId,
    number: inv.number,
    type: inv.type,
    amountExcludingTax: inv.amountExcludingTax,
    taxAmount: inv.taxAmount,
    amountIncludingTax: inv.amountIncludingTax,
    currency: inv.currency,
    status: inv.status,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    paidAt: inv.paidAt,
    hostedInvoiceUrl: inv.hostedInvoiceUrl, // lien Stripe (voir la facture hébergée)
    invoicePdfUrl: inv.invoicePdfUrl, // lien Stripe (télécharger le PDF)
    label: inv.label || '', // nom libre (rattachement manuel)
    addedManually: Boolean(inv.addedManually),
    createdAt: inv.createdAt,
  };
}

async function buildView(contractFilter) {
  const contracts = await Contract.find(contractFilter).sort({ createdAt: -1 });
  const ids = contracts.map((c) => c._id);
  const [payments, invoices] = await Promise.all([
    Payment.find({ contractId: { $in: ids } }).sort({ createdAt: -1 }),
    Invoice.find({ contractId: { $in: ids } }).sort({ createdAt: -1 }),
  ]);
  return contracts.map((c) => ({
    contractId: c._id,
    reference: c.reference,
    status: c.status,
    pricing: c.pricing,
    subscription: {
      status: c.stripe?.subscription?.status,
      currentPeriodEnd: c.stripe?.subscription?.currentPeriodEnd,
      cancelAtPeriodEnd: c.stripe?.subscription?.cancelAtPeriodEnd,
    },
    payments: payments.filter((p) => String(p.contractId) === String(c._id)).map(serializePayment),
    invoices: invoices.filter((i) => String(i.contractId) === String(c._id)).map(serializeInvoice),
  }));
}

/** ADMIN — ses factures (contrats non archivés). */
export const myInvoices = asyncHandler(async (req, res) => {
  return ok(res, await buildView({ archived: false }));
});

/** DEV — vue globale (tous contrats, y compris archivés). */
export const allInvoices = asyncHandler(async (req, res) => {
  return ok(res, await buildView({}));
});

/** Détail d'une facture. ADMIN limité à un contrat non archivé. */
export const getInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) throw ApiError.notFound('Facture introuvable.');
  if (req.user.role !== 'DEV') {
    const contract = await Contract.findById(invoice.contractId);
    if (!contract || contract.archived) throw ApiError.forbidden();
  }
  return ok(res, serializeInvoice(invoice));
});

/**
 * DEV — rattache une facture Stripe EXISTANTE à partir de son lien (ou de son
 * identifiant). Ne crée rien chez Stripe : la facture est lue puis reflétée.
 * Seul champ saisi : `label` (nom libre). Tout le reste est dérivé de Stripe.
 */
export const attachInvoice = asyncHandler(async (req, res) => {
  const { url, label } = req.body;
  const { invoice, created: isNew, contract } = await billingSvc.attachInvoiceFromUrl(url, { label });
  const payload = { invoice: serializeInvoice(invoice), created: isNew, reference: contract.reference };
  // 201 si la facture entre en base, 200 si elle y était déjà (rattachement idempotent).
  return isNew ? created(res, payload) : ok(res, payload);
});

/* ── PRESTATIONS À RÉGLER (L10.5) ─────────────────────────────────────────── */

/**
 * LES PRESTATIONS DU CLIENT — projection locale, aucune lecture du Panel.
 *
 * La page de facturation doit s'afficher même Panel indisponible : ce que le
 * client voit peut avoir quelques secondes de retard, il ne doit jamais être
 * absent. La convergence, elle, arrive par le canal de synchronisation.
 */
export const myPaymentRequests = asyncHandler(async (req, res) => {
  const { listPaymentRequests } = await import('../services/billing/paymentRequestCheckout.service.js');
  return ok(res, { items: await listPaymentRequests() });
});

/**
 * PAYER — le seul geste que le client puisse faire sur une prestation.
 *
 * Le corps de la requête est VIDE, et c'est délibéré : l'identité vient du
 * chemin, le montant du Panel. Il n'y a rien à falsifier ici.
 */
/* ── INCIDENTS DE PAIEMENT D'ABONNEMENT (L10.6B-3) ────────────────────────── */

/**
 * L'IMPAYÉ D'ABONNEMENT DU CLIENT — projection locale, aucune lecture du Panel.
 *
 * ══ UN GET QUI NE FAIT RIEN, ET QUI DOIT LE RESTER ══════════════════════════
 *
 * Aucun appel Stripe, aucun e-mail, aucune mutation. Un client inquiet qui
 * rafraîchit dix fois ne doit provoquer aucune tentative de prélèvement :
 * Stripe reste l'unique ordonnanceur, et une lecture qui deviendrait un
 * déclencheur ferait dépendre la collecte de qui regarde l'écran.
 *
 * ══ POURQUOI SOUS `my-invoices` ═════════════════════════════════════════════
 *
 * Parce que c'est l'espace du CLIENT, et que la garde ADMIN posée au-dessus du
 * routeur vaut pour lui comme pour les prestations. Un impayé d'abonnement se
 * lit là où le client vient chercher ses factures, pas dans un écran à part.
 */
export const mySubscriptionIncidents = asyncHandler(async (req, res) => {
  const { listPaymentDefaultIncidents } = await import(
    '../services/billing/paymentDefaultIncident.service.js'
  );
  return ok(res, await listPaymentDefaultIncidents());
});

export const payPaymentRequest = asyncHandler(async (req, res) => {
  const { openServiceCheckout } = await import('../services/billing/paymentRequestCheckout.service.js');
  const session = await openServiceCheckout({
    paymentRequestId: req.params.paymentRequestId,
    origin: req.get('origin'),
  });
  return ok(res, session);
});
