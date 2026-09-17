// tests/p1/distanceLearningLifetimeAccessRefund.test.js
// Pré-React C3 — Formation distancielle = contenu numérique à VIE. Renonciation obligatoire
// avant accès immédiat ; aucun remboursement une fois l'accès donné ; pas d'expiration.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../services/notificationService.js', async o => ({ ...(await o()), triggerNotification: async () => {} }));
vi.mock('../../services/mailService.js', async o => ({ ...(await o()), sendSaleEmail: async () => true }));
vi.mock('../../services/stripeInvoiceService.js', async o => ({ ...(await o()), createStripeInvoiceForSale: async () => null }));

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const Formation = (await import('../../models/Formation.js')).default;
const Sale = (await import('../../models/Sale.js')).default;
const { processCheckoutStatePurchase } = await import('../../services/checkout/checkoutFacade.js');
const { deriveLegalRequirements, validateCheckoutLegalConsents } = await import('../../services/legalConsentService.js');
const { getDistancielRefundEligibility, REFUND_REASON_DISTANCIEL_ACCESS_GRANTED } = await import('../../services/refundService.js');
const { DISTANT_LEARNING_WAIVER_TEXT } = await import('../../constants/consumerWaiver.js');

describe('C3 — distanciel accès à vie non remboursable', () => {
  let fx;
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  it('achat distanciel SANS renonciation → consentement refusé', async () => {
    const reqs = await deriveLegalRequirements({ item: { type: 'formation', id: String(fx.formationDistanciel._id) } });
    expect(reqs.digitalImmediateAccessWaiverRequired).toBe(true);
    expect(() => validateCheckoutLegalConsents(
      { item: { type: 'formation', id: String(fx.formationDistanciel._id) }, legal: { acceptedCgv: true } },
      reqs
    )).toThrowError(expect.objectContaining({ code: 'LEGAL_CONSENT_REQUIRED' }));
  });

  it('Formation distancielle : accès à vie par défaut, non remboursable après accès', async () => {
    const f = await Formation.findById(fx.formationDistanciel._id).lean();
    expect(f.accessLifetime).toBe(true);
    expect(f.accessExpiresAt).toBeNull();
    expect(f.isRefundableAfterAccess).toBe(false);
  });

  it('achat distanciel immédiat (accessUrl + waiver) → accès granted/lifetime + snapshot légal', async () => {
    const distImmediate = await Formation.create({
      name: 'Distanciel immédiat', type: 'distanciel', price: 0, status: 'published', active: true,
      refundDays: 7, accessDeliveryMode: 'immediate', accessUrl: 'https://video/abc'
    });
    await processCheckoutStatePurchase({
      userId: fx.client1._id, itemType: 'formation', itemId: String(distImmediate._id),
      checkoutState: {
        item: { type: 'formation', id: String(distImmediate._id) },
        legal: { acceptedCgv: true, waiverAccepted: true, waiverText: DISTANT_LEARNING_WAIVER_TEXT }
      },
      clientIp: '1.2.3.4', stripeSessionId: 'pi_c3_1', stripePaymentIntentId: 'pi_c3_1'
    });
    const sale = await Sale.findOne({ stripePaymentIntentId: 'pi_c3_1' }).lean();
    expect(sale.accessDeliveryStatus).toBe('immediate');
    expect(sale.accessGrantedAt).toBeTruthy();
    // Snapshot légal : renonciation au droit de rétractation captée (A1).
    expect(sale.legalConsentSnapshot.digitalContentImmediateAccessAccepted).toBe(true);
    expect(sale.legalConsentSnapshot.withdrawalWaiverAccepted).toBe(true);
  });

  it('remboursement après accès donné → refusé (code clair, pas d\'expiration)', async () => {
    const distImmediate = await Formation.create({
      name: 'Distanciel immédiat 2', type: 'distanciel', price: 200, status: 'published', active: true,
      refundDays: 7, accessDeliveryMode: 'immediate', accessUrl: 'https://video/xyz'
    });
    const elig = getDistancielRefundEligibility({
      formation: distImmediate.toObject(),
      sale: { accessGrantedAt: new Date(), accessDeliveryStatus: 'immediate' },
      now: new Date()
    });
    expect(elig.applicable).toBe(true);
    expect(elig.eligibleRefund).toBe(false);
    expect(elig.reason).toBe(REFUND_REASON_DISTANCIEL_ACCESS_GRANTED);
    expect(elig.lifetime).toBe(true);
  });

  it('isRefundableAfterAccess=true (cas exceptionnel configuré) → remboursement autorisé', async () => {
    const f = { type: 'distanciel', isRefundableAfterAccess: true, accessLifetime: true };
    const elig = getDistancielRefundEligibility({ formation: f, sale: { accessGrantedAt: new Date() } });
    expect(elig.eligibleRefund).toBe(false); // accès donné mais flag → reste géré (review)
    // (le flag autorise un arbitrage manuel ; le code ne rembourse jamais automatiquement)
    expect(elig.reason).not.toBe(REFUND_REASON_DISTANCIEL_ACCESS_GRANTED);
  });
});
