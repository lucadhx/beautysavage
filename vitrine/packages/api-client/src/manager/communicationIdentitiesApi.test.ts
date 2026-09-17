import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  listCommunicationIdentities,
  createCommercialeIdentity,
  createSupportIdentity,
  requestIdentityVerification,
  confirmIdentityVerification,
  setActiveCommunicationIdentity,
  refreshCommunicationIdentity,
} from './communicationIdentities';

let lastUrl = '';
let lastInit: RequestInit | undefined;
function mockFetch(payload: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      lastUrl = String(url);
      lastInit = init;
      return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

const IDENTITY = { id: 'i1', role: 'commerciale', scope: 'institute', email: 'com@beauty.fr', displayName: 'C', status: 'unverified', active: false, dnsRecords: [] };

describe('communicationIdentities api-client (M4)', () => {
  it('list admin → endpoint commerciale ; dev → endpoint support', async () => {
    mockFetch({ ok: true, identities: [IDENTITY] });
    const admin = await listCommunicationIdentities('admin');
    expect(lastUrl).toContain('/api/gestion/communication-identities');
    expect(lastUrl).not.toContain('/dev/');
    expect(admin).toHaveLength(1);

    await listCommunicationIdentities('dev');
    expect(lastUrl).toContain('/api/gestion/dev/communication-identities');
  });

  it('createCommercialeIdentity POST /commerciale', async () => {
    mockFetch({ ok: true, identity: IDENTITY });
    await createCommercialeIdentity({ email: 'com@beauty.fr', displayName: 'C' });
    expect(lastUrl).toContain('/api/gestion/communication-identities/commerciale');
    expect(lastInit?.method).toBe('POST');
    expect(String(lastInit?.body)).toContain('com@beauty.fr');
  });

  it('createSupportIdentity POST /dev/.../support', async () => {
    mockFetch({ ok: true, identity: { ...IDENTITY, role: 'support' } });
    await createSupportIdentity({ email: 'sup@beauty.fr', displayName: 'S' });
    expect(lastUrl).toContain('/api/gestion/dev/communication-identities/support');
  });

  it('request/confirm/setActive/refresh ciblent le bon base selon le scope', async () => {
    mockFetch({ ok: true, identity: IDENTITY });
    await requestIdentityVerification('i1', 'admin');
    expect(lastUrl).toContain('/api/gestion/communication-identities/i1/request-verification');

    await confirmIdentityVerification('i1', '123456', 'dev');
    expect(lastUrl).toContain('/api/gestion/dev/communication-identities/i1/confirm-verification');
    expect(String(lastInit?.body)).toContain('123456');

    await setActiveCommunicationIdentity('i1', 'admin');
    expect(lastUrl).toContain('/i1/set-active');

    await refreshCommunicationIdentity('i1', 'dev');
    expect(lastUrl).toContain('/api/gestion/dev/communication-identities/i1/refresh');
  });

  it('liste vide robuste', async () => {
    mockFetch({ ok: true });
    expect(await listCommunicationIdentities('admin')).toEqual([]);
  });
});
