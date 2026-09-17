import { clearSessionCookie } from '../utils/session.js';
import {
  ADMIN_SUSPENDED_MESSAGE,
  isSiteSuspended
} from '../services/siteStatusService.js';

export const SITE_SUSPENDED_ERROR_CODE = 'SITE_SUSPENDED';
export const SUSPENDED_ADMIN_LOGOUT_CODE = 'SUSPENDED_ADMIN_LOGOUT';

export function buildPurchaseSuspendedPayload() {
  return {
    ok: false,
    error: SITE_SUSPENDED_ERROR_CODE,
    code: SITE_SUSPENDED_ERROR_CODE,
    message: 'Achats temporairement indisponibles'
  };
}

export function buildAdminSuspendedPayload() {
  return {
    ok: false,
    error: SUSPENDED_ADMIN_LOGOUT_CODE,
    code: SUSPENDED_ADMIN_LOGOUT_CODE,
    message: ADMIN_SUSPENDED_MESSAGE
  };
}

export async function isAdminBlockedBySuspension(user) {
  const role = String(user?.role || '').trim().toLowerCase();
  if (role !== 'admin') return false;
  return isSiteSuspended();
}

export function respondSuspendedAdmin(res) {
  clearSessionCookie(res);
  return res.status(403).json(buildAdminSuspendedPayload());
}

export function requireSiteActiveForPurchases() {
  return async (_req, res, next) => {
    try {
      const suspended = await isSiteSuspended();
      if (suspended) {
        return res.status(503).json(buildPurchaseSuspendedPayload());
      }
      return next();
    } catch (error) {
      console.error('Erreur guard achats site status', error);
      return res.status(500).json({
        ok: false,
        error: 'Erreur serveur.'
      });
    }
  };
}
