// tests/p1/legalConsentCheckout.test.js
// Sprint pré-React A1 — Revalidation serveur des consentements légaux (CGV /
// rétractation / renonciation). Le serveur ne fait plus confiance aux booléens
// client : il dérive les consentements requis du CATALOGUE et refuse les achats
// incomplets (code LEGAL_CONSENT_REQUIRED), puis snapshote le consentement sur la vente.
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

const {
  validateCheckoutLegalConsents,
  deriveLegalRequirements,
  buildLegalConsentSnapshot,
  LEGAL_CONSENT_REQUIRED_CODE
} = await import('../../services/legalConsentService.js');
const { DISTANT_LEARNING_WAIVER_TEXT } = await import('../../constants/consumerWaiver.js');

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const Sale = (await import('../../models/Sale.js')).default;
const Product = (await import('../../models/Product.js')).default;
const { processCheckoutStatePurchase } = await import('../../services/checkout/checkoutFacade.js');

const FINALIZE_FREE = '/api/client/checkout/finalize-free';

async function loginClient1(agent) {
  const login = await agent
    .post('/auth/login')
    .send({ email: 'client1@test.local', password: TEST_PASSWORD });
  expect(login.status).toBe(200);
  return login.headers['set-cookie'];
}

describe('A1 — legal consent (pure validation rules)', () => {
  it('refuses a checkout without CGV → LEGAL_CONSENT_REQUIRED', () => {
    expect(() =>
      validateCheckoutLegalConsents({ legal: { acceptedCgv: false } }, { cgvRequired: true })
    ).toThrowError(expect.objectContaining({ code: LEGAL_CONSENT_REQUIRED_CODE, status: 400 }));
  });

  it('refuses a distanciel immediate-access checkout without the withdrawal waiver', () => {
    expect(() =>
      validateCheckoutLegalConsents(
        { legal: { acceptedCgv: true, waiverAccepted: false, waiverText: '' } },
        { cgvRequired: true, digitalImmediateAccessWaiverRequired: true }
      )
    ).toThrowError(expect.objectContaining({ code: LEGAL_CONSENT_REQUIRED_CODE }));
  });

  it('refuses a dated service checkout without acknowledgement', () => {
    expect(() =>
      validateCheckoutLegalConsents(
        { service: { serviceId: 'x' }, legal: { acceptedCgv: true, waiverAccepted: false } },
        { cgvRequired: true, datedServiceAckRequired: true }
      )
    ).toThrowError(expect.objectContaining({ code: LEGAL_CONSENT_REQUIRED_CODE }));
  });

  it('accepts a complete distanciel consent (CGV + explicit withdrawal waiver)', () => {
    expect(
      validateCheckoutLegalConsents(
        { legal: { acceptedCgv: true, waiverAccepted: true, waiverText: DISTANT_LEARNING_WAIVER_TEXT } },
        { cgvRequired: true, digitalImmediateAccessWaiverRequired: true }
      )
    ).toBe(true);
  });

  it('builds a snapshot reflecting the captured consents', () => {
    const snap = buildLegalConsentSnapshot({
      checkoutState: {
        legal: { acceptedCgv: true, waiverAccepted: true, waiverText: DISTANT_LEARNING_WAIVER_TEXT }
      },
      source: 'stripe_checkout'
    });
    expect(snap.cgvAccepted).toBe(true);
    expect(snap.withdrawalWaiverAccepted).toBe(true);
    expect(snap.digitalContentImmediateAccessAccepted).toBe(true);
    expect(snap.source).toBe('stripe_checkout');
    expect(snap.version).toBeTruthy();
    expect(snap.cgvAcceptedAt instanceof Date).toBe(true);
  });
});

