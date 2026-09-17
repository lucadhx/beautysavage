// services/checkout/checkoutFinalizationService.js
// Sprint F1 — Extraction PUREMENT STRUCTURELLE des finaliseurs de checkout-state hors de
// clientController. Aucune modification de comportement : fonctions déplacées verbatim
// (seuls le helper local `isValidObjectId` et le chemin du dynamic import giftCardController
// sont adaptés au nouvel emplacement).
//
// Contient le dispatcher `processCheckoutStatePurchase` (appelé par le webhook Stripe et la
// finalisation 0 €), le finaliseur panier `processCartCheckoutStatePurchase`, et l'helper
// d'idempotence `waitForExistingFreeSale`. Le finaliseur prestation vit dans
// checkoutBookingService ; la persistance/effets dans checkoutPersistenceService.

import mongoose from 'mongoose';

import Sale from '../../models/Sale.js';
import Purchase from '../../models/Purchase.js';
import Formation from '../../models/Formation.js';
import FormationSession, { buildActiveFormationSessionFilter } from '../../models/FormationSession.js';
import Product from '../../models/Product.js';
import User from '../../models/user.js';
import GiftCard from '../../models/GiftCard.js';
import {
  getActivePromotion,
  getActivePromotionsForTargets
} from '../promotionService.js';
import { resolveAccessDeliveryStatusForFormation } from '../offerReadinessService.js';
import { buildLegalConsentSnapshot } from '../legalConsentService.js';
import { planGiftCardUsage } from './checkoutGiftCardService.js';
import { processServiceCheckoutStatePurchase } from './checkoutBookingService.js';
import {
  buildCustomerProfile,
  buildSaleEntry,
  validateAndBuildSelectedOptions,
  buildFormationEntryFromSale,
  applySaleCommissionSnapshot,
  persistSale,
  runPostSaleSideEffects,
  clearCartSnapshotBestEffort,
  rollbackSingleSale,
  assertZeroRemainingForFreeOrder,
  recordCommissionTransactions
} from './checkoutPersistenceService.js';

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || '').trim());
}

