// tests/p1/rx1ReactFrontend.test.js
// RX1 — React frontend officiel (progressif, rollback). Vérifie : serving SPA /app & /manager sans
// shadow de /api, bascule par flag REACT_OFFICIAL_FRONTEND (entrées Vanilla → React), rollback (flag
// OFF = Vanilla). Le flag est lu dynamiquement → togglable par test.
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');

let agent;
const ORIGINAL_FLAG = process.env.REACT_OFFICIAL_FRONTEND;

describe('RX1 — React frontend officiel', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  // Contrat actif (opération normale) pour que les entrées passent le contractGuard.
  beforeEach(async () => { await clearDatabase(); await seedTestData(); });
  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.REACT_OFFICIAL_FRONTEND;
    else process.env.REACT_OFFICIAL_FRONTEND = ORIGINAL_FLAG;
  });

  it('flag OFF (rollback) : / et /vitrine.html restent Vanilla', async () => {
    delete process.env.REACT_OFFICIAL_FRONTEND;
    const root = await agent.get('/').redirects(0);
    expect(root.status).toBe(302);
    expect(root.headers.location).toBe('/vitrine.html');
    // /vitrine.html sert le fichier Vanilla (200), pas de redirection
    const vitrine = await agent.get('/vitrine.html').redirects(0);
    expect(vitrine.status).toBe(200);
  });

  it('flag ON : les entrées Vanilla redirigent vers React', async () => {
    process.env.REACT_OFFICIAL_FRONTEND = 'true';
    const root = await agent.get('/').redirects(0);
    expect(root.status).toBe(302);
    expect(root.headers.location).toBe('/app/');
    const vitrine = await agent.get('/vitrine.html').redirects(0);
    expect(vitrine.status).toBe(302);
    expect(vitrine.headers.location).toBe('/app/');
    const gestion = await agent.get('/gestion.html').redirects(0);
    expect(gestion.status).toBe(302);
    expect(gestion.headers.location).toBe('/manager/');
  });

  it('le serving React ne shadow PAS /api (quel que soit le flag)', async () => {
    process.env.REACT_OFFICIAL_FRONTEND = 'true';
    const api = await agent.get('/api/site-status').redirects(0);
    // Réponse API normale (jamais une 302 vers /app)
    expect(api.status).toBeLessThan(500);
    expect(api.headers.location).not.toBe('/app/');
  });

  it('/app et /manager sont servis en SPA (200 si build présent, 503 sinon — jamais 404/500)', async () => {
    const app = await agent.get('/app/prestations').redirects(0);
    expect([200, 503]).toContain(app.status);
    if (app.status === 503) expect(app.text).toContain('Build React');
    const manager = await agent.get('/manager/planning').redirects(0);
    expect([200, 503]).toContain(manager.status);
  });
});
