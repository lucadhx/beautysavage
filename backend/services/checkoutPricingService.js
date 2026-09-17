// services/checkoutPricingService.js
// Pré-React B2 — Le SERVEUR est l'unique source de vérité du montant à payer.
//
// Le client ne peut jamais imposer : total panier, amountToPay, prix final, réduction,
// carte cadeau débitée, montant Stripe. Ce service recalcule TOUT depuis le catalogue
// serveur (prix, promotions, options) + les soldes réels de cartes cadeaux, puis :
//   - `buildServerCheckoutPricing(checkoutState, ctx)` → pricing serveur faisant foi.
//   - `assertClientPricingMatchesServer(checkoutState, serverPricing)` → refuse
//     (CHECKOUT_AMOUNT_MISMATCH) si le montant client diverge du montant serveur.
//
// Le PaymentIntent / la finalisation utilisent le montant SERVEUR (jamais le client).
// Snapshot fiscal V1 inclus (constants/tax.js, TVA non applicable).
//
// HORS PÉRIMÈTRE (volontaire) : commissions — voir rapport 98 (prochaine étape =
// discussion produit/architecture sur l'unification du système de commissions).

import mongoose from 'mongoose';

import Product from '../models/Product.js';
import Formation from '../models/Formation.js';
import Service from '../models/Service.js';
import GiftCard from '../models/GiftCard.js';
import GiftCardConfig from '../models/GiftCardConfig.js';
import { getActivePromotion } from './promotionService.js';
import { calculateFinalPrice } from './promotionService.js';
import { resolveEffectiveServiceUnitPrice } from './promotionService.js';
import { buildTaxSnapshot } from '../constants/tax.js';
import { buildPricingSnapshot, pickSinglePromotion } from '../constants/pricingConcepts.js';

const PRICING_TOLERANCE = 0.01; // 1 centime

function roundToCents(value) {
  const n = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.round(n * 100) / 100;
}

function pricingError(code, message, status = 400) {
  const error = new Error(message || 'Montant checkout invalide.');
  error.status = status;
  error.code = code;
  return error;
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || '').trim());
}


// Couverture carte cadeau SERVEUR : capée au solde réel et au montant dû.
// Lecture seule (aucun débit/réservation ici). Réplique la logique de planGiftCardUsage.
async function computeServerGiftCardCoverage(appliedGiftCards, amountBase) {
  let remaining = roundToCents(amountBase);
  if (remaining <= 0 || !Array.isArray(appliedGiftCards) || !appliedGiftCards.length) {
    return { coverage: 0, remaining };
  }
  const ids = [];
  const codes = [];
  for (const g of appliedGiftCards) {
    const id = String(g?.giftCardId || '').trim();
    const code = String(g?.code || '').trim().toUpperCase();
    if (isValidObjectId(id)) ids.push(id);
    else if (code) codes.push(code);
  }
  const orQuery = [];
  if (ids.length) orQuery.push({ _id: { $in: ids } });
  if (codes.length) orQuery.push({ code: { $in: codes } });
  const cards = orQuery.length ? await GiftCard.find(orQuery.length === 1 ? orQuery[0] : { $or: orQuery }).lean() : [];
  const byId = new Map(cards.map(c => [String(c._id), c]));
  const byCode = new Map(cards.map(c => [String(c.code || '').toUpperCase(), c]));

  let coverage = 0;
  const seen = new Set();
  for (const g of appliedGiftCards) {
    if (remaining <= 0) break;
    const id = String(g?.giftCardId || '').trim();
    const code = String(g?.code || '').trim().toUpperCase();
    const card = (isValidObjectId(id) && byId.get(id)) || (code && byCode.get(code)) || null;
    if (!card) continue;
    const key = String(card._id);
    if (seen.has(key)) continue;
    seen.add(key);
    if (card.status !== 'active') continue;
    const balance = roundToCents(card.balance);
    if (balance <= 0) continue;
    const requested = Number.isFinite(Number(g?.amount)) && Number(g.amount) > 0 ? roundToCents(g.amount) : balance;
    const useAmount = roundToCents(Math.min(requested, balance, remaining));
    if (useAmount <= 0) continue;
    coverage = roundToCents(coverage + useAmount);
    remaining = roundToCents(Math.max(0, remaining - useAmount));
  }
  return { coverage, remaining };
}

