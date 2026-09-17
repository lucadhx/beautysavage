// tests/p1/contractBillingCharacterization.test.js
// Sprint F3A — Caractérisation du domaine facturation contrat AVANT extraction. Fige le
// comportement observé des endpoints (statuts + payloads publics) pour garantir zéro
// changement après le déplacement vers services/stripe/dev/* + services/contract/*.
// Le client Stripe Dev est mocké via le shim utils/stripeDevClient ; getCredential mocké.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

const h = vi.hoisted(() => ({ client: null }));
vi.mock('../../utils/stripeDevClient.js', () => ({
  getStripeDevClient: async () => h.client,
  default: async () => h.client
}));
vi.mock('../../services/integratedApiCredentialService.js', () => ({
  getCredential: vi.fn(async () => 'pk_test_dev_char')
}));
// invalidateContractCache : no-op DB-free
vi.mock('../../middlewares/contractGuard.js', async (orig) => {
  const actual = await orig();
  return { ...actual, invalidateContractCache: () => {} };
});

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const Contract = (await import('../../models/Contract.js')).default;
const ContractCheckoutIntent = (await import('../../models/ContractCheckoutIntent.js')).default;
const ctrl = await import('../../controllers/contractController.js');
// Sprint F3A — syncStripeStatuses vit désormais dans le service de sync Stripe Dev contrat.
const { syncStripeStatuses } = await import('../../services/stripe/dev/stripeDevContractSyncService.js');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}
const ADMIN_ID = new mongoose.Types.ObjectId();
function req(extra = {}) {
  return { sessionUser: { _id: ADMIN_ID }, body: {}, query: {}, params: {}, ...extra };
}

async function seedPendingContract(overrides = {}) {
  return Contract.create({
    status: 'pending',
    file: '/uploads/contracts/x.pdf',
    fileOriginalName: 'contrat.pdf',
    launchFee: { amount: 500, taxRate: 0.2, paid: false },
    monthlyFee: { amount: 100, taxRate: 0.2, active: false },
    cancellationPolicy: { type: 'anytime' },
    createdBy: ADMIN_ID,
    updatedBy: ADMIN_ID,
    ...overrides
  });
}

