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
const { createResetPasswordToken } = await import('../../services/passwordResetService.js');

const LOGIN_OK_IP = '203.0.113.20';
const LOGIN_RATE_IP = '203.0.113.21';
const RESET_REQUEST_IP = '203.0.113.22';
const RESET_VALIDATE_IP = '203.0.113.23';
const RESET_COMPLETE_IP = '203.0.113.24';
const RESET_PASSWORD = 'Reset1234';

let agent;

async function postWithIp(path, body, ip) {
  return agent.post(path).set('X-Forwarded-For', ip).send(body);
}

describe('P1 - auth rate limits', () => {
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

  it('a normal login still works', async () => {
    const res = await postWithIp('/auth/login', { email: 'client1@test.local', password: TEST_PASSWORD }, LOGIN_OK_IP);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('login is rate-limited after repeated failures', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await postWithIp(
        '/auth/login',
        { email: 'client1@test.local', password: 'WrongPass123' },
        LOGIN_RATE_IP
      );
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Identifiants invalides.');
    }

    const limited = await postWithIp(
      '/auth/login',
      { email: 'client1@test.local', password: 'WrongPass123' },
      LOGIN_RATE_IP
    );

    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('LOGIN_RATE_LIMIT');
    expect(limited.body.error).toBe('Trop de tentatives de connexion. Reessayez plus tard.');
  });

  it('password reset request is rate-limited after repeated submissions', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await postWithIp(
        '/auth/password-reset/request',
        { email: 'client1@test.local' },
        RESET_REQUEST_IP
      );
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.message).toBe('Si un compte existe avec cet email, un lien a ete envoye.');
    }

    const limited = await postWithIp(
      '/auth/password-reset/request',
      { email: 'client1@test.local' },
      RESET_REQUEST_IP
    );

    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('PASSWORD_RESET_REQUEST_RATE_LIMIT');
    expect(limited.body.error).toBe('Trop de demandes de reinitialisation. Reessayez plus tard.');
  });

  it('password reset validate is rate-limited after repeated checks', async () => {
    const client = await User.findOne({ email: 'client1@test.local' }).lean();
    const { token } = await createResetPasswordToken(client._id);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await postWithIp(
        '/auth/password-reset/validate',
        { token },
        RESET_VALIDATE_IP
      );
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.expiresAt).toBeTruthy();
    }

    const limited = await postWithIp(
      '/auth/password-reset/validate',
      { token },
      RESET_VALIDATE_IP
    );

    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('PASSWORD_RESET_VALIDATE_RATE_LIMIT');
    expect(limited.body.error).toBe('Trop de tentatives de validation. Reessayez plus tard.');
  });

  it('password reset complete is rate-limited after repeated completions', async () => {
    const client = await User.findOne({ email: 'client1@test.local' }).lean();
    const tokens = await Promise.all(
      Array.from({ length: 6 }, () => createResetPasswordToken(client._id))
    );

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await postWithIp(
        '/auth/password-reset/complete',
        { token: tokens[attempt].token, password: RESET_PASSWORD },
        RESET_COMPLETE_IP
      );
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    }

    const limited = await postWithIp(
      '/auth/password-reset/complete',
      { token: tokens[5].token, password: RESET_PASSWORD },
      RESET_COMPLETE_IP
    );

    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('PASSWORD_RESET_COMPLETE_RATE_LIMIT');
    expect(limited.body.error).toBe('Trop de tentatives de reinitialisation. Reessayez plus tard.');
  });
});
