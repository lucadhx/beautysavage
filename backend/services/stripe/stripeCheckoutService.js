// services/stripe/stripeCheckoutService.js
// Sprint F2 — Extraction PUREMENT STRUCTURELLE de la création de session de paiement Stripe
// (PaymentIntent) hors de stripeController. Aucune modification de comportement.
//
// `createCheckoutSessionFromRequest(req)` renvoie un résultat `{ status, json }` mappé en
// réponse HTTP par stripeResponseMapper — le contrôleur ne fait qu'orchestrer. Toute la
// validation (catalogue, légal A1, offre A7, anti-doublon, pricing serveur B2 faisant foi),
// la persistance de StripeCheckoutIntent et la réservation des cartes cadeaux sont déplacées
// verbatim. Les statuts/codes d'erreur sont strictement préservés.

import mongoose from 'mongoose';

import { getSessionUserId } from '../../utils/session.js';
import { extractClientIp } from '../../utils/requestClientIp.js';
import User from '../../models/user.js';
import Product from '../../models/Product.js';
import Formation from '../../models/Formation.js';
import FormationSession, { buildActiveFormationSessionFilter } from '../../models/FormationSession.js';
import GiftCardConfig from '../../models/GiftCardConfig.js';
import Purchase from '../../models/Purchase.js';
import StripeCheckoutIntent from '../../models/StripeCheckoutIntent.js';
import { assertGlobalServiceSlotBookable } from '../calendar/globalAvailabilityService.js';
import { deriveLegalRequirements, validateCheckoutLegalConsents } from '../legalConsentService.js';
import { assertCheckoutFormationsPurchasable } from '../offerReadinessService.js';
import { buildServerCheckoutPricing, assertClientPricingMatchesServer } from '../checkoutPricingService.js';
import {
  reserveGiftCardAmountsForPaymentIntent,
  releaseGiftCardReservationsForPaymentIntent
} from '../giftCardReservationService.js';
import { getStripeClient } from './stripeConfigService.js';
import { resolveVitrineBaseUrl } from '../system/domainResolver.js';
import { buildPaymentIntentCheckoutMetadata, roundToCents } from './stripeMetadataService.js';
// Sprint U2 — checkout Stripe HÉBERGÉ (feature flag) + moteur UnifiedCheckout.
import { isCheckoutHostedEnabled } from '../checkout/unified/unifiedCheckoutConfig.js';
import { createUnifiedCheckoutRecord } from '../checkout/unified/unifiedCheckoutFactory.js';
import { updateCheckout } from '../checkout/unified/unifiedCheckoutRepository.js';
import { isReactOfficialFrontend } from '../system/reactFrontend.js';

// R2C — URLs de retour du Checkout hébergé. Si `CHECKOUT_RETURN_BASE_URL` (env, http(s) absolue) est
// défini → retour vers les pages React /paiement/succes|annule ; sinon → URLs Vanilla (inchangées).
// La base vient UNIQUEMENT de l'env (jamais du client) → pas de risque d'open redirect.
export function buildHostedReturnUrls(publicBase, checkoutId) {
  const base = String(process.env.CHECKOUT_RETURN_BASE_URL || '').trim().replace(/\/+$/, '');
  if (base && /^https?:\/\//i.test(base)) {
    const cid = checkoutId ? `&checkoutId=${encodeURIComponent(String(checkoutId))}` : '';
    return {
      success_url: `${base}/paiement/succes?session_id={CHECKOUT_SESSION_ID}${cid}`,
      cancel_url: `${base}/paiement/annule`
    };
  }
  // RX-GO — flag-aware : quand REACT_OFFICIAL_FRONTEND=ON (et sans base env), retour vers les pages React
  // servies sous /app. Flag OFF → URLs Vanilla historiques (inchangées). Rollback = flag OFF.
  if (isReactOfficialFrontend()) {
    const cid = checkoutId ? `&checkoutId=${encodeURIComponent(String(checkoutId))}` : '';
    return {
      success_url: `${publicBase}/app/paiement/succes?session_id={CHECKOUT_SESSION_ID}${cid}`,
      cancel_url: `${publicBase}/app/paiement/annule`
    };
  }
  return {
    success_url: `${publicBase}/vitrine.html?slug=payment&checkout_session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${publicBase}/vitrine.html?slug=checkout`
  };
}

