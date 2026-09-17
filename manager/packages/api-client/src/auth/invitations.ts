// RX-BLOCKER-2 — Acceptation d'invitation manager (public, token opaque, sans auth).
import { apiGet, apiPost } from '../apiFetch';

export interface ManagerInvitationInfo {
  email: string;
  firstName: string;
  role: 'admin' | 'dev';
}

/** GET /auth/manager-invitations/:token — infos sûres (lève ApiError si invalide/expiré/utilisé). */
export async function getManagerInvitation(token: string): Promise<ManagerInvitationInfo> {
  const res = await apiGet<{ ok: boolean } & ManagerInvitationInfo>(`/auth/manager-invitations/${encodeURIComponent(token)}`);
  return { email: res.email, firstName: res.firstName ?? '', role: res.role };
}

/** POST /auth/manager-invitations/:token/accept — définit le mot de passe et active le compte. */
export async function acceptManagerInvitation(token: string, password: string, confirmPassword: string): Promise<void> {
  await apiPost(`/auth/manager-invitations/${encodeURIComponent(token)}/accept`, { password, confirmPassword });
}
