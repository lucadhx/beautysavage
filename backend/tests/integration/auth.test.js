// tests/integration/auth.test.js
// Integration tests for the client auth flow: signup -> verify-email -> login.
// The mail service is mocked so we can (a) avoid real Brevo network calls and
// (b) capture the verification code that would have been emailed.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Capture the verification code passed to the (mocked) mail sender.
const mail = vi.hoisted(() => ({ lastCode: null }));

vi.mock('../../services/mailService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    sendEmailConfirmationCodeEmail: async ({ code }) => {
      mail.lastCode = code;
      return true;
    }
  };
});

// Avoid the fire-and-forget admin notification (which would touch the mail layer).
vi.mock('../../services/notificationService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, triggerNotification: async () => {} };
});

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const User = (await import('../../models/user.js')).default;

describe('auth — signup / verify-email / login', () => {
  let agent;

  beforeAll(async () => {
    agent = await getAgent();
  });

  afterAll(async () => {
    await stopMemoryDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    mail.lastCode = null;
  });

  it('signup creates an unverified client and issues a 6-digit code', async () => {
    const res = await agent
      .post('/auth/signup')
      .send({ email: 'new@test.local', password: 'Test1234', passwordConfirm: 'Test1234' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const user = await User.findOne({ email: 'new@test.local' }).lean();
    expect(user).toBeTruthy();
    expect(user.emailVerified).toBe(false);
    expect(mail.lastCode).toMatch(/^\d{6}$/);
  });

  it('login is refused while the email is not verified', async () => {
    await agent
      .post('/auth/signup')
      .send({ email: 'pending@test.local', password: 'Test1234', passwordConfirm: 'Test1234' });

    const res = await agent
      .post('/auth/login')
      .send({ email: 'pending@test.local', password: 'Test1234' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('verify-email with the issued code activates the account and opens a session', async () => {
    await agent
      .post('/auth/signup')
      .send({ email: 'verify@test.local', password: 'Test1234', passwordConfirm: 'Test1234' });

    const res = await agent
      .post('/auth/verify-email')
      .send({ email: 'verify@test.local', code: mail.lastCode });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.headers['set-cookie']).toBeDefined();

    const user = await User.findOne({ email: 'verify@test.local' }).lean();
    expect(user.emailVerified).toBe(true);
  });

  it('a seeded verified client can login and reach /auth/me with the session cookie', async () => {
    await seedTestData();

    const login = await agent
      .post('/auth/login')
      .send({ email: 'client1@test.local', password: TEST_PASSWORD });

    expect(login.status).toBe(200);
    expect(login.body.ok).toBe(true);
    const cookie = login.headers['set-cookie'];
    expect(cookie).toBeDefined();

    const me = await agent.get('/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('client1@test.local');
  });
});
