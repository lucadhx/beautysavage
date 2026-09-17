// services/checkout/unified/unifiedCheckoutFactory.js
// Sprint U1 — Crée un UnifiedCheckout à partir du checkoutState client ACTUEL (format inchangé).
// Snapshots SERVEUR (pricing/tax/legal) ; inputs client sanitisés (aucun secret : les mots de
// passe carte cadeau sont retirés). Idempotent par idempotencyKey. Délègue le pricing/validation
// aux services existants — aucune logique métier dupliquée. NE finalise PAS (cf. finalizer).

import { computeUnifiedPricing } from './unifiedCheckoutPricingService.js';
import { validateUnifiedCheckout } from './unifiedCheckoutValidationService.js';
import { findOrCreateByIdempotencyKey, buildCheckoutId } from './unifiedCheckoutRepository.js';
import { classifyUnifiedKind, resolvePaymentMode } from './unifiedCheckoutTypes.js';

// Sous-ensemble SAFE du checkoutState (jamais de secret : password carte cadeau retiré).
function sanitizeCheckoutStateForSnapshot(checkoutState = {}) {
  const cs = checkoutState && typeof checkoutState === 'object' ? checkoutState : {};
  const pickOptions = opts =>
    Array.isArray(opts)
      ? opts.map(o => ({ optionId: String(o?.optionId || '').trim() })).filter(o => o.optionId)
      : [];
  const pickItem = it =>
    it && typeof it === 'object'
      ? {
          type: String(it.type || '').trim() || null,
          id: it.id ? String(it.id).trim() : null,
          name: it.name ? String(it.name).slice(0, 200) : null,
          amount: Number.isFinite(Number(it.amount)) ? Number(it.amount) : undefined,
          sessionId: it.sessionId ? String(it.sessionId).trim() : null,
          selectedOptions: pickOptions(it.selectedOptions)
        }
      : null;
  const giftCards = Array.isArray(cs.appliedGiftCards)
    ? cs.appliedGiftCards.map(g => ({
        // JAMAIS de password ni d'autre champ : uniquement les références publiques.
        giftCardId: g?.giftCardId ? String(g.giftCardId).trim() : null,
        code: g?.code ? String(g.code).trim().toUpperCase() : null,
        amount: Number.isFinite(Number(g?.amount)) ? Number(g.amount) : undefined
      }))
    : [];
  const legal = cs.legal && typeof cs.legal === 'object' ? cs.legal : {};
  return {
    cart: cs.cart === true,
    item: pickItem(cs.item),
    items: Array.isArray(cs.items) ? cs.items.map(pickItem).filter(Boolean) : [],
    service: cs.service && typeof cs.service === 'object'
      ? {
          serviceId: cs.service.serviceId ? String(cs.service.serviceId).trim() : null,
          slotStart: cs.service.slotStart || null,
          slotEnd: cs.service.slotEnd || null,
          practitionerId: cs.service.practitionerId ? String(cs.service.practitionerId).trim() : null,
          selectedOptions: pickOptions(cs.service.selectedOptions)
        }
      : null,
    appliedGiftCards: giftCards,
    legal: {
      acceptedCgv: Boolean(legal.acceptedCgv),
      waiverRequired: Boolean(legal.waiverRequired),
      waiverAccepted: Boolean(legal.waiverAccepted),
      waiverType: legal.waiverType ? String(legal.waiverType) : null
    }
  };
}

/**
 * Crée (ou retrouve, par idempotencyKey) un UnifiedCheckout pour un checkoutState institut.
 * @param {object} p
 * @param {object} p.checkoutState  — format client actuel (inchangé)
 * @param {string|ObjectId} [p.userId]
 * @param {string} [p.source]
 * @param {object} [p.origin]
 * @param {string} [p.idempotencyKey]
 * @param {boolean} [p.validate=true] — exécute la validation legal/offre/créneau
 * @returns {Promise<{ checkout, created: boolean }>}
 */
