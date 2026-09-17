// S1C — NGROK_DOMAIN supprimé, DomainResolver = SystemConfiguration → localhost (premier boot),
// politique vault uniforme (clé obligatoire au boot).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import {
  updateSystemConfiguration,
  invalidateSystemConfigurationCache
} from '../../services/system/systemConfigurationService.js';
import {
  resolveVitrineBaseUrl,
  resolvePanelUrl,
  resolveVitrineUrl,
  resolvePublicUrl
} from '../../services/system/domainResolver.js';
import { validateCredentialVaultKey } from '../../utils/credentialVault.js';

function src(rel) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('S1C — suppression NGROK_DOMAIN (garde statique)', () => {
  const RUNTIME_FILES = [
    '../../app.js',
    '../../services/system/domainResolver.js',
    '../../services/stripe/stripeCheckoutService.js',
    '../../services/stripe/dev/stripeDevHostedCheckoutService.js'
  ];
  it('aucun fichier runtime ne lit process.env.NGROK_DOMAIN', () => {
    for (const f of RUNTIME_FILES) {
      expect(src(f)).not.toMatch(/process\.env\.NGROK_DOMAIN/);
    }
  });
  it('le DomainResolver ne lit ni NGROK_DOMAIN ni APP_BASE_URL', () => {
    const resolver = src('../../services/system/domainResolver.js');
    expect(resolver).not.toMatch(/NGROK_DOMAIN/);
    expect(resolver).not.toMatch(/APP_BASE_URL/);
    expect(resolver).not.toMatch(/process\.env/);
  });
});

describe('S1C — DomainResolver : SystemConfiguration → localhost', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); invalidateSystemConfigurationCache(); });

  it('premier boot (aucune config) → localhost:3000', () => {
    expect(resolveVitrineBaseUrl()).toBe('http://localhost:3000');
    expect(resolveVitrineUrl('vitrine.html?slug=payment')).toBe('http://localhost:3000/vitrine.html?slug=payment');
  });

  it('avec SystemConfiguration.domains → URLs construites depuis la config (ex. ngrok)', async () => {
    await updateSystemConfiguration({
      domains: { vitrineUrl: 'https://abc123.ngrok-free.app', panelUrl: 'https://abc123.ngrok-free.app/manager' }
    });
    expect(resolveVitrineUrl('vitrine.html?slug=payment')).toBe('https://abc123.ngrok-free.app/vitrine.html?slug=payment');
    expect(resolvePublicUrl('api/stripe/webhook')).toBe('https://abc123.ngrok-free.app/api/stripe/webhook');
    expect(resolvePanelUrl('gestion.html')).toBe('https://abc123.ngrok-free.app/manager/gestion.html');
  });

  it('panelUrl absent → retombe sur la vitrine', async () => {
    await updateSystemConfiguration({ domains: { vitrineUrl: 'https://beautysavage.fr' } });
    expect(resolvePanelUrl('gestion.html')).toBe('https://beautysavage.fr/gestion.html');
  });
});

describe('S1C — politique vault uniforme', () => {
  it('clé injectée (testEnv) → valide', () => {
    expect(validateCredentialVaultKey()).toBe(true);
  });
  it('clé absente → refuse de démarrer (throw), quel que soit NODE_ENV', () => {
    const prevKey = process.env.CREDENTIAL_VAULT_KEY;
    const prevEnv = process.env.NODE_ENV;
    try {
      delete process.env.CREDENTIAL_VAULT_KEY;
      for (const env of ['development', 'production']) {
        process.env.NODE_ENV = env;
        expect(() => validateCredentialVaultKey()).toThrow(/Refusing to boot/i);
      }
    } finally {
      if (prevKey === undefined) delete process.env.CREDENTIAL_VAULT_KEY; else process.env.CREDENTIAL_VAULT_KEY = prevKey;
      if (prevEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevEnv;
    }
  });
});
