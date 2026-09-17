// tests/p0/mockPay.exposure.test.js
// P0 (Phase 1A — FIXED): `POST /api/client/mock-pay` creates a real Sale/Purchase
// (and can debit gift cards) WITHOUT real payment. It is now guarded so it is
// UNREACHABLE in production (returns 404), while remaining available in
// development and test for characterization.
//
// These tests verify:
//   - in NODE_ENV=test the route is still reachable (dev/test behaviour);
//   - in NODE_ENV=production the route returns 404 (no creation path, and the
//     endpoint's existence is not revealed via a 403).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../../services/notificationService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, triggerNotification: async () => {} };
});

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');

describe('P0 — mock-pay endpoint exposure (now production-guarded)', () => {
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

  it('is reachable in NODE_ENV=test (dev/test behaviour preserved)', async () => {
    const res = await agent.post('/api/client/mock-pay').set('Cookie', cookie).send({});

    // Not the Express "Cannot POST" 404 (route exists), and not blocked by the
    // production guard (we are in test). With an empty body the handler will fail
    // validation (JSON 400/404) — that's fine; we only assert reachability here.
    expect(res.text || '').not.toMatch(/Cannot POST/i);
    expect(res.status).not.toBe(401);
  });

  it('is BLOCKED with 404 in NODE_ENV=production (no real-payment bypass in prod)', async () => {
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      // The guard runs first, before auth — so no cookie is needed to observe it.
      const res = await agent.post('/api/client/mock-pay').send({ type: 'product', id: 'x' });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    } finally {
      process.env.NODE_ENV = previous; // restore for subsequent tests
    }
  });
});
