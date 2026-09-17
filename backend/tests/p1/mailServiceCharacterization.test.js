// tests/p1/mailServiceCharacterization.test.js
// Sprint F3B — Caractérisation de mailService AVANT split. Fige : rendu/dispatch d'un email
// transactionnel (template → payload Brevo), contrat postToBrevo (endpoint + header api-key +
// SendLog queued/sent/failed), fallback template par défaut, et l'ABSENCE de secret/email brut
// dans le SendLog. Le rendu de template publié/draft est couvert par emailTemplateRuntimePublished ;
// SendLog/postToBrevo en détail par sendLog.test. Ce test verrouille le bout-en-bout (dispatcher).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../services/integratedApiCredentialService.js', () => ({
  getCredential: vi.fn(async () => 'xkeysib-FAKE-CHAR-KEY')
}));

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const SendLog = (await import('../../models/SendLog.js')).default;
const EmailTemplate = (await import('../../models/EmailTemplate.js')).default;
const { postToBrevo, loadTemplate, sendPasswordResetEmail } = await import('../../services/mailService.js');
const { seedDevCommunicationIdentity } = await import('../../seeders/seedDevCommunicationIdentity.js');

const PAYLOAD = { to: [{ email: 'client@example.com', name: 'Client' }], subject: 'Bonjour', htmlContent: '<p>hi</p>', tags: ['transactional', 'vente'] };

describe('F3B — caractérisation mailService (bout-en-bout)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('postToBrevo POSTe sur l\'endpoint Brevo avec le header api-key et marque le SendLog "sent"', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ messageId: '<ok-1>' }) });
    const ok = await postToBrevo(PAYLOAD);
    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(opts.method).toBe('POST');
    expect(opts.headers['api-key']).toBe('xkeysib-FAKE-CHAR-KEY');
    const log = await SendLog.findOne({ providerMessageId: '<ok-1>' }).lean();
    expect(log.status).toBe('sent');
    // jamais d'email brut ni de clé api dans le SendLog
    const raw = JSON.stringify(log);
    expect(raw).not.toContain('client@example.com');
    expect(raw).not.toContain('xkeysib-');
  });

  it('postToBrevo sans api-key → SendLog "failed", retourne false', async () => {
    const { getCredential } = await import('../../services/integratedApiCredentialService.js');
    getCredential.mockResolvedValueOnce(''); // pas de clé
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const ok = await postToBrevo(PAYLOAD);
    expect(ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    const log = await SendLog.findOne({ status: 'failed' }).lean();
    // LOT1 — code d'erreur typé explicite (ex-'provider_not_configured').
    expect(log?.errorCode).toBe('API_KEY_MISSING');
  });

  it('loadTemplate génère le défaut quand aucun doc (fallback)', async () => {
    const tpl = await loadTemplate('vente');
    expect(tpl).toBeTruthy();
    expect(tpl.functionName).toBe('vente');
    expect(String(tpl.subject || '').length).toBeGreaterThan(0);
  });

  it('sendPasswordResetEmail rend le template et POSTe vers Brevo (subject non vide, aucune clé exposée)', async () => {
    // LOT1 — l'expéditeur vient d'une identité configurée (plus de fallback MAIL_FROM) : on la seed.
    await seedDevCommunicationIdentity({ force: true });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ messageId: '<pwd-1>' }) });
    await sendPasswordResetEmail({ email: 'user@example.com', firstName: 'Jean' }, 'reset-token-123');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, opts] = fetchSpy.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(Array.isArray(body.to)).toBe(true);
    expect(body.to[0].email).toBe('user@example.com');
    expect(String(body.subject || '').length).toBeGreaterThan(0);
    // la clé api ne fuit jamais dans le corps du message
    expect(JSON.stringify(body)).not.toContain('xkeysib-');
  });
});
