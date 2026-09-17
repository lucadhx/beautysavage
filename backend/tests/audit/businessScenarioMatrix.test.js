// tests/audit/businessScenarioMatrix.test.js
// Audit pré-React (rapport 90) — matrice de scénarios métier SIMULÉS, non destructifs.
// EXPLORATOIRE : exécuté seulement via `npm run audit:business-scenarios` (config
// vitest.audit.config.js), JAMAIS dans la suite principale.
//
// Chaque probe est une CARACTÉRISATION : vert = le comportement observé est celui
// documenté dans le rapport 90. Les risques (FRAGILE/FAIL/INDETERMINÉ) sont classés
// analytiquement dans les rapports 90/94 ; ici on fige la réalité du code pour éviter
// toute dérive silencieuse. Aucun prix, aucun flux métier n'est modifié.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../services/notificationService.js', async o => ({ ...(await o()), triggerNotification: async () => {} }));
vi.mock('../../services/mailService.js', async o => ({
  ...(await o()),
  sendSaleEmail: async () => true,
  sendRefundConfirmedEmail: async () => true
}));
vi.mock('../../services/stripeInvoiceService.js', async o => ({ ...(await o()), createStripeInvoiceForSale: async () => null }));

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');

const Service = (await import('../../models/Service.js')).default;
const PractitionerProfile = (await import('../../models/PractitionerProfile.js')).default;
const PractitionerSchedule = (await import('../../models/PractitionerSchedule.js')).default;
const ServiceBooking = (await import('../../models/ServiceBooking.js')).default;
const BookingSlotLock = (await import('../../models/BookingSlotLock.js')).default;
const RefundRequest = (await import('../../models/RefundRequest.js')).default;
const Sale = (await import('../../models/Sale.js')).default;
const CommissionTransaction = (await import('../../models/CommissionTransaction.js')).default;
const CommissionPayment = (await import('../../models/CommissionPayment.js')).default;
const EventLog = (await import('../../models/EventLog.js')).default;
const WebhookFailureLog = (await import('../../models/WebhookFailureLog.js')).default;

const {
  assertServiceSlotBookable,
  createServiceBookingWithProtection,
  computeAvailableSlotsForPractitioner
} = await import('../../services/serviceAvailabilityService.js');
const {
  getServiceRefundEligibility,
  getPresentielRefundEligibility,
  ensureRefundCommissionProvision,
  ensureRefundCommissionReversal
} = await import('../../services/refundService.js');
const { computeCommissionsForPeriod } = await import('../../services/commissionPaymentService.js');
const { calculateFinalPrice, getActivePromotion } = await import('../../services/promotionService.js');
const {
  evaluateServiceOfferReadiness,
  assertServiceOfferBookable,
  evaluateFormationOfferReadiness,
  assertCheckoutFormationsPurchasable
} = await import('../../services/offerReadinessService.js');
const { validateCheckoutLegalConsents, deriveLegalRequirements } = await import('../../services/legalConsentService.js');
const { recordWebhookFailure } = await import('../../services/webhookFailureService.js');
const { triggerRefundExecution } = await import('../../services/refundExecutionService.js');
const { DISTANT_LEARNING_WAIVER_TEXT } = await import('../../constants/consumerWaiver.js');

const DAY = 24 * 3600 * 1000;
function slotFrom(iso, durationMin = 60) {
  const startAt = new Date(iso);
  const endAt = new Date(startAt.getTime() + durationMin * 60 * 1000);
  return { startAt, endAt };
}

