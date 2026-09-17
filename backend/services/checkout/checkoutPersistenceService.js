// services/checkout/checkoutPersistenceService.js
// Sprint F1 — Extraction PUREMENT STRUCTURELLE du cœur "persistance de vente + effets
// post-vente" hors de clientController. Aucune modification de comportement : fonctions
// déplacées verbatim.
//
// Ce module est la BASE du DAG checkout (aucune dépendance vers les finaliseurs) : il
// regroupe les builders purs, la persistance de la Sale (`persistSale`) et les effets
// post-vente (`runPostSaleSideEffects`). `persistSale` invoque `runPostSaleSideEffects`
// (chemin par défaut) ; les deux sont donc co-localisés pour garder le graphe acyclique
// (les finaliseurs importent d'ici, jamais l'inverse).

import crypto from 'node:crypto';
import mongoose from 'mongoose';

import Sale from '../../models/Sale.js';
import Purchase from '../../models/Purchase.js';
import Formation from '../../models/Formation.js';
import FormationSession from '../../models/FormationSession.js';
import User from '../../models/user.js';
import CartSnapshot from '../../models/CartSnapshot.js';
import { calculateFinalPrice } from '../promotionService.js';
import { recordCommissionTransactions } from '../commissionService.js';
import { createStripeInvoiceForSale } from '../stripe/stripeInvoiceFacade.js';
import { sendSaleEmail } from '../mail/mailDispatcher.js';
import { triggerNotification } from '../notificationService.js';
import { emitSaleEvent } from '../businessEventService.js';
import { buildTaxSnapshot } from '../../constants/tax.js';
import { buildPricingSnapshot } from '../../constants/pricingConcepts.js';
import { finalizeGiftCardUsage } from './checkoutGiftCardService.js';

function roundToCents(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || '').trim());
}

export function buildSaleId() {
  const suffix = crypto.randomUUID().split('-')[0];
  return `SALE-${Date.now()}-${suffix}`;
}

export function buildCustomerProfile(user) {
  return {
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    email: user?.email || ''
  };
}

export function buildSaleEntry({ type, itemId, formationId = null, name, basePrice, promotion }) {
  const normalizedBase = Number.isFinite(Number(basePrice)) ? Number(basePrice) : 0;
  const { finalPrice } = calculateFinalPrice(normalizedBase, promotion);
  return {
    type,
    itemId: new mongoose.Types.ObjectId(itemId),
    formationId: isValidObjectId(formationId) ? new mongoose.Types.ObjectId(formationId) : null,
    name: (name || '').trim(),
    basePrice: normalizedBase,
    finalPrice,
    price: finalPrice,
    promotionApplied: Boolean(promotion),
    promotionId: promotion?._id || null
  };
}

export function validateAndBuildSelectedOptions(rawOptions, formation, sessionStartAt) {
  if (!Array.isArray(rawOptions) || !rawOptions.length) {
    return { selectedOptions: [], optionSaleItems: [] };
  }
  if (!formation || !Array.isArray(formation.options)) {
    return { selectedOptions: [], optionSaleItems: [] };
  }
  const now = Date.now();
  const sessionStartMs = sessionStartAt ? new Date(sessionStartAt).getTime() : 0;
  const optionMap = new Map(formation.options.map(opt => [opt._id?.toString(), opt]));
  const selectedOptions = [];
  const optionSaleItems = [];
  for (const raw of rawOptions) {
    const optionId = String(raw?.optionId || '').trim();
    if (!isValidObjectId(optionId)) {
      const error = new Error('Option invalide.');
      error.status = 400;
      throw error;
    }
    const option = optionMap.get(optionId);
    if (!option) {
      const error = new Error(`Option ${optionId} introuvable sur cette formation.`);
      error.status = 400;
      throw error;
    }
    const deadlineMs = Number(option.deadlineDays || 0) * 86400000;
    if (!sessionStartMs || sessionStartMs - now <= deadlineMs) {
      const error = new Error(`L'option "${option.name}" n'est plus disponible pour cette session.`);
      error.status = 400;
      error.code = 'OPTION_DEADLINE_EXCEEDED';
      throw error;
    }
    selectedOptions.push({
      optionId: option._id,
      name: option.name || '',
      price: Number.isFinite(Number(option.price)) ? Number(option.price) : 0
    });
    optionSaleItems.push({
      type: 'formation-option',
      itemId: option._id,
      formationId: formation._id,
      name: option.name || 'Option',
      basePrice: Number.isFinite(Number(option.price)) ? Number(option.price) : 0,
      finalPrice: Number.isFinite(Number(option.price)) ? Number(option.price) : 0,
      price: Number.isFinite(Number(option.price)) ? Number(option.price) : 0,
      promotionApplied: false,
      promotionId: null
    });
  }
  return { selectedOptions, optionSaleItems };
}

