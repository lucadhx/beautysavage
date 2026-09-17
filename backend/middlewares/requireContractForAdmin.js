import { loadSessionUser } from '../utils/session.js';
import Contract from '../models/Contract.js';

/**
 * Middleware appliqué uniquement aux routes admin (pas developer).
 * - Si role dev → passe toujours
 * - Si contrat active → passe
 * - Si contrat pending → retourne { blocked: true, reason: 'pending' }
 * - Si pas de contrat → retourne { blocked: true, reason: 'no_contract' }
 */
export function requireContractForAdmin() {
  return async (req, res, next) => {
    try {
      const user = await loadSessionUser(req, res);
      if (!user) {
        return res.status(401).json({ ok: false, error: 'Authentification requise.' });
      }

      const role = String(user.role || '').trim().toLowerCase();

      // Developer always bypasses this middleware
      if (role === 'dev') {
        req.sessionUser = user;
        return next();
      }

      if (role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Accès refusé.' });
      }

      // Check contract status for admin users
      const contract = await Contract.findOne({ status: { $in: ['active', 'pending'] } })
        .select({ status: 1 })
        .lean();

      if (!contract) {
        return res.status(403).json({
          ok: false,
          blocked: true,
          reason: 'no_contract',
          error: 'Aucun contrat actif. Contactez votre prestataire.'
        });
      }

      if (contract.status === 'pending') {
        return res.status(403).json({
          ok: false,
          blocked: true,
          reason: 'pending',
          error: 'Contrat en attente de règlement.'
        });
      }

      req.sessionUser = user;
      return next();
    } catch (error) {
      console.error('[requireContractForAdmin] Erreur', error);
      return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
    }
  };
}

export default requireContractForAdmin;