function isLegalStateValid(checkoutState) {
  const legal = checkoutState?.legal || {};
  if (!legal.acceptedCgv) return false;
  if (legal.waiverRequired && !legal.waiverAccepted) return false;
  if (legal.waiverRequired && !String(legal.waiverText || '').trim()) return false;
  return true;
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || '').trim());
}

function normalizeCheckoutItems(checkoutState) {
  const list = Array.isArray(checkoutState?.items) && checkoutState.items.length
    ? checkoutState.items
    : checkoutState?.item
      ? [checkoutState.item]
      : [];
  return list
    .map(entry => {
      const rawType = String(entry?.type || '').trim().toLowerCase();
      const type = rawType === 'product' || rawType === 'gift-card' ? rawType : 'formation';
      return {
        type,
        id: String(entry?.id || '').trim() || (type === 'gift-card' ? 'gift-card' : ''),
        sessionId: String(entry?.sessionId || '').trim()
      };
    })
    .filter(entry => entry.type === 'gift-card' || entry.id);
}

function parseGiftCardCheckoutAmount(checkoutState) {
  const item = checkoutState?.item && typeof checkoutState.item === 'object' ? checkoutState.item : {};
  const rawAmount = Number(
    item?.amount ??
      checkoutState?.totals?.subtotal ??
      checkoutState?.totals?.basePrice ??
      checkoutState?.totals?.remainingToPay
  );
  if (!Number.isFinite(rawAmount)) return 0;
  return roundToCents(rawAmount);
}

async function validateGiftCardCheckoutState(checkoutState = {}) {
  const amount = parseGiftCardCheckoutAmount(checkoutState);
  if (!Number.isFinite(amount) || amount <= 0) {
    const error = new Error('Montant carte cadeau invalide.');
    error.status = 400;
    error.code = 'GIFT_CARD_AMOUNT_INVALID';
    throw error;
  }

  const config = await GiftCardConfig.findOne().sort({ createdAt: -1 }).select({ minAmount: 1 }).lean();
  const minAmount = Number(config?.minAmount || 50);
  if (amount < minAmount) {
    const error = new Error(`Le montant minimal est de ${minAmount} EUR.`);
    error.status = 400;
    error.code = 'GIFT_CARD_MIN_AMOUNT';
    throw error;
  }
}

