// S1C — Politique UNIFORME du fallback .env des credentials (aucune logique d'environnement).
// Le fallback est un opt-in EXPLICITE : actif si et seulement si ALLOW_ENV_CREDENTIAL_FALLBACK==='true',
// QUEL QUE SOIT NODE_ENV (dev/test/production). La sécurité vient de la clé de coffre (obligatoire au boot).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import { getCredential, IntegratedApiNotFoundError } from '../../services/integratedApiCredentialService.js';

describe('IntegratedAPI — fallback .env : politique uniforme (flag-only)', () => {
  let prevNodeEnv, prevFlag, prevKey;

  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => {
    await stopMemoryDb();
  });
  beforeEach(async () => {
    await clearDatabase();
    prevNodeEnv = process.env.NODE_ENV;
    prevFlag = process.env.ALLOW_ENV_CREDENTIAL_FALLBACK;
    prevKey = process.env.BREVO_API_KEY;
    process.env.BREVO_API_KEY = 'xkeysib-FAKE-test-only-not-a-secret';
  });
  afterEach(() => {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevNodeEnv;
    process.env.ALLOW_ENV_CREDENTIAL_FALLBACK = prevFlag;
    if (prevKey === undefined) delete process.env.BREVO_API_KEY; else process.env.BREVO_API_KEY = prevKey;
  });

  // flag true → fallback actif dans TOUS les environnements (y compris production).
  for (const env of ['test', 'development', 'production']) {
    it(`flag true + pas de coffre → fallback .env actif (NODE_ENV=${env})`, async () => {
      process.env.NODE_ENV = env;
      process.env.ALLOW_ENV_CREDENTIAL_FALLBACK = 'true';
      const val = await getCredential('brevo', { role: 'api_key' });
      expect(val).toBe('xkeysib-FAKE-test-only-not-a-secret');
    });
  }

  // flag false → jamais de fallback (fail-loud), dans TOUS les environnements.
  for (const env of ['test', 'production']) {
    it(`flag false → aucun fallback, fail-loud (NODE_ENV=${env})`, async () => {
      process.env.NODE_ENV = env;
      process.env.ALLOW_ENV_CREDENTIAL_FALLBACK = 'false';
      await expect(getCredential('brevo', { role: 'api_key' })).rejects.toBeInstanceOf(IntegratedApiNotFoundError);
    });
  }
});
