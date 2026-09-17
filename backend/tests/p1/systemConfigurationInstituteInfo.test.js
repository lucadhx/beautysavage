// S1B — SystemConfiguration fournit les infos institut (getInstituteInfo). Le fallback
// .env INSTITUTE_* est dev-only (interdit en production).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import {
  updateSystemConfiguration,
  invalidateSystemConfigurationCache,
  getInstituteInfo,
  resolveInstituteName
} from '../../services/system/systemConfigurationService.js';

describe('SystemConfiguration — getInstituteInfo (source unique)', () => {
  let prevNodeEnv, prevName;

  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => {
    await stopMemoryDb();
  });
  beforeEach(async () => {
    await clearDatabase();
    invalidateSystemConfigurationCache();
    prevNodeEnv = process.env.NODE_ENV;
    prevName = process.env.INSTITUTE_NAME;
  });
  afterEach(() => {
    process.env.NODE_ENV = prevNodeEnv;
    if (prevName === undefined) delete process.env.INSTITUTE_NAME; else process.env.INSTITUTE_NAME = prevName;
    invalidateSystemConfigurationCache();
  });

  it('renvoie les infos issues de la configuration', async () => {
    await updateSystemConfiguration({
      institute: {
        name: 'Studio Romane',
        email: 'hello@studio.fr',
        siret: '111 222 333 00044',
        address: { line1: '2 rue X', city: 'Lyon', postalCode: '69001', country: 'FR' }
      },
      tax: { vatMention: 'TVA 20%' }
    });
    const info = getInstituteInfo();
    expect(info.name).toBe('Studio Romane');
    expect(info.email).toBe('hello@studio.fr');
    expect(info.siret).toBe('111 222 333 00044');
    expect(info.address.city).toBe('Lyon');
    expect(info.vatMention).toBe('TVA 20%');
  });

  it('production + config vide + INSTITUTE_NAME env → IGNORE l\'env (renvoie \'\')', () => {
    process.env.NODE_ENV = 'production';
    process.env.INSTITUTE_NAME = 'Env Institut';
    invalidateSystemConfigurationCache();
    expect(resolveInstituteName()).toBe('');
  });

  it('dev + config vide + INSTITUTE_NAME env → fallback env autorisé', () => {
    process.env.NODE_ENV = 'test';
    process.env.INSTITUTE_NAME = 'Env Institut';
    invalidateSystemConfigurationCache();
    expect(resolveInstituteName()).toBe('Env Institut');
  });
});
