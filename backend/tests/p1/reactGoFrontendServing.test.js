// tests/p1/reactGoFrontendServing.test.js
// RX-GO — Complète rx1ReactFrontend.test.js : garde-fous de bascule non couverts (auth/uploads non
// shadowés par le SPA React, deep-links /app + /manager servis en SPA, no-store sur l'index). Le flag est
// lu dynamiquement → togglé par test. Rollback = flag OFF.
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');

let agent;
const ORIGINAL_FLAG = process.env.REACT_OFFICIAL_FRONTEND;

describe('RX-GO — garde-fous de serving React', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await seedTestData(); process.env.REACT_OFFICIAL_FRONTEND = 'true'; });
  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.REACT_OFFICIAL_FRONTEND;
    else process.env.REACT_OFFICIAL_FRONTEND = ORIGINAL_FLAG;
  });

  it('/auth n’est PAS shadowé par le SPA React (flag ON)', async () => {
    const res = await agent.get('/auth/me').redirects(0);
    // Réponse auth normale (401 anonyme), jamais une 302 vers /app.
    expect(res.status).toBeLessThan(500);
    expect(res.headers.location).not.toBe('/app/');
  });

  it('/uploads n’est PAS shadowé par le SPA React (flag ON)', async () => {
    const res = await agent.get('/uploads/does-not-exist.png').redirects(0);
    // Static uploads → 404 fichier absent, jamais une 302 vers /app ni l’index React.
    expect(res.status).not.toBe(302);
    expect(res.headers.location).not.toBe('/app/');
  });

  it('deep-links vitrine servis en SPA (200 build présent / 503 build absent, jamais 404)', async () => {
    for (const p of ['/app/mon-compte/rendez-vous', '/app/decision', '/app/refund-tracking/tok', '/app/paiement/succes',
      '/app/inscription', '/app/verify-email', '/app/reinitialiser-mot-de-passe', '/app/invoice/tok']) {
      const res = await agent.get(p).redirects(0);
      expect([200, 503]).toContain(res.status);
    }
  });

  it('deep-links manager servis en SPA', async () => {
    for (const p of ['/manager/clients', '/manager/finance', '/manager/dev/system']) {
      const res = await agent.get(p).redirects(0);
      expect([200, 503]).toContain(res.status);
    }
  });

  it('l’index SPA est servi en no-store (si build présent)', async () => {
    const res = await agent.get('/app/prestations').redirects(0);
    if (res.status === 200) {
      expect(String(res.headers['cache-control'] || '')).toContain('no-store');
    }
  });
});
