import {
  ACQUISITION_PAGES,
  incrementAcquisitionNotifications
} from './acquisitionNotificationService.js';
import { requestVitrineNavigation } from './vitrineNavigationHelper.js';
import { triggerFlyToTarget } from '../ui/acquisitionAnimationService.js';

const CHECKOUT_STATE_PREFIX = 'beautysavage_checkout_state_';
const CHECKOUT_STATE_TTL_MS = 1000 * 60 * 15;
const CHECKOUT_RESULT_KEY = 'beautysavage_checkout_result';
const FREE_CHECKOUT_ENDPOINT = '/api/client/checkout/finalize-free';

function roundToCents(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function toAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return roundToCents(Math.max(0, parsed));
}

function sanitizeSlug(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (!/^[a-z0-9_-]+$/.test(normalized)) return '';
  return normalized;
}

function sanitizeQuery(query) {
  if (!query || typeof query !== 'object') return {};
  const output = {};
  Object.entries(query).forEach(([key, value]) => {
    if (!key || value === null || value === undefined) return;
    output[key] = String(value);
  });
  return output;
}

function getStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch (_error) {
    return null;
  }
}

function serializeForStorage(value) {
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return '';
  }
}

function parseFromStorage(rawValue) {
  if (!rawValue) return null;
  try {
    return JSON.parse(rawValue);
  } catch (_error) {
    return null;
  }
}

function buildDefaultOrigin(itemType, itemId) {
  return {
    slug: 'item-detail',
    query: {
      type: itemType === 'product' ? 'product' : 'formation',
      id: String(itemId || '').trim()
    }
  };
}

function normalizeAppliedGiftCards(appliedGiftCards = []) {
  if (!Array.isArray(appliedGiftCards)) return [];
  return appliedGiftCards
    .map(entry => ({
      giftCardId: String(entry?.giftCardId || '').trim(),
      code: String(entry?.code || '').trim().toUpperCase(),
      password: String(entry?.password || '').trim(),
      amount: toAmount(entry?.amountUsed ?? entry?.amount)
    }))
    .filter(entry => entry.code && entry.amount > 0);
}

function normalizeTotals(totals = {}) {
  return {
    basePrice: toAmount(totals?.basePrice),
    discountAmount: toAmount(totals?.discountAmount),
    subtotal: toAmount(totals?.subtotal),
    giftCardUsed: toAmount(totals?.giftCardUsed),
    remainingToPay: toAmount(totals?.remainingToPay)
  };
}

export function getCheckoutAmountDue(checkoutState = {}) {
  const totals = checkoutState?.totals || {};
  if (totals?.amountToPay !== undefined && totals?.amountToPay !== null) {
    return toAmount(totals.amountToPay);
  }
  return toAmount(totals.remainingToPay);
}

function normalizeLegalState(legalState, item = {}) {
  const legacyWaiverAccepted =
    typeof legalState === 'boolean' ? legalState : Boolean(legalState?.waiverAccepted);
  const waiverRequired =
    typeof legalState === 'object'
      ? Boolean(legalState?.waiverRequired)
      : Boolean(item?.waiverRequired);
  const waiverAccepted =
    typeof legalState === 'object'
      ? Boolean(legalState?.waiverAccepted)
      : legacyWaiverAccepted;
  const waiverText =
    typeof legalState === 'object' ? String(legalState?.waiverText || '').trim() : '';
  const acceptedCgv =
    typeof legalState === 'object' ? Boolean(legalState?.acceptedCgv) : false;
  let dateFormation = null;
  if (typeof legalState === 'object' && legalState?.dateFormation) {
    const parsedFormationDate = new Date(legalState.dateFormation);
    if (!Number.isNaN(parsedFormationDate.getTime())) {
      dateFormation = parsedFormationDate.toISOString();
    }
  }
  return {
    acceptedCgv,
    waiverRequired,
    waiverAccepted,
    waiverText,
    dateFormation
  };
}