async function validateCheckoutStateAgainstCatalog({ userId, checkoutState }) {
  const normalizedUserId = String(userId || '').trim();
  if (!isValidObjectId(normalizedUserId)) {
    const error = new Error('Utilisateur invalide.');
    error.status = 400;
    error.code = 'INVALID_USER';
    throw error;
  }
  const userExists = await User.exists({ _id: normalizedUserId });
  if (!userExists) {
    const error = new Error('Utilisateur introuvable.');
    error.status = 400;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }

  const item = checkoutState?.item && typeof checkoutState.item === 'object' ? checkoutState.item : {};
  const rawItemType = String(item?.type || '').trim().toLowerCase();
  const itemType = rawItemType === 'product' || rawItemType === 'gift-card' ? rawItemType
    : rawItemType === 'service' ? 'service'
    : 'formation';
  // Service booking: booking is pre-validated at creation — skip catalog check
  if (itemType === 'service') return;
  if (itemType === 'gift-card') {
    await validateGiftCardCheckoutState(checkoutState);
    return;
  }

  const itemId = String(item?.id || '').trim();
  if (!isValidObjectId(itemId)) {
    const error = new Error('Article invalide.');
    error.status = 400;
    error.code = 'INVALID_ITEM_ID';
    throw error;
  }
  if (itemType === 'product') {
    const product = await Product.findById(itemId).select({ _id: 1, active: 1 }).lean();
    if (!product || !product.active) {
      const error = new Error('Produit introuvable.');
      error.status = 404;
      error.code = 'PRODUCT_NOT_FOUND';
      throw error;
    }
    return;
  }
  const formation = await Formation.findById(itemId)
    .select({ _id: 1, status: 1, type: 1, options: 1 })
    .lean();
  if (!formation || formation.status !== 'published') {
    const error = new Error('Formation introuvable.');
    error.status = 404;
    error.code = 'FORMATION_NOT_FOUND';
    throw error;
  }

  const selectedOptions = Array.isArray(item?.selectedOptions) ? item.selectedOptions : [];
  if (formation.type !== 'presentiel') {
    if (selectedOptions.length) {
      const error = new Error('Options indisponibles pour cette formation.');
      error.status = 400;
      error.code = 'INVALID_OPTIONS_FOR_FORMATION';
      throw error;
    }
    return;
  }

  const sessionId = String(item?.sessionId || '').trim();
  if (!isValidObjectId(sessionId)) {
    const error = new Error('Session requise pour une formation en presentiel.');
    error.status = 400;
    error.code = 'SESSION_REQUIRED';
    throw error;
  }

  const targetSession = await FormationSession.findOne(
    buildActiveFormationSessionFilter({
      _id: sessionId,
      formationId: formation._id
    })
  )
    .select({ _id: 1, startDate: 1, reservedCount: 1, maxClients: 1 })
    .lean();
  if (!targetSession) {
    const error = new Error('Session introuvable.');
    error.status = 404;
    error.code = 'SESSION_NOT_FOUND';
    throw error;
  }
  if (Number(targetSession.reservedCount || 0) >= Number(targetSession.maxClients || 0)) {
    const error = new Error('Session complete.');
    error.status = 409;
    error.code = 'SESSION_FULL';
    throw error;
  }

  if (!selectedOptions.length) return;
  const optionMap = new Map(
    (Array.isArray(formation.options) ? formation.options : []).map(option => [
      option?._id?.toString(),
      option
    ])
  );
  const nowMs = Date.now();
  const sessionStartMs = new Date(targetSession.startDate).getTime();
  for (const raw of selectedOptions) {
    const optionId = String(raw?.optionId || '').trim();
    if (!isValidObjectId(optionId)) {
      const error = new Error('Option invalide.');
      error.status = 400;
      error.code = 'INVALID_OPTION_ID';
      throw error;
    }
    const option = optionMap.get(optionId);
    if (!option) {
      const error = new Error(`Option ${optionId} introuvable sur cette formation.`);
      error.status = 400;
      error.code = 'OPTION_NOT_FOUND';
      throw error;
    }
    const deadlineMs = Number(option?.deadlineDays || 0) * 86400000;
    if (!sessionStartMs || sessionStartMs - nowMs <= deadlineMs) {
      const error = new Error(`L'option "${String(option?.name || 'Option')}" n'est plus disponible.`);
      error.status = 400;
      error.code = 'OPTION_DEADLINE_EXCEEDED';
      throw error;
    }
  }
}

