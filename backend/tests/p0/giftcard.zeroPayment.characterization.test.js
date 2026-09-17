// tests/p0/giftcard.zeroPayment.characterization.test.js
// P0 (Phase 1B-4): a purchase fully covered by a gift card (remainingToPay = 0) or a
// genuinely free item (price = 0) must produce the SAME business effects as a
// successful Stripe purchase — without ever touching Stripe.
//
// Root cause (reports 06 / 31): the only production finalizer is the Stripe webhook,
// which needs a PaymentIntent >= 0.50€; mock-pay is blocked in production; the
// frontend skips the backend when paymentProvider === 'stripe'. There was no backend
// entrypoint to finalize a 0€ order. Phase 1B-4 adds
// POST /api/client/checkout/finalize-free, which reuses the SAME central finalizer
// (processCheckoutStatePurchase) used by the Stripe webhook — no parallel flow.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Keep post-sale side effects (email / notification / Stripe invoice) offline.
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
const GiftCard = (await import('../../models/GiftCard.js')).default;
const GiftCardTransaction = (await import('../../models/GiftCardTransaction.js')).default;
const Product = (await import('../../models/Product.js')).default;
const Sale = (await import('../../models/Sale.js')).default;
const ServiceBooking = (await import('../../models/ServiceBooking.js')).default;
const StripeCheckoutIntent = (await import('../../models/StripeCheckoutIntent.js')).default;

const FINALIZE_FREE = '/api/client/checkout/finalize-free';

async function loginClient1(agent) {
  const login = await agent
    .post('/auth/login')
    .send({ email: 'client1@test.local', password: TEST_PASSWORD });
  expect(login.status).toBe(200);
  return login.headers['set-cookie'];
}