// UNE seule promotion par ligne (pas de cumul). `Promotion` (product/formation) et
// `Service.promotion` (prestation) ciblent des types DISJOINTS → aucune cumulation possible
// par construction ; pickSinglePromotion garantit néanmoins « meilleure réduction unique ».
async function priceFormation(itemId, selectedOptions = [], now = new Date()) {
  if (!isValidObjectId(itemId)) throw pricingError('INVALID_ITEM_ID', 'Formation invalide.');
  const formation = await Formation.findById(itemId).lean();
  if (!formation || formation.status !== 'published') {
    throw pricingError('FORMATION_NOT_FOUND', 'Formation introuvable.', 404);
  }
  const basePrice = Number(formation.price || 0);
  const promotion = await getActivePromotion('formation', itemId, now);
  const { finalPrice, discountAmount } = calculateFinalPrice(basePrice, promotion);
  // Une seule promotion (source 'promotion'), pas de cumul.
  const promo = pickSinglePromotion([{ discountAmount, promotionId: promotion?._id, source: 'promotion' }]);
  let optionsTotal = 0;
  const optionMap = new Map((formation.options || []).map(o => [String(o._id), o]));
  for (const sel of Array.isArray(selectedOptions) ? selectedOptions : []) {
    const opt = optionMap.get(String(sel?.optionId || '').trim());
    if (opt) optionsTotal = roundToCents(optionsTotal + Number(opt.price || 0)); // options non promues
  }
  const catalog = roundToCents(basePrice + optionsTotal);
  const total = roundToCents(roundToCents(finalPrice) + optionsTotal);
  return { total, catalog, discount: promo.discountAmount, name: formation.name, type: formation.type };
}

async function priceProduct(itemId, now = new Date()) {
  if (!isValidObjectId(itemId)) throw pricingError('INVALID_ITEM_ID', 'Produit invalide.');
  const product = await Product.findById(itemId).lean();
  if (!product || !product.active) throw pricingError('PRODUCT_NOT_FOUND', 'Produit introuvable.', 404);
  const basePrice = Number(product.price || 0);
  const promotion = await getActivePromotion('product', itemId, now);
  const { finalPrice, discountAmount } = calculateFinalPrice(basePrice, promotion);
  const promo = pickSinglePromotion([{ discountAmount, promotionId: promotion?._id, source: 'promotion' }]);
  return { total: roundToCents(finalPrice), catalog: roundToCents(basePrice), discount: promo.discountAmount, name: product.name };
}

async function priceService(serviceData, now = new Date()) {
  const serviceId = String(serviceData?.serviceId || serviceData?.id || '').trim();
  if (!isValidObjectId(serviceId)) throw pricingError('INVALID_ITEM_ID', 'Prestation invalide.');
  const service = await Service.findById(serviceId).lean();
  if (!service || !service.isActive) throw pricingError('SERVICE_NOT_BOOKABLE', 'Prestation introuvable.', 404);
  const baseUnit = Number(service.price || 0);
  // D1 — source unique : Promotion(service) prioritaire, fallback Service.promotion legacy.
  const { unitPrice: unit } = await resolveEffectiveServiceUnitPrice(service, now);
  let optionsTotal = 0;
  const rawOptions = Array.isArray(serviceData?.selectedOptions) ? serviceData.selectedOptions : [];
  for (const sel of rawOptions) {
    const opt = (service.options || []).find(o => String(o._id) === String(sel?.optionId) && o.isActive !== false);
    if (opt) optionsTotal = roundToCents(optionsTotal + Number(opt.price || 0));
  }
  const totalPrice = roundToCents(unit + optionsTotal);
  const catalog = roundToCents(baseUnit + optionsTotal);
  // Acompte (bloqué par A7 mais calculé pour cohérence) : base de paiement = acompte.
  let payBase = totalPrice;
  if (service.paymentType === 'deposit') {
    payBase = service.depositType === 'percentage'
      ? roundToCents(totalPrice * Number(service.depositValue || 0) / 100)
      : roundToCents(Math.min(Number(service.depositValue || 0), totalPrice));
  }
  return { total: totalPrice, catalog, discount: roundToCents(Math.max(0, catalog - totalPrice)), payBase, name: service.name };
}

async function priceGiftCardPurchase(item) {
  const amount = roundToCents(
    item?.amount ?? 0
  );
  if (!Number.isFinite(amount) || amount <= 0) {
    throw pricingError('GIFT_CARD_AMOUNT_INVALID', 'Montant carte cadeau invalide.');
  }
  const config = await GiftCardConfig.findOne().sort({ createdAt: -1 }).select({ minAmount: 1 }).lean();
  const minAmount = Number(config?.minAmount || 50);
  if (amount < minAmount) {
    throw pricingError('GIFT_CARD_MIN_AMOUNT', `Le montant minimal est de ${minAmount} EUR.`);
  }
  return { total: amount, catalog: amount, discount: 0, name: String(item?.name || 'Carte cadeau') };
}

/**
 * Recalcule le pricing serveur faisant foi pour un checkoutState (panier / prestation /
 * formation / produit / carte cadeau). Lecture seule.
 * @param {object} checkoutState
 * @param {{ now?: Date }} [ctx]
 * @returns {Promise<object>} { subtotal, payBase, giftCardCoverage, amountToPay, remainingToPay, isZeroPayment, currency, taxSnapshot, kind }
 */