describe('A1 — legal consent (server-derived requirements + enforcement)', () => {
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

  it('derives the digital immediate-access waiver requirement for a distanciel formation (catalog, not client)', async () => {
    const reqs = await deriveLegalRequirements({
      item: { type: 'formation', id: String(fixtures.formationDistanciel._id) }
    });
    expect(reqs.digitalImmediateAccessWaiverRequired).toBe(true);
  });

  it('derives a dated-service acknowledgement requirement when the slot is soon', async () => {
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // < 7/14 days
    const reqs = await deriveLegalRequirements({
      service: { serviceId: String(fixtures.service._id), slotStart: soon.toISOString() }
    });
    expect(reqs.datedServiceAckRequired).toBe(true);
  });

  it('free checkout (0€) refuses a distanciel purchase without the withdrawal waiver — same rules', async () => {
    const res = await agent
      .post(FINALIZE_FREE)
      .set('Cookie', cookie)
      .send({
        idempotencyKey: 'legal-distanciel-nowaiver-001',
        checkoutState: {
          item: { type: 'formation', id: String(fixtures.formationDistanciel._id) },
          appliedGiftCards: [],
          totals: { subtotal: 0, remainingToPay: 0, totalAmount: 0 },
          // Malicious/incomplete: CGV ok but no withdrawal waiver for immediate access.
          legal: { acceptedCgv: true, waiverRequired: false, waiverAccepted: false }
        }
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(LEGAL_CONSENT_REQUIRED_CODE);
    expect(await Sale.countDocuments({})).toBe(0);
  });

  it('free checkout (0€) refuses a product purchase without CGV', async () => {
    const res = await agent
      .post(FINALIZE_FREE)
      .set('Cookie', cookie)
      .send({
        idempotencyKey: 'legal-noconsent-001',
        checkoutState: {
          item: { type: 'product', id: String(fixtures.product._id), name: fixtures.product.name },
          appliedGiftCards: [],
          totals: { subtotal: 0, remainingToPay: 0, totalAmount: 0 },
          legal: { acceptedCgv: false }
        }
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(LEGAL_CONSENT_REQUIRED_CODE);
    expect(await Sale.countDocuments({})).toBe(0);
  });

  it('free checkout (0€) with valid consent succeeds and stores a legalConsentSnapshot on the Sale', async () => {
    const { product, giftCard } = fixtures; // gift card 100 fully covers product 40
    const res = await agent
      .post(FINALIZE_FREE)
      .set('Cookie', cookie)
      .send({
        idempotencyKey: 'legal-valid-001',
        checkoutState: {
          item: { type: 'product', id: String(product._id), name: product.name },
          appliedGiftCards: [
            { giftCardId: String(giftCard._id), code: giftCard.code, amount: Number(product.price) }
          ],
          totals: { subtotal: Number(product.price), remainingToPay: 0, totalAmount: Number(product.price) },
          legal: { acceptedCgv: true }
        }
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const sale = await Sale.findOne({ saleId: res.body.saleId }).lean();
    expect(sale.legalConsentSnapshot).toBeTruthy();
    expect(sale.legalConsentSnapshot.cgvAccepted).toBe(true);
    expect(sale.legalConsentSnapshot.source).toBe('free_checkout');
    expect(sale.legalConsentSnapshot.version).toBeTruthy();
  });

  it('Stripe-path finalizer stores the snapshot with source stripe_checkout', async () => {
    await processCheckoutStatePurchase({
      userId: fixtures.client1._id,
      itemType: 'product',
      itemId: String(fixtures.product._id),
      checkoutState: {
        item: { type: 'product', id: String(fixtures.product._id) },
        legal: { acceptedCgv: true }
      },
      clientIp: '1.2.3.4',
      stripeSessionId: 'pi_legal_snap_1',
      stripePaymentIntentId: 'pi_legal_snap_1'
    });
    const sale = await Sale.findOne({ stripePaymentIntentId: 'pi_legal_snap_1' }).lean();
    expect(sale).toBeTruthy();
    expect(sale.legalConsentSnapshot.cgvAccepted).toBe(true);
    expect(sale.legalConsentSnapshot.source).toBe('stripe_checkout');
  });
});