export function buildFormationEntryFromSale(entry) {
  if (!entry || entry.type !== 'formation') {
    return null;
  }
  return {
    formationId: entry.itemId,
    formationName: entry.name || 'Formation',
    price: Number.isFinite(Number(entry.finalPrice)) ? Number(entry.finalPrice) : 0
  };
}

export function buildSaleCommissionSnapshot(commissionTransactions = []) {
  if (!Array.isArray(commissionTransactions) || !commissionTransactions.length) {
    return null;
  }
  const commissionAmount = roundToCents(
    commissionTransactions.reduce((sum, entry) => sum + Number(entry?.commissionAmount || 0), 0)
  );
  if (!Number.isFinite(commissionAmount)) {
    return null;
  }
  const percentageEntry = commissionTransactions.find(
    entry =>
      String(entry?.commissionType || '').trim().toLowerCase() === 'percentage' &&
      Number.isFinite(Number(entry?.commissionValue))
  );
  return {
    commissionRate: percentageEntry ? Number(percentageEntry.commissionValue) : null,
    commissionAmount
  };
}

export async function applySaleCommissionSnapshot(saleDoc, commissionTransactions = []) {
  if (!saleDoc || !Array.isArray(commissionTransactions) || !commissionTransactions.length) {
    return;
  }
  const snapshot = buildSaleCommissionSnapshot(commissionTransactions);
  if (!snapshot) {
    return;
  }
  saleDoc.commissionRate = snapshot.commissionRate;
  saleDoc.commissionAmount = snapshot.commissionAmount;
  await saleDoc.save();
}

export function normalizeSnapshotItem(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const type = entry.type === 'product' ? 'product' : 'formation';
  const itemId = entry.itemId || entry.id;
  if (!itemId) return null;
  const hasSession = entry.sessionId !== undefined && entry.sessionId !== null;
  const sessionId = hasSession ? entry.sessionId : null;
  return {
    type,
    itemId,
    name: String(entry.name || entry.label || '').trim(),
    price: Number.isFinite(Number(entry.price)) ? Number(entry.price) : 0,
    sessionId
  };
}

export async function runPostSaleSideEffects(sale, { giftCardSettlement = null } = {}) {
  if (!sale) return;
  console.log('[PostSaleEffects] Demarrage pour sale:', sale._id);
  const settlement = giftCardSettlement && typeof giftCardSettlement === 'object'
    ? giftCardSettlement
    : null;
  if (settlement?.usages?.length) {
    await finalizeGiftCardUsage({
      userId: settlement.userId,
      saleDoc: sale,
      saleItems: Array.isArray(settlement.saleItems) ? settlement.saleItems : [],
      usages: settlement.usages,
      paymentIntentId: settlement.paymentIntentId || null
    });
  }
  void sendSaleEmail(sale);
  void triggerNotification('new_sale', {
    saleId: sale.saleId || '—',
    amount: typeof sale.totalAmount === 'number' ? sale.totalAmount.toFixed(2) : '—',
    link: '/gestion.html?page=ventes',
    linkLabel: 'Voir les ventes'
  });

  // Formation purchase notifications
  try {
    const formationItem = sale.items?.find(i => i.type === 'formation');
    if (formationItem?.formationId) {
      const [formation, client] = await Promise.all([
        Formation.findById(formationItem.formationId).select('type name').lean(),
        User.findById(sale.userId).select('firstName lastName email').lean()
      ]);
      const clientName = [client?.firstName, client?.lastName].filter(Boolean).join(' ') || client?.email || '—';

      if (formation?.type === 'distanciel') {
        void triggerNotification('formation_distancielle_purchased', {
          clientName,
          formationName: formation.name || '—',
          saleId: sale.saleId || '—',
          amount: typeof sale.totalAmount === 'number' ? sale.totalAmount.toFixed(2) : '—'
        });
      } else if (formation?.type === 'presentiel') {
        const purchase = await Purchase.findOne({ saleId: sale.saleId, itemType: 'formation' }).select('sessionId').lean();
        const session = purchase?.sessionId
          ? await FormationSession.findById(purchase.sessionId).lean()
          : null;
        const optionItems = sale.items?.filter(i => i.type === 'formation-option') || [];
        const sessionDate = session?.startDate
          ? new Date(session.startDate).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
          : 'Non renseignée';
        const schedule = session?.schedule?.[0];
        const sessionTime = schedule ? `${schedule.startTime} → ${schedule.endTime}` : '';
        void triggerNotification('formation_presentielle_purchased', {
          clientName,
          formationName: formation.name || '—',
          sessionDate,
          sessionTime,
          optionsCount: optionItems.length,
          saleId: sale.saleId || '—'
        });
      }
    }
  } catch (err) {
    console.error('[runPostSaleSideEffects] Formation notification error:', err?.message || err);
  }

  console.log('[Invoice] Recherche user pour sale:', sale._id, 'userId:', sale.userId);
  try {
    const user = await User.findById(sale.userId).select({
      _id: 1,
      email: 1,
      firstName: 1,
      lastName: 1,
      stripeCustomerId: 1
    }).lean();
    console.log('[Invoice] User trouve:', user ? user.email : 'NULL');
    if (user) {
      await createStripeInvoiceForSale(sale, user);
    } else {
      console.warn('[Invoice] User null - generation facture skippee');
    }
  } catch (err) {
    console.error('[Invoice] Echec generation Stripe Invoice:', err?.message || err);
  }
}

