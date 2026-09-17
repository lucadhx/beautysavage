// tests/p1/checkoutExtractionParity.test.js
// Sprint F1 — Prouve que l'extraction du domaine Checkout hors de clientController est
// PUREMENT STRUCTURELLE :
//  (1) Identité référentielle : les fonctions ré-exportées par checkoutFacade SONT les mêmes
//      références que celles définies dans les sous-services (aucune duplication de logique,
//      une seule définition par fonction — consommée à l'identique par stripe/giftCard/booking).
//  (2) Contrat HTTP inchangé : l'endpoint public finalize-free renvoie les mêmes statuts/codes
//      qu'avant (401 sans auth, 400 sans checkoutState, 402 PAYMENT_REQUIRED si un solde reste dû).
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

const facade = await import('../../services/checkout/checkoutFacade.js');
const finalization = await import('../../services/checkout/checkoutFinalizationService.js');
const booking = await import('../../services/checkout/checkoutBookingService.js');
const persistence = await import('../../services/checkout/checkoutPersistenceService.js');

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');

const FINALIZE_FREE = '/api/client/checkout/finalize-free';

async function loginClient1(agent) {
  const login = await agent
    .post('/auth/login')
    .send({ email: 'client1@test.local', password: TEST_PASSWORD });
  expect(login.status).toBe(200);
  return login.headers['set-cookie'];
}

describe('F1 — extraction checkout : identité référentielle (aucune duplication)', () => {
  it('checkoutFacade ré-exporte les MÊMES références que les sous-services', () => {
    // Dispatcher + idempotence (checkoutFinalizationService)
    expect(facade.processCheckoutStatePurchase).toBe(finalization.processCheckoutStatePurchase);
    expect(facade.waitForExistingFreeSale).toBe(finalization.waitForExistingFreeSale);
    // Réservation prestation (checkoutBookingService)
    expect(facade.processServiceCheckoutStatePurchase).toBe(
      booking.processServiceCheckoutStatePurchase
    );
    // Persistance + effets + builders (checkoutPersistenceService)
    expect(facade.persistSale).toBe(persistence.persistSale);
    expect(facade.runPostSaleSideEffects).toBe(persistence.runPostSaleSideEffects);
    expect(facade.applySaleCommissionSnapshot).toBe(persistence.applySaleCommissionSnapshot);
    expect(facade.buildCustomerProfile).toBe(persistence.buildCustomerProfile);
    expect(facade.buildSaleEntry).toBe(persistence.buildSaleEntry);
    expect(facade.validateAndBuildSelectedOptions).toBe(persistence.validateAndBuildSelectedOptions);
    expect(facade.persistCartSnapshot).toBe(persistence.persistCartSnapshot);
    expect(facade.rollbackSingleSale).toBe(persistence.rollbackSingleSale);
    expect(typeof facade.finalizeFreeCheckout).toBe('function');
  });
});

describe('F1 — extraction checkout : contrat HTTP finalize-free inchangé', () => {
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

  it('401 sans authentification', async () => {
    const res = await agent.post(FINALIZE_FREE).send({ checkoutState: { item: {} } });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('400 + CHECKOUT_STATE_REQUIRED si checkoutState manquant', async () => {
    const res = await agent.post(FINALIZE_FREE).set('Cookie', cookie).send({});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, code: 'CHECKOUT_STATE_REQUIRED' });
  });

  it('402 + PAYMENT_REQUIRED si un solde reste dû (produit payant, pas de carte cadeau)', async () => {
    const res = await agent
      .post(FINALIZE_FREE)
      .set('Cookie', cookie)
      .send({
        checkoutState: {
          item: { type: 'product', id: String(fixtures.product._id) },
          legal: { acceptedCgv: true },
          appliedGiftCards: []
        }
      });
    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ ok: false, code: 'PAYMENT_REQUIRED' });
  });
});