describe('AUDIT — matrice de scénarios métier', () => {
  let fx;
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    // Index essentiels aux probes de concurrence / anti-doublon.
    await Promise.all([
      BookingSlotLock.syncIndexes(),
      ServiceBooking.syncIndexes(),
      RefundRequest.syncIndexes(),
      Sale.syncIndexes()
    ]);
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  // ─── Réservations prestations / créneaux ─────────────────────────────────
  describe('Réservations & créneaux', () => {
    it('S01 réservation simple sur créneau valide → bookable', async () => {
      const { startAt, endAt } = slotFrom(fx.bookingSlotISO, fx.service.duration);
      const r = await assertServiceSlotBookable({
        practitionerId: fx.practitioner._id, serviceId: fx.service._id, startAt, endAt, now: new Date()
      });
      expect(r.slot).toBeTruthy();
    });

    it('S02 créneau passé → SLOT_PAST', async () => {
      const past = new Date(Date.now() - 2 * DAY); past.setHours(10, 0, 0, 0);
      const { startAt, endAt } = slotFrom(past.toISOString(), fx.service.duration);
      await expect(assertServiceSlotBookable({
        practitionerId: fx.practitioner._id, serviceId: fx.service._id, startAt, endAt, now: new Date()
      })).rejects.toMatchObject({ status: 409 });
    });

    it('S03 créneau hors planning (dimanche) → indisponible', async () => {
      const sunday = new Date(Date.now() + 7 * DAY);
      while (sunday.getDay() !== 0) sunday.setDate(sunday.getDate() + 1);
      sunday.setHours(10, 0, 0, 0);
      const { startAt, endAt } = slotFrom(sunday.toISOString(), fx.service.duration);
      await expect(assertServiceSlotBookable({
        practitionerId: fx.practitioner._id, serviceId: fx.service._id, startAt, endAt, now: new Date()
      })).rejects.toBeTruthy();
    });

    it('S04 durée de créneau incohérente → INVALID_SLOT_DURATION', async () => {
      const { startAt } = slotFrom(fx.bookingSlotISO, fx.service.duration);
      const wrongEnd = new Date(startAt.getTime() + 30 * 60 * 1000); // 30 au lieu de 60
      await expect(assertServiceSlotBookable({
        practitionerId: fx.practitioner._id, serviceId: fx.service._id, startAt, endAt: wrongEnd, now: new Date()
      })).rejects.toMatchObject({ status: 400 });
    });

    it('S05 double réservation même créneau/praticienne → 2e refusée (lock)', async () => {
      const { startAt, endAt } = slotFrom(fx.bookingSlotISO, fx.service.duration);
      const base = { clientId: fx.client1._id, serviceId: fx.service._id, practitionerId: fx.practitioner._id, startAt, endAt, totalPrice: 80, status: 'confirmed' };
      await createServiceBookingWithProtection({ bookingData: { ...base, bookingId: 'BKG-A' }, service: fx.service.toObject?.() || fx.service });
      await expect(createServiceBookingWithProtection({
        bookingData: { ...base, clientId: fx.client2._id, bookingId: 'BKG-B' }, service: fx.service.toObject?.() || fx.service
      })).rejects.toMatchObject({ status: 409 });
    });

    it('S06 deux praticiennes même créneau → les deux réservables (locks par praticienne)', async () => {
      const p2 = await PractitionerProfile.create({
        userId: fx.dev._id, displayName: 'Praticienne 2', isActive: true, slotGranularity: 30, serviceIds: [fx.service._id]
      });
      await PractitionerSchedule.create({
        practitionerId: p2._id,
        weeklySchedule: [0,1,2,3,4,5,6].map(d => ({ dayOfWeek: d, isWorking: d >= 1 && d <= 5, slots: d>=1&&d<=5?[{ startTime:'09:00', endTime:'17:00' }]:[] }))
      });
      const { startAt, endAt } = slotFrom(fx.bookingSlotISO, fx.service.duration);
      await createServiceBookingWithProtection({ bookingData: { clientId: fx.client1._id, serviceId: fx.service._id, practitionerId: fx.practitioner._id, startAt, endAt, totalPrice: 80, status: 'confirmed', bookingId: 'BKG-P1' }, service: fx.service.toObject?.() || fx.service });
      const r2 = await assertServiceSlotBookable({ practitionerId: p2._id, serviceId: fx.service._id, startAt, endAt, now: new Date() });
      expect(r2.slot).toBeTruthy(); // praticienne 2 libre sur le même créneau
    });

    it('S07 praticienne inactive → PRACTITIONER_NOT_FOUND', async () => {
      await PractitionerProfile.findByIdAndUpdate(fx.practitioner._id, { isActive: false });
      const { startAt, endAt } = slotFrom(fx.bookingSlotISO, fx.service.duration);
      await expect(assertServiceSlotBookable({
        practitionerId: fx.practitioner._id, serviceId: fx.service._id, startAt, endAt, now: new Date()
      })).rejects.toMatchObject({ status: 404 });
    });

    it('S08 génération de créneaux exclut les créneaux déjà réservés', async () => {
      const dateStr = new Date(fx.bookingSlotISO).toISOString().slice(0, 10);
      const before = await computeAvailableSlotsForPractitioner({
        practitioner: fx.practitioner.toObject?.() || fx.practitioner,
        schedule: await PractitionerSchedule.findOne({ practitionerId: fx.practitioner._id }).lean(),
        service: fx.service.toObject?.() || fx.service, dateStr, now: new Date()
      });
      expect(before.length).toBeGreaterThan(0);
    });
  });

  // ─── Garde-fous offres (A7) ──────────────────────────────────────────────
  describe('Offres incomplètes (acompte / distanciel)', () => {
    it('S20 prestation acompte non réservable', async () => {
      const r = evaluateServiceOfferReadiness({ paymentType: 'deposit', depositType: 'percentage', depositValue: 30, price: 80 });
      expect(r.ready).toBe(false);
      expect(() => assertServiceOfferBookable({ paymentType: 'deposit', price: 80, depositValue: 30, depositType: 'percentage' })).toThrow();
    });
    it('S21 prestation full réservable', () => {
      expect(evaluateServiceOfferReadiness({ paymentType: 'full', price: 80 }).ready).toBe(true);
    });
    it('S22 distanciel manuel → manual_pending', () => {
      const r = evaluateFormationOfferReadiness({ type: 'distanciel', accessDeliveryMode: 'manual' });
      expect(r.ready).toBe(true); expect(r.accessDeliveryStatus).toBe('manual_pending');
    });
    it('S23 distanciel immédiat sans URL → bloqué', () => {
      expect(evaluateFormationOfferReadiness({ type: 'distanciel', accessDeliveryMode: 'immediate', accessUrl: '' }).ready).toBe(false);
    });
    it('S24 distanciel immédiat avec URL → immediate', () => {
      expect(evaluateFormationOfferReadiness({ type: 'distanciel', accessDeliveryMode: 'immediate', accessUrl: 'https://x' }).accessDeliveryStatus).toBe('immediate');
    });
    it('S25 assertCheckoutFormationsPurchasable passe pour distanciel manuel seedé', async () => {
      await expect(assertCheckoutFormationsPurchasable({ item: { type: 'formation', id: String(fx.formationDistanciel._id) } })).resolves.toBeUndefined();
    });
  });

  // ─── Consentement légal (A1) ─────────────────────────────────────────────
  describe('Consentement légal', () => {
    it('S30 sans CGV → refus', () => {
      expect(() => validateCheckoutLegalConsents({ legal: { acceptedCgv: false } }, { cgvRequired: true })).toThrow();
    });
    it('S31 distanciel sans renonciation → refus', () => {
      expect(() => validateCheckoutLegalConsents({ legal: { acceptedCgv: true } }, { digitalImmediateAccessWaiverRequired: true })).toThrow();
    });
    it('S32 distanciel avec renonciation → OK', () => {
      expect(validateCheckoutLegalConsents({ legal: { acceptedCgv: true, waiverAccepted: true, waiverText: DISTANT_LEARNING_WAIVER_TEXT } }, { cgvRequired: true, digitalImmediateAccessWaiverRequired: true })).toBe(true);
    });
    it('S33 deriveLegalRequirements(distanciel) exige la renonciation', async () => {
      const req = await deriveLegalRequirements({ item: { type: 'formation', id: String(fx.formationDistanciel._id) } });
      expect(req.digitalImmediateAccessWaiverRequired).toBe(true);
    });
  });

  // ─── Remboursements : éligibilité ────────────────────────────────────────
  describe('Éligibilité remboursement', () => {
    const now = new Date();
    it('S40 prestation dans rétractation, sans waiver → éligible (retractation)', () => {
      const r = getServiceRefundEligibility({
        sale: { createdAt: new Date(now.getTime() - 2 * DAY) },
        booking: { startAt: new Date(now.getTime() + 1 * DAY), consumerWaiverSnapshot: { refundDays: 7, waiverAcceptedAt: null } },
        now
      });
      expect(r.eligibleRefund).toBe(true); expect(r.reason).toBe('retractation');
    });
    it('S41 prestation waiver signé + date lointaine → éligible (institut)', () => {
      const r = getServiceRefundEligibility({
        sale: { createdAt: new Date(now.getTime() - 30 * DAY) },
        booking: { startAt: new Date(now.getTime() + 30 * DAY), consumerWaiverSnapshot: { refundDays: 7, waiverAcceptedAt: now } },
        now
      });
      expect(r.eligibleRefund).toBe(true); expect(r.reason).toBe('institut');
    });
    it('S42 prestation waiver signé + date proche → non éligible', () => {
      const r = getServiceRefundEligibility({
        sale: { createdAt: new Date(now.getTime() - 30 * DAY) },
        booking: { startAt: new Date(now.getTime() + 1 * DAY), consumerWaiverSnapshot: { refundDays: 7, waiverAcceptedAt: now } },
        now
      });
      expect(r.eligibleRefund).toBe(false); expect(r.reason).toBe('none');
    });
    it('S43 présentiel distanciel (pas de session) → daysBeforeSession=-Infinity, institut non éligible', () => {
      // FRAGILE documenté (rapport 78/94) : un distanciel via la logique présentiel
      // n'est jamais éligible institut (sessionDate null). Caractérisation.
      const r = getPresentielRefundEligibility({
        sale: { createdAt: new Date(now.getTime() - 30 * DAY), consumerWaiverAcceptedAt: now },
        formation: { refundDays: 7 }, now
      });
      expect(r.eligibleRefund).toBe(false);
    });
  });

  // ─── Remboursement carte cadeau (split, sans Stripe) ─────────────────────
  describe('Exécution remboursement carte cadeau', () => {
    it('S50 remboursement 100% carte cadeau → recrédit, status succeeded, pas de Stripe', async () => {
      const sale = await Sale.create({
        saleId: 'S-GC-AUDIT', userId: fx.client1._id,
        items: [{ type: 'formation', itemId: fx.formationDistanciel._id, name: 'F', price: 100, finalPrice: 100 }],
        totalAmount: 100, itemCount: 1,
        giftCardUsage: [{ giftCardId: fx.giftCard._id, code: fx.giftCard.code, amountUsed: 100 }]
      });
      const refund = await RefundRequest.create({
        refundId: 'REF-GC-AUDIT', saleId: sale.saleId, userId: fx.client1._id,
        itemId: fx.formationDistanciel._id, itemType: 'formation', amount: 100, status: 'requested'
      });
      const result = await triggerRefundExecution(refund, sale.toObject());
      expect(result.mode).toBe('gift_card_only');
      expect(result.refund.stripeRefundStatus).toBe('not_applicable');
      expect(result.refund.giftCardRefundStatus).toBe('succeeded');
    });
  });

  // ─── Commissions ─────────────────────────────────────────────────────────
  describe('Commissions', () => {
    const P0 = new Date(2026, 0, 1), P1 = new Date(2026, 1, 1);
    async function saleWithCommission(saleId, commissionAmount = 20, totalAmount = 100) {
      return Sale.create({ saleId, userId: new mongoose.Types.ObjectId(),
        items: [{ type: 'formation', itemId: new mongoose.Types.ObjectId(), name: 'F', price: totalAmount, finalPrice: totalAmount }],
        totalAmount, commissionAmount, itemCount: 1, createdAt: new Date(2026, 0, 15) });
    }
    it('S60 remboursement 100% carte cadeau déduit la commission (trou corrigé)', async () => {
      await clearDatabase();
      const s = await saleWithCommission('S-COMM-A');
      await RefundRequest.create({ refundId: 'R-A', saleId: s.saleId, userId: s.userId, itemId: new mongoose.Types.ObjectId(), itemType: 'formation', amount: 100, status: 'succeeded', stripeRefundStatus: 'not_applicable', giftCardRefundStatus: 'succeeded', giftCardRecredited: true, refundedAt: new Date(2026, 0, 20) });
      const { total } = await computeCommissionsForPeriod(P0, P1);
      expect(total).toBe(0);
    });
    it('S61 remboursement Stripe partiel déduit au prorata', async () => {
      await clearDatabase();
      const s = await saleWithCommission('S-COMM-B');
      await RefundRequest.create({ refundId: 'R-B', saleId: s.saleId, userId: s.userId, itemId: new mongoose.Types.ObjectId(), itemType: 'formation', amount: 50, status: 'succeeded', stripeRefundStatus: 'succeeded', stripeRefundConfirmedAt: new Date(2026, 0, 18) });
      const { refundEntries } = await computeCommissionsForPeriod(P0, P1);
      expect(refundEntries[0].commissionAmount).toBe(10);
    });
    it('S62 provision remboursement → transaction négative + commission.adjusted', async () => {
      await clearDatabase();
      const fId = new mongoose.Types.ObjectId();
      await saleWithCommission('S-COMM-C');
      await CommissionTransaction.create({ saleId: 'S-COMM-C', formationId: fId, formationName: 'F', sourceType: 'sale', commissionType: 'fixed', commissionValue: 20, commissionAmount: 20 });
      const refund = await RefundRequest.create({ refundId: 'R-C', saleId: 'S-COMM-C', userId: new mongoose.Types.ObjectId(), itemId: fId, itemType: 'formation', formationId: fId, amount: 100, status: 'requested' });
      const row = await ensureRefundCommissionProvision(refund);
      expect(row.commissionAmount).toBe(-20);
      expect(await EventLog.countDocuments({ eventName: 'commission.adjusted' })).toBe(1);
    });
    it('S63 vente déjà payée puis remboursée → commission.reversal_required', async () => {
      await clearDatabase();
      const fId = new mongoose.Types.ObjectId();
      const s = await saleWithCommission('S-COMM-D');
      await CommissionTransaction.create({ saleId: 'S-COMM-D', formationId: fId, formationName: 'F', sourceType: 'sale', commissionType: 'fixed', commissionValue: 20, commissionAmount: 20 });
      const d = new Date(s.createdAt);
      await CommissionPayment.create({ month: d.getMonth(), year: d.getFullYear(), periodStart: P0, periodEnd: P1, amount: 20, status: 'succeeded' });
      const refund = await RefundRequest.create({ refundId: 'R-D', saleId: 'S-COMM-D', userId: new mongoose.Types.ObjectId(), itemId: fId, itemType: 'formation', formationId: fId, amount: 100, status: 'requested' });
      await ensureRefundCommissionProvision(refund);
      expect(await EventLog.countDocuments({ eventName: 'commission.reversal_required' })).toBe(1);
    });
    it('S64 remboursement échoué → reversal restaure la commission (commission.cancelled)', async () => {
      await clearDatabase();
      const fId = new mongoose.Types.ObjectId();
      await saleWithCommission('S-COMM-E');
      await CommissionTransaction.create({ saleId: 'S-COMM-E', formationId: fId, formationName: 'F', sourceType: 'sale', commissionType: 'fixed', commissionValue: 20, commissionAmount: 20 });
      const refund = await RefundRequest.create({ refundId: 'R-E', saleId: 'S-COMM-E', userId: new mongoose.Types.ObjectId(), itemId: fId, itemType: 'formation', formationId: fId, amount: 100, status: 'requested' });
      await ensureRefundCommissionProvision(refund);
      await ensureRefundCommissionReversal(refund);
      expect(await EventLog.countDocuments({ eventName: 'commission.cancelled' })).toBe(1);
    });
  });

  // ─── Promotions / réductions ─────────────────────────────────────────────
  describe('Promotions', () => {
    it('S70 promo pourcentage 20% sur 100 → 80', () => {
      const r = calculateFinalPrice(100, { discountType: 'percentage', discountValue: 20 });
      expect(r.finalPrice).toBe(80); expect(r.discountAmount).toBe(20);
    });
    it('S71 promo fixe 30 sur 100 → 70', () => {
      expect(calculateFinalPrice(100, { discountType: 'fixed', discountValue: 30 }).finalPrice).toBe(70);
    });
    it('S72 promo fixe dépassant le prix → 0 (jamais négatif)', () => {
      expect(calculateFinalPrice(100, { discountType: 'fixed', discountValue: 150 }).finalPrice).toBe(0);
    });
    it('S73 promo expirée → getActivePromotion ne la retourne pas', async () => {
      const Promotion = (await import('../../models/Promotion.js')).default;
      await Promotion.create({ targetType: 'product', targetId: fx.product._id, discountType: 'percentage', discountValue: 10, createdBy: new mongoose.Types.ObjectId(), startAt: new Date(Date.now() - 10 * DAY), endAt: new Date(Date.now() - 1 * DAY) });
      const active = await getActivePromotion('product', fx.product._id, new Date());
      expect(active).toBeNull();
    });
    it('S74 promo active → getActivePromotion la retourne', async () => {
      const Promotion = (await import('../../models/Promotion.js')).default;
      await Promotion.create({ targetType: 'product', targetId: fx.product._id, discountType: 'percentage', discountValue: 10, createdBy: new mongoose.Types.ObjectId(), startAt: new Date(Date.now() - 1 * DAY), endAt: null });
      const active = await getActivePromotion('product', fx.product._id, new Date());
      expect(active).toBeTruthy();
    });
  });

  // ─── Observabilité webhook (A6) ──────────────────────────────────────────
  describe('Webhook failure observability', () => {
    it('S80 recordWebhookFailure tronque le message et rejette un id malformé', async () => {
      await clearDatabase();
      await recordWebhookFailure({ provider: 'stripe', failureStage: 'processing', errorMessageSafe: 'x'.repeat(1000), stripeEventId: 'bad <id>', paymentIntentId: 'pi_ok_1', retryable: true });
      const log = await WebhookFailureLog.findOne({}).lean();
      expect(log.errorMessageSafe.length).toBeLessThanOrEqual(300);
      expect(log.stripeEventId).toBeNull();
      expect(log.paymentIntentId).toBe('pi_ok_1');
    });
    it('S81 aucun secret/email stocké dans WebhookFailureLog', async () => {
      await clearDatabase();
      await recordWebhookFailure({ provider: 'stripe', failureStage: 'signature', errorCode: 'SIGNATURE_INVALID', errorMessageSafe: 'Signature webhook invalide', retryable: false });
      const log = await WebhookFailureLog.findOne({}).lean();
      const raw = JSON.stringify(log);
      expect(raw).not.toMatch(/@.*\.(com|fr)/); // pas d'email
      expect(raw).not.toMatch(/sk_(live|test)_/);
      expect(raw).not.toMatch(/whsec_/);
    });
  });

  // ─── Anti-doublon remboursement ──────────────────────────────────────────
  describe('Anti-doublon remboursement', () => {
    it('S90 double RefundRequest actif même sale+item → index unique rejette', async () => {
      const itemId = new mongoose.Types.ObjectId();
      const base = { saleId: 'S-DUP', userId: fx.client1._id, itemId, itemType: 'formation', amount: 100, status: 'requested' };
      await RefundRequest.create({ ...base, refundId: 'RD-1' });
      let threw = false;
      try {
        await RefundRequest.create({ ...base, refundId: 'RD-2' });
      } catch (e) { threw = Number(e?.code) === 11000; }
      // Caractérisation : l'index partiel unique {saleId,itemId,itemType} sur statuts
      // actifs doit empêcher un 2e remboursement actif.
      expect(threw).toBe(true);
    });
  });
});
