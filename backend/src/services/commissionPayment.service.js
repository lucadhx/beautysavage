import { CommerceCommission } from '../models/CommerceCommission.model.js';
import { Contract } from '../models/Contract.model.js';
import { SystemConfiguration } from '../models/SystemConfiguration.model.js';
import { ApiError } from '../utils/ApiError.js';
import { getSingleton } from '../utils/singleton.js';
import { logger } from '../utils/logger.js';
import { SITE_SERVEABLE_STATUSES } from '../utils/contractConstants.js';
import { invokeCapability } from './panelBridge/capabilityClient.js';
import { readCheckoutViaPanel, readInvoiceViaPanel } from './stripe/checkoutCapability.js';
import { upsertInvoiceFromStripe } from './billing.service.js';
import crypto from 'node:crypto';
import { activeCommissionRule } from './commissionRules.js';
import { emitAndDispatch } from './events/domainEvent.service.js';
import { PAYMENT_TYPE } from '../utils/contractConstants.js';

/**
 * PAYER LES COMMISSIONS — une page de paiement Stripe par mois, une ligne par
 * vente, et la facture émise par Stripe après paiement.
 *
 * ══ AUCUN PAIEMENT ENCAISSÉ SANS ÊTRE ENREGISTRÉ ═══════════════════════════
 *
 * Trois chemins constatent le paiement, et chacun suffit seul :
 *   1. le webhook de la plateforme (`checkout.session.completed`, puis
 *      `invoice.paid` qui apporte la facture) ;
 *   2. le retour sur le Manager : la page interroge `sync`, qui relit la
 *      session auprès du Panel ;
 *   3. le rattrapage automatique, toutes les quelques minutes.
 * Tous passent par `settlePaid`, idempotent : constater deux fois ne paie
 * pas deux fois.
 *
 * Seul un MOIS TERMINÉ se paie : sa liste de ventes ne bougera plus.
 */

const CHECKOUT_CAPABILITY = 'billing.checkout.create';

async function managerBaseUrl() {
  const cfg = await getSingleton(SystemConfiguration);
  return (cfg.network?.managerUrl || '').replace(/\/$/, '');
}

async function activeContract() {
  return Contract.findOne({ status: { $in: SITE_SERVEABLE_STATUSES }, archived: false }).sort({ updatedAt: -1 });
}

export function commissionPayable(commission, now = new Date()) {
  return Boolean(commission?.periodEnd) && new Date(commission.periodEnd) < now;
}

function shortOperation(prefix, id, attempt) {
  // Le Panel exige 16 à 96 caractères : identité stable PAR TENTATIVE.
  return `${prefix}-${id}-${attempt}`.slice(0, 96);
}

/** Les lignes envoyées au Panel : une vente, sa base, son taux, son montant. */
export function linesOf(commission) {
  return (commission.sourceSnapshot?.lines || [])
    .filter((line) => Number(line.amountCents) > 0)
    .map((line) => ({
      saleRef: String(line.saleId || line.saleNumber),
      saleNumber: String(line.saleNumber || line.saleId).slice(0, 40),
      basisCents: Math.round(Number(line.basisCents) || 0),
      amountCents: Math.round(Number(line.amountCents) || 0),
      // Le taux HT EFFECTIF : un taux « TTC » (7,5 %) est facturé à son HT (6,25 %), la TVA s'ajoutant.
      ratePercent: Math.round(Number(line.rateHtPercent ?? line.ratePercent ?? commission.ratePercent ?? 0) * 1e6) / 1e6,
      ...(line.capped ? { capped: true } : {}),
    }));
}

/**
 * « PAYER » — ouvre (ou reprend) la page de paiement Stripe du mois.
 * Une session encore ouverte est réutilisée : deux clics ne créent pas deux
 * paiements.
 */
