// M4 — Client API identités de communication (M1). admin → commerciale, dev → support.
// Aucun secret/OTP n'est stocké : l'OTP est saisi puis transmis, jamais conservé.
import { apiGet, apiPost } from '../apiFetch';

export type CommunicationIdentityRole = 'support' | 'commerciale' | 'client';
export type CommunicationIdentityScope = 'platform' | 'institute';
export type CommunicationIdentityStatus = 'unverified' | 'verification_pending' | 'verified' | 'disabled';
/** Vue : 'admin' → endpoints commerciale ; 'dev' → endpoints support. */
export type CommunicationScopeView = 'admin' | 'dev';

export interface DnsRecord {
  type: string;
  host: string;
  value: string;
  status: string;
}

export interface CommunicationIdentitySummary {
  id: string;
  role: CommunicationIdentityRole;
  scope: CommunicationIdentityScope;
  email: string;
  displayName: string;
  status: CommunicationIdentityStatus;
  active: boolean;
  provider: string;
  providerSenderId: string;
  providerVerificationStatus: string;
  domain: string;
  domainAuthenticated: boolean;
  domainStatus: string;
  dnsRecords: DnsRecord[];
  verification: {
    requestedAt: string | null;
    verifiedAt: string | null;
    lastErrorCode: string;
    lastErrorMessageSafe: string;
  };
  createdAt: string | null;
  updatedAt: string | null;
}

const ADMIN_BASE = '/api/gestion/communication-identities';
const DEV_BASE = '/api/gestion/dev/communication-identities';

function baseFor(scope: CommunicationScopeView): string {
  return scope === 'dev' ? DEV_BASE : ADMIN_BASE;
}

export async function listCommunicationIdentities(
  scope: CommunicationScopeView,
): Promise<CommunicationIdentitySummary[]> {
  const res = await apiGet<{ ok: boolean; identities: CommunicationIdentitySummary[] }>(baseFor(scope));
  return res.identities ?? [];
}

export async function createCommercialeIdentity(input: {
  email: string;
  displayName: string;
}): Promise<CommunicationIdentitySummary> {
  const res = await apiPost<{ ok: boolean; identity: CommunicationIdentitySummary }>(
    `${ADMIN_BASE}/commerciale`,
    input,
  );
  return res.identity;
}

export async function createSupportIdentity(input: {
  email: string;
  displayName: string;
}): Promise<CommunicationIdentitySummary> {
  const res = await apiPost<{ ok: boolean; identity: CommunicationIdentitySummary }>(
    `${DEV_BASE}/support`,
    input,
  );
  return res.identity;
}

export async function requestIdentityVerification(
  id: string,
  scope: CommunicationScopeView,
): Promise<CommunicationIdentitySummary> {
  const res = await apiPost<{ ok: boolean; identity: CommunicationIdentitySummary }>(
    `${baseFor(scope)}/${encodeURIComponent(id)}/request-verification`,
  );
  return res.identity;
}

export async function confirmIdentityVerification(
  id: string,
  code: string,
  scope: CommunicationScopeView,
): Promise<CommunicationIdentitySummary> {
  const res = await apiPost<{ ok: boolean; identity: CommunicationIdentitySummary }>(
    `${baseFor(scope)}/${encodeURIComponent(id)}/confirm-verification`,
    { code },
  );
  return res.identity;
}

export async function setActiveCommunicationIdentity(
  id: string,
  scope: CommunicationScopeView,
): Promise<CommunicationIdentitySummary> {
  const res = await apiPost<{ ok: boolean; identity: CommunicationIdentitySummary }>(
    `${baseFor(scope)}/${encodeURIComponent(id)}/set-active`,
  );
  return res.identity;
}

export async function refreshCommunicationIdentity(
  id: string,
  scope: CommunicationScopeView,
): Promise<CommunicationIdentitySummary> {
  const res = await apiPost<{ ok: boolean; identity: CommunicationIdentitySummary }>(
    `${baseFor(scope)}/${encodeURIComponent(id)}/refresh`,
  );
  return res.identity;
}