export async function persistSale({
  userId,
  customer,
  items,
  giftCardUsage,
  consumerWaiver,
  clientIp,
  stripePaymentIntentId = null,
  stripeSessionId = null,
  skipPostSaleSideEffects = false,
  legalConsentSnapshot = null,
  accessDeliveryStatus = null,
  accessGrantedAt = null
}) {
  if (!userId || !items?.length) return null;
  const normalizedItems = items.map(entry => {
    const basePrice =
      Number.isFinite(Number(entry.basePrice)) && Number(entry.basePrice) >= 0
        ? Number(entry.basePrice)
        : Number.isFinite(Number(entry.price)) && Number(entry.price) >= 0
        ? Number(entry.price)
        : 0;
    const rawFinal =
      Number.isFinite(Number(entry.finalPrice)) && Number(entry.finalPrice) >= 0
        ? Number(entry.finalPrice)
        : Number(entry.price) >= 0
        ? Number(entry.price)
        : basePrice;
    const finalPrice = Math.max(0, roundToCents(rawFinal));
    return {
      ...entry,
      basePrice,
      finalPrice,
      price: finalPrice,
      promotionApplied: Boolean(entry.promotionApplied || entry.promotionId),
      promotionId: entry.promotionId || null
    };
  });
  const totalAmount = normalizedItems.reduce((sum, item) => sum + Number(item.finalPrice || 0), 0);
  const normalizedIp = String(clientIp || '').trim() || '0.0.0.0';
  const acceptedCgv =
    typeof consumerWaiver?.accepted_cgv === 'boolean'
      ? consumerWaiver.accepted_cgv
      : true;
  const renonciationText = String(
    consumerWaiver?.renonciation_text || consumerWaiver?.consumerWaiverAcceptedText || ''
  ).trim();
  const dateAchat = consumerWaiver?.date_achat ? new Date(consumerWaiver.date_achat) : new Date();
  const hasValidDateAchat = !Number.isNaN(dateAchat.getTime());
  const dateFormation = consumerWaiver?.date_formation
    ? new Date(consumerWaiver.date_formation)
    : null;
  const hasValidDateFormation = dateFormation && !Number.isNaN(dateFormation.getTime());
  const sale = new Sale({
    saleId: buildSaleId(),
    userId,
    customer,
    items: normalizedItems,
    totalAmount: roundToCents(totalAmount),
    itemCount: normalizedItems.length,
    giftCardUsage: Array.isArray(giftCardUsage) ? giftCardUsage : [],
    accepted_cgv: Boolean(acceptedCgv),
    renonciation_text: renonciationText || null,
    date_formation: hasValidDateFormation ? dateFormation : null,
    date_session: hasValidDateFormation ? dateFormation : null,
    date_achat: hasValidDateAchat ? dateAchat : new Date(),
    client_ip: normalizedIp
  });
  if (renonciationText) {
    sale.consumerWaiverAcceptedText = renonciationText;
    sale.consumerWaiverAcceptedAt = consumerWaiver?.consumerWaiverAcceptedAt || sale.date_achat;
  }
  // Sprint pré-React A1 — snapshot des consentements légaux revalidés serveur.
  if (legalConsentSnapshot && typeof legalConsentSnapshot === 'object') {
    sale.legalConsentSnapshot = legalConsentSnapshot;
  }
  // Sprint pré-React A7 — marqueur de livraison d'accès (distanciel : pas de faux
  // « accès immédiat »).
  if (accessDeliveryStatus) {
    sale.accessDeliveryStatus = accessDeliveryStatus;
  }
  // Pré-React C3 — horodatage d'octroi d'accès (distanciel immédiat → non remboursable).
  if (accessGrantedAt) {
    sale.accessGrantedAt = accessGrantedAt;
  }
  // Pré-React B1 — snapshot fiscal V1 (franchise en base, TVA non applicable, HT=TTC).
  sale.taxSnapshot = buildTaxSnapshot(sale.totalAmount);
  // Pré-React — snapshot pricing : promotion (sold = catalogue − promo) + carte cadeau comme
  // MOYEN DE PAIEMENT (ne réduit pas sold ni la base de commission).
  const catalogAmount = roundToCents(
    normalizedItems.reduce((sum, item) => sum + Number(item.basePrice || 0), 0)
  );
  const giftCardPaymentAmount = roundToCents(
    (Array.isArray(giftCardUsage) ? giftCardUsage : []).reduce(
      (sum, g) => sum + Number(g?.amountUsed || 0),
      0
    )
  );
  sale.pricingSnapshot = buildPricingSnapshot({
    catalogAmount,
    soldAmount: roundToCents(totalAmount),
    giftCardPaymentAmount
  });
  // Phase 1B-1: set the Stripe PaymentIntent id AT INSERT so the unique partial
  // index on stripePaymentIntentId rejects a concurrent/duplicate webhook with an
  // E11000 BEFORE any side effect (gift-card debit, commission) runs — preventing
  // both a duplicate Sale and an orphan Sale.
  const normalizedPi = String(stripePaymentIntentId || '').trim();
  const normalizedSession = String(stripeSessionId || '').trim();
  if (normalizedPi) sale.stripePaymentIntentId = normalizedPi;
  if (normalizedSession) sale.stripeSessionId = normalizedSession;
  const saved = await sale.save();
  // Audit-only event (best-effort, no side effect, never throws to the flow).
  await emitSaleEvent('sale.finalized', saved);
  if (!skipPostSaleSideEffects) {
    await runPostSaleSideEffects(saved);
  }
  return saved;
}