function isLegalStateValid(checkoutState) {
  const legal = checkoutState?.legal || {};
  if (!legal.acceptedCgv) return false;
  if (legal.waiverRequired && !legal.waiverAccepted) return false;
  if (legal.waiverRequired && !String(legal.waiverText || '').trim()) return false;
  return true;
}

function saveCheckoutResult(payload) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(
    CHECKOUT_RESULT_KEY,
    serializeForStorage({
      ...payload,
      createdAt: new Date().toISOString()
    })
  );
}

function navigateToOrigin(origin, fallbackItem) {
  const fallback = buildDefaultOrigin(fallbackItem?.type, fallbackItem?.id);
  const targetSlug = sanitizeSlug(origin?.slug) || fallback.slug;
  const targetQuery = sanitizeQuery(origin?.query);
  const finalQuery = Object.keys(targetQuery).length ? targetQuery : fallback.query;
  requestVitrineNavigation(targetSlug, {
    source: 'checkout-finalize',
    skipThrottle: true,
    query: finalQuery
  });
}

export async function submitFreeCheckoutRequest({ checkoutState, idempotencyKey } = {}) {
  const response = await fetch(FREE_CHECKOUT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      checkoutState,
      idempotencyKey: String(idempotencyKey || '').trim() || undefined
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const isPaymentRequired =
      response.status === 402 ||
      String(data?.code || data?.error || '').trim().toUpperCase() === 'PAYMENT_REQUIRED';
    const error = new Error(
      data?.message ||
        data?.error ||
        (isPaymentRequired
          ? 'Un paiement complementaire est requis pour finaliser cette commande.'
          : 'Impossible de confirmer votre achat.')
    );
    error.code = data?.code || data?.error || 'PURCHASE_FAILED';
    error.status = response.status;
    throw error;
  }
  return data;
}

function triggerAcquisitionForFormation(checkoutState, sourceElement) {
  if (checkoutState?.item?.type !== 'formation') return;
  incrementAcquisitionNotifications(ACQUISITION_PAGES.MY_FORMATIONS, 1);
  triggerFlyToTarget({
    sourceElement: sourceElement || document.body,
    targetSelector: '.header-burger-button',
    mode: 'acquisition'
  });
}

export function buildCheckoutState(
  item,
  appliedGiftCards,
  totals,
  legalState,
  origin = null
) {
  const itemType = String(item?.type || '').toLowerCase() === 'product' ? 'product' : 'formation';
  const normalizedItem = {
    type: itemType,
    id: String(item?.id || '').trim(),
    name: String(item?.name || '').trim(),
    itemSubType: String(item?.itemSubType || '').trim().toLowerCase(),
    sessionId: String(item?.sessionId || '').trim(),
    coverImage: String(item?.coverImage || '').trim(),
    selectedOptions: Array.isArray(item?.selectedOptions)
      ? item.selectedOptions
          .filter(o => o && String(o.optionId || '').trim())
          .map(o => ({
            optionId: String(o.optionId).trim(),
            name: String(o.name || '').trim(),
            price: roundToCents(Number(o.price) || 0)
          }))
      : []
  };
  const normalizedGiftCards = normalizeAppliedGiftCards(appliedGiftCards);
  const normalizedTotals = normalizeTotals(totals);
  const legal = normalizeLegalState(legalState, item);
  const originSlug = sanitizeSlug(origin?.slug);
  const originQuery = sanitizeQuery(origin?.query);
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    item: normalizedItem,
    items: [normalizedItem],
    appliedGiftCards: normalizedGiftCards,
    totals: normalizedTotals,
    legal,
    waiver: {
      required: legal.waiverRequired,
      accepted: legal.waiverAccepted
    },
    paymentProvider: 'stripe',
    paymentIntentId: null,
    origin: {
      slug: originSlug || 'item-detail',
      query:
        Object.keys(originQuery).length > 0
          ? originQuery
          : buildDefaultOrigin(itemType, normalizedItem.id).query
    }
  };
}

