import mongoose from 'mongoose';

import User from '../models/user.js';
import { hashPassword } from '../utils/password.js';

const ALLOWED_ROLES = ['client', 'admin', 'dev'];

function resolveIsActive(user) {
  if (typeof user?.isActive === 'boolean') {
    return user.isActive;
  }
  if (typeof user?.active === 'boolean') {
    return user.active;
  }
  return true;
}

function buildUserPayload(user) {
  const isActive = resolveIsActive(user);
  return {
    id: user?._id?.toString(),
    email: user?.email,
    role: user?.role,
    createdAt: user?.createdAt,
    lastLogin: user?.lastLogin || null,
    isActive,
    active: isActive
  };
}

function normalizeEmail(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return candidate || null;
}

function normalizeRole(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return ALLOWED_ROLES.includes(candidate) ? candidate : null;
}

function getRequesterRole(req) {
  return String(req?.sessionUser?.role || '').trim().toLowerCase();
}

export async function listGestionUsers(_req, res) {
  try {
    const users = await User.find().sort({ createdAt: 1 }).lean();
    return res.json({ ok: true, users: users.map(buildUserPayload) });
  } catch (error) {
    console.error('Impossible de lister les utilisateurs', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lister les utilisateurs.' });
  }
}

export async function createGestionUser(req, res) {
  const { email, password, role } = req.body || {};
  const normalizedEmail = normalizeEmail(email);
  const normalizedRole = normalizeRole(role);
  if (!normalizedEmail || !password || !normalizedRole) {
    return res.status(400).json({ ok: false, error: 'Email, mot de passe et rÃ´le requis.' });
  }
  const requesterRole = getRequesterRole(req);
  if (normalizedRole === 'dev' && requesterRole !== 'dev') {
    return res.status(403).json({
      ok: false,
      error: 'Seul un compte dev peut creer ou promouvoir un compte dev.'
    });
  }
  try {
    const existing = await User.findOne({ email: normalizedEmail }).lean();
    if (existing) {
      return res.status(409).json({ ok: false, error: 'Un utilisateur porte dÃ©jÃ  cet email.' });
    }
    const { hash, salt } = await hashPassword(password);
    const candidate = new User({
      email: normalizedEmail,
      passwordHash: hash,
      passwordSalt: salt,
      role: normalizedRole,
      currentMode: 'vitrine',
      isActive: true,
      active: true
    });
    await candidate.save();
    return res.status(201).json({ ok: true, user: buildUserPayload(candidate.toObject()) });
  } catch (error) {
    console.error('Impossible de crÃ©er un utilisateur', error);
    return res.status(500).json({ ok: false, error: 'Impossible de crÃ©er un utilisateur.' });
  }
}

export async function updateGestionUser(req, res) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
  }
  try {
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'Utilisateur introuvable.' });
    }
    const normalizedEmail = normalizeEmail(req.body?.email);
    if (normalizedEmail && normalizedEmail !== user.email) {
      const taken = await User.findOne({ email: normalizedEmail, _id: { $ne: user._id } }).lean();
      if (taken) {
        return res.status(409).json({ ok: false, error: 'Un utilisateur porte dÃ©jÃ  cet email.' });
      }
      user.email = normalizedEmail;
    }
    const normalizedRole = normalizeRole(req.body?.role);
    const isSelf = String(req.sessionUserId) === String(user._id);
    if (typeof normalizedRole === 'string') {
      const requesterRole = getRequesterRole(req);
      if (normalizedRole === 'dev' && requesterRole !== 'dev') {
        return res.status(403).json({
          ok: false,
          error: 'Seul un compte dev peut creer ou promouvoir un compte dev.'
        });
      }
      if (isSelf) {
        return res.status(403).json({ ok: false, error: 'Impossible de changer votre propre rÃ´le.' });
      }
      user.role = normalizedRole;
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'active')) {
      const desiredState = Boolean(req.body.active);
      user.isActive = desiredState;
      user.active = desiredState;
    }
    await user.save();
    return res.json({ ok: true, user: buildUserPayload(user.toObject()) });
  } catch (error) {
    console.error("Impossible de mettre à jour l'utilisateur", error);
    return res.status(500).json({ ok: false, error: "Impossible de mettre à jour l'utilisateur." });
  }
}