export async function createUnifiedCheckout({
  checkoutState,
  userId = null,
  source = 'unified_checkout',
  origin = null,
  idempotencyKey = null,
  validate = true,
  now = new Date()
} = {}) {
  return findOrCreateByIdempotencyKey(idempotencyKey, async () => {
    const pricing = await computeUnifiedPricing(checkoutState, { now });
    const kind = classifyUnifiedKind(checkoutState, pricing.kind);

    let legalConsentSnapshot = null;
    if (validate) {
      const v = await validateUnifiedCheckout({ checkoutState, kind, source, now });
      legalConsentSnapshot = v.legalConsentSnapshot;
    }

    const mode = resolvePaymentMode(pricing);
    const status = pricing.isZeroPayment ? 'free_ready' : 'pricing_ready';

    return {
      checkoutId: buildCheckoutId(),
      kind,
      status,
      userId: userId || null,
      clientId: userId || null,
      source,
      origin: origin || (checkoutState?.origin && typeof checkoutState.origin === 'object' ? checkoutState.origin : null),
      inputSnapshot: sanitizeCheckoutStateForSnapshot(checkoutState),
      pricingSnapshot: pricing.pricingSnapshot || {
        catalogAmount: pricing.catalogAmount,
        soldAmount: pricing.soldAmount,
        giftCardPaymentAmount: pricing.giftCardPaymentAmount
      },
      taxSnapshot: pricing.taxSnapshot || null,
      legalConsentSnapshot,
      payment: {
        mode,
        amountToPay: pricing.amountToPay,
        giftCardPaymentAmount: pricing.giftCardPaymentAmount,
        provider: 'stripe',
        status: 'pending'
      },
      metadata: { pricingKind: pricing.kind, currency: pricing.currency || 'eur' }
    };
  });
}

/**
 * Persiste un UnifiedCheckout à partir d'un pricing serveur DÉJÀ calculé (et d'une validation
 * déjà effectuée par l'appelant — ex. createCheckoutSession). N'exécute NI pricing NI validation
 * (évite tout double-calcul/double-validation). Idempotent par idempotencyKey.
 */
export async function createUnifiedCheckoutRecord({
  checkoutState,
  pricing,
  userId = null,
  source = 'stripe_checkout',
  origin = null,
  idempotencyKey = null,
  legalConsentSnapshot = null,
  status = null
} = {}) {
  return findOrCreateByIdempotencyKey(idempotencyKey, async () => {
    const kind = classifyUnifiedKind(checkoutState, pricing?.kind);
    const mode = resolvePaymentMode(pricing || {});
    const resolvedStatus = status || (pricing?.isZeroPayment ? 'free_ready' : 'payment_pending');
    return {
      checkoutId: buildCheckoutId(),
      kind,
      status: resolvedStatus,
      userId: userId || null,
      clientId: userId || null,
      source,
      origin,
      inputSnapshot: sanitizeCheckoutStateForSnapshot(checkoutState),
      pricingSnapshot: pricing?.pricingSnapshot || null,
      taxSnapshot: pricing?.taxSnapshot || null,
      legalConsentSnapshot: legalConsentSnapshot || null,
      payment: {
        mode,
        amountToPay: pricing?.amountToPay ?? 0,
        giftCardPaymentAmount: pricing?.giftCardPaymentAmount ?? 0,
        provider: 'stripe',
        status: 'pending'
      },
      metadata: { pricingKind: pricing?.kind || null, currency: pricing?.currency || 'eur' }
    };
  });
}

/**
 * Sprint U3 — Persiste un UnifiedCheckout pour un paiement PLATEFORME (compte Stripe Dev :
 * commission / launch_fee / subscription). Kind explicite (pas de pricing catalogue). Aucun
 * checkoutState client ; inputSnapshot = références business safe (commissionPaymentId/contractId).
 * Idempotent par idempotencyKey.
 */
export async function createPlatformUnifiedCheckoutRecord({
  kind,
  amountToPay = 0,
  userId = null,
  source = 'platform_checkout',
  idempotencyKey = null,
  inputSnapshot = null,
  metadata = null,
  status = null
} = {}) {
  return findOrCreateByIdempotencyKey(idempotencyKey, async () => ({
    checkoutId: buildCheckoutId(),
    kind,
    status: status || (Number(amountToPay) > 0 ? 'payment_pending' : 'free_ready'),
    userId: userId || null,
    clientId: userId || null,
    source,
    inputSnapshot: inputSnapshot || null,
    payment: {
      mode: Number(amountToPay) > 0 ? 'stripe' : 'free',
      amountToPay: Number(amountToPay) || 0,
      giftCardPaymentAmount: 0,
      provider: 'stripe_dev',
      status: 'pending'
    },
    metadata: metadata || null
  }));
}

export { sanitizeCheckoutStateForSnapshot };
