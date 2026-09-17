import { loadSessionUser } from '../utils/session.js';

const GESTION_ALLOWED_ROLES = new Set(['admin', 'dev']);

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

export function requireGestionRole() {
  return async (req, res, next) => {
    try {
      const user = await loadSessionUser(req, res);
      if (!user) {
        return res.status(401).json({ ok: false, error: 'Authentification requise.' });
      }
      const role = normalizeRole(user.role);
      if (!GESTION_ALLOWED_ROLES.has(role)) {
        return res.status(403).json({
          ok: false,
          error: 'Acces reserve aux admins/dev.',
          code: 'FORBIDDEN_GESTION_ROLE'
        });
      }
      req.sessionUser = user;
      req.sessionUserId = req.sessionUserId || String(user._id || '');
      return next();
    } catch (error) {
      console.error('Erreur guard role gestion', error);
      return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
    }
  };
}
