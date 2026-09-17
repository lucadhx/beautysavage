// RX-BLOCKER-2 — Comptes manager (admin/dev) par invitation. Dev-only côté backend. Aucun mot de passe :
// l'utilisateur le choisit via l'invitation. Le serveur fait foi.
import { apiGet, apiPost } from '../apiFetch';
import type { Role } from '../types';

export type ManagerUserStatus = 'invited' | 'active' | 'disabled';

export interface ManagerUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Extract<Role, 'admin' | 'dev'>;
  status: ManagerUserStatus;
  inviteSentAt: string | null;
  activatedAt: string | null;
  lastLogin: string | null;
  createdAt: string | null;
}

const BASE = '/api/gestion/manager-users';

export async function listManagerUsers(signal?: AbortSignal): Promise<ManagerUser[]> {
  const res = await apiGet<{ ok: boolean; users: ManagerUser[] }>(BASE, undefined);
  void signal;
  return res.users ?? [];
}

export async function createManagerUser(input: { firstName?: string; lastName?: string; email: string; role: 'admin' | 'dev' }): Promise<ManagerUser> {
  const res = await apiPost<{ ok: boolean; user: ManagerUser }>(BASE, input);
  return res.user;
}

export async function resendManagerInvitation(id: string): Promise<ManagerUser> {
  const res = await apiPost<{ ok: boolean; user: ManagerUser }>(`${BASE}/${encodeURIComponent(id)}/send-invitation`);
  return res.user;
}

export async function disableManagerUser(id: string): Promise<ManagerUser> {
  const res = await apiPost<{ ok: boolean; user: ManagerUser }>(`${BASE}/${encodeURIComponent(id)}/disable`);
  return res.user;
}

export async function enableManagerUser(id: string): Promise<ManagerUser> {
  const res = await apiPost<{ ok: boolean; user: ManagerUser }>(`${BASE}/${encodeURIComponent(id)}/enable`);
  return res.user;
}
