// services/checkout/checkoutBookingService.js
// Sprint F1 — Extraction PUREMENT STRUCTURELLE du finaliseur "réservation prestation"
// (`processServiceCheckoutStatePurchase`) hors de clientController. Aucune modification de
// comportement : fonction déplacée verbatim.
//
// Crée la ServiceBooking + Sale depuis un checkoutState pré-validé (webhook Stripe ou
// finalisation 0 €). Pricing prestation = SOURCE UNIQUE Promotion(service) (E1). Acompte V1
// (D3) : solde tracé, réglé sur place. N'importe QUE depuis checkoutPersistenceService
// (pas de dépendance vers les finaliseurs → graphe acyclique).

import crypto from 'node:crypto';

import Sale from '../../models/Sale.js';
import Service from '../../models/Service.js';
import ServiceBooking from '../../models/ServiceBooking.js';
import { resolveEffectiveServiceUnitPrice } from '../promotionService.js';
import { createGlobalServiceBooking } from '../calendar/globalAvailabilityService.js';
import { triggerNotification } from '../notificationService.js';
import { emitSaleEvent, emitBookingEvent } from '../businessEventService.js';
import { buildTaxSnapshot } from '../../constants/tax.js';
import { buildPricingSnapshot } from '../../constants/pricingConcepts.js';
import { planGiftCardUsage } from './checkoutGiftCardService.js';
import {
  buildSaleId,
  runPostSaleSideEffects,
  assertZeroRemainingForFreeOrder
} from './checkoutPersistenceService.js';