describe('F3A — caractérisation facturation contrat', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); h.client = null; });

  it('getStripeDevConfig → { ok:true, publishableKey }', async () => {
    const res = mockRes();
    await ctrl.getStripeDevConfig(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, publishableKey: 'pk_test_dev_char' });
  });

  it('createLaunchIntent → crée un PaymentIntent + ContractCheckoutIntent', async () => {
    const contract = await seedPendingContract();
    h.client = {
      paymentIntents: {
        create: vi.fn(async () => ({ id: 'pi_launch_1', client_secret: 'cs_launch_1' })),
        retrieve: vi.fn()
      }
    };
    const res = mockRes();
    await ctrl.createLaunchIntent(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, paymentIntentId: 'pi_launch_1', clientSecret: 'cs_launch_1', amountCents: 60000 });
    const intent = await ContractCheckoutIntent.findOne({ contractId: contract._id, type: 'launch' }).lean();
    expect(intent?.stripePaymentIntentId).toBe('pi_launch_1');
  });

  it('createLaunchIntent → 409 si déjà payé', async () => {
    await seedPendingContract({ launchFee: { amount: 500, taxRate: 0.2, paid: true } });
    h.client = { paymentIntents: { create: vi.fn(), retrieve: vi.fn() } };
    const res = mockRes();
    await ctrl.createLaunchIntent(req(), res);
    expect(res.statusCode).toBe(409);
  });

  it('createMonthlySetup → customer + SetupIntent (launch payé)', async () => {
    await seedPendingContract({ launchFee: { amount: 500, taxRate: 0.2, paid: true } });
    h.client = {
      customers: { create: vi.fn(async () => ({ id: 'cus_1' })) },
      setupIntents: { create: vi.fn(async () => ({ id: 'si_1', client_secret: 'cs_si_1' })), retrieve: vi.fn() }
    };
    const res = mockRes();
    await ctrl.createMonthlySetup(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, setupIntentId: 'si_1', clientSecret: 'cs_si_1', customerId: 'cus_1' });
  });

  it('verifyLaunchPayment → succeeded marque launchFee.paid', async () => {
    const contract = await seedPendingContract();
    await ContractCheckoutIntent.create({ contractId: contract._id, type: 'launch', stripePaymentIntentId: 'pi_v1', processed: false, adminId: ADMIN_ID });
    h.client = { paymentIntents: { retrieve: vi.fn(async () => ({ id: 'pi_v1', status: 'succeeded' })) } };
    const res = mockRes();
    await ctrl.verifyLaunchPayment(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const fresh = await Contract.findById(contract._id).lean();
    expect(fresh.launchFee.paid).toBe(true);
  });

  it('verifyMonthlySetup → succeeded marque monthlyFee.active', async () => {
    const contract = await seedPendingContract({ launchFee: { amount: 500, taxRate: 0.2, paid: true } });
    await ContractCheckoutIntent.create({ contractId: contract._id, type: 'monthly', stripeSetupIntentId: 'si_v1', processed: false, adminId: ADMIN_ID });
    h.client = { setupIntents: { retrieve: vi.fn(async () => ({ id: 'si_v1', status: 'succeeded' })) } };
    const res = mockRes();
    await ctrl.verifyMonthlySetup(req(), res);
    expect(res.body).toEqual({ ok: true });
    const fresh = await Contract.findById(contract._id).lean();
    expect(fresh.monthlyFee.active).toBe(true);
  });

  it('checkPaymentStatus → payload steps stable', async () => {
    await seedPendingContract({ launchFee: { amount: 500, taxRate: 0.2, paid: true }, monthlyFee: { amount: 100, taxRate: 0.2, active: true } });
    h.client = { paymentIntents: { retrieve: vi.fn() }, subscriptions: { retrieve: vi.fn() } };
    const res = mockRes();
    await ctrl.checkPaymentStatus(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.contractStatus).toBe('pending');
    expect(res.body.steps).toMatchObject({
      launchFeePaid: true, launchFeeRequired: true,
      monthlyActive: true, monthlyRequired: true, contractActive: false
    });
  });

  it('activateContract → active si tout réglé (+ lockedUntil null en anytime)', async () => {
    await seedPendingContract({ launchFee: { amount: 500, taxRate: 0.2, paid: true }, monthlyFee: { amount: 100, taxRate: 0.2, active: true } });
    h.client = { paymentIntents: { retrieve: vi.fn() }, subscriptions: { retrieve: vi.fn() } };
    const res = mockRes();
    await ctrl.activateContract(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.lockedUntil).toBeNull();
    const fresh = await Contract.findOne({}).lean();
    expect(fresh.status).toBe('active');
  });

  it('cancelContract avec subscription → cancel_at_period_end (status inchangé)', async () => {
    await seedPendingContract({ status: 'active', monthlyFee: { amount: 100, taxRate: 0.2, active: true, stripeSubscriptionId: 'sub_1' } });
    h.client = { subscriptions: { update: vi.fn(async () => ({ current_period_end: 1893456000 })) } };
    const res = mockRes();
    await ctrl.cancelContract(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, cancelAtPeriodEnd: true, immediate: false });
    const fresh = await Contract.findOne({}).lean();
    expect(fresh.status).toBe('active'); // transition déléguée au webhook
    expect(fresh.monthlyFee.cancelAtPeriodEnd).toBe(true);
  });

  it('cancelContract sans subscription → résiliation immédiate', async () => {
    await seedPendingContract({ status: 'active', monthlyFee: { amount: 0, taxRate: 0.2, active: false } });
    h.client = { subscriptions: { update: vi.fn() } };
    const res = mockRes();
    await ctrl.cancelContract(req(), res);
    expect(res.body).toMatchObject({ ok: true, cancelAtPeriodEnd: false, immediate: true });
    const fresh = await Contract.findOne({}).lean();
    expect(fresh.status).toBe('cancelled');
  });

  it('syncStripeStatuses → PI succeeded ⇒ launchFee.paid ; sub active ⇒ monthlyFee.active', async () => {
    const contract = await seedPendingContract();
    await ContractCheckoutIntent.create({ contractId: contract._id, type: 'launch', stripePaymentIntentId: 'pi_s1', processed: false, adminId: ADMIN_ID });
    const doc = await Contract.findById(contract._id);
    doc.monthlyFee.stripeSubscriptionId = 'sub_s1';
    await doc.save();
    h.client = {
      paymentIntents: { retrieve: vi.fn(async () => ({ status: 'succeeded' })) },
      subscriptions: { retrieve: vi.fn(async () => ({ status: 'active' })) }
    };
    const live = await Contract.findById(contract._id);
    await syncStripeStatuses(live);
    expect(live.launchFee.paid).toBe(true);
    expect(live.monthlyFee.active).toBe(true);
  });
});