async function validateCartItemsAgainstCatalog({ userId, checkoutState }) {
  const normalizedUserId = String(userId || '').trim();
  if (!isValidObjectId(normalizedUserId)) {
    const error = new Error('Utilisateur invalide.');
    error.status = 400;
    error.code = 'INVALID_USER';
    throw error;
  }
  const userExists = await User.exists({ _id: normalizedUserId });
  if (!userExists) {
    const error = new Error('Utilisateur introuvable.');
    error.status = 400;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }
  const cartItems = Array.isArray(checkoutState?.items) ? checkoutState.items : [];
  if (!cartItems.length) {
    const error = new Error('Panier vide.');
    error.status = 400;
    error.code = 'EMPTY_CART';
    throw error;
  }
  for (const item of cartItems) {
    const rawType = String(item?.type || '').trim().toLowerCase();
    const itemType = rawType === 'product' ? 'product' : 'formation';
    const itemId = String(item?.id || '').trim();
    if (!isValidObjectId(itemId)) {
      const error = new Error('Article invalide dans le panier.');
      error.status = 400;
      error.code = 'INVALID_ITEM_ID';
      throw error;
    }
    if (itemType === 'product') {
      const product = await Product.findById(itemId).select({ _id: 1, active: 1 }).lean();
      if (!product || !product.active) {
        const error = new Error('Produit introuvable.');
        error.status = 404;
        error.code = 'PRODUCT_NOT_FOUND';
        throw error;
      }
    } else {
      const formation = await Formation.findById(itemId)
        .select({ _id: 1, status: 1, type: 1 })
        .lean();
      if (!formation || formation.status !== 'published') {
        const error = new Error('Formation introuvable.');
        error.status = 404;
        error.code = 'FORMATION_NOT_FOUND';
        throw error;
      }
      if (formation.type === 'presentiel') {
        const sessionId = String(item?.sessionId || '').trim();
        if (!isValidObjectId(sessionId)) {
          const error = new Error('Session requise pour une formation en presentiel.');
          error.status = 400;
          error.code = 'SESSION_REQUIRED';
          throw error;
        }
        const targetSession = await FormationSession.findOne(
          buildActiveFormationSessionFilter({ _id: sessionId, formationId: formation._id })
        )
          .select({ _id: 1, reservedCount: 1, maxClients: 1 })
          .lean();
        if (!targetSession) {
          const error = new Error('Session introuvable.');
          error.status = 404;
          error.code = 'SESSION_NOT_FOUND';
          throw error;
        }
        if (Number(targetSession.reservedCount || 0) >= Number(targetSession.maxClients || 0)) {
          const error = new Error('Session complete.');
          error.status = 409;
          error.code = 'SESSION_FULL';
          throw error;
        }
      }
    }
  }
}

async function hasActiveFormationPurchase({ userId, formationId, sessionId }) {
  if (!isValidObjectId(formationId)) return false;
  const query = {
    userId,
    itemType: 'formation',
    itemId: formationId,
    participationStatus: { $ne: 'canceled' }
  };
  if (sessionId && isValidObjectId(sessionId)) {
    query.sessionId = sessionId;
  } else {
    query.sessionId = null;
  }
  return Boolean(await Purchase.exists(query));
}

/**
 * POST /api/stripe/create-checkout-session
 * Creates a Stripe PaymentIntent, stores checkoutState in MongoDB, returns clientSecret.
 * Renvoie un résultat `{ status, json }` (mappé par stripeResponseMapper).
 */
