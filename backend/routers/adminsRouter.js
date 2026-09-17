import express from 'express';
import mongoose from 'mongoose';

import User from '../models/user.js';
import { hashPassword } from '../utils/password.js';
import { requireAuth } from '../utils/session.js';
import { requireMode } from '../middlewares/modeGuard.js';
import { requireDev } from '../middlewares/requireDev.js';

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'), requireDev);

function resolveIsActive(user) {
  if (typeof user?.isActive === 'boolean') {
    return user.isActive;
  }
  if (typeof user?.active === 'boolean') {
    return user.active;
  }
  return true;
}

function buildAdminPayload(user) {
  return {
    id: user?._id?.toString(),
    email: user?.email,
    createdAt: user?.createdAt,
    isActive: resolveIsActive(user),
    mustChangePassword: Boolean(user?.mustChangePassword)
  };
}

router.get('/', async (_req, res) => {
  try {
    const admins = await User.find({ role: 'admin' })
      .sort({ createdAt: 1 })
      .lean();
    return res.json({ ok: true, admins: admins.map(buildAdminPayload) });
  } catch (error) {
    console.error('Impossible de lister les admins', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lister les admins.' });
  }
});

router.post('/', async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !password) {
    return res.status(400).json({ ok: false, error: 'Email et mot de passe requis.' });
  }
  try {
    const existing = await User.findOne({ email: normalizedEmail }).lean();
    if (existing) {
      return res.status(409).json({ ok: false, error: 'Un compte porte déjà cet email.' });
    }
    const { hash, salt } = await hashPassword(password);
    const admin = await User.create({
      email: normalizedEmail,
      passwordHash: hash,
      passwordSalt: salt,
      role: 'admin',
      currentMode: 'gestion',
      isActive: true,
      active: true,
      mustChangePassword: true
    });
    return res.status(201).json({ ok: true, admin: buildAdminPayload(admin.toObject()) });
  } catch (error) {
    console.error('Impossible de créer un admin', error);
    return res.status(500).json({ ok: false, error: 'Impossible de créer un admin.' });
  }
});

router.put('/:id/toggle', async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
  }
  try {
    const admin = await User.findById(id);
    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ ok: false, error: 'Admin introuvable.' });
    }
    const currentState = resolveIsActive(admin);
    const nextState = !currentState;
    admin.isActive = nextState;
    admin.active = nextState;
    await admin.save();
    return res.json({ ok: true, admin: buildAdminPayload(admin.toObject()) });
  } catch (error) {
    console.error("Impossible de changer le statut de l'admin", error);
    return res.status(500).json({ ok: false, error: "Impossible de changer le statut de l'admin." });
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
  }
  if (id === String(req.sessionUserId || '')) {
    return res.status(400).json({ ok: false, error: 'Impossible de supprimer votre propre compte.' });
  }
  try {
    const admin = await User.findById(id);
    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ ok: false, error: 'Admin introuvable.' });
    }
    await User.findByIdAndDelete(id);
    return res.json({ ok: true });
  } catch (error) {
    console.error("Impossible de supprimer l'admin", error);
    return res.status(500).json({ ok: false, error: "Impossible de supprimer l'admin." });
  }
});

export default router;
