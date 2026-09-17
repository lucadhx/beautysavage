import User from '../models/user.js';
import { getSessionUserId } from '../utils/session.js';
import {
  isAdminBlockedBySuspension,
  respondSuspendedAdmin
} from './siteStatusGuards.js';

function createRoleGuard(roles = []) {
  const allowedRoles = new Set(roles.map(role => String(role || '').trim().toLowerCase()));
  return async (req, res, next) => {
    try {
      const userId = getSessionUserId(req);
      if (!userId) {
        return res.status(401).json({ ok: false, error: 'Authentification requise.' });
      }
      const user = await User.findById(userId).lean();
      if (!user) {
        return res.status(401).json({ ok: false, error: 'Utilisateur introuvable.' });
      }
      if (!allowedRoles.has(String(user.role || '').trim().toLowerCase())) {
        return res.status(403).json({ ok: false, error: 'Acces refuse.' });
      }
      const isActive =
        typeof user.isActive === 'boolean'
          ? user.isActive
          : typeof user.active === 'boolean'
            ? user.active
            : true;
      if (!isActive) {
        return res.status(403).json({ ok: false, error: 'Compte desactive.' });
      }
      if (await isAdminBlockedBySuspension(user)) {
        return respondSuspendedAdmin(res);
      }
      req.sessionUser = user;
      next();
    } catch (error) {
      console.error('Erreur de controle role', error);
      return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
    }
  };
}

// Guard used for the gestion perimeter: both admin and dev accounts are allowed by default.
export const requireDev = createRoleGuard(['dev', 'admin']);
// Explicit alias kept for clarity when a route wants to be inclusive.
export const requireAdminOrDev = requireDev;
// Strict dev-only guard: admin/client must be refused here.
// Account-disabled and suspension/maintenance checks still run in createRoleGuard().
export const requireStrictDev = createRoleGuard(['dev']);
