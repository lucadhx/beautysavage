// tests/p1/signupVerificationCoherence.test.js
// LOT2 — Cohérence d'inscription :
//  - envoi OK   → 200 ok:true, compte pending, notification institut « new_client » DÉCLENCHÉE.
//  - envoi KO   → 202 ACCOUNT_PENDING_VERIFICATION, compte pending, notification NON déclenchée,
//                 pas de 500 générique, réponse resumable (canResend). Reprise = 409 pending.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Envoi du code contrôlable via un flag mutable (isole la logique du routeur du transport réel).
const mailState = { sendResult: true };
vi.mock('../../services/mailService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, sendEmailConfirmationCodeEmail: async () => mailState.sendResult };
});

// Espion sur la notification institut : on vérifie QUAND elle est déclenchée (pas la persistance,
// gatée par NotificationConfig — hors scope). L'appel `void triggerNotification(...)` est synchrone.
const notifSpy = vi.fn(async () => {});
vi.mock('../../services/notificationService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, triggerNotification: notifSpy };
});

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const User = (await import('../../models/user.js')).default;

let agent;
describe('signup — cohérence envoi/notification (LOT2)', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); mailState.sendResult = true; notifSpy.mockClear(); });

  it('envoi OK → 200, compte pending, notification new_client déclenchée', async () => {
    mailState.sendResult = true;
    const res = await agent.post('/auth/signup')
      .send({ email: 'ok@test.local', password: 'Test1234', passwordConfirm: 'Test1234' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const user = await User.findOne({ email: 'ok@test.local' }).lean();
    expect(user.emailVerified).toBe(false);
    expect(notifSpy).toHaveBeenCalledTimes(1);
    expect(notifSpy).toHaveBeenCalledWith('new_client', expect.objectContaining({ clientEmail: 'ok@test.local' }));
  });

  it('envoi KO → 202 ACCOUNT_PENDING_VERIFICATION, compte pending, notification NON déclenchée', async () => {
    mailState.sendResult = false;
    const res = await agent.post('/auth/signup')
      .send({ email: 'fail@test.local', password: 'Test1234', passwordConfirm: 'Test1234' });
    expect(res.status).toBe(202);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('ACCOUNT_PENDING_VERIFICATION');
    expect(res.body.canResend).toBe(true);
    expect(res.body.emailSent).toBe(false);
    // Compte créé (pending) — permet le renvoi du code, pas de rollback.
    const user = await User.findOne({ email: 'fail@test.local' }).lean();
    expect(user).toBeTruthy();
    expect(user.emailVerified).toBe(false);
    // Pas de fausse notification de succès.
    expect(notifSpy).not.toHaveBeenCalled();
  });

  it('après un envoi KO, une 2e tentative renvoie 409 EMAIL_NOT_VERIFIED_PENDING (reprise)', async () => {
    mailState.sendResult = false;
    await agent.post('/auth/signup').send({ email: 'again@test.local', password: 'Test1234', passwordConfirm: 'Test1234' });
    const res2 = await agent.post('/auth/signup').send({ email: 'again@test.local', password: 'Test1234', passwordConfirm: 'Test1234' });
    expect(res2.status).toBe(409);
    expect(res2.body.code).toBe('EMAIL_NOT_VERIFIED_PENDING');
  });
});
