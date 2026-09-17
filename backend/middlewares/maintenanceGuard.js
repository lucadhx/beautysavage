import {
  getStatus,
  isRoleAllowedDuringMaintenance,
  MAINTENANCE_BLOCKED_MESSAGE
} from '../services/siteStatusService.js';
import { clearSessionCookie, loadSessionUser } from '../utils/session.js';

export const MAINTENANCE_ERROR_CODE = 'MAINTENANCE';

function normalizePath(value) {
  return String(value || '/').trim().toLowerCase() || '/';
}

function isStaticAssetPath(pathname) {
  return (
    pathname.startsWith('/css/') ||
    pathname.startsWith('/js/') ||
    pathname.startsWith('/img/') ||
    pathname.startsWith('/images/') ||
    pathname.startsWith('/fonts/') ||
    pathname.startsWith('/uploads/') ||
    pathname === '/favicon.ico'
  );
}

function isMaintenanceExemptRequest(req) {
  const pathname = normalizePath(req?.path);
  const method = String(req?.method || '').toUpperCase();
  if (
    pathname === '/maintenance' ||
    pathname === '/maintenance.html' ||
    pathname === '/login' ||
    pathname === '/login.html'
  ) {
    return true;
  }
  if (
    pathname === '/auth/login' ||
    pathname === '/auth/me' ||
    pathname === '/auth/logout'
  ) {
    return true;
  }
  if (pathname === '/api/site-status' && method === 'GET') {
    return true;
  }
  if (pathname === '/api/vitrine/theme' && method === 'GET') {
    return true;
  }
  return isStaticAssetPath(pathname);
}

function requestWantsHtml(req) {
  const method = String(req?.method || '').toUpperCase();
  if (method !== 'GET') return false;
  const accept = String(req?.headers?.accept || '').toLowerCase();
  return accept.includes('text/html');
}

function requestLooksLikeApi(req) {
  const pathname = normalizePath(req?.path);
  if (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) return true;
  const accept = String(req?.headers?.accept || '').toLowerCase();
  return accept.includes('application/json');
}

function buildMaintenancePayload(status) {
  return {
    ok: false,
    code: MAINTENANCE_ERROR_CODE,
    error: MAINTENANCE_ERROR_CODE,
    message: MAINTENANCE_BLOCKED_MESSAGE,
    status: 'maintenance',
    reason: String(status?.reason || '').trim(),
    eta: String(status?.eta || '').trim(),
    startedAt: status?.maintenanceStartedAt || null,
    updatedAt: status?.updatedAt || null
  };
}

export function maintenanceGuard() {
  return async (req, res, next) => {
    try {
      const siteStatus = await getStatus();
      if (siteStatus?.status !== 'maintenance') {
        return next();
      }

      if (isMaintenanceExemptRequest(req)) {
        return next();
      }

      const sessionUser = await loadSessionUser(req, res);
      if (isRoleAllowedDuringMaintenance(sessionUser?.role)) {
        return next();
      }

      if (sessionUser) {
        clearSessionCookie(res);
      }

      const payload = buildMaintenancePayload(siteStatus);
      res.set('Retry-After', '120');

      if (requestLooksLikeApi(req)) {
        return res.status(503).json(payload);
      }

      if (requestWantsHtml(req)) {
        return res.redirect('/maintenance');
      }

      return res.status(503).json(payload);
    } catch (error) {
      console.error('Erreur maintenanceGuard', error);
      return res.status(500).json({
        ok: false,
        error: 'Erreur serveur.'
      });
    }
  };
}

export default maintenanceGuard;
