// RX-BLOCKER-2 — Gestion des comptes MANAGER (admin/dev) par invitation. Le dev crée l'utilisateur ; celui-ci
// choisit son mot de passe via un lien tokenisé (aucun mot de passe généré côté dev). Réutilise User,
// managerInvitationService, authMailService. Router gardé dev-only (V1 : pas d'escalade de privilège).
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import User from '../models/user.js';
import { hashPassword } from '../utils/password.js';
import {
  createManagerInvitationToken,
  loadInvitationToken,
  evaluateInvitationToken,
  markInvitationTokenUsed
} from '../services/managerInvitationService.js';
import { sendManagerInvitationEmail } from '../services/authMailService.js';

const MANAGER_ROLES = ['admin', 'dev'];
const PASSWORD_POLICY = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

function normalizeEmail(v) { const c = String(v || '').trim().toLowerCase(); return c || null; }
function normalizeName(v) { return String(v || '').trim().slice(0, 64); }
function resolveIsActive(u) {
  if (typeof u?.isActive === 'boolean') return u.isActive;
  if (typeof u?.active === 'boolean') return u.active;
  return true;
}
function statusOf(u) {
  if (u?.managerInviteStatus) return u.managerInviteStatus;
  return resolveIsActive(u) ? 'active' : 'disabled';
}
function payload(u) {
  return {
    id: u?._id?.toString(),
    firstName: u?.firstName || '',
    lastName: u?.lastName || '',
    email: u?.email || '',
    role: u?.role,
    status: statusOf(u),
    inviteSentAt: u?.managerInviteSentAt || null,
    activatedAt: u?.managerActivatedAt || null,
    lastLogin: u?.lastLogin || null,
    createdAt: u?.createdAt || null
  };
}

// ── Manager (dev-only) ────────────────────────────────────────────────────────

export async function listManagerUsers(_req, res) {
  try {
    const users = await User.find({ role: { $in: MANAGER_ROLES } }).sort({ createdAt: 1 }).lean();
    return res.json({ ok: true, users: users.map(payload) });
  } catch (error) {
    console.error('[managerUsers] list', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lister les utilisateurs.' });
  }
}

async function issueInvitation(user, createdByUserId) {
  const { token } = await createManagerInvitationToken(user._id, createdByUserId);
  await User.findByIdAndUpdate(user._id, { managerInviteSentAt: new Date() });
  await sendManagerInvitationEmail(user, token); // best-effort (Brevo mocké en test)
}

export async function createManagerUser(req, res) {
  const email = normalizeEmail(req.body?.email);
  const role = String(req.body?.role || '').trim().toLowerCase();
  const firstName = normalizeName(req.body?.firstName);
  const lastName = normalizeName(req.body?.lastName);
  if (!email || !MANAGER_ROLES.includes(role)) {
    return res.status(400).json({ ok: false, error: 'Email et rôle (admin|dev) requis.' });
  }
  try {
    const existing = await User.findOne({ email }).lean();
    if (existing) {
      return res.status(409).json({ ok: false, error: 'Un utilisateur porte déjà cet email.' });
    }
    // Aucun mot de passe côté dev : hash placeholder ALÉATOIRE (login impossible avant acceptation).
    const { hash, salt } = await hashPassword(crypto.randomBytes(24).toString('hex'));
    const user = new User({
      email, firstName, lastName,
      passwordHash: hash, passwordSalt: salt,
      role, currentMode: 'vitrine',
      isActive: false, active: false,
      managerInviteStatus: 'invited'
    });
    await user.save();
    await issueInvitation(user, req.sessionUserId);
    return res.status(201).json({ ok: true, user: payload(user.toObject()) });
  } catch (error) {
    console.error('[managerUsers] create', error);
    return res.status(500).json({ ok: false, error: 'Impossible de créer l’utilisateur.' });
  }
}

export async function resendManagerInvitation(req, res) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
  try {
    const user = await User.findById(id).lean();
    if (!user || !MANAGER_ROLES.includes(user.role)) return res.status(404).json({ ok: false, error: 'Utilisateur introuvable.' });
    if (statusOf(user) === 'active') return res.status(409).json({ ok: false, error: 'Ce compte est déjà actif.' });
    await User.findByIdAndUpdate(id, { managerInviteStatus: 'invited' });
    await issueInvitation(user, req.sessionUserId);
    return res.json({ ok: true, user: payload({ ...user, managerInviteStatus: 'invited', managerInviteSentAt: new Date() }) });
  } catch (error) {
    console.error('[managerUsers] resend', error);
    return res.status(500).json({ ok: false, error: 'Impossible de renvoyer l’invitation.' });
  }
}

async function setEnabled(req, res, enabled) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
  if (String(req.sessionUserId) === String(id)) return res.status(403).json({ ok: false, error: 'Impossible de vous désactiver vous-même.' });
  try {
    const user = await User.findById(id);
    if (!user || !MANAGER_ROLES.includes(user.role)) return res.status(404).json({ ok: false, error: 'Utilisateur introuvable.' });
    user.isActive = enabled; user.active = enabled;
    if (!enabled) { user.managerInviteStatus = 'disabled'; user.disabledAt = new Date(); }
    else if (user.managerInviteStatus === 'disabled') { user.managerInviteStatus = user.managerActivatedAt ? 'active' : 'invited'; }
    await user.save();
    return res.json({ ok: true, user: payload(user.toObject()) });
  } catch (error) {
    console.error('[managerUsers] setEnabled', error);
    return res.status(500).json({ ok: false, error: 'Action impossible.' });
  }
}
export const disableManagerUser = (req, res) => setEnabled(req, res, false);
export const enableManagerUser = (req, res) => setEnabled(req, res, true);

// ── Public (token) — acceptation d'invitation ─────────────────────────────────

export async function getManagerInvitation(req, res) {
  try {
    const tokenDoc = await loadInvitationToken(String(req.params.token || '').trim());
    const evalRes = evaluateInvitationToken(tokenDoc);
    if (evalRes.status !== 'valid') {
      return res.status(400).json({ ok: false, status: evalRes.status });
    }
    const user = await User.findById(tokenDoc.userId).select('email firstName role').lean();
    if (!user) return res.status(400).json({ ok: false, status: 'invalid' });
    return res.json({ ok: true, email: user.email, firstName: user.firstName || '', role: user.role });
  } catch (error) {
    console.error('[managerUsers] getInvitation', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function acceptManagerInvitation(req, res) {
  try {
    const rawToken = String(req.params.token || '').trim();
    const password = String(req.body?.password || '');
    const confirm = String(req.body?.confirmPassword ?? req.body?.password ?? '');
    if (password !== confirm) return res.status(400).json({ ok: false, error: 'Les mots de passe ne correspondent pas.' });
    if (!PASSWORD_POLICY.test(password)) {
      return res.status(400).json({ ok: false, error: 'Le mot de passe doit contenir au moins 8 caractères, dont une lettre et un chiffre.' });
    }
    const tokenDoc = await loadInvitationToken(rawToken);
    const evalRes = evaluateInvitationToken(tokenDoc);
    if (evalRes.status !== 'valid') return res.status(400).json({ ok: false, status: evalRes.status });
    const used = await markInvitationTokenUsed(tokenDoc._id);
    if (!used) return res.status(400).json({ ok: false, status: 'used' });
    const { hash, salt } = await hashPassword(password);
    await User.findByIdAndUpdate(tokenDoc.userId, {
      passwordHash: hash, passwordSalt: salt,
      isActive: true, active: true,
      emailVerified: true,
      managerInviteStatus: 'active', managerActivatedAt: new Date()
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error('[managerUsers] accept', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}