export async function persistCartSnapshot(userId, items) {
  if (!userId) return;
  const normalized = Array.isArray(items)
    ? items
        .map(normalizeSnapshotItem)
        .filter(Boolean)
    : [];
  if (!normalized.length) {
    await CartSnapshot.deleteOne({ userId });
    return;
  }
  const totalAmount = normalized.reduce((sum, item) => sum + Number(item.price || 0), 0);
  const itemCount = normalized.length;
  await CartSnapshot.findOneAndUpdate(
    { userId },
    { items: normalized, totalAmount, itemCount, updatedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

export async function clearCartSnapshotBestEffort(userId) {
  if (!userId) return;
  try {
    await CartSnapshot.deleteOne({ userId });
  } catch (error) {
    console.error('Erreur suppression CartSnapshot (best effort)', error);
  }
}

export async function rollbackSingleSale({ sale, purchase, session }) {
  if (session) {
    await FormationSession.findByIdAndUpdate(session._id, { $inc: { reservedCount: -1 } }).catch(
      () => {}
    );
  }
  if (purchase) {
    await Purchase.deleteOne({ _id: purchase._id }).catch(() => {});
  }
  if (sale) {
    await Sale.deleteOne({ _id: sale._id }).catch(() => {});
  }
}

// Phase 1B-4: guard for the free / 0€ finalization path. When an order is finalized
// WITHOUT Stripe (POST /api/client/checkout/finalize-free), the REAL remaining amount
// (catalog prices minus the actual gift-card coverage computed server-side) MUST be 0.
// Otherwise a balance is still due and the order has to go through Stripe — this
// prevents finalizing a partially-paid order for free.
export function assertZeroRemainingForFreeOrder(requireZeroRemaining, remainingAmount) {
  if (!requireZeroRemaining) return;
  if (roundToCents(remainingAmount) > 0) {
    const err = new Error('Un montant reste du: ce paiement ne peut pas etre finalise sans reglement.');
    err.status = 402;
    err.code = 'PAYMENT_REQUIRED';
    throw err;
  }
}

// Re-export commission recording so finaliseurs can import the full persistence surface
// from a single module (no behavior change; same commissionService function).
export { recordCommissionTransactions };
