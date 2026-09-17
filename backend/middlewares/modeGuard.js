import User from '../models/user.js';
import { clearSessionCookie } from '../utils/session.js';
import { isSiteSuspended } from '../services/siteStatusService.js';

function buildSuspendedLoginRedirectUrl() {
  const params = new URLSearchParams({ reason: 'site-suspended' });
  return `/login.html?${params.toString()}`;
}

export function requireMode(expectedMode) {
  return async (req, res, next) => {
    const userId = req.sessionUserId;
    if (!userId) {
      return res.redirect('/login.html');
    }
    try {
      const user = await User.findById(userId).select('role currentMode');
      if (!user) {
        clearSessionCookie(res);
        return res.redirect('/login.html');
      }
      if (
        expectedMode === 'gestion' &&
        String(user.role || '').trim().toLowerCase() === 'admin' &&
        (await isSiteSuspended())
      ) {
        clearSessionCookie(res);
        return res.redirect(buildSuspendedLoginRedirectUrl());
      }
      if (user.currentMode !== expectedMode) {
        return res.redirect('/vitrine.html');
      }
      req.currentMode = user.currentMode;
      next();
    } catch (error) {
      console.error(error);
      res.status(500).send('Erreur serveur.');
    }
  };
}
