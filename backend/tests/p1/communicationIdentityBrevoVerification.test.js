// tests/p1/communicationIdentityBrevoVerification.test.js
// M1 — Vérification sender via Brevo (adapter réel, getCredential + fetch mockés). Aucun vrai e-mail.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../services/integratedApiCredentialService.js', () => ({
  getCredential: vi.fn(async () => 'xkeysib-FAKE-M1-KEY')
}));

const mongoose = (await import('mongoose')).default;
const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const CommunicationIdentity = (await import('../../models/CommunicationIdentity.js')).default;
const {
  createCommunicationIdentity,
  requestSenderVerification,
  confirmSenderVerification,
  refreshIdentityVerificationStatus
} = await import('../../services/communicationIdentityService.js');

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('CommunicationIdentity — vérification Brevo (mock)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await CommunicationIdentity.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await CommunicationIdentity.syncIndexes(); });
  afterEach(() => vi.restoreAllMocks());

  it('request → confirm → refresh : statut verified + domainAuthenticated stocké', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts = {}) => {
      const u = String(url);
      const method = opts.method || 'GET';
      if (u.endsWith('/v3/senders') && method === 'POST') return jsonResponse({ id: 12345 });
      if (/\/v3\/senders\/12345\/validate$/.test(u) && method === 'PUT') return jsonResponse({});
      if (u.endsWith('/v3/senders') && method === 'GET') return jsonResponse({ senders: [{ id: 12345, email: 'sup@beauty.fr', active: true }] });
      if (/\/v3\/senders\/domains\/beauty\.fr$/.test(u)) return jsonResponse({ authenticated: true, status: 'authenticated', dns_records: [{ type: 'TXT', host: 'mail._domainkey', value: 'k=rsa;...' }] });
      return jsonResponse({}, 404);
    });

    const created = await createCommunicationIdentity({ role: 'support', email: 'sup@beauty.fr', displayName: 'Support' });

    const pending = await requestSenderVerification(created._id, 'dev');
    expect(pending.status).toBe('verification_pending');
    expect(pending.providerSenderId).toBe('12345');

    const confirmed = await confirmSenderVerification(created._id, '999999', 'dev');
    expect(confirmed.status).toBe('verified');
    expect(confirmed.providerVerifiedAt).toBeTruthy();

    const refreshed = await refreshIdentityVerificationStatus(created._id);
    expect(refreshed.domainAuthenticated).toBe(true);
    expect(refreshed.domainStatus).toBe('authenticated');
    expect(refreshed.dnsRecords.length).toBe(1);

    // La clé API n'apparaît jamais dans le document.
    expect(JSON.stringify(refreshed.toObject())).not.toContain('xkeysib-');
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('échec provider → lastErrorMessageSafe stocké, pas de secret', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'bad' }, 400));
    const created = await createCommunicationIdentity({ role: 'commerciale', email: 'c@beauty.fr', displayName: 'Com' });
    await expect(requestSenderVerification(created._id, 'admin')).rejects.toBeTruthy();
    const reloaded = await CommunicationIdentity.findById(created._id);
    expect(reloaded.verification.lastErrorMessageSafe).toBeTruthy();
    expect(reloaded.verification.lastErrorMessageSafe).not.toContain('xkeysib-');
  });
});
