// services/checkout/checkoutFacade.js
// Sprint F1 — Point d'entrée UNIQUE du domaine Checkout. Les contrôleurs/routers/webhook
// importent ICI (jamais les sous-services directement) : handler HTTP `finalizeFreeCheckout`
// + ré-exports des fonctions consommées par stripeController, giftCardController,
// serviceBookingController et clientController (mockPay/saveCartSnapshot).
//
// Aucune logique métier déplacée dans la facade : le handler 0 € reconstruit EXACTEMENT
// l'ancien `finalizeFreeCheckout` (mêmes statuts/codes/payloads) en composant
// checkoutValidationService + checkoutResponseMapper + le dispatcher de finalisation.

import crypto from 'node:crypto';

import Sale from '../../models/Sale.js';
import { getSessionUserId } from '../../utils/session.js';
import { extractClientIp } from '../../utils/requestClientIp.js';
import { emitSaleEvent } from '../businessEventService.js';
import { validateFreeCheckoutPreconditions } from './checkoutValidationService.js';
import {
  mapCheckoutValidationError,
  mapCheckoutFinalizationError
} from './checkoutResponseMapper.js';
import {
  processCheckoutStatePurchase,
  waitForExistingFreeSale
} from './checkoutFinalizationService.js';
// Sprint U2 — enregistrement best-effort d'un UnifiedCheckout pour le 0 € (gated par flag).
import { isCheckoutHostedEnabled } from './unified/unifiedCheckoutConfig.js';
import { createUnifiedCheckoutRecord } from './unified/unifiedCheckoutFactory.js';

/**
 * Phase 1B-4: POST /api/client/checkout/finalize-free
 * Finalizes a 0€ order (100% gift-card coverage OR a genuinely free item) WITHOUT
 * Stripe. Reuses the EXACT same finalizer as the Stripe webhook
 * (processCheckoutStatePurchase) — there is no parallel business flow and no
 * duplicated sale/booking/debit logic. The `requireZeroRemaining` guard re-checks
 * server-side (catalog prices minus real gift-card coverage) that nothing remains due,
 * so a partially-paid order can never be finalized for free. Idempotence reuses the
 * Phase 1B-1 unique partial index: a deterministic synthetic reference
 * `free_<idempotencyKey>` is stored in Sale.stripePaymentIntentId, so a double submit
 * collides (E11000) and resolves to the same sale.
 */
export async function finalizeFreeCheckout(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const checkoutState = req.body?.checkoutState;
  if (!checkoutState || typeof checkoutState !== 'object') {
    return res
      .status(400)
      .json({ ok: false, error: 'checkoutState manquant.', code: 'CHECKOUT_STATE_REQUIRED' });
  }

  // Préconditions serveur (legal A1 + offre A7 + pricing serveur B2). Sémantique identique :
  // legal → 400/LEGAL_CONSENT_REQUIRED ; offre → 409/OFFER_NOT_AVAILABLE.
  try {
    await validateFreeCheckoutPreconditions(checkoutState);
  } catch (validationError) {
    const { status, body } = mapCheckoutValidationError(validationError);
    return res.status(status).json(body);
  }

  // Deterministic synthetic reference → reuses the Phase 1B-1 unique partial index on
  // Sale.stripePaymentIntentId for idempotence (double submit → E11000 → idempotent).
  const rawKey = String(req.body?.idempotencyKey || '').trim();
  const safeKey = /^[A-Za-z0-9_-]{8,128}$/.test(rawKey) ? rawKey : crypto.randomUUID();
  const freeRef = `free_${safeKey}`;

  const existing = await Sale.findOne({ stripePaymentIntentId: freeRef }).select('saleId').lean();
  if (existing) {
    return res.status(200).json({ ok: true, saleId: existing.saleId, idempotent: true });
  }

  const isCart = checkoutState?.cart === true;
  const item =
    checkoutState?.item && typeof checkoutState.item === 'object' ? checkoutState.item : {};
  const clientIp = extractClientIp(req);

  try {
    const result = await processCheckoutStatePurchase({
      userId,
      itemType: isCart ? null : item?.type,
      itemId: isCart ? null : item?.id,
      sessionId: isCart ? null : item?.sessionId || null,
      selectedOptions: Array.isArray(item?.selectedOptions) ? item.selectedOptions : [],
      appliedGiftCards: Array.isArray(checkoutState?.appliedGiftCards)
        ? checkoutState.appliedGiftCards
        : [],
      checkoutState,
      waiverText: checkoutState?.legal?.waiverText || null,
      clientIp,
      stripeSessionId: freeRef,
      stripePaymentIntentId: freeRef,
      requireZeroRemaining: true
    });
    // Audit-only event (best-effort). sale.finalized is also emitted by persistSale.
    await emitSaleEvent('sale.zero_payment_finalized', result, { extra: { zeroPayment: true } });
    // Sprint U2 — enregistrement UnifiedCheckout (shadow) pour le 0 €, gated par flag, best-effort.
    // Ne modifie JAMAIS la réponse publique (try/catch ; payload inchangé).
    if (isCheckoutHostedEnabled()) {
      try {
        await createUnifiedCheckoutRecord({
          checkoutState,
          pricing: checkoutState?.serverPricing || { isZeroPayment: true, amountToPay: 0, giftCardPaymentAmount: 0 },
          userId,
          source: 'finalize_free',
          idempotencyKey: freeRef,
          status: 'finalized'
        });
      } catch (_ucErr) {
        // best-effort : l'état UnifiedCheckout est secondaire, ne casse jamais le 0 €.
      }
    }
    return res.status(200).json({ ok: true, saleId: result?.saleId });
  } catch (error) {
    // Concurrent double-submit lost the race on the unique index → idempotent success.
    const isDuplicate =
      Number(error?.code) === 11000 ||
      Boolean(error?.keyPattern && error.keyPattern.stripePaymentIntentId);
    if (isDuplicate) {
      const dup = await waitForExistingFreeSale(freeRef);
      return res.status(200).json({ ok: true, saleId: dup?.saleId, idempotent: true });
    }
    const { status, shouldLog, body } = mapCheckoutFinalizationError(error);
    if (shouldLog) {
      console.error('[finalizeFreeCheckout] Echec finalisation 0 EUR', error);
    }
    return res.status(status).json(body);
  }
}

// ── Ré-exports du domaine checkout (point d'entrée unique pour les consommateurs) ──
export {
  processCheckoutStatePurchase,
  waitForExistingFreeSale
} from './checkoutFinalizationService.js';
export { processServiceCheckoutStatePurchase } from './checkoutBookingService.js';
export {
  persistSale,
  runPostSaleSideEffects,
  applySaleCommissionSnapshot,
  buildCustomerProfile,
  buildSaleId,
  buildSaleEntry,
  buildFormationEntryFromSale,
  buildSaleCommissionSnapshot,
  validateAndBuildSelectedOptions,
  normalizeSnapshotItem,
  persistCartSnapshot,
  clearCartSnapshotBestEffort,
  rollbackSingleSale,
  assertZeroRemainingForFreeOrder
} from './checkoutPersistenceService.js';