export function createCheckoutStateToken(checkoutState) {
  const storage = getStorage();
  if (!storage || !checkoutState) return '';
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  storage.setItem(
    `${CHECKOUT_STATE_PREFIX}${token}`,
    serializeForStorage({
      expiresAt: Date.now() + CHECKOUT_STATE_TTL_MS,
      state: checkoutState
    })
  );
  return token;
}

export function readCheckoutStateToken(token, { consume = false } = {}) {
  const storage = getStorage();
  if (!storage) return null;
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken) return null;
  const storageKey = `${CHECKOUT_STATE_PREFIX}${normalizedToken}`;
  const payload = parseFromStorage(storage.getItem(storageKey));
  if (!payload?.state) {
    if (consume) storage.removeItem(storageKey);
    return null;
  }
  const expiresAt = Number(payload.expiresAt || 0);
  if (expiresAt && Date.now() > expiresAt) {
    storage.removeItem(storageKey);
    return null;
  }
  if (consume) {
    storage.removeItem(storageKey);
  }
  return payload.state;
}

export function consumeCheckoutResult({ itemType, itemId } = {}) {
  const storage = getStorage();
  if (!storage) return null;
  const payload = parseFromStorage(storage.getItem(CHECKOUT_RESULT_KEY));
  if (!payload) return null;
  const createdAt = Date.parse(payload?.createdAt || '');
  if (Number.isFinite(createdAt) && Date.now() - createdAt > CHECKOUT_STATE_TTL_MS) {
    storage.removeItem(CHECKOUT_RESULT_KEY);
    return null;
  }
  const normalizedType = String(itemType || '').trim().toLowerCase();
  const normalizedId = String(itemId || '').trim();
  const payloadType = String(payload?.itemType || '').trim().toLowerCase();
  const payloadId = String(payload?.itemId || '').trim();
  if (
    normalizedType &&
    normalizedId &&
    (payloadType !== normalizedType || payloadId !== normalizedId)
  ) {
    return null;
  }
  storage.removeItem(CHECKOUT_RESULT_KEY);
  return payload;
}

export function buildCartCheckoutState(
  cartItems,
  appliedGiftCards,
  totals,
  consumerWaivers,
  refundPolicySnapshots,
  legal = {}
) {
  const normalizedItems = Array.isArray(cartItems)
    ? cartItems.map(item => ({
        type: String(item?.type || '').toLowerCase(),
        id: String(item?.id || '').trim(),
        name: String(item?.name || '').trim(),
        sessionId: String(item?.sessionId || '').trim() || null,
        selectedOptions: Array.isArray(item?.selectedOptions)
          ? item.selectedOptions
              .filter(o => String(o?.optionId || '').trim())
              .map(o => ({
                optionId: String(o.optionId).trim(),
                name: String(o.name || '').trim(),
                price: roundToCents(Number(o.price) || 0)
              }))
          : []
      }))
    : [];
  const normalizedWaivers = Array.isArray(consumerWaivers)
    ? consumerWaivers.map(w => ({
        type: String(w?.type || '').trim(),
        text: String(w?.text || '').trim(),
        accepted: Boolean(w?.accepted),
        formationIds: Array.isArray(w?.formationIds)
          ? w.formationIds.map(id => String(id || '').trim()).filter(Boolean)
          : []
      }))
    : [];
  const normalizedSnapshots =
    refundPolicySnapshots && typeof refundPolicySnapshots === 'object'
      ? Object.fromEntries(
          Object.entries(refundPolicySnapshots).map(([key, val]) => [
            key,
            {
              refundDays: typeof val?.refundDays === 'number' ? val.refundDays : null,
              daysBeforeFormation:
                typeof val?.daysBeforeFormation === 'number' ? val.daysBeforeFormation : null,
              waiverType: val?.waiverType || null,
              waiverText: String(val?.waiverText || '').trim() || null,
              acceptedAt: val?.acceptedAt || null
            }
          ])
        )
      : {};
  return {
    cart: true,
    version: 1,
    createdAt: new Date().toISOString(),
    items: normalizedItems,
    consumerWaivers: normalizedWaivers,
    refundPolicySnapshots: normalizedSnapshots,
    appliedGiftCards: normalizeAppliedGiftCards(appliedGiftCards),
    totals: normalizeTotals(totals),
    legal: { acceptedCgv: Boolean(legal?.acceptedCgv) },
    paymentProvider: 'stripe',
    paymentIntentId: null,
    origin: { slug: 'cart', query: {} }
  };
}