async function processCartCheckoutStatePurchase({
  userId,
  customer,
  normalizedCheckoutState,
  normalizedIp,
  normalizedStripeSessionId,
  normalizedStripePaymentIntentId,
  legalDateAchat,
  requireZeroRemaining = false,
  legalConsentSnapshot = null
}) {
  const cartItems = Array.isArray(normalizedCheckoutState?.items) ? normalizedCheckoutState.items : [];
  const rawGiftCards = Array.isArray(normalizedCheckoutState?.appliedGiftCards)
    ? normalizedCheckoutState.appliedGiftCards
    : [];
  const refundPolicySnapshots = normalizedCheckoutState?.refundPolicySnapshots || {};

  const applyStripeFieldsToSale = async saleDoc => {
    if (!saleDoc) return;
    const stripePatch = {};
    if (normalizedStripeSessionId) stripePatch.stripeSessionId = normalizedStripeSessionId;
    if (normalizedStripePaymentIntentId) {
      stripePatch.stripePaymentIntentId = normalizedStripePaymentIntentId;
    }
    if (!Object.keys(stripePatch).length) return;
    await Sale.findByIdAndUpdate(saleDoc._id, stripePatch);
    Object.assign(saleDoc, stripePatch);
  };

  const formationIds = [
    ...new Set(
      cartItems
        .filter(i => String(i?.type || '').toLowerCase() === 'formation')
        .map(i => String(i?.id || '').trim())
        .filter(Boolean)
    )
  ];
  const productIds = [
    ...new Set(
      cartItems
        .filter(i => String(i?.type || '').toLowerCase() === 'product')
        .map(i => String(i?.id || '').trim())
        .filter(Boolean)
    )
  ];
  const sessionIds = [
    ...new Set(cartItems.map(i => String(i?.sessionId || '').trim()).filter(Boolean))
  ];

  const [formations, products, sessions, formationPromotions, productPromotions] = await Promise.all([
    formationIds.length ? Formation.find({ _id: { $in: formationIds } }).lean() : [],
    productIds.length ? Product.find({ _id: { $in: productIds } }).lean() : [],
    sessionIds.length
      ? FormationSession.find(buildActiveFormationSessionFilter({ _id: { $in: sessionIds } })).lean()
      : [],
    formationIds.length ? getActivePromotionsForTargets('formation', formationIds) : new Map(),
    productIds.length ? getActivePromotionsForTargets('product', productIds) : new Map()
  ]);

  const formationMap = new Map(formations.map(f => [f._id.toString(), f]));
  const productMap = new Map(products.map(p => [p._id.toString(), p]));
  const sessionMap = new Map(sessions.map(s => [s._id.toString(), s]));

  const saleItems = [];
  const createdPurchases = [];
  const reservedSessions = [];
  let saleRecord = null;
  let postSaleSideEffectsApplied = false;

  try {
    for (const item of cartItems) {
      const itemType = String(item?.type || '').trim().toLowerCase();
      const itemId = String(item?.id || '').trim();
      const itemSessionId = String(item?.sessionId || '').trim() || null;
      const selectedOptions = Array.isArray(item?.selectedOptions) ? item.selectedOptions : [];

      const policySnapshot = refundPolicySnapshots[itemId] || null;
      const consumerWaiverSnapshot =
        itemType === 'formation' && policySnapshot
          ? {
              refundDays: policySnapshot.refundDays ?? null,
              retractationDays: 14,
              waiverType: policySnapshot.waiverType || null,
              waiverAcceptedAt: policySnapshot.acceptedAt
                ? new Date(policySnapshot.acceptedAt)
                : null
            }
          : { refundDays: null, retractationDays: 14, waiverType: null, waiverAcceptedAt: null };

      if (itemType === 'product') {
        const product = productMap.get(itemId);
        if (!product || !product.active) {
          const err = new Error('Produit introuvable.');
          err.status = 404;
          throw err;
        }
        const alreadyPurchased = await Purchase.exists({
          userId,
          itemType: 'product',
          itemId: product._id
        });
        if (alreadyPurchased) {
          const err = new Error('Vous avez deja achete ce produit.');
          err.status = 409;
          throw err;
        }
        const purchase = new Purchase({
          userId,
          formationId: null,
          sessionId: null,
          paymentProvider: 'stripe',
          paymentStatus: 'paid',
          paymentRef: normalizedStripeSessionId || `STRIPE-${Date.now()}`,
          itemType: 'product',
          itemId: product._id,
          createdAt: new Date()
        });
        await purchase.save();
        createdPurchases.push({ purchase, session: null });

        const promotion = productPromotions.get(itemId);
        const saleItem = buildSaleEntry({
          type: 'product',
          itemId: product._id,
          name: product.name,
          basePrice: Number(product.price || 0),
          promotion
        });
        saleItem.consumerWaiverSnapshot = consumerWaiverSnapshot;
        saleItems.push(saleItem);
      } else {
        const formation = formationMap.get(itemId);
        if (!formation || formation.status !== 'published') {
          const err = new Error('Formation introuvable.');
          err.status = 404;
          throw err;
        }

        let purchaseSelectedOptions = [];
        let optionSaleItems = [];
        let reservedSession = null;

        if (formation.type === 'presentiel') {
          if (!itemSessionId || !isValidObjectId(itemSessionId)) {
            const err = new Error('Session requise pour une formation en presentiel.');
            err.status = 400;
            throw err;
          }
          const alreadyPurchased = await Purchase.exists({
            userId,
            itemType: 'formation',
            itemId: formation._id,
            sessionId: itemSessionId,
            participationStatus: { $ne: 'canceled' }
          });
          if (alreadyPurchased) {
            const err = new Error('Vous avez deja achete cette session.');
            err.status = 409;
            err.code = 'ALREADY_PURCHASED';
            throw err;
          }
          const targetSession = sessionMap.get(itemSessionId);
          if (!targetSession) {
            const err = new Error('Session introuvable.');
            err.status = 404;
            throw err;
          }
          const updatedSession = await FormationSession.findOneAndUpdate(
            buildActiveFormationSessionFilter({
              _id: targetSession._id,
              formationId: formation._id,
              reservedCount: { $lt: targetSession.maxClients }
            }),
            { $inc: { reservedCount: 1 } },
            { new: true }
          );
          if (!updatedSession) {
            const err = new Error('Session complete.');
            err.status = 409;
            throw err;
          }
          reservedSession = updatedSession;
          reservedSessions.push(updatedSession);

          const optionsResult = validateAndBuildSelectedOptions(
            selectedOptions,
            formation,
            targetSession.startDate
          );
          purchaseSelectedOptions = optionsResult.selectedOptions;
          optionSaleItems = optionsResult.optionSaleItems;
        } else {
          const alreadyPurchased = await Purchase.exists({
            userId,
            itemType: 'formation',
            itemId: formation._id,
            sessionId: null,
            participationStatus: { $ne: 'canceled' }
          });
          if (alreadyPurchased) {
            const err = new Error('Vous avez deja achete cette formation.');
            err.status = 409;
            throw err;
          }
        }

        const purchase = new Purchase({
          userId,
          formationId: formation._id,
          sessionId: reservedSession ? reservedSession._id : null,
          paymentProvider: 'stripe',
          paymentStatus: 'paid',
          paymentRef: normalizedStripeSessionId || `STRIPE-${Date.now()}`,
          itemType: 'formation',
          itemId: formation._id,
          selectedOptions: purchaseSelectedOptions,
          createdAt: new Date()
        });
        await purchase.save();
        createdPurchases.push({ purchase, session: reservedSession });

        const promotion = formationPromotions.get(itemId);
        const mainSaleItem = buildSaleEntry({
          type: 'formation',
          itemId: formation._id,
          formationId: formation._id,
          name: formation.name,
          basePrice: Number(formation.price || 0),
          promotion
        });
        mainSaleItem.consumerWaiverSnapshot = consumerWaiverSnapshot;
        saleItems.push(mainSaleItem);

        for (const optItem of optionSaleItems) {
          optItem.consumerWaiverSnapshot = consumerWaiverSnapshot;
          saleItems.push(optItem);
        }
      }
    }

    const totalAmount = saleItems.reduce((sum, e) => sum + Number(e.finalPrice || 0), 0);
    const giftPlan = await planGiftCardUsage(rawGiftCards, totalAmount, {
      requirePassword: false,
      reservationPaymentIntentId: normalizedStripePaymentIntentId
    });
    assertZeroRemainingForFreeOrder(requireZeroRemaining, giftPlan.remainingAmount);

    const firstAcceptedWaiver = Array.isArray(normalizedCheckoutState?.consumerWaivers)
      ? normalizedCheckoutState.consumerWaivers.find(w => w.accepted && w.text)
      : null;
    const consumerWaiver = {
      accepted_cgv: true,
      renonciation_text: firstAcceptedWaiver?.text || null,
      date_formation: null,
      date_achat: legalDateAchat,
      consumerWaiverAcceptedText: firstAcceptedWaiver?.text || null,
      consumerWaiverAcceptedAt: firstAcceptedWaiver ? legalDateAchat : null
    };

    // A7 — si le panier contient une formation distancielle, marquer la livraison
    // d'accès (pas de faux « accès immédiat »).
    const cartDistancielFormation = formations.find(
      f => String(f?.type || '').toLowerCase() === 'distanciel'
    );
    const cartAccessDeliveryStatus = cartDistancielFormation
      ? resolveAccessDeliveryStatusForFormation(cartDistancielFormation)
      : null;

    saleRecord = await persistSale({
      userId,
      customer,
      items: saleItems,
      giftCardUsage: giftPlan.saleEntries,
      consumerWaiver,
      clientIp: normalizedIp,
      stripePaymentIntentId: normalizedStripePaymentIntentId,
      stripeSessionId: normalizedStripeSessionId,
      skipPostSaleSideEffects: true,
      legalConsentSnapshot,
      accessDeliveryStatus: cartAccessDeliveryStatus
    });

    await applyStripeFieldsToSale(saleRecord);

    const formationEntries = saleItems.map(buildFormationEntryFromSale).filter(Boolean);
    if (saleRecord && formationEntries.length) {
      const commissionTransactions = await recordCommissionTransactions({
        saleId: saleRecord.saleId,
        formationEntries
      });
      await applySaleCommissionSnapshot(saleRecord, commissionTransactions);
    }

    if (saleRecord?._id && createdPurchases.length) {
      const purchaseIds = createdPurchases.map(e => e.purchase?._id).filter(Boolean);
      await Purchase.updateMany({ _id: { $in: purchaseIds } }, { saleId: saleRecord.saleId }).catch(
        () => {}
      );
    }

    if (saleRecord) {
      await runPostSaleSideEffects(saleRecord, {
        giftCardSettlement: {
          userId,
          saleItems,
          usages: giftPlan.usages,
          paymentIntentId: normalizedStripePaymentIntentId
        }
      });
      postSaleSideEffectsApplied = true;
    }

    await clearCartSnapshotBestEffort(userId);
    return { ok: true, saleId: saleRecord?.saleId };
  } catch (error) {
    if (!postSaleSideEffectsApplied) {
      const purchaseIds = createdPurchases.map(e => e.purchase?._id).filter(Boolean);
      if (purchaseIds.length) {
        await Purchase.deleteMany({ _id: { $in: purchaseIds } }).catch(() => {});
      }
      await Promise.all(
        reservedSessions.map(session =>
          FormationSession.findByIdAndUpdate(session._id, { $inc: { reservedCount: -1 } })
        )
      ).catch(() => {});
      if (saleRecord) {
        await Sale.deleteOne({ _id: saleRecord._id }).catch(() => {});
      }
    }
    throw error;
  }
}