export async function createCheckoutSessionFromRequest(req) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return { status: 401, json: { ok: false, error: 'Authentification requise.' } };
  }

  const checkoutState = req.body?.checkoutState;
  if (!checkoutState) {
    return { status: 400, json: { ok: false, error: 'checkoutState manquant.' } };
  }

  const isCart = checkoutState?.cart === true;
  const isServiceBooking = String(checkoutState?.item?.type || '').trim().toLowerCase() === 'service';

  if (isServiceBooking) {
    // Vérifier suspension pour les bookings de service
    const clientUser = await User.findById(userId).select('bookingSuspended').lean();
    if (clientUser?.bookingSuspended) {
      return {
        status: 403,
        json: {
          ok: false,
          code: 'BOOKING_SUSPENDED',
          error: 'Compte suspendu — réservation impossible.'
        }
      };
    }

    // Service booking: CGV required — catalog re-validation happens in webhook (processServiceCheckoutStatePurchase)
    if (!checkoutState.legal?.acceptedCgv) {
      return {
        status: 400,
        json: {
          ok: false,
          error: 'Conditions générales non acceptées.',
          code: 'LEGAL_VALIDATION_REQUIRED'
        }
      };
    }
    if (!checkoutState.service?.serviceId || !checkoutState.service?.slotStart || !checkoutState.service?.slotEnd) {
      return {
        status: 400,
        json: {
          ok: false,
          error: 'Données de réservation incomplètes.',
          code: 'CHECKOUT_CONTEXT_INVALID'
        }
      };
    }
    try {
      // M11A — réservabilité GLOBALE institut : le `practitionerId` legacy du front est ignoré.
      await assertGlobalServiceSlotBookable({
        serviceId: checkoutState.service.serviceId,
        startAt: checkoutState.service.slotStart,
        endAt: checkoutState.service.slotEnd,
        now: new Date()
      });
    } catch (validationError) {
      return {
        status: Number(validationError?.status || 400),
        json: {
          ok: false,
          error: validationError?.message || 'Ce creneau n est plus disponible.',
          code: validationError?.code || 'CHECKOUT_CONTEXT_INVALID'
        }
      };
    }
  } else if (isCart) {
    if (!checkoutState.legal?.acceptedCgv) {
      return {
        status: 400,
        json: {
          ok: false,
          error: 'Conditions generales non acceptees.',
          code: 'LEGAL_VALIDATION_REQUIRED'
        }
      };
    }
    const cartWaivers = Array.isArray(checkoutState.consumerWaivers) ? checkoutState.consumerWaivers : [];
    const unacceptedWaivers = cartWaivers.filter(w => !w.accepted);
    if (unacceptedWaivers.length) {
      return {
        status: 400,
        json: {
          ok: false,
          error: 'Toutes les renonciations doivent etre acceptees.',
          code: 'WAIVER_NOT_ACCEPTED'
        }
      };
    }
    try {
      await validateCartItemsAgainstCatalog({ userId, checkoutState });
    } catch (validationError) {
      return {
        status: Number(validationError?.status || 400),
        json: {
          ok: false,
          error: validationError?.message || 'Contexte checkout invalide.',
          code: validationError?.code || 'CHECKOUT_CONTEXT_INVALID'
        }
      };
    }
  } else {
    const rawItemType = String(checkoutState?.item?.type || '').trim().toLowerCase();
    const requiresItemId = rawItemType !== 'gift-card';
    if (requiresItemId && !checkoutState.item?.id) {
      return { status: 400, json: { ok: false, error: 'checkoutState manquant ou invalide.' } };
    }
    if (!isLegalStateValid(checkoutState)) {
      return {
        status: 400,
        json: {
          ok: false,
          error: 'Conditions generales non acceptees ou renonciation manquante.',
          code: 'LEGAL_VALIDATION_REQUIRED'
        }
      };
    }
    try {
      await validateCheckoutStateAgainstCatalog({ userId, checkoutState });
    } catch (validationError) {
      return {
        status: Number(validationError?.status || 400),
        json: {
          ok: false,
          error: validationError?.message || 'Contexte checkout invalide.',
          code: validationError?.code || 'CHECKOUT_CONTEXT_INVALID'
        }
      };
    }
  }

  // Sprint pré-React A1 — revalidation serveur des consentements légaux (CGV /
  // rétractation / renonciation). Le serveur re-dérive les consentements requis
  // depuis le CATALOGUE (type de formation, prestation datée, date de session) et
  // refuse l'achat si un consentement requis manque — sans faire confiance aux
  // booléens client (waiverRequired, accepted_cgv inventé). Voir rapports 74/82/84.
  try {
    const legalRequirements = await deriveLegalRequirements(checkoutState);
    validateCheckoutLegalConsents(checkoutState, legalRequirements);
  } catch (legalError) {
    return {
      status: Number(legalError?.status) || 400,
      json: {
        ok: false,
        error: legalError?.message || 'Consentement légal requis.',
        code: legalError?.code || 'LEGAL_CONSENT_REQUIRED'
      }
    };
  }

  // Sprint pré-React A7 — bloque les offres formation non finies (distanciel immédiat
  // sans accès configuré). Avant création du PaymentIntent.
  try {
    await assertCheckoutFormationsPurchasable(checkoutState);
  } catch (offerError) {
    return {
      status: Number(offerError?.status) || 409,
      json: {
        ok: false,
        error: offerError?.message || 'Offre indisponible.',
        code: offerError?.code || 'OFFER_NOT_AVAILABLE'
      }
    };
  }

  const checkoutItems = normalizeCheckoutItems(checkoutState);
  for (const item of checkoutItems) {
    if (item.type !== 'formation') continue;
    const alreadyPurchased = await hasActiveFormationPurchase({
      userId,
      formationId: item.id,
      sessionId: item.sessionId
    });
    if (alreadyPurchased) {
      return {
        status: 409,
        json: {
          ok: false,
          error: 'ALREADY_PURCHASED',
          code: 'ALREADY_PURCHASED'
        }
      };
    }
  }

  // S1C — la base publique vient de SystemConfiguration (vitrineUrl) via le DomainResolver
  // (localhost au premier boot). Plus aucune dépendance au tunnel de dev.
  const publicBase = resolveVitrineBaseUrl();

  const clientIp = extractClientIp(req);
  const stripe = await getStripeClient();

  // Pré-React B2 — Le SERVEUR est l'unique source de vérité du montant. On recalcule
  // le montant à charger depuis le catalogue (prix + promotions + options − cartes
  // cadeaux capées au solde réel) et on REFUSE si le client a déclaré un montant
  // divergent (CHECKOUT_AMOUNT_MISMATCH). Le PaymentIntent est créé avec le montant
  // SERVEUR, jamais avec `checkoutState.totals` (client).
  let serverPricing;
  try {
    serverPricing = await buildServerCheckoutPricing(checkoutState);
    assertClientPricingMatchesServer(checkoutState, serverPricing);
  } catch (pricingErr) {
    return {
      status: Number(pricingErr?.status) || 400,
      json: {
        ok: false,
        error: pricingErr?.message || 'Montant checkout invalide.',
        code: pricingErr?.code || 'CHECKOUT_AMOUNT_MISMATCH'
      }
    };
  }
  // Snapshot serveur persisté avec l'intent → le finaliseur dispose du montant faisant foi.
  checkoutState.serverPricing = serverPricing;

  // Amount to charge = montant SERVEUR (acompte/plein, après cartes cadeaux serveur).
  const amountToPay = serverPricing.amountToPay;
  const amountCents = Math.round(amountToPay * 100);

  // Sprint U2 — Stripe Checkout HÉBERGÉ derrière feature flag. Le flux Elements (ci-dessous)
  // reste le fallback par défaut (CHECKOUT_HOSTED=false). La carte cadeau n'est JAMAIS un
  // discount Stripe : Stripe n'encaisse que `amountToPay` (catalogue − promo − carte cadeau).
  if (isCheckoutHostedEnabled()) {
    return createHostedCheckoutResult({
      checkoutState, userId, clientIp, serverPricing, amountToPay, amountCents, publicBase, stripe
    });
  }

  if (amountCents < 50) {
    return {
      status: 400,
      json: {
        ok: false,
        error: 'Le montant minimum pour un paiement par carte est de 0.50 EUR.',
        code: 'AMOUNT_TOO_LOW'
      }
    };
  }

  let createdPaymentIntentId = '';
  let reservationApplied = false;
  try {
    // Persist checkoutState in MongoDB (avoids Stripe metadata size limits)
    const intent = new StripeCheckoutIntent({
      checkoutState,
      userId,
      clientIp
    });
    await intent.save();

    const paymentIntentMetadata = buildPaymentIntentCheckoutMetadata({
      intentId: intent._id?.toString() || '',
      userId: String(userId || '').trim(),
      checkoutState
    });

    // Create PaymentIntent — standard stable Stripe API
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      metadata: paymentIntentMetadata
    });
    createdPaymentIntentId = String(paymentIntent?.id || '').trim();

    let persistedAppliedGiftCards = Array.isArray(checkoutState?.appliedGiftCards)
      ? checkoutState.appliedGiftCards
      : [];
    if (Array.isArray(checkoutState?.appliedGiftCards) && checkoutState.appliedGiftCards.length) {
      const reservationResult = await reserveGiftCardAmountsForPaymentIntent({
        paymentIntentId: createdPaymentIntentId,
        appliedGiftCards: checkoutState.appliedGiftCards
      });
      persistedAppliedGiftCards = reservationResult.reserved.map(entry => ({
        giftCardId: String(entry?.giftCardId || '').trim(),
        code: String(entry?.code || '').trim().toUpperCase(),
        amount: Number(entry?.amount || 0)
      }));
      reservationApplied = true;
    }

    const persistedCheckoutState = {
      ...checkoutState,
      appliedGiftCards: persistedAppliedGiftCards
    };

    // Store PaymentIntent ID and normalized applied gift-card refs for webhook lookup
    await StripeCheckoutIntent.findByIdAndUpdate(intent._id, {
      stripeSessionId: paymentIntent.id,
      checkoutState: persistedCheckoutState
    });

    const returnUrl = `${publicBase}/vitrine.html?slug=payment`;

    return {
      status: 200,
      json: {
        ok: true,
        clientSecret: paymentIntent.client_secret,
        returnUrl
      }
    };
  } catch (error) {
    if (reservationApplied && createdPaymentIntentId) {
      await releaseGiftCardReservationsForPaymentIntent(createdPaymentIntentId, {
        reason: 'checkout_session_creation_failed'
      }).catch(releaseError => {
        console.error('[Stripe] Echec liberation reservation carte cadeau', releaseError);
      });
    }
    if (createdPaymentIntentId) {
      await stripe.paymentIntents.cancel(createdPaymentIntentId).catch(cancelError => {
        console.error('[Stripe] Echec annulation PaymentIntent apres erreur checkout', cancelError);
      });
    }
    if (error?.code === 'GIFT_CARD_RESERVED_BALANCE_INSUFFICIENT') {
      return {
        status: 400,
        json: {
          ok: false,
          error: 'Solde carte cadeau insuffisant',
          code: error.code
        }
      };
    }
    const errorStatus = Number(error?.status || 0);
    if (errorStatus >= 400 && errorStatus < 500) {
      return {
        status: errorStatus,
        json: {
          ok: false,
          error: error?.message || 'Contexte checkout invalide.',
          code: error?.code || null
        }
      };
    }
    console.error('[Stripe] Erreur creation PaymentIntent', error);
    return {
      status: 500,
      json: {
        ok: false,
        error: 'Impossible de creer la session de paiement.',
        code: error?.code || null
      }
    };
  }
}

