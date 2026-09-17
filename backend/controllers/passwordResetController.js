import { hashPassword } from '../utils/password.js';
import {
  createResetPasswordToken,
  evaluateResetToken,
  loadResetToken,
  markResetTokenUsed
} from '../services/passwordResetService.js';
// RX-BLOCKER-2 — routage d'expéditeur par rôle : manager (admin/dev) → support ; client → commerciale.
import { sendManagerPasswordResetEmail, sendClientPasswordResetEmail } from '../services/authMailService.js';
import { invalidateSessionTokens, loadSessionUser } from '../utils/session.js';
import User from '../models/user.js';

const GENERIC_SUCCESS_MESSAGE = 'Si un compte existe avec cet email, un lien a ete envoye.';
const MIN_PASSWORD_LENGTH = 8;

function resolveUserActive(user) {
  if (!user) return false;
  if (typeof user.isActive === 'boolean') {
    return user.isActive;
  }
  if (typeof user.active === 'boolean') {
    return user.active;
  }
  return true;
}

export async function requestResetToken(req, res) {
  try {
    const sessionUser = await loadSessionUser(req, res);
    let targetUser = sessionUser;
    const emailInput = String(req.body?.email || '').trim().toLowerCase();
    if (!targetUser && !emailInput) {
      return res.status(400).json({ ok: false, error: 'Email requis.' });
    }
    if (!targetUser) {
      targetUser = await User.findOne({ email: emailInput }).lean();
    }
    if (targetUser && resolveUserActive(targetUser)) {
      const { token } = await createResetPasswordToken(targetUser._id);
      try {
        // Routage expéditeur + lien selon le rôle (aucun sender hardcodé) :
        //   admin/dev → support + /manager/reinitialiser-mot-de-passe ; client → commerciale + /app.
        const isManager = ['admin', 'dev'].includes(String(targetUser.role || '').trim().toLowerCase());
        if (isManager) {
          await sendManagerPasswordResetEmail(targetUser, token);
        } else {
          await sendClientPasswordResetEmail(targetUser, token);
        }
      } catch (error) {
        console.error('[passwordReset] Erreur envoi email', error);
      }
    }
    return res.json({ ok: true, message: GENERIC_SUCCESS_MESSAGE });
  } catch (error) {
    console.error('[passwordReset] Impossible de traiter la demande', error);
    return res.status(500).json({ ok: false, error: 'Impossible de traiter la demande.' });
  }
}

function translateTokenStatus(status) {
  switch (status) {
    case 'invalid':
      return { errorCode: 'invalid', message: 'Lien invalide.' };
    case 'used':
      return { errorCode: 'used', message: 'Ce lien a deja ete utilise.' };
    case 'expired':
      return { errorCode: 'expired', message: 'Ce lien a expire.' };
    default:
      return null;
  }
}

export async function validateResetToken(req, res) {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) {
      return res.status(400).json({ ok: false, errorCode: 'missing_token', error: 'Token requis.' });
    }
    const tokenDoc = await loadResetToken(token);
    const evaluation = evaluateResetToken(tokenDoc);
    if (evaluation.status !== 'valid') {
      const payload = translateTokenStatus(evaluation.status);
      return res.status(400).json({ ok: false, ...payload });
    }
    return res.json({
      ok: true,
      expiresAt: tokenDoc?.expiresAt || null
    });
  } catch (error) {
    console.error('[passwordReset] Impossible de valider le token', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function completeResetPassword(req, res) {
  try {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');
    if (!token || !password) {
      return res.status(400).json({ ok: false, error: 'Token et mot de passe requis.' });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        ok: false,
        error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caracteres.`
      });
    }
    const tokenDoc = await loadResetToken(token);
    const evaluation = evaluateResetToken(tokenDoc);
    if (evaluation.status !== 'valid') {
      const payload = translateTokenStatus(evaluation.status);
      return res.status(400).json({ ok: false, ...payload });
    }
    const usedToken = await markResetTokenUsed(tokenDoc._id);
    if (!usedToken) {
      return res.status(400).json({ ok: false, errorCode: 'used', error: 'Ce lien a deja ete utilise.' });
    }
    const { hash, salt } = await hashPassword(password);
    await User.findByIdAndUpdate(tokenDoc.userId, {
      passwordHash: hash,
      passwordSalt: salt,
      mustChangePassword: false
    });
    await invalidateSessionTokens(tokenDoc.userId);
    return res.json({ ok: true });
  } catch (error) {
    console.error('[passwordReset] Impossible de reinitialiser le mot de passe', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}