describe('P0 — 0€ checkout finalization (100% gift card / free item)', () => {
  let agent;
  let cookie;
  let fixtures;

  beforeAll(async () => {
    agent = await getAgent();
  });

  afterAll(async () => {
    await stopMemoryDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    fixtures = await seedTestData();
    cookie = await loginClient1(agent);
  });

  it('precondition: a seeded gift card balance can fully cover an item (=> remainingToPay would be 0)', async () => {
    const giftCard = await GiftCard.findById(fixtures.giftCard._id).lean();
    const product = await Product.findById(fixtures.product._id).lean();
    expect(giftCard.balance).toBeGreaterThanOrEqual(product.price);
    expect(Math.max(0, product.price - giftCard.balance)).toBe(0);
  });

  // Test 1 — 100% gift card on a service: sale + gift-card debit + booking created.
  it('Test 1: a 100%-gift-card service booking creates a Sale, a ServiceBooking and debits the card', async () => {
    const { service, practitioner, giftCard, bookingSlotISO } = fixtures;
    const startAt = new Date(bookingSlotISO);
    const endAt = new Date(startAt.getTime() + Number(service.duration) * 60 * 1000);

    const res = await agent
      .post(FINALIZE_FREE)
      .set('Cookie', cookie)
      .send({
        idempotencyKey: 'free-service-001',
        checkoutState: {
          item: { type: 'service', id: String(service._id), name: service.name },
          service: {
            serviceId: String(service._id),
            slotStart: startAt.toISOString(),
            slotEnd: endAt.toISOString(),
            practitionerId: String(practitioner._id),
            selectedOptions: []
          },
          appliedGiftCards: [
            { giftCardId: String(giftCard._id), code: giftCard.code, amount: Number(service.price) }
          ],
          totals: {
            subtotal: Number(service.price),
            giftCardUsed: Number(service.price),
            amountToPay: 0,
            remainingToPay: 0,
            totalAmount: Number(service.price)
          },
          // Sprint pré-React A1 — la prestation est réservée dans la fenêtre de
          // rétractation (slot à +7j) : la reconnaissance d'exécution à date déterminée
          // (renonciation) est désormais revalidée serveur, comme le fait l'UI réelle.
          legal: { acceptedCgv: true, waiverRequired: true, waiverAccepted: true, waiverType: 'legal', waiverText: 'Je reconnais l\'exécution à la date choisie.' }
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.saleId).toBeTruthy();

    const sale = await Sale.findOne({ saleId: res.body.saleId }).lean();
    expect(sale).toBeTruthy();
    expect(sale.totalAmount).toBe(Number(service.price));
    expect(sale.giftCardUsage?.[0]?.amountUsed).toBe(Number(service.price));

    const booking = await ServiceBooking.findOne({ saleId: res.body.saleId }).lean();
    expect(booking).toBeTruthy();
    expect(booking.status).toBe('confirmed');
    expect(String(booking.serviceId)).toBe(String(service._id));

    const debited = await GiftCard.findById(giftCard._id).lean();
    expect(debited.balance).toBe(Number(giftCard.balance) - Number(service.price)); // 100 - 80 = 20
  });

  // Test 2 — gift card balance greater than the amount: debit is capped, remainder kept.
  it('Test 2: a gift card larger than the cart debits only the due amount and keeps the remainder', async () => {
    const { product, giftCard } = fixtures;

    const res = await agent
      .post(FINALIZE_FREE)
      .set('Cookie', cookie)
      .send({
        idempotencyKey: 'free-product-cap-001',
        checkoutState: {
          item: { type: 'product', id: String(product._id), name: product.name },
          appliedGiftCards: [
            { giftCardId: String(giftCard._id), code: giftCard.code, amount: Number(giftCard.balance) }
          ],
          totals: { subtotal: Number(product.price), remainingToPay: 0, totalAmount: Number(product.price) },
          legal: { acceptedCgv: true }
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const sale = await Sale.findOne({ saleId: res.body.saleId }).lean();
    expect(sale.totalAmount).toBe(Number(product.price));
    expect(sale.giftCardUsage?.[0]?.amountUsed).toBe(Number(product.price)); // 40 debited, not 100

    const debited = await GiftCard.findById(giftCard._id).lean();
    expect(debited.balance).toBe(Number(giftCard.balance) - Number(product.price)); // 100 - 40 = 60
    expect(debited.status).toBe('active');
  });

  // Test 3 — a genuinely free product (price 0): sale created, no Stripe involved.
  it('Test 3: a genuinely free product (price 0) is finalized with no Stripe call', async () => {
    const freeProduct = await Product.create({ name: 'Produit gratuit', price: 0, active: true });

    const res = await agent
      .post(FINALIZE_FREE)
      .set('Cookie', cookie)
      .send({
        idempotencyKey: 'free-product-zero-001',
        checkoutState: {
          item: { type: 'product', id: String(freeProduct._id), name: freeProduct.name },
          appliedGiftCards: [],
          totals: { subtotal: 0, remainingToPay: 0, totalAmount: 0 },
          legal: { acceptedCgv: true }
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const sale = await Sale.findOne({ saleId: res.body.saleId }).lean();
    expect(sale).toBeTruthy();
    expect(sale.totalAmount).toBe(0);
    // No real Stripe PaymentIntent — only a synthetic "free_" idempotency reference,
    // and no StripeCheckoutIntent was ever created.
    expect(String(sale.stripePaymentIntentId || '')).toMatch(/^free_/);
    expect(await StripeCheckoutIntent.countDocuments({})).toBe(0);
  });

  // Test 4 — double submission with the same idempotency key: one sale, one debit.
  it('Test 4: a double submission (same idempotency key) creates exactly one Sale and debits once', async () => {
    const { product, giftCard } = fixtures;
    const payload = {
      idempotencyKey: 'free-dup-001',
      checkoutState: {
        item: { type: 'product', id: String(product._id), name: product.name },
        appliedGiftCards: [
          { giftCardId: String(giftCard._id), code: giftCard.code, amount: Number(product.price) }
        ],
        totals: { subtotal: Number(product.price), remainingToPay: 0, totalAmount: Number(product.price) },
        legal: { acceptedCgv: true }
      }
    };

    const [r1, r2] = await Promise.all([
      agent.post(FINALIZE_FREE).set('Cookie', cookie).send(payload),
      agent.post(FINALIZE_FREE).set('Cookie', cookie).send(payload)
    ]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body.saleId).toBeTruthy();
    expect(r2.body.saleId).toBe(r1.body.saleId);

    const sales = await Sale.find({ stripePaymentIntentId: 'free_free-dup-001' }).lean();
    expect(sales).toHaveLength(1);

    const debited = await GiftCard.findById(giftCard._id).lean();
    expect(debited.balance).toBe(Number(giftCard.balance) - Number(product.price)); // debited exactly once

    const txns = await GiftCardTransaction.find({ saleId: r1.body.saleId }).lean();
    expect(txns).toHaveLength(1);
  });

  // Anti-bypass — server must not finalize a partially-paid order for free.
  it('refuses to finalize for free when a balance remains due (cannot bypass payment)', async () => {
    const { product, giftCard } = fixtures;

    const res = await agent
      .post(FINALIZE_FREE)
      .set('Cookie', cookie)
      .send({
        idempotencyKey: 'free-bypass-attempt-001',
        checkoutState: {
          item: { type: 'product', id: String(product._id), name: product.name },
          // Only 10€ of a 40€ product covered → 30€ still due.
          appliedGiftCards: [{ giftCardId: String(giftCard._id), code: giftCard.code, amount: 10 }],
          totals: { subtotal: Number(product.price), remainingToPay: 0, totalAmount: Number(product.price) },
          legal: { acceptedCgv: true }
        }
      });

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('PAYMENT_REQUIRED');

    expect(await Sale.countDocuments({})).toBe(0);
    const card = await GiftCard.findById(giftCard._id).lean();
    expect(card.balance).toBe(Number(giftCard.balance)); // untouched
  });
});