function resolveCheckoutContext(checkoutState) {
  if (checkoutState?.cart === true) {
    const firstItem =
      Array.isArray(checkoutState?.items) && checkoutState.items.length > 0
        ? checkoutState.items[0]
        : null;
    return {
      fallbackItem: firstItem || { type: 'formation', id: '' },
      itemType: 'cart',
      itemId: 'cart'
    };
  }
  const item =
    checkoutState?.item && typeof checkoutState.item === 'object' ? checkoutState.item : {};
  return {
    fallbackItem: item,
    itemType: String(item?.type || checkoutState?.itemType || '').trim().toLowerCase(),
    itemId: String(item?.id || '').trim()
  };
}

export async function finalizePurchase({
  outcome,
  checkoutState,
  sourceElement,
  idempotencyKey
} = {}) {
  const normalizedOutcome = outcome === 'failed' ? 'failed' : 'success';
  const state = checkoutState || null;
  const { fallbackItem, itemType, itemId } = resolveCheckoutContext(state);
  if (!state || (!state?.cart && !itemId)) {
    return { ok: false, code: 'MISSING_CHECKOUT_STATE' };
  }
  if (!isLegalStateValid(state)) {
    saveCheckoutResult({
      status: 'failed',
      message: 'Veuillez accepter les conditions pour continuer.',
      itemType,
      itemId
    });
    navigateToOrigin(state.origin, fallbackItem);
    return { ok: false, code: 'LEGAL_VALIDATION_REQUIRED' };
  }
  if (normalizedOutcome === 'failed') {
    saveCheckoutResult({
      status: 'failed',
      message: 'Paiement non valide. Aucun debit n a ete effectue et votre achat n est pas confirme.',
      itemType,
      itemId
    });
    navigateToOrigin(state.origin, fallbackItem);
    return { ok: false, code: 'PAYMENT_FAILED' };
  }

  if (getCheckoutAmountDue(state) === 0) {
    try {
      const response = await submitFreeCheckoutRequest({ checkoutState: state, idempotencyKey });
      triggerAcquisitionForFormation(state, sourceElement);
      saveCheckoutResult({
        status: 'success',
        message: 'Paiement valide. Votre achat est confirme.',
        itemType,
        itemId
      });
      navigateToOrigin(state.origin, fallbackItem);
      return { ok: true, response };
    } catch (error) {
      saveCheckoutResult({
        status: 'failed',
        message:
          error?.message ||
          'Paiement non valide. Aucun debit n a ete effectue et votre achat n est pas confirme.',
        itemType,
        itemId
      });
      navigateToOrigin(state.origin, fallbackItem);
      return { ok: false, code: error?.code || 'PURCHASE_FAILED', error };
    }
  }

  // Stripe: purchase already handled server-side by webhook, skip backend call
  if (state.paymentProvider === 'stripe') {
    triggerAcquisitionForFormation(state, sourceElement);
    saveCheckoutResult({
      status: 'success',
      message: 'Paiement valide. Votre achat est confirme.',
      itemType,
      itemId
    });
    navigateToOrigin(state.origin, fallbackItem);
    return { ok: true };
  }

  return { ok: false, code: 'UNSUPPORTED_PAYMENT_PROVIDER' };
}
