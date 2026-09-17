import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../../services/mailService.js', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    sendEmailConfirmationCodeEmail: async () => true,
    sendPasswordResetEmail: async () => true
  };
});

vi.mock('../../services/notificationService.js', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, triggerNotification: async () => {} };
});

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const User = (await import('../../models/user.js')).default;

const IP_DEV = '203.0.113.10';
const IP_ADMIN = '203.0.113.11';
const IP_CLIENT = '203.0.113.12';
const IP_GESTION = '203.0.113.13';

async function login(email, ip) {
  return agent.post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: TEST_PASSWORD });
}

let agent;

describe('P1 - roles hardening', () => {
  beforeAll(async () => {
    agent = await getAgent();
  });

  afterAll(async () => {
    await stopMemoryDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    await seedTestData();
  });

  it('dev can access a strict-dev route', async () => {
    const loginRes = await login('dev@test.local', IP_DEV);
    expect(loginRes.status).toBe(200);

    const res = await agent
      .post('/api/dev/create-user')
      .set('Cookie', loginRes.headers['set-cookie'])
      .set('X-Forwarded-For', IP_DEV)
      .send({
        email: 'dev-only-created@test.local',
        password: TEST_PASSWORD,
        role: 'client'
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });

  it('admin is refused on a strict-dev route', async () => {
    const loginRes = await login('admin@test.local', IP_ADMIN);
    expect(loginRes.status).toBe(200);

    const res = await agent
      .post('/api/dev/create-user')
      .set('Cookie', loginRes.headers['set-cookie'])
      .set('X-Forwarded-For', IP_ADMIN)
      .send({
        email: 'admin-blocked@test.local',
        password: TEST_PASSWORD,
        role: 'client'
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Acces refuse.');
  });

  it('client is refused on a strict-dev route', async () => {
    const loginRes = await login('client1@test.local', IP_CLIENT);
    expect(loginRes.status).toBe(200);

    const res = await agent
      .post('/api/dev/create-user')
      .set('Cookie', loginRes.headers['set-cookie'])
      .set('X-Forwarded-For', IP_CLIENT)
      .send({
        email: 'client-blocked@test.local',
        password: TEST_PASSWORD,
        role: 'client'
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Acces refuse.');
  });

  it('admin can manage clients but cannot assign role dev', async () => {
    const loginRes = await login('admin@test.local', IP_GESTION);
    expect(loginRes.status).toBe(200);

    const createClient = await agent
      .post('/api/gestion/users')
      .set('Cookie', loginRes.headers['set-cookie'])
      .set('X-Forwarded-For', IP_GESTION)
      .send({
        email: 'managed-client@test.local',
        password: TEST_PASSWORD,
        role: 'client'
      });

    expect(createClient.status).toBe(201);
    expect(createClient.body.ok).toBe(true);

    const createDev = await agent
      .post('/api/gestion/users')
      .set('Cookie', loginRes.headers['set-cookie'])
      .set('X-Forwarded-For', IP_GESTION)
      .send({
        email: 'managed-dev-denied@test.local',
        password: TEST_PASSWORD,
        role: 'dev'
      });

    expect(createDev.status).toBe(403);
    expect(createDev.body.error).toMatch(/compte dev/i);

    const client = await User.findOne({ email: 'client2@test.local' }).lean();
    const updateDev = await agent
      .put(`/api/gestion/users/${client._id}`)
      .set('Cookie', loginRes.headers['set-cookie'])
      .set('X-Forwarded-For', IP_GESTION)
      .send({ role: 'dev' });

    expect(updateDev.status).toBe(403);
    expect(updateDev.body.error).toMatch(/compte dev/i);

    const unchanged = await User.findById(client._id).lean();
    expect(unchanged.role).toBe('client');
  });

  it('dev can create dev users through gestion user management', async () => {
    const loginRes = await login('dev@test.local', IP_GESTION);
    expect(loginRes.status).toBe(200);

    const res = await agent
      .post('/api/gestion/users')
      .set('Cookie', loginRes.headers['set-cookie'])
      .set('X-Forwarded-For', IP_GESTION)
      .send({
        email: 'managed-dev@test.local',
        password: TEST_PASSWORD,
        role: 'dev'
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);

    const created = await User.findOne({ email: 'managed-dev@test.local' }).lean();
    expect(created.role).toBe('dev');
  });
});