export async function openCommissionCheckout(id) {
  const commission = await CommerceCommission.findById(id);
  if (!commission) throw ApiError.notFound('Commission introuvable');
  if (commission.status === 'PAID') throw ApiError.conflict('Ces commissions sont déjà payées', { code: 'COMMISSION_ALREADY_PAID' });
  if (!commissionPayable(commission)) {
    throw ApiError.conflict('Le mois n’est pas terminé : ses commissions se paient à partir du 1er du mois suivant.', { code: 'COMMISSION_PERIOD_OPEN' });
  }
  const lines = linesOf(commission);
  if (!lines.length) throw ApiError.conflict('Aucune vente à facturer pour ce mois.', { code: 'COMMISSION_EMPTY' });

  // Une session ouverte et non expirée : on la reprend.
  const open = commission.sourceSnapshot?.checkout;
  // Un prélèvement déjà validé par l'institut est en traitement à la banque : en ouvrir un second ferait payer deux fois.
  if (commission.status === 'PAYMENT_PENDING' && open?.processing) {
    throw ApiError.conflict('Un paiement de ce mois est déjà en cours de traitement par la banque : il sera enregistré automatiquement.', { code: 'COMMISSION_PAYMENT_PROCESSING' });
  }
  if (commission.status === 'PAYMENT_PENDING' && open?.url && open.expiresAt && new Date(open.expiresAt) > new Date(Date.now() + 60_000)) {
    return { url: open.url, reused: true };
  }

  const contract = await activeContract();
  if (!contract) {
    throw ApiError.conflict('Aucun contrat actif : le paiement des commissions s’ouvre une fois le contrat activé.', { code: 'NO_ACTIVE_CONTRACT' });
  }
  const base = await managerBaseUrl();
  const attempt = Number(open?.attempt || 0) + 1;
  const operationId = shortOperation('commission-checkout', commission._id, attempt);
  const rates = [...new Set(lines.map((l) => l.ratePercent))];
  const envelope = await invokeCapability(CHECKOUT_CAPABILITY, {
    paymentType: 'COMMISSION',
    contractRef: String(contract._id),
    successUrl: `${base}/commerce/commissions?paiement=retour&commission=${commission._id}`,
    cancelUrl: `${base}/commerce/commissions?paiement=annule&commission=${commission._id}`,
    operationId,
    correlation: { paymentRef: String(commission._id) },
    commission: {
      commissionRef: String(commission._id),
      periodKey: commission.periodKey,
      ratePercent: rates.length === 1 ? rates[0] : Number(commission.ratePercent ?? rates[0]),
      lines,
    },
  });
  const result = envelope?.result;
  if (!result?.checkoutSessionId || !result.url) {
    throw ApiError.badRequest('Le Panel n’a pas rendu de page de paiement exploitable.', { code: 'COMMISSION_CHECKOUT_INVALID' });
  }
  commission.status = 'PAYMENT_PENDING';
  commission.sourceSnapshot = {
    ...(commission.sourceSnapshot || {}),
    checkout: {
      sessionId: result.checkoutSessionId,
      url: result.url,
      expiresAt: result.expiresAt ? new Date(result.expiresAt * 1000) : new Date(Date.now() + 23 * 3600_000),
      attempt,
      contractId: String(contract._id),
      openedAt: new Date(),
    },
  };
  commission.markModified('sourceSnapshot');
  await commission.save();
  return { url: result.url, reused: false };
}

/** Constater le paiement — idempotent, quel que soit le chemin qui l'apporte. */
async function settlePaid(commission, { paymentReference = '', invoiceId = '' } = {}) {
  if (commission.status !== 'PAID') {
    commission.status = 'PAID';
    commission.paidAt = commission.paidAt || new Date();
    commission.paymentReference = paymentReference || commission.paymentReference;
  }
  if (invoiceId && !commission.stripeInvoice?.id) commission.stripeInvoice.id = invoiceId;
  await commission.save();
  await refreshInvoice(commission).catch((err) => logger.warn(`[commission] facture ${commission.periodKey} pas encore lisible : ${err.message}`));
  return commission;
}

/**
 * LA FACTURE DANS LA PAGE « FACTURES » DU MANAGER — à côté des frais de
 * lancement et de l'abonnement, rattachée au contrat qui a payé. Accepte
 * l'objet Stripe brut (webhook) comme la vue du Panel (lecture).
 */
async function recordInManagerInvoices(commission, facture) {
  const contractId = commission.sourceSnapshot?.checkout?.contractId;
  const contract = contractId ? await Contract.findById(contractId).catch(() => null) : null;
  if (!contract) return null;
  const { invoice } = await upsertInvoiceFromStripe(facture, contract, {
    type: PAYMENT_TYPE.COMMISSION,
    label: `Commissions ${monthName(commission)}`,
  });
  return invoice;
}