function roundToCents(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

/**
 * Process a service booking purchase from a pre-validated checkoutState (Stripe webhook or mock-pay).
 * Creates the ServiceBooking and Sale from checkoutState data — no pre-existing bookingId needed.
 */
export async function processServiceCheckoutStatePurchase({
  userId,
  customer,
  normalizedCheckoutState,
  normalizedIp,
  normalizedStripeSessionId,
  normalizedStripePaymentIntentId,
  requireZeroRemaining = false,
  legalConsentSnapshot = null
}) {
  const serviceData = normalizedCheckoutState?.service;
  if (!serviceData?.serviceId || !serviceData?.slotStart || !serviceData?.slotEnd) {
    throw Object.assign(new Error('Données de réservation incomplètes dans checkoutState.'), { status: 400 });
  }

  const service = await Service.findById(serviceData.serviceId).lean();
  if (!service || !service.isActive) {
    throw Object.assign(new Error('Prestation introuvable ou inactive.'), { status: 404 });
  }

  // D1 — prix prestation après promotion : SOURCE UNIQUE (Promotion(service) prioritaire,
  // fallback Service.promotion legacy ; jamais les deux).
  const { unitPrice: effectiveServicePrice } = await resolveEffectiveServiceUnitPrice(service, new Date());

  // Validate and price selected options
  const rawOptions = Array.isArray(serviceData.selectedOptions) ? serviceData.selectedOptions : [];
  let optionsTotal = 0;
  const validatedOptions = [];
  for (const sel of rawOptions) {
    const opt = (service.options || []).find(o => String(o._id) === String(sel.optionId) && o.isActive !== false);
    if (!opt) continue;
    const optPrice = roundToCents(opt.price || 0);
    validatedOptions.push({ optionId: opt._id, name: opt.name, price: optPrice });
    optionsTotal += optPrice;
  }

  const totalPrice = roundToCents(effectiveServicePrice + optionsTotal);

  const depositAmount = (() => {
    if (service.paymentType === 'deposit') {
      if (service.depositType === 'percentage') return roundToCents(totalPrice * service.depositValue / 100);
      return roundToCents(Math.min(service.depositValue, totalPrice));
    }
    return 0;
  })();

  // Gift card plan — capped at deposit amount for deposit payments
  const rawGiftCards = Array.isArray(normalizedCheckoutState?.appliedGiftCards)
    ? normalizedCheckoutState.appliedGiftCards
    : [];
  const giftCardBase = service.paymentType === 'deposit' ? depositAmount : totalPrice;
  const giftPlan = await planGiftCardUsage(rawGiftCards, giftCardBase, {
    requirePassword: false,
    reservationPaymentIntentId: normalizedStripePaymentIntentId
  });
  // Phase 1B-4: for a free finalization, ensure nothing remains due BEFORE creating the
  // booking, so we never leave an orphan ServiceBooking when payment is actually required.
  assertZeroRemainingForFreeOrder(requireZeroRemaining, giftPlan.remainingAmount);

  // Waiver snapshot from checkoutState legal
  const legal = normalizedCheckoutState?.legal || {};
  const waiverAcceptedAt = legal.waiverAcceptedAt ? new Date(legal.waiverAcceptedAt) : null;
  const consumerWaiverSnapshot = {
    refundDays: service.cancellationDays || 0,
    retractationDays: 14,
    waiverType: legal.waiverType || null,
    waiverAcceptedAt
  };

  // M11A — entité institut unique : un `practitionerId` legacy éventuellement présent dans le
  // checkoutState est ACCEPTÉ mais IGNORÉ. La réservation est créée via le chemin GLOBAL
  // (createGlobalServiceBooking résout l'institut + verrou anti-double-booking global).
  const rawPractitionerId = serviceData.practitionerId || null;

  // Generate bookingId
  const bookingIdSuffix = crypto.randomUUID().split('-')[0];
  const newBookingId = `BKG-${Date.now()}-${bookingIdSuffix}`;

  const startAt = new Date(serviceData.slotStart);
  const endAt = new Date(serviceData.slotEnd);

  // D3 — acompte : solde tracé (réglé sur place en V1, balanceSettlementMode='pay_on_site').
  const isDeposit = service.paymentType === 'deposit';
  const balanceDueAmount = isDeposit ? roundToCents(Math.max(0, totalPrice - depositAmount)) : 0;

  // Create ServiceBooking — chemin GLOBAL institut (M11A). `practitionerId` legacy transmis
  // tel quel : createGlobalServiceBooking l'écrase par l'id institut (entité unique).
  const { booking } = await createGlobalServiceBooking({
    bookingData: {
      bookingId: newBookingId,
      clientId: userId,
      serviceId: service._id,
      practitionerId: rawPractitionerId, // legacy — ignoré/écrasé par l'institut
      startAt,
      endAt,
      totalPrice,
      depositAmount,
      totalSoldAmount: roundToCents(totalPrice),
      balanceDueAmount,
      balanceSettlementMode: isDeposit ? (service.balanceSettlementMode || 'none') : null,
      paymentType: service.paymentType || 'full',
      paymentStatus: isDeposit ? 'deposit_paid' : 'paid',
      status: 'confirmed',
      selectedOptions: validatedOptions,
      consumerWaiverSnapshot,
      stripePaymentIntentId: normalizedStripePaymentIntentId || null
    }
  });

  // For deposit payments, totalAmount = deposit charged now (not full service price)
  const saleTotal = service.paymentType === 'deposit' ? depositAmount : totalPrice;

  // Sale items store full unit prices — the deposit ratio is applied in stripeInvoiceService
  const saleItems = [
    {
      type: 'service',
      itemId: service._id,
      name: service.name,
      basePrice: effectiveServicePrice,
      finalPrice: effectiveServicePrice,
      price: effectiveServicePrice,
      consumerWaiverSnapshot
    },
    ...validatedOptions.map(opt => ({
      type: 'service-option',
      itemId: opt.optionId,
      name: opt.name,
      basePrice: opt.price,
      finalPrice: opt.price,
      price: opt.price
    }))
  ];

  const saleId = buildSaleId();
  const sale = new Sale({
    saleId,
    userId,
    customer,
    items: saleItems,
    totalAmount: saleTotal,
    itemCount: saleItems.length,
    accepted_cgv: true,
    client_ip: normalizedIp || '0.0.0.0',
    giftCardUsage: giftPlan.saleEntries,
    legalConsentSnapshot: legalConsentSnapshot || undefined,
    // B1 — snapshot fiscal V1 (TVA non applicable, HT=TTC).
    taxSnapshot: buildTaxSnapshot(saleTotal),
    // Pricing snapshot : carte cadeau = moyen de paiement (ne réduit pas sold).
    pricingSnapshot: buildPricingSnapshot({
      catalogAmount: saleTotal,
      soldAmount: saleTotal,
      giftCardPaymentAmount: roundToCents(
        (giftPlan.saleEntries || []).reduce((sum, g) => sum + Number(g?.amountUsed || 0), 0)
      )
    })
  });
  if (normalizedStripeSessionId) sale.stripeSessionId = normalizedStripeSessionId;
  if (normalizedStripePaymentIntentId) sale.stripePaymentIntentId = normalizedStripePaymentIntentId;

  const savedSale = await sale.save();

  // Link sale to booking
  await ServiceBooking.findByIdAndUpdate(booking._id, { saleId: savedSale.saleId });

  // Notification booking confirmé via Stripe
  const stripeNotifClientName = [customer?.firstName, customer?.lastName].filter(Boolean).join(' ') || customer?.email || '—';
  void triggerNotification('booking_created', {
    clientName: stripeNotifClientName,
    serviceName: service.name,
    bookingDate: booking.startAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    bookingTime: booking.startAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    userId: booking.practitionerId ? String(booking.practitionerId) : '',
    link: '/gestion.html?page=planning',
    linkLabel: 'Voir le planning'
  });

  await runPostSaleSideEffects(savedSale, {
    giftCardSettlement: giftPlan.usages.length
      ? { userId, saleItems, usages: giftPlan.usages, paymentIntentId: normalizedStripePaymentIntentId }
      : null
  });
  // Audit-only events (best-effort, no side effect). Booking is created confirmed.
  await emitSaleEvent('sale.finalized', savedSale);
  await emitBookingEvent('booking.created', booking);
  await emitBookingEvent('booking.confirmed', booking);
  return savedSale;
}
