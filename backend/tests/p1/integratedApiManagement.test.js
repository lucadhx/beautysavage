// tests/p1/integratedApiManagement.test.js
// LOT1 — Surface de gestion DEV des intégrations chiffrées : list/détail masqués, configurer
// (préfixe par mode), test de connexion (fetch mocké), verified + empreinte invalidée au
// changement de clé, garde d'activation PROD, suppression, permissions DEV-only.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const IntegratedApi = (await import('../../models/IntegratedApi.js')).default;

let agent;
const DEV_IP = '203.0.113.10';
const ADMIN_IP = '203.0.113.11';
async function login(email, ip) {
  const r = await agent.post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: TEST_PASSWORD });
  return r.headers['set-cookie'];
}
function mockFetchOnce(impl) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

describe('IntegratedAPI management (dev)', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await seedTestData(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('DEV liste les intégrations, JAMAIS de secret', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const res = await agent.get('/api/gestion/dev/integrated-api').set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    expect(res.status).toBe(200);
    const slugs = res.body.integrations.map(i => i.slug).sort();
    expect(slugs).toEqual(['brevo', 'stripe-dev', 'stripe-institut']);
    const raw = JSON.stringify(res.body);
    // Aucun secret : jamais `encryptedValue` (les `expectedPrefix` type "sk_test_" sont des
    // indices d'UI catalogués, pas des secrets — vérif de valeur réelle dans le test configure).
    expect(raw).not.toContain('encryptedValue');
    // Stripe = dual_environment → 2 runtimes ; Brevo = single → 1 runtime.
    const stripe = res.body.integrations.find(i => i.slug === 'stripe-institut');
    expect(stripe.runtimes.map(r => r.runtime).sort()).toEqual(['prod', 'test']);
    const brevo = res.body.integrations.find(i => i.slug === 'brevo');
    expect(brevo.runtimes.map(r => r.runtime)).toEqual([null]);
  });

  it('ADMIN (non dev) est refusé (403)', async () => {
    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.get('/api/gestion/dev/integrated-api').set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(res.status).toBe(403);
  });

  it('configure secret_key (test) — préfixe valide, valeur masquée, pas de secret renvoyé', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const res = await agent.put('/api/gestion/dev/integrated-api/stripe-institut/credentials')
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP)
      .send({ runtime: 'test', credentials: { secret_key: 'sk_test_ABCD1234efgh' } });
    expect(res.status).toBe(200);
    const testRt = res.body.integration.runtimes.find(r => r.runtime === 'test');
    const cred = testRt.credentials.find(c => c.role === 'secret_key');
    expect(cred.configured).toBe(true);
    expect(cred.maskedValue).toMatch(/efgh$/);
    expect(JSON.stringify(res.body)).not.toContain('sk_test_ABCD1234efgh');
    // Persisté chiffré.
    const doc = await IntegratedApi.findOne({ slug: 'stripe-institut' });
    const stored = doc.credentials.find(c => c.role === 'secret_key' && c.runtime === 'test');
    expect(stored.encryptedValue).toBeTruthy();
    expect(stored.encryptedValue).not.toContain('sk_test_ABCD1234efgh');
  });

  it('rejette un préfixe de mode incohérent (sk_live_ en test)', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const res = await agent.put('/api/gestion/dev/integrated-api/stripe-institut/credentials')
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP)
      .send({ runtime: 'test', credentials: { secret_key: 'sk_live_SHOULDFAIL' } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CREDENTIAL_PREFIX');
  });

  it('test de connexion Stripe (succès mocké) → verified=true + empreinte, puis changement de clé invalide verified', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    await agent.put('/api/gestion/dev/integrated-api/stripe-institut/credentials')
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP)
      .send({ runtime: 'test', credentials: { secret_key: 'sk_test_valid_key_1', webhook_secret: 'whsec_abc', publishable_key: 'pk_test_x' } });

    mockFetchOnce(async () => ({ ok: true, status: 200, json: async () => ({ id: 'acct_1', country: 'FR', default_currency: 'eur', charges_enabled: true }) }));
    const test = await agent.post('/api/gestion/dev/integrated-api/stripe-institut/test')
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({ runtime: 'test' });
    expect(test.status).toBe(200);
    expect(test.body.result.status).toBe('success');
    let testRt = test.body.integration.runtimes.find(r => r.runtime === 'test');
    expect(testRt.verified).toBe(true);
    expect(JSON.stringify(test.body)).not.toContain('sk_test_valid_key_1');

    // Changement de clé → verified doit devenir faux (empreinte différente).
    const changed = await agent.put('/api/gestion/dev/integrated-api/stripe-institut/credentials')
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP)
      .send({ runtime: 'test', credentials: { secret_key: 'sk_test_valid_key_2' } });
    testRt = changed.body.integration.runtimes.find(r => r.runtime === 'test');
    expect(testRt.verified).toBe(false);
  });

  it('test de connexion Brevo (401 mocké) → verified=false + message clair', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    await agent.put('/api/gestion/dev/integrated-api/brevo/credentials')
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP)
      .send({ runtime: null, credentials: { api_key: 'xkeysib-badkey' } });
    mockFetchOnce(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    const test = await agent.post('/api/gestion/dev/integrated-api/brevo/test')
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({ runtime: null });
    expect(test.status).toBe(200);
    expect(test.body.result.status).toBe('failed');
    expect(test.body.result.message).toMatch(/401/);
    const brevoRt = test.body.integration.runtimes.find(r => r.runtime === null);
    expect(brevoRt.verified).toBe(false);
  });

  it('activation PROD refusée si non vérifiée, puis autorisée avec test + confirmation', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    // Configure prod
    await agent.put('/api/gestion/dev/integrated-api/stripe-institut/credentials')
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP)
      .send({ runtime: 'prod', credentials: { secret_key: 'sk_live_prodkey', webhook_secret: 'whsec_prod' } });
    // Sans test → refus.
    let mode = await agent.post('/api/gestion/dev/integrated-api/stripe-institut/mode')
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({ mode: 'prod', confirmation: 'ACTIVER STRIPE INSTITUT PROD' });
    expect(mode.status).toBe(400);
    expect(mode.body.code).toBe('MODE_NOT_VERIFIED');
    // Test prod OK.
    mockFetchOnce(async () => ({ ok: true, status: 200, json: async () => ({ id: 'acct_live', country: 'FR' }) }));
    await agent.post('/api/gestion/dev/integrated-api/stripe-institut/test')
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({ runtime: 'prod' });
    // Mauvaise phrase → refus.
    mode = await agent.post('/api/gestion/dev/integrated-api/stripe-institut/mode')
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({ mode: 'prod', confirmation: 'WRONG' });
    expect(mode.body.code).toBe('CONFIRMATION_REQUIRED');
    // Phrase exacte → OK.
    mode = await agent.post('/api/gestion/dev/integrated-api/stripe-institut/mode')
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({ mode: 'prod', confirmation: 'ACTIVER STRIPE INSTITUT PROD' });
    expect(mode.status).toBe(200);
    expect(mode.body.integration.mode).toBe('prod');
  });

  it('supprime les credentials d\'un runtime', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    await agent.put('/api/gestion/dev/integrated-api/stripe-institut/credentials')
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP)
      .send({ runtime: 'test', credentials: { secret_key: 'sk_test_todelete' } });
    const del = await agent.delete('/api/gestion/dev/integrated-api/stripe-institut/credentials?runtime=test')
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    expect(del.status).toBe(200);
    const testRt = del.body.integration.runtimes.find(r => r.runtime === 'test');
    expect(testRt.configured).toBe(false);
    expect(testRt.credentials.every(c => !c.configured)).toBe(true);
  });
});
