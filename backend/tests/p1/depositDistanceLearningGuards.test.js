// tests/p1/depositDistanceLearningGuards.test.js
// Sprint pré-React A7 — Garde-fous offres incomplètes (acompte / distanciel).
//   - prestation en acompte → réservation bloquée (solde non collectable)
//   - distanciel « accès immédiat » sans accès configuré → achat bloqué (cas faux)
//   - distanciel manuel → vendable mais marqué accessDeliveryStatus='manual_pending'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../../services/notificationService.js', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, triggerNotification: async () => {} };
});
vi.mock('../../services/mailService.js', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, sendSaleEmail: async () => true };
});
vi.mock('../../services/stripeInvoiceService.js', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, createStripeInvoiceForSale: async () => null };
});

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const Sale = (await import('../../models/Sale.js')).default;
const Formation = (await import('../../models/Formation.js')).default;
const Service = (await import('../../models/Service.js')).default;
const mongoose = (await import('mongoose')).default;
const { DISTANT_LEARNING_WAIVER_TEXT } = await import('../../constants/consumerWaiver.js');
const {
  evaluateServiceOfferReadiness,
  assertServiceOfferBookable,
  evaluateFormationOfferReadiness,
  assertCheckoutFormationsPurchasable,
  OFFER_READINESS_CODES
} = await import('../../services/offerReadinessService.js');
const { assertServiceSlotBookable } = await import('../../services/serviceAvailabilityService.js');
const { processCheckoutStatePurchase } = await import('../../services/checkout/checkoutFacade.js');

const FINALIZE_FREE = '/api/client/checkout/finalize-free';

async function loginClient1(agent) {
  const login = await agent.post('/auth/login').send({ email: 'client1@test.local', password: TEST_PASSWORD });
  expect(login.status).toBe(200);
  return login.headers['set-cookie'];
}

describe('A7 — deposit / distanciel guards', () => {
  let agent;
  let cookie;
  let fixtures;

  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    fixtures = await seedTestData();
    cookie = await loginClient1(agent);
  });

  // ── Acompte ──────────────────────────────────────────────────────────────
  it('flags a deposit service offer as not ready (balance not collectable)', () => {
    const readiness = evaluateServiceOfferReadiness({ paymentType: 'deposit', depositType: 'percentage', depositValue: 30, price: 80 });
    expect(readiness.ready).toBe(false);
    expect(readiness.code).toBe(OFFER_READINESS_CODES.OFFER_BALANCE_UNSUPPORTED);
    expect(readiness.remainingPaymentRequired).toBe(true);
    expect(readiness.balanceDue).toBe(56); // 80 - 30%
    expect(evaluateServiceOfferReadiness({ paymentType: 'full', price: 80 }).ready).toBe(true);
  });

  it('assertServiceOfferBookable throws 409 for a deposit offer, passes for full', () => {
    expect(() => assertServiceOfferBookable({ paymentType: 'deposit', price: 80, depositValue: 30, depositType: 'percentage' }))
      .toThrowError(expect.objectContaining({ status: 409, code: OFFER_READINESS_CODES.OFFER_BALANCE_UNSUPPORTED }));
    expect(assertServiceOfferBookable({ paymentType: 'full', price: 80 }).ready).toBe(true);
  });

  it('blocks booking a deposit service at the central slot assertion', async () => {
    const depositService = await Service.create({
      name: 'Soin acompte', slug: 'soin-acompte', duration: 60, price: 80,
      isActive: true, isBookable: true, paymentType: 'deposit', depositType: 'percentage', depositValue: 30
    });
    const start = new Date(Date.now() + 2 * 24 * 3600 * 1000);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    await expect(assertServiceSlotBookable({
      practitionerId: new mongoose.Types.ObjectId(),
      serviceId: depositService._id,
      startAt: start,
      endAt: end,
      now: new Date()
    })).rejects.toMatchObject({ code: OFFER_READINESS_CODES.OFFER_BALANCE_UNSUPPORTED });
  });

  // ── Distanciel ───────────────────────────────────────────────────────────
  it('marks a default distanciel formation as manual_pending (no fake immediate access)', () => {
    const r = evaluateFormationOfferReadiness({ type: 'distanciel', accessDeliveryMode: 'manual' });
    expect(r.ready).toBe(true);
    expect(r.accessDeliveryStatus).toBe('manual_pending');
  });

  it('blocks a distanciel formation that promises immediate access without an access URL', () => {
    const r = evaluateFormationOfferReadiness({ type: 'distanciel', accessDeliveryMode: 'immediate', accessUrl: '' });
    expect(r.ready).toBe(false);
    expect(r.code).toBe(OFFER_READINESS_CODES.OFFER_ACCESS_UNAVAILABLE);
    // With a real URL it becomes ready/immediate.
    const ok = evaluateFormationOfferReadiness({ type: 'distanciel', accessDeliveryMode: 'immediate', accessUrl: 'https://x/y' });
    expect(ok.ready).toBe(true);
    expect(ok.accessDeliveryStatus).toBe('immediate');
  });

  it('free checkout refuses a distanciel immediate offer without configured access', async () => {
    const broken = await Formation.create({
      name: 'Distanciel cassé', type: 'distanciel', price: 0, status: 'published', active: true,
      refundDays: 7, accessDeliveryMode: 'immediate', accessUrl: ''
    });
    const res = await agent.post(FINALIZE_FREE).set('Cookie', cookie).send({
      idempotencyKey: 'a7-distanciel-broken-1',
      checkoutState: {
        item: { type: 'formation', id: String(broken._id) },
        appliedGiftCards: [],
        totals: { subtotal: 0, remainingToPay: 0, totalAmount: 0 },
        // legal complet pour passer A1 et atteindre la garde A7.
        legal: { acceptedCgv: true, waiverAccepted: true, waiverText: DISTANT_LEARNING_WAIVER_TEXT }
      }
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(OFFER_READINESS_CODES.OFFER_ACCESS_UNAVAILABLE);
    expect(await Sale.countDocuments({})).toBe(0);
  });

  it('assertCheckoutFormationsPurchasable passes for a manual distanciel offer', async () => {
    await expect(
      assertCheckoutFormationsPurchasable({ item: { type: 'formation', id: String(fixtures.formationDistanciel._id) } })
    ).resolves.toBeUndefined();
  });

  it('marks a purchased distanciel sale with accessDeliveryStatus=manual_pending', async () => {
    await processCheckoutStatePurchase({
      userId: fixtures.client1._id,
      itemType: 'formation',
      itemId: String(fixtures.formationDistanciel._id),
      checkoutState: {
        item: { type: 'formation', id: String(fixtures.formationDistanciel._id) },
        legal: { acceptedCgv: true, waiverAccepted: true, waiverText: DISTANT_LEARNING_WAIVER_TEXT }
      },
      clientIp: '1.2.3.4',
      stripeSessionId: 'pi_a7_distanciel',
      stripePaymentIntentId: 'pi_a7_distanciel'
    });
    const sale = await Sale.findOne({ stripePaymentIntentId: 'pi_a7_distanciel' }).lean();
    expect(sale).toBeTruthy();
    expect(sale.accessDeliveryStatus).toBe('manual_pending');
  });
});