function monthName(commission) {
  const start = commission.periodStart ? new Date(commission.periodStart) : new Date(`${commission.periodKey}-01T12:00:00Z`);
  const text = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(start);
  return text;
}

/** La facture Stripe (émise après paiement) : son lien hébergé et son PDF. */
async function refreshInvoice(commission) {
  const invoiceId = commission.stripeInvoice?.id;
  const contractId = commission.sourceSnapshot?.checkout?.contractId;
  if (!invoiceId || !contractId || commission.stripeInvoice?.hostedInvoiceUrl) return commission;
  const invoice = await readInvoiceViaPanel({ contractRef: contractId, invoiceId, operationId: shortOperation('commission-invoice', commission._id, Date.now()) });
  await recordInManagerInvoices(commission, invoice).catch((err) => logger.warn(`[commission] facture ${commission.periodKey} non classée dans « Factures » : ${err.message}`));
  commission.stripeInvoice = {
    ...(commission.stripeInvoice?.toObject?.() || commission.stripeInvoice || {}),
    id: invoice.invoiceId,
    number: invoice.number || '',
    status: invoice.status || '',
    hostedInvoiceUrl: invoice.hostedInvoiceUrl || '',
    invoicePdfUrl: invoice.invoicePdfUrl || '',
    amountDueCents: Number(invoice.amountDue || 0),
    createdAt: commission.stripeInvoice?.createdAt || new Date(),
    paidAt: commission.paidAt,
    lastCheckedAt: new Date(),
  };
  await commission.save();
  return commission;
}

/**
 * RELIRE L'ÉTAT AUPRÈS DE STRIPE (via le Panel) — appelé par la page au
 * retour de paiement, et par le rattrapage. Payée → enregistrée ; expirée →
 * le mois redevient « à payer ».
 */
export async function syncCommissionPayment(id) {
  const commission = await CommerceCommission.findById(id);
  if (!commission) throw ApiError.notFound('Commission introuvable');
  const sessionId = commission.sourceSnapshot?.checkout?.sessionId;
  if (commission.status === 'PAID') {
    await refreshInvoice(commission).catch(() => null);
    return view(commission);
  }
  if (commission.status !== 'PAYMENT_PENDING' || !sessionId) return view(commission);
  const session = await readCheckoutViaPanel({ checkoutSessionId: sessionId, operationId: shortOperation('commission-read', commission._id, Date.now()) });
  if (session.paymentStatus === 'paid' || session.paymentStatus === 'no_payment_required') {
    await settlePaid(commission, { paymentReference: session.paymentIntentId || sessionId, invoiceId: session.invoiceId || '' });
  } else if (session.status === 'expired') {
    commission.status = 'DUE';
    await commission.save();
  } else if (session.status === 'complete' && session.paymentStatus === 'unpaid') {
    // Paiement différé (prélèvement SEPA…) : accepté par la banque plus tard, constaté par le webhook.
    commission.sourceSnapshot = { ...(commission.sourceSnapshot || {}), checkout: { ...(commission.sourceSnapshot?.checkout || {}), processing: true } };
    commission.markModified('sourceSnapshot');
    await commission.save();
  }
  return view(await CommerceCommission.findById(id));
}

/** Les événements Stripe de la plateforme qui concernent une commission. */
export async function handleCommissionStripeEvent(type, obj) {
  const commissionId = obj.metadata?.commissionId;
  if (!commissionId) return { handled: false };
  const commission = await CommerceCommission.findById(commissionId);
  if (!commission) return { handled: false };
  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    if (obj.payment_status === 'paid' || obj.payment_status === 'no_payment_required') {
      await settlePaid(commission, { paymentReference: obj.payment_intent || obj.id, invoiceId: obj.invoice || '' });
    }
    return { handled: true };
  }
  if (type === 'checkout.session.expired' || type === 'checkout.session.async_payment_failed') {
    if (commission.status === 'PAYMENT_PENDING') { commission.status = 'DUE'; await commission.save(); }
    return { handled: true };
  }
  if (type === 'invoice.finalized' || type === 'invoice.paid') {
    commission.stripeInvoice = {
      ...(commission.stripeInvoice?.toObject?.() || commission.stripeInvoice || {}),
      id: obj.id,
      number: obj.number || '',
      status: obj.status || '',
      hostedInvoiceUrl: obj.hosted_invoice_url || '',
      invoicePdfUrl: obj.invoice_pdf || '',
      amountDueCents: Number(obj.amount_due || 0),
      createdAt: commission.stripeInvoice?.createdAt || new Date(),
      lastCheckedAt: new Date(),
    };
    if (type === 'invoice.paid') await settlePaid(commission, { paymentReference: obj.payment_intent || obj.id, invoiceId: obj.id });
    else await commission.save();
    await recordInManagerInvoices(commission, obj).catch((err) => logger.warn(`[commission] facture ${commission.periodKey} non classée dans « Factures » : ${err.message}`));
    return { handled: true };
  }
  return { handled: true };
}

