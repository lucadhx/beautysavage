// tests/p1/integratedApiAccountPurpose.test.js
// Correction commissions — IntegratedApi.accountPurpose clarifie les deux comptes Stripe
// (+ messaging). Seedé et backfillé depuis le slug.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import IntegratedApi, { ACCOUNT_PURPOSES } from '../../models/IntegratedApi.js';
import { seedIntegratedApisFromEnv } from '../../seeders/seedIntegratedApisFromEnv.js';

describe('IntegratedApi — accountPurpose', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('enum exposé : customer_payments / platform_billing / messaging', () => {
    expect(ACCOUNT_PURPOSES).toEqual(['customer_payments', 'platform_billing', 'messaging']);
  });

  it('seed pose accountPurpose par compte', async () => {
    await seedIntegratedApisFromEnv();
    const institut = await IntegratedApi.findOne({ slug: 'stripe-institut' }).lean();
    const dev = await IntegratedApi.findOne({ slug: 'stripe-dev' }).lean();
    const brevo = await IntegratedApi.findOne({ slug: 'brevo' }).lean();
    expect(institut.accountPurpose).toBe('customer_payments');
    expect(dev.accountPurpose).toBe('platform_billing');
    expect(brevo.accountPurpose).toBe('messaging');
  });

  it('backfill : un document existant sans accountPurpose est complété par le seed', async () => {
    // Pré-créer brevo SANS accountPurpose (document legacy).
    await IntegratedApi.create({
      slug: 'brevo', name: 'Brevo', provider: 'brevo', runtimeModel: 'single', mode: 'test',
      credentials: []
    });
    const before = await IntegratedApi.findOne({ slug: 'brevo' }).lean();
    expect(before.accountPurpose).toBeNull();

    await seedIntegratedApisFromEnv();
    const after = await IntegratedApi.findOne({ slug: 'brevo' }).lean();
    expect(after.accountPurpose).toBe('messaging');
  });
});
