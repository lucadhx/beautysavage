// tests/integration/health.test.js
// Verifies the harness itself: the real app boots in NODE_ENV=test against an
// in-memory MongoDB, does NOT connect to a real cluster, and does NOT keep a
// real HTTP listener open (supertest binds an ephemeral port per request).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { getAgent } from '../setup/testApp.js';
import { stopMemoryDb } from '../setup/testDb.js';

describe('health — test harness boots safely', () => {
  let agent;

  beforeAll(async () => {
    agent = await getAgent();
  });

  afterAll(async () => {
    await stopMemoryDb();
  });

  it('is connected to an in-memory mongo, not a real cluster', () => {
    expect(mongoose.connection.readyState).toBe(1); // 1 = connected
    expect(['127.0.0.1', 'localhost']).toContain(mongoose.connection.host);
  });

  it('responds on the public Stripe config endpoint without leaking secret keys', async () => {
    const res = await agent.get('/api/stripe/config');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('publishableKey');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/sk_(test|live)_/); // never expose a secret key
  });
});