/** Rattrapage : les mois « en paiement » et les factures pas encore lues. */
export async function reconcileCommissionPayments() {
  const pending = await CommerceCommission.find({
    $or: [
      { status: 'PAYMENT_PENDING' },
      { status: 'PAID', 'stripeInvoice.id': { $ne: '' }, 'stripeInvoice.hostedInvoiceUrl': '' },
    ],
  }).select('_id').limit(20).lean();
  for (const { _id } of pending) {
    await syncCommissionPayment(String(_id)).catch((err) => logger.warn(`[commission] rattrapage ${_id} : ${err.message}`));
  }
  return pending.length;
}

/** Ce que la page des commissions affiche. */
export function view(commission, { fallbackVatRate = null } = {}) {
  const c = commission?.toObject ? commission.toObject() : commission;
  // HT / TVA / TTC du mois : somme des lignes (comme la facture Stripe, ligne par ligne).
  // Un mois antérieur à l'enregistrement de la TVA prend celle du contrat en vigueur.
  const lines = c?.sourceSnapshot?.lines || [];
  const vatRate = c?.vatRate ?? lines.find((l) => l.vatRate != null)?.vatRate ?? fallbackVatRate;
  const fromLines = lines.reduce((s, l) => s + (Number(l.vatCents) || (vatRate != null ? Math.round(Number(l.amountCents || 0) * vatRate / 100) : 0)), 0);
  const vatCents = c?.vatCents || (lines.length ? fromLines : (vatRate != null ? Math.round(Number(c?.amountCents || 0) * vatRate / 100) : 0));
  return {
    ...c,
    vatRate,
    vatCents,
    amountTtcCents: Number(c?.amountCents || 0) + vatCents,
    payable: commissionPayable(c),
    invoiceUrl: c?.stripeInvoice?.hostedInvoiceUrl || c?.stripeInvoice?.invoicePdfUrl || '',
    checkout: c?.sourceSnapshot?.checkout ? { openedAt: c.sourceSnapshot.checkout.openedAt, expiresAt: c.sourceSnapshot.checkout.expiresAt, processing: Boolean(c.sourceSnapshot.checkout.processing) } : null,
  };
}

/* -------------------------------------------------------------------------- */
/*  LIEN DE PAIEMENT STABLE                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Le lien du bouton « Payer » d'un e-mail. Une page Stripe expire en 24 h au
 * plus ; ce lien, lui, ne meurt pas : il ouvre (ou reprend) la page du mois au
 * moment du clic et y redirige. Il ne permet rien d'autre que de payer.
 */
function payToken(id) {
  const mac = crypto.createHmac('sha256', `commission-pay:${process.env.JWT_SECRET || ''}`).update(String(id)).digest('base64url').slice(0, 32);
  return `${id}.${mac}`;
}

export function verifyPayToken(token) {
  const [id, mac] = String(token || '').split('.');
  if (!/^[a-f0-9]{24}$/.test(id || '') || !mac) return null;
  const expected = payToken(id).split('.')[1];
  const a = Buffer.from(mac); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? id : null;
}

export async function commissionPayLink(id) {
  const cfg = await getSingleton(SystemConfiguration);
  const api = (cfg.network?.backendUrl || '').replace(/\/$/, '');
  return `${api}/api/public/commissions/payer/${payToken(id)}`;
}