/**
 * Sprint U2 — Chemin Stripe Checkout HÉBERGÉ (feature flag CHECKOUT_HOSTED=true). La validation
 * (legal/offre/anti-doublon) et le pricing serveur ont déjà été faits par l'appelant. Crée un
 * UnifiedCheckout puis :
 *  - montant 0 € → mode "free" (pas de Stripe ; le client appelle finalize-free) ;
 *  - montant > 0 → Stripe Checkout Session hébergée (le PaymentIntent porte metadata.intentId →
 *    le webhook payment_intent.succeeded EXISTANT finalise la vente, à l'identique d'Elements ;
 *    checkout.session.completed réconcilie l'UnifiedCheckout).
 * La carte cadeau n'est JAMAIS un discount Stripe : Stripe n'encaisse que `amountToPay`.
 */
async function createHostedCheckoutResult({
  checkoutState, userId, clientIp, serverPricing, amountToPay, amountCents, publicBase, stripe
}) {
  // 0 € → aucune Stripe Session ; finalisation via finalize-free (inchangé).
  if (amountToPay <= 0) {
    const { checkout } = await createUnifiedCheckoutRecord({
      checkoutState,
      pricing: serverPricing,
      userId,
      source: 'hosted_free',
      status: 'free_ready'
    });
    return {
      status: 200,
      json: { ok: true, mode: 'free', checkoutId: checkout.checkoutId, requiresPayment: false }
    };
  }

  if (amountCents < 50) {
    return {
      status: 400,
      json: {
        ok: false,
        error: 'Le montant minimum pour un paiement par carte est de 0.50 EUR.',
        code: 'AMOUNT_TOO_LOW'
      }
    };
  }

  let createdPaymentIntentId = '';
  let reservationApplied = false;
  let sessionId = '';
  try {
    // Persiste le checkoutState (le webhook PI EXISTANT le retrouve par metadata.intentId).
    const intent = new StripeCheckoutIntent({ checkoutState, userId, clientIp });
    await intent.save();

    const { checkout } = await createUnifiedCheckoutRecord({
      checkoutState,
      pricing: serverPricing,
      userId,
      source: 'hosted_checkout',
      idempotencyKey: intent._id?.toString() || null,
      status: 'payment_pending'
    });

    const paymentIntentMetadata = buildPaymentIntentCheckoutMetadata({
      intentId: intent._id?.toString() || '',
      userId: String(userId || '').trim(),
      checkoutState
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: amountCents,
            product_data: { name: 'Beauty Savage' }
          },
          quantity: 1
        }
      ],
      // Le PI hérite de metadata.intentId → finalisation par le webhook PI existant.
      payment_intent_data: { metadata: paymentIntentMetadata },
      metadata: {
        unifiedCheckoutId: checkout.checkoutId,
        checkoutId: checkout.checkoutId,
        kind: checkout.kind,
        idempotencyKey: intent._id?.toString() || ''
      },
      ...buildHostedReturnUrls(publicBase, checkout.checkoutId)
    });
    sessionId = String(session?.id || '').trim();
    createdPaymentIntentId = String(session?.payment_intent || '').trim();

    let persistedAppliedGiftCards = Array.isArray(checkoutState?.appliedGiftCards)
      ? checkoutState.appliedGiftCards
      : [];
    if (createdPaymentIntentId && Array.isArray(checkoutState?.appliedGiftCards) && checkoutState.appliedGiftCards.length) {
      const reservationResult = await reserveGiftCardAmountsForPaymentIntent({
        paymentIntentId: createdPaymentIntentId,
        appliedGiftCards: checkoutState.appliedGiftCards
      });
      persistedAppliedGiftCards = reservationResult.reserved.map(entry => ({
        giftCardId: String(entry?.giftCardId || '').trim(),
        code: String(entry?.code || '').trim().toUpperCase(),
        amount: Number(entry?.amount || 0)
      }));
      reservationApplied = true;
    }

    // Le webhook PI retrouve l'intent par stripeSessionId = PI id (comme le flux Elements).
    await StripeCheckoutIntent.findByIdAndUpdate(intent._id, {
      stripeSessionId: createdPaymentIntentId || sessionId,
      checkoutState: { ...checkoutState, appliedGiftCards: persistedAppliedGiftCards }
    });

    await updateCheckout(checkout.checkoutId, {
      'payment.stripeCheckoutSessionId': sessionId,
      'payment.stripePaymentIntentId': createdPaymentIntentId || null
    }).catch(() => {});

    return {
      status: 200,
      json: { ok: true, mode: 'hosted', checkoutId: checkout.checkoutId, url: session.url }
    };
  } catch (error) {
    if (reservationApplied && createdPaymentIntentId) {
      await releaseGiftCardReservationsForPaymentIntent(createdPaymentIntentId, {
        reason: 'hosted_checkout_creation_failed'
      }).catch(() => {});
    }
    if (sessionId) {
      await stripe.checkout.sessions.expire(sessionId).catch(() => {});
    }
    if (error?.code === 'GIFT_CARD_RESERVED_BALANCE_INSUFFICIENT') {
      return { status: 400, json: { ok: false, error: 'Solde carte cadeau insuffisant', code: error.code } };
    }
    const errorStatus = Number(error?.status || 0);
    if (errorStatus >= 400 && errorStatus < 500) {
      return { status: errorStatus, json: { ok: false, error: error?.message || 'Contexte checkout invalide.', code: error?.code || null } };
    }
    console.error('[Stripe] Erreur creation Checkout Session hebergee', error);
    return { status: 500, json: { ok: false, error: 'Impossible de creer la session de paiement.', code: error?.code || null } };
  }
}