export async function buildServerCheckoutPricing(checkoutState, { now = new Date() } = {}) {
  if (!checkoutState || typeof checkoutState !== 'object') {
    throw pricingError('CHECKOUT_CONTEXT_INVALID', 'checkoutState manquant.');
  }
  const isCart = checkoutState.cart === true;
  const item = checkoutState.item && typeof checkoutState.item === 'object' ? checkoutState.item : {};
  const rawType = String(item?.type || '').trim().toLowerCase();
  const isService = rawType === 'service' || Boolean(checkoutState?.service?.serviceId);

  let subtotal = 0;
  let catalogTotal = 0;
  let payBase = 0;
  let kind = 'single';

  if (isService) {
    kind = 'service';
    const r = await priceService(checkoutState.service || item, now);
    subtotal = r.total; catalogTotal = r.catalog;
    payBase = r.payBase; // acompte éventuel
  } else if (isCart) {
    kind = 'cart';
    const items = Array.isArray(checkoutState.items) ? checkoutState.items : [];
    if (!items.length) throw pricingError('EMPTY_CART', 'Panier vide.');
    for (const it of items) {
      const t = String(it?.type || '').trim().toLowerCase();
      const r = t === 'product'
        ? await priceProduct(it?.id, now)
        : await priceFormation(it?.id, it?.selectedOptions, now);
      subtotal = roundToCents(subtotal + r.total);
      catalogTotal = roundToCents(catalogTotal + r.catalog);
    }
    payBase = subtotal;
  } else if (rawType === 'gift-card') {
    kind = 'gift-card';
    const r = await priceGiftCardPurchase(item);
    subtotal = r.total; catalogTotal = r.catalog; payBase = r.total;
  } else if (rawType === 'product') {
    const r = await priceProduct(item?.id, now);
    subtotal = r.total; catalogTotal = r.catalog; payBase = r.total;
  } else {
    // défaut : formation
    const r = await priceFormation(item?.id, item?.selectedOptions, now);
    subtotal = r.total; catalogTotal = r.catalog; payBase = r.total;
  }

  payBase = roundToCents(payBase);
  const { coverage } = await computeServerGiftCardCoverage(checkoutState.appliedGiftCards, payBase);
  const amountToPay = roundToCents(Math.max(0, payBase - coverage));

  // Snapshot pricing formalisé : carte cadeau = moyen de paiement, commissionBase = soldPrice.
  const pricingSnapshot = buildPricingSnapshot({
    catalogAmount: roundToCents(catalogTotal),
    soldAmount: roundToCents(subtotal),
    giftCardPaymentAmount: roundToCents(coverage)
  });

  return {
    kind,
    subtotal: roundToCents(subtotal),
    catalogAmount: roundToCents(catalogTotal),
    promotionDiscountAmount: pricingSnapshot.promotionDiscountAmount,
    soldAmount: roundToCents(subtotal),
    payBase,
    giftCardCoverage: roundToCents(coverage),
    giftCardPaymentAmount: roundToCents(coverage),
    stripePaymentAmount: amountToPay,
    commissionBaseAmount: roundToCents(subtotal),
    amountToPay,
    remainingToPay: amountToPay,
    isZeroPayment: amountToPay <= 0,
    currency: 'eur',
    taxSnapshot: buildTaxSnapshot(subtotal),
    pricingSnapshot
  };
}

/**
 * Refuse si le montant déclaré par le client diverge du montant serveur faisant foi.
 * @param {object} checkoutState
 * @param {object} serverPricing résultat de buildServerCheckoutPricing
 * @throws {Error} status 400, code CHECKOUT_AMOUNT_MISMATCH
 */
export function assertClientPricingMatchesServer(checkoutState, serverPricing) {
  const totals = checkoutState?.totals && typeof checkoutState.totals === 'object' ? checkoutState.totals : {};
  const claimed = totals.amountToPay ?? totals.remainingToPay;
  if (claimed === undefined || claimed === null || claimed === '') {
    // Le client n'impose rien : le serveur fait foi, pas de mismatch possible.
    return true;
  }
  const clientAmount = roundToCents(claimed);
  if (Math.abs(clientAmount - serverPricing.amountToPay) > PRICING_TOLERANCE) {
    throw pricingError(
      'CHECKOUT_AMOUNT_MISMATCH',
      `Montant client (${clientAmount}) différent du montant serveur (${serverPricing.amountToPay}).`
    );
  }
  return true;
}

export { PRICING_TOLERANCE };

export default {
  buildServerCheckoutPricing,
  assertClientPricingMatchesServer,
  PRICING_TOLERANCE
};