/**
 * Process a purchase from a pre-validated checkoutState (used by Stripe webhook).
 * Mirrors mockPay logic but takes pre-validated data from checkoutState.
 * Does NOT call validateAndBuildConsumerWaiver — legal validation already done at session creation.
 */
export async function processCheckoutStatePurchase({
  userId,
  itemType,
  itemId,
  sessionId: rawSessionId,
  selectedOptions: rawSelectedOptions = [],
  appliedGiftCards: rawGiftCards = [],
  checkoutState = null,
  waiverText,
  clientIp,
  stripeSessionId,
  stripePaymentIntentId,
  requireZeroRemaining = false
}) {
  const user = await User.findById(userId).lean();
  if (!user) {
    const err = new Error('Utilisateur introuvable.');
    err.status = 400;
    throw err;
  }
  const customer = buildCustomerProfile(user);
  const normalizedCheckoutState =
    checkoutState && typeof checkoutState === 'object' ? checkoutState : null;
  const normalizedIp = String(clientIp || '').trim() || '0.0.0.0';
  const rawItemType = String(itemType || '').trim().toLowerCase();
  const normalizedItemType =
    rawItemType === 'product' ? 'product'
    : rawItemType === 'gift-card' ? 'gift-card'
    : rawItemType === 'service' ? 'service'
    : 'formation';
  const normalizedStripeSessionId = String(stripeSessionId || '').trim() || null;
  const normalizedStripePaymentIntentId =
    String(stripePaymentIntentId || normalizedStripeSessionId || '').trim() || null;
  const legalDateAchat = new Date();

  // Sprint pré-React A1 — snapshot des consentements légaux capturés à l'achat,
  // dérivé du checkoutState revalidé. Stocké sur la vente (audit/preuve).
  const legalConsentSnapshot = normalizedCheckoutState
    ? buildLegalConsentSnapshot({
        checkoutState: normalizedCheckoutState,
        acceptedAt: legalDateAchat,
        source: requireZeroRemaining ? 'free_checkout' : 'stripe_checkout'
      })
    : null;

  // Multi-item cart: delegate to dedicated handler
  if (normalizedCheckoutState?.cart === true) {
    return processCartCheckoutStatePurchase({
      userId,
      customer,
      normalizedCheckoutState,
      normalizedIp,
      normalizedStripeSessionId,
      normalizedStripePaymentIntentId,
      legalDateAchat,
      requireZeroRemaining,
      legalConsentSnapshot
    });
  }

  // Service booking: delegate to dedicated handler
  if (normalizedItemType === 'service') {
    return processServiceCheckoutStatePurchase({
      userId,
      customer,
      normalizedCheckoutState,
      normalizedIp,
      normalizedStripeSessionId,
      normalizedStripePaymentIntentId,
      requireZeroRemaining,
      legalConsentSnapshot
    });
  }

  let saleRecord = null;
  let purchaseRecord = null;
  let reservedSession = null;
  let createdGiftCard = null;
  let postSaleSideEffectsApplied = false;

  const applyStripeFieldsToSale = async saleDoc => {
    if (!saleDoc) return;
    const stripePatch = {};
    if (normalizedStripeSessionId) {
      stripePatch.stripeSessionId = normalizedStripeSessionId;
    }
    if (normalizedStripePaymentIntentId) {
      stripePatch.stripePaymentIntentId = normalizedStripePaymentIntentId;
    }
    if (!Object.keys(stripePatch).length) return;
    await Sale.findByIdAndUpdate(saleDoc._id, stripePatch);
    Object.assign(saleDoc, stripePatch);
  };

  try {
    if (normalizedItemType === 'formation') {
      const formation = await Formation.findById(itemId).lean();
      if (!formation || formation.status !== 'published') {
        const err = new Error('Formation introuvable.');
        err.status = 404;
        throw err;
      }
      let consumerWaiver;
      let purchaseSelectedOptions = [];
      let optionSaleItemsForStripe = [];

      if (formation.type === 'presentiel') {
        if (!isValidObjectId(rawSessionId)) {
          const err = new Error('Session requise pour une formation en presentiel.');
          err.status = 400;
          throw err;
        }
        const alreadyPurchasedSameSession = await Purchase.exists({
          userId,
          itemType: 'formation',
          itemId: formation._id,
          sessionId: rawSessionId,
          participationStatus: { $ne: 'canceled' }
        });
        if (alreadyPurchasedSameSession) {
          const err = new Error('Vous avez deja achete cette session.');
          err.status = 409;
          err.code = 'ALREADY_PURCHASED';
          throw err;
        }
        const targetSession = await FormationSession.findOne(
          buildActiveFormationSessionFilter({ _id: rawSessionId, formationId: formation._id })
        ).lean();
        if (!targetSession) {
          const err = new Error('Session introuvable.');
          err.status = 404;
          throw err;
        }
        consumerWaiver = {
          accepted_cgv: true,
          renonciation_text: waiverText || null,
          date_formation: targetSession.startDate,
          date_achat: legalDateAchat,
          consumerWaiverAcceptedText: waiverText || null,
          consumerWaiverAcceptedAt: waiverText ? legalDateAchat : null
        };
        const updatedSession = await FormationSession.findOneAndUpdate(
          buildActiveFormationSessionFilter({
            _id: targetSession._id,
            formationId: formation._id,
            reservedCount: { $lt: targetSession.maxClients }
          }),
          { $inc: { reservedCount: 1 } },
          { new: true }
        );
        if (!updatedSession) {
          const err = new Error('Session complete.');
          err.status = 409;
          throw err;
        }
        reservedSession = updatedSession;
        const optionsResult = validateAndBuildSelectedOptions(
          rawSelectedOptions,
          formation,
          targetSession.startDate
        );
        purchaseSelectedOptions = optionsResult.selectedOptions;
        optionSaleItemsForStripe = optionsResult.optionSaleItems;
      } else {
        const alreadyPurchased = await Purchase.exists({
          userId,
          itemType: 'formation',
          itemId: formation._id,
          sessionId: null,
          participationStatus: { $ne: 'canceled' }
        });
        if (alreadyPurchased) {
          const err = new Error('Vous avez deja achete cette formation.');
          err.status = 409;
          throw err;
        }
        consumerWaiver = {
          accepted_cgv: true,
          renonciation_text: waiverText || null,
          date_formation: null,
          date_achat: legalDateAchat,
          consumerWaiverAcceptedText: waiverText || null,
          consumerWaiverAcceptedAt: waiverText ? legalDateAchat : null
        };
      }

      const purchase = new Purchase({
        userId,
        formationId: formation._id,
        sessionId: reservedSession ? reservedSession._id : null,
        paymentProvider: 'stripe',
        paymentStatus: 'paid',
        paymentRef: stripeSessionId || `STRIPE-${Date.now()}`,
        itemType: 'formation',
        itemId: formation._id,
        selectedOptions: purchaseSelectedOptions,
        createdAt: new Date()
      });
      await purchase.save();
      purchaseRecord = purchase;

      const promotion = await getActivePromotion('formation', formation._id);
      const saleItems = [
        buildSaleEntry({
          type: 'formation',
          itemId: formation._id,
          formationId: formation._id,
          name: formation.name,
          basePrice: Number(formation.price || 0),
          promotion
        }),
        ...optionSaleItemsForStripe
      ];
      const totalAmount = saleItems.reduce((sum, entry) => sum + Number(entry.finalPrice || 0), 0);
      const giftPlan = await planGiftCardUsage(rawGiftCards, totalAmount, {
        requirePassword: false,
        reservationPaymentIntentId: normalizedStripePaymentIntentId
      });
      assertZeroRemainingForFreeOrder(requireZeroRemaining, giftPlan.remainingAmount);

      saleRecord = await persistSale({
        userId,
        customer,
        items: saleItems,
        giftCardUsage: giftPlan.saleEntries,
        consumerWaiver,
        clientIp: normalizedIp,
        stripePaymentIntentId: normalizedStripePaymentIntentId,
        stripeSessionId: normalizedStripeSessionId,
        skipPostSaleSideEffects: true,
        legalConsentSnapshot,
        // A7 — marqueur d'accès distanciel (null pour présentiel).
        accessDeliveryStatus: resolveAccessDeliveryStatusForFormation(formation),
        // C3 — accès distanciel immédiat octroyé → horodatage (non remboursable ensuite).
        accessGrantedAt: resolveAccessDeliveryStatusForFormation(formation) === 'immediate' ? new Date() : null
      });

      await applyStripeFieldsToSale(saleRecord);

      const formationEntries = saleItems.map(buildFormationEntryFromSale).filter(Boolean);
      if (saleRecord && formationEntries.length) {
        const commissionTransactions = await recordCommissionTransactions({
          saleId: saleRecord.saleId,
          formationEntries
        });
        await applySaleCommissionSnapshot(saleRecord, commissionTransactions);
      }
      if (saleRecord?._id && purchaseRecord?._id) {
        await Purchase.findByIdAndUpdate(purchaseRecord._id, { saleId: saleRecord.saleId }).catch(() => {});
      }
      if (saleRecord) {
        await runPostSaleSideEffects(saleRecord, {
          giftCardSettlement: {
            userId,
            saleItems,
            usages: giftPlan.usages,
            paymentIntentId: normalizedStripePaymentIntentId
          }
        });
        postSaleSideEffectsApplied = true;
      }
      await clearCartSnapshotBestEffort(userId);
      return { ok: true, saleId: saleRecord?.saleId };
    }

    if (normalizedItemType === 'gift-card') {
      const checkoutItem =
        normalizedCheckoutState?.item && typeof normalizedCheckoutState.item === 'object'
          ? normalizedCheckoutState.item
          : {};
      const checkoutLegal =
        normalizedCheckoutState?.legal && typeof normalizedCheckoutState.legal === 'object'
          ? normalizedCheckoutState.legal
          : {};
      const rawGiftCardAmount = Number(
        checkoutItem?.amount ??
          normalizedCheckoutState?.totals?.subtotal ??
          normalizedCheckoutState?.totals?.basePrice ??
          normalizedCheckoutState?.totals?.remainingToPay
      );
      const giftCardAmount = roundToCents(rawGiftCardAmount);
      if (!Number.isFinite(giftCardAmount) || giftCardAmount <= 0) {
        const err = new Error('Montant carte cadeau invalide.');
        err.status = 400;
        err.code = 'GIFT_CARD_AMOUNT_INVALID';
        throw err;
      }

      const { createGiftCardForPurchase } = await import('../../controllers/giftCardController.js');
      const giftCardCreation = await createGiftCardForPurchase({
        userId,
        amount: giftCardAmount,
        purchasedAt: legalDateAchat,
        enforceMinAmount: false,
        // RX3 S4 — bénéficiaire optionnel transmis par le storefront React (persisté sur la carte).
        recipientName: checkoutItem?.recipientName,
        message: checkoutItem?.message
      });
      createdGiftCard = giftCardCreation.giftCard;

      const giftCardLabel = String(checkoutItem?.name || 'Carte cadeau').trim() || 'Carte cadeau';
      const consumerWaiver = {
        accepted_cgv: checkoutLegal.acceptedCgv !== false,
        renonciation_text: waiverText || null,
        date_formation: null,
        date_achat: legalDateAchat,
        consumerWaiverAcceptedText: waiverText || null,
        consumerWaiverAcceptedAt: waiverText ? legalDateAchat : null
      };
      const saleItems = [
        {
          type: 'gift-card',
          itemId: createdGiftCard._id,
          name: giftCardLabel,
          basePrice: giftCardAmount,
          finalPrice: giftCardAmount,
          price: giftCardAmount,
          promotionApplied: false,
          promotionId: null
        }
      ];
      const giftPlan = await planGiftCardUsage(rawGiftCards, giftCardAmount, {
        requirePassword: false,
        reservationPaymentIntentId: normalizedStripePaymentIntentId
      });
      assertZeroRemainingForFreeOrder(requireZeroRemaining, giftPlan.remainingAmount);

      saleRecord = await persistSale({
        userId,
        customer,
        items: saleItems,
        giftCardUsage: giftPlan.saleEntries,
        consumerWaiver,
        clientIp: normalizedIp,
        stripePaymentIntentId: normalizedStripePaymentIntentId,
        stripeSessionId: normalizedStripeSessionId,
        skipPostSaleSideEffects: true,
        legalConsentSnapshot
      });

      await applyStripeFieldsToSale(saleRecord);

      if (saleRecord?.saleId && createdGiftCard?._id) {
        createdGiftCard.saleId = saleRecord.saleId;
        await createdGiftCard.save();
      }

      if (saleRecord) {
        await runPostSaleSideEffects(saleRecord, {
          giftCardSettlement: {
            userId,
            saleItems,
            usages: giftPlan.usages,
            paymentIntentId: normalizedStripePaymentIntentId
          }
        });
        postSaleSideEffectsApplied = true;
      }
      await clearCartSnapshotBestEffort(userId);
      return { ok: true, saleId: saleRecord?.saleId };
    }

    // Product
    const product = await Product.findById(itemId).lean();
    if (!product || !product.active) {
      const err = new Error('Produit introuvable.');
      err.status = 404;
      throw err;
    }
    const alreadyPurchased = await Purchase.exists({ userId, itemType: 'product', itemId: product._id });
    if (alreadyPurchased) {
      const err = new Error('Vous avez deja achete ce produit.');
      err.status = 409;
      throw err;
    }
    const consumerWaiver = {
      accepted_cgv: true,
      renonciation_text: waiverText || null,
      date_formation: null,
      date_achat: legalDateAchat,
      consumerWaiverAcceptedText: waiverText || null,
      consumerWaiverAcceptedAt: waiverText ? legalDateAchat : null
    };

    const purchase = new Purchase({
      userId,
      formationId: null,
      sessionId: null,
      paymentProvider: 'stripe',
      paymentStatus: 'paid',
      paymentRef: stripeSessionId || `STRIPE-${Date.now()}`,
      itemType: 'product',
      itemId: product._id,
      createdAt: new Date()
    });
    await purchase.save();
    purchaseRecord = purchase;

    const promotion = await getActivePromotion('product', product._id);
    const saleItems = [
      buildSaleEntry({
        type: 'product',
        itemId: product._id,
        name: product.name,
        basePrice: Number(product.price || 0),
        promotion
      })
    ];
    const totalAmount = saleItems.reduce((sum, entry) => sum + Number(entry.finalPrice || 0), 0);
    const giftPlan = await planGiftCardUsage(rawGiftCards, totalAmount, {
      requirePassword: false,
      reservationPaymentIntentId: normalizedStripePaymentIntentId
    });
    assertZeroRemainingForFreeOrder(requireZeroRemaining, giftPlan.remainingAmount);

    saleRecord = await persistSale({
      userId,
      customer,
      items: saleItems,
      giftCardUsage: giftPlan.saleEntries,
      consumerWaiver,
      clientIp: normalizedIp,
      stripePaymentIntentId: normalizedStripePaymentIntentId,
      stripeSessionId: normalizedStripeSessionId,
      skipPostSaleSideEffects: true,
      legalConsentSnapshot
    });

    await applyStripeFieldsToSale(saleRecord);

    if (saleRecord?._id && purchaseRecord?._id) {
      await Purchase.findByIdAndUpdate(purchaseRecord._id, { saleId: saleRecord.saleId }).catch(() => {});
    }
    if (saleRecord) {
      await runPostSaleSideEffects(saleRecord, {
        giftCardSettlement: {
          userId,
          saleItems,
          usages: giftPlan.usages,
          paymentIntentId: normalizedStripePaymentIntentId
        }
      });
      postSaleSideEffectsApplied = true;
    }
    await clearCartSnapshotBestEffort(userId);
    return { ok: true, saleId: saleRecord?.saleId };
  } catch (error) {
    // Never rollback sale/purchase/session after gift-card debit has been applied in post-sale effects.
    if (!postSaleSideEffectsApplied && (saleRecord || purchaseRecord || reservedSession)) {
      await rollbackSingleSale({ sale: saleRecord, purchase: purchaseRecord, session: reservedSession });
    }
    if (!postSaleSideEffectsApplied && createdGiftCard?._id) {
      await GiftCard.deleteOne({ _id: createdGiftCard._id }).catch(() => {});
    }
    throw error;
  }
}

// Phase 1B-4: resolve the winning sale for a free reference. Under concurrent double
// submit, the loser may fail on an EARLIER unique index (e.g. purchase_unique_product)
// before the winner has committed its Sale, so a single immediate lookup can miss it.
// We poll briefly until the winner's Sale appears.
export async function waitForExistingFreeSale(freeRef, { attempts = 25, delayMs = 40 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const found = await Sale.findOne({ stripePaymentIntentId: freeRef }).select('saleId').lean();
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return null;
}

function roundToCents(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}