/** Clic sur le lien : où envoyer la personne. Jamais une erreur brute. */
export async function resolvePayLink(token) {
  const base = await managerBaseUrl();
  const id = verifyPayToken(token);
  if (!id) return `${base}/commerce/commissions?paiement=lien-invalide`;
  const commission = await CommerceCommission.findById(id).lean();
  if (!commission) return `${base}/commerce/commissions?paiement=lien-invalide`;
  if (commission.status === 'PAID') return `${base}/commerce/commissions?paiement=deja-payee&commission=${id}`;
  try {
    const { url } = await openCommissionCheckout(id);
    return url;
  } catch (err) {
    logger.warn(`[commission] lien de paiement ${commission.periodKey} : ${err.message}`);
    return `${base}/commerce/commissions?paiement=indisponible&commission=${id}`;
  }
}

/* -------------------------------------------------------------------------- */
/*  ANNONCE DE FIN DE MOIS                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Chaque mois terminé dont les commissions sont dues est annoncé UNE fois aux
 * administrateurs (e-mail « Payer »). Sans contrat actif, rien n'est annoncé :
 * le paiement ne pourrait pas s'ouvrir.
 */
export async function notifyFinishedCommissionMonths(now = new Date()) {
  const due = await CommerceCommission.find({
    status: { $in: ['DUE', 'PAYMENT_PENDING'] },
    periodEnd: { $lt: now },
    amountCents: { $gt: 0 },
    notifiedAt: null,
  }).limit(12);
  if (!due.length) return 0;
  const contract = await activeContract();
  if (!contract) return 0;
  let sent = 0;
  for (const commission of due) {
    try {
      await emitAndDispatch({
        type: 'commission.payment_due',
        entityType: 'Contract',
        entityId: contract._id,
        payloadSafe: { commissionId: String(commission._id), periodKey: commission.periodKey, amountCents: Number(commission.amountCents || 0) },
        idempotencyKey: `commission-payment-due:${commission._id}`,
      });
      await CommerceCommission.updateOne({ _id: commission._id }, { $set: { notifiedAt: new Date() } });
      sent += 1;
    } catch (err) {
      logger.warn(`[commission] annonce ${commission.periodKey} non émise : ${err.message}`);
    }
  }
  return sent;
}

/**
 * LE COMPTEUR DU PLAFOND — ce qui a été prélevé au total, ce qui est payé, ce
 * qu'il reste à payer, et la place restante sous le plafond.
 */
export async function commissionSummary() {
  const [rule, docs] = await Promise.all([
    activeCommissionRule(),
    CommerceCommission.find({ status: { $ne: 'CANCELLED' } }).select('status amountCents vatCents vatRate sourceSnapshot').lean(),
  ]);
  const vatOf = (d) => view(d, { fallbackVatRate: rule.vatRate }).vatCents;
  const totalCents = docs.reduce((s, d) => s + Number(d.amountCents || 0), 0);
  const paidDocs = docs.filter((d) => d.status === 'PAID');
  const paidCents = paidDocs.reduce((s, d) => s + Number(d.amountCents || 0), 0);
  const totalVatCents = docs.reduce((s, d) => s + vatOf(d), 0);
  const paidVatCents = paidDocs.reduce((s, d) => s + vatOf(d), 0);
  // Le plafond est COMPARÉ en HT ; on l'affiche dans l'unité où il a été saisi.
  const capCents = rule.capHtCents || null;
  return {
    capCents,
    capTtcCents: capCents ? Math.round(capCents * (1 + rule.vatRate / 100)) : null,
    capType: rule.capType || 'HT',
    capInputCents: rule.capCents || null,
    totalCents,
    totalTtcCents: totalCents + totalVatCents,
    paidCents,
    paidTtcCents: paidCents + paidVatCents,
    remainingToPayCents: totalCents - paidCents,
    remainingToPayTtcCents: (totalCents + totalVatCents) - (paidCents + paidVatCents),
    capLeftCents: capCents ? Math.max(0, capCents - totalCents) : null,
    capReached: Boolean(capCents && totalCents >= capCents),
    vatRate: rule.vatRate,
    rule: {
      ratePercent: rule.ratePercent, rateType: rule.rateType, rateHtPercent: rule.rateHtPercent, rateTtcPercent: rule.rateTtcPercent,
      vatRate: rule.vatRate, basis: rule.basis, salesVatRate: rule.salesVatRate, productKinds: rule.productKinds, source: rule.source,
    },
  };
}
