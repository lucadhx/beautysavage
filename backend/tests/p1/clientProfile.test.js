// tests/p1/clientProfile.test.js
// RX4 S2 — GET /api/client/profile : lecture seule du profil client (prénom/nom/e-mail).
// Seul endpoint backend ajouté en RX4 S2. Vérifie : auth requise, forme minimale, cohérence avec PUT.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../../services/notificationService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, triggerNotification: async () => {} };
});

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');

describe('RX4 S2 — GET /api/client/profile', () => {
  let agent;
  let cookie;

  beforeAll(async () => {
    agent = await getAgent();
  });

  afterAll(async () => {
    await stopMemoryDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    await seedTestData();
    const login = await agent
      .post('/auth/login')
      .send({ email: 'client1@test.local', password: TEST_PASSWORD });
    cookie = login.headers['set-cookie'];
    expect(cookie).toBeDefined();
  });

  it('refuse un accès non authentifié (401)', async () => {
    const res = await agent.get('/api/client/profile');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('renvoie prénom/nom/e-mail pour le client connecté', async () => {
    const res = await agent.get('/api/client/profile').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe('client1@test.local');
    expect(typeof res.body.user.firstName).toBe('string');
    expect(typeof res.body.user.lastName).toBe('string');
    // Lecture seule : aucune donnée sensible exposée.
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user.role).toBeUndefined();
  });

  it('reflète une mise à jour effectuée via PUT /api/client/profile', async () => {
    await agent.put('/api/client/profile').set('Cookie', cookie).send({ firstName: 'Julie', lastName: 'Martin' });
    const res = await agent.get('/api/client/profile').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.user.firstName).toBe('Julie');
    expect(res.body.user.lastName).toBe('Martin');
  });
});
