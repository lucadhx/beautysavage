import express from 'express';

import User from '../models/user.js';
import { hashPassword } from '../utils/password.js';
import { requireAuth } from '../utils/session.js';
import { requireStrictDev } from '../middlewares/requireDev.js';

const router = express.Router();

router.use(requireAuth(), requireStrictDev);

router.post('/create-user', async (req, res) => {
  const { email, password, role } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (!normalizedEmail || !password) {
    return res.status(400).json({ ok: false, error: 'Email et mot de passe requis.' });
  }
  if (!['admin', 'client'].includes(normalizedRole)) {
    return res.status(400).json({ ok: false, error: 'Role invalide (admin ou client).' });
  }
  try {
    const exists = await User.exists({ email: normalizedEmail });
    if (exists) {
      return res.status(409).json({ ok: false, error: 'Un utilisateur porte dÃ©jÃ  cet email.' });
    }
    const { hash, salt } = await hashPassword(password);
    await User.create({
      email: normalizedEmail,
      passwordHash: hash,
      passwordSalt: salt,
      role: normalizedRole,
      currentMode: 'vitrine'
    });
    return res.status(201).json({ ok: true });
  } catch (error) {
    console.error('Erreur crÃ©ation utilisateur test', error);
    return res.status(500).json({ ok: false, error: "Impossible de créer l'utilisateur." });
  }
});

export default router;

