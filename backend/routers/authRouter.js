import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';

import User from '../models/user.js';
import { triggerNotification } from '../services/notificationService.js';
import Contract from '../models/Contract.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import {
  createSessionCookie,
  clearSessionCookie,
  requireAuth,
  generateSessionToken,
  hashSessionToken
} from '../utils/session.js';
import {
  ADMIN_SUSPENDED_MESSAGE,
  MAINTENANCE_BLOCKED_MESSAGE,
  isSiteSuspended,
  isSiteInMaintenance,
  isRoleAllowedDuringMaintenance
} from '../services/siteStatusService.js';
import { respondSuspendedAdmin } from '../middlewares/siteStatusGuards.js';
import { sendEmailConfirmationCodeEmail } from '../services/mailService.js';

const router = express.Router();

const EMAIL_VERIFICATION_CODE_LENGTH = 6;
const EMAIL_VERIFICATION_TTL_MS = 10 * 60 * 1000;
const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;
const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 30 * 1000;
const SIGNUP_PASSWORD_MIN_LENGTH = 8;
const PASSWORD_POLICY = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_AUTH_ERROR = 'Identifiants invalides.';

const SIGNUP_RATE_LIMIT = buildAuthRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  code: 'SIGNUP_RATE_LIMIT',
  error: 'Trop de tentatives de creation de compte. Reessayez plus tard.'
});
const VERIFY_RATE_LIMIT = buildAuthRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  code: 'VERIFY_EMAIL_RATE_LIMIT',
  error: 'Trop de tentatives de verification. Reessayez plus tard.'
});
const RESEND_RATE_LIMIT = buildAuthRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 12,
  code: 'RESEND_VERIFICATION_RATE_LIMIT',
  error: 'Trop de demandes de renvoi. Reessayez plus tard.'
});
const LOGIN_RATE_LIMIT = buildAuthRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  code: 'LOGIN_RATE_LIMIT',
  error: 'Trop de tentatives de connexion. Reessayez plus tard.',
  skipSuccessfulRequests: true
});

function buildAuthRateLimiter({ windowMs, max, code, error, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    handler(_req, res) {
      return res.status(429).json({
        ok: false,
        code,
        error
      });
    }
  });
}

function isAdminRole(user) {
  return String(user?.role || '').trim().toLowerCase() === 'admin';
}

function isDevRole(user) {
  return String(user?.role || '').trim().toLowerCase() === 'dev';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return EMAIL_REGEX.test(String(value || '').trim());
}

function isStrongPassword(password) {
  return PASSWORD_POLICY.test(String(password || ''));
}

function resolveUserIsActive(user) {
  if (typeof user?.isActive === 'boolean') {
    return user.isActive;
  }
  if (typeof user?.active === 'boolean') {
    return user.active;
  }
  return true;
}

function isEmailVerified(user) {
  if (typeof user?.emailVerified === 'boolean') {
    return user.emailVerified;
  }
  return true;
}

function getEmailVerificationSecret() {
  const secret =
    String(process.env.EMAIL_VERIFICATION_SECRET || '').trim() ||
    String(process.env.SESSION_SECRET || '').trim();
  if (!secret) {
    // No insecure hardcoded fallback: refuse to derive verification codes with a
    // public, known key. SESSION_SECRET is mandatory at boot, so this never throws
    // in a correctly-configured deployment.
    throw new Error(
      'EMAIL_VERIFICATION_SECRET (or SESSION_SECRET fallback) is required and was not found in the environment.'
    );
  }
  return secret;
}

function hashVerificationCode(code) {
  return crypto
    .createHmac('sha256', getEmailVerificationSecret())
    .update(String(code || '').trim())
    .digest('hex');
}

function generateVerificationCode() {
  const max = 10 ** EMAIL_VERIFICATION_CODE_LENGTH;
  return String(crypto.randomInt(0, max)).padStart(EMAIL_VERIFICATION_CODE_LENGTH, '0');
}

function hasMatchingVerificationCodeHash(storedHash, candidateCode) {
  const normalizedHash = String(storedHash || '').trim();
  if (!normalizedHash) return false;
  const computedHash = hashVerificationCode(candidateCode);
  const storedBuffer = Buffer.from(normalizedHash, 'hex');
  const computedBuffer = Buffer.from(computedHash, 'hex');
  if (!storedBuffer.length || storedBuffer.length !== computedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(storedBuffer, computedBuffer);
}

function getRetryAfterSeconds(lastSentAt, cooldownMs = EMAIL_VERIFICATION_RESEND_COOLDOWN_MS) {
  if (!lastSentAt) return 0;
  const sentAt = new Date(lastSentAt).getTime();
  if (!Number.isFinite(sentAt)) return 0;
  const diff = cooldownMs - (Date.now() - sentAt);
  if (diff <= 0) return 0;
  return Math.max(1, Math.ceil(diff / 1000));
}

async function issueAndSendVerificationCode(user, { enforceCooldown = true } = {}) {
  if (!user?._id || !user?.email) {
    const error = new Error('Compte invalide.');
    error.code = 'INVALID_USER_FOR_VERIFICATION';
    throw error;
  }
  if (enforceCooldown) {
    const retryAfterSeconds = getRetryAfterSeconds(user.emailVerificationLastSentAt);
    if (retryAfterSeconds > 0) {
      const error = new Error(`Attendez ${retryAfterSeconds}s avant de renvoyer un code.`);
      error.code = 'VERIFICATION_RESEND_THROTTLED';
      error.retryAfterSeconds = retryAfterSeconds;
      throw error;
    }
  }

  const code = generateVerificationCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS);
  await User.findByIdAndUpdate(user._id, {
    emailVerificationCodeHash: hashVerificationCode(code),
    emailVerificationExpiresAt: expiresAt,
    emailVerificationAttempts: 0,
    emailVerificationLastSentAt: now
  });
  const emailSent = await sendEmailConfirmationCodeEmail({
    toEmail: user.email,
    firstName: user.firstName || '',
    email: user.email,
    code,
    expiresMinutes: Math.round(EMAIL_VERIFICATION_TTL_MS / 60000)
  });
  if (!emailSent) {
    const error = new Error('Impossible d envoyer le code de verification.');
    error.code = 'VERIFICATION_EMAIL_SEND_FAILED';
    throw error;
  }
  return {
    expiresAt: expiresAt.toISOString(),
    retryAfterSeconds: Math.ceil(EMAIL_VERIFICATION_RESEND_COOLDOWN_MS / 1000)
  };
}

router.post('/dev-bootstrap', async (req, res) => {
  try {
    // ! A SUPPRIMER APRES INITIALISATION DU PROJET
    const { email, password, role } = req.body || {};
    if (String(role || '').trim().toLowerCase() !== 'dev') {
      return res.status(400).json({ ok: false, error: 'Role requis : dev.' });
    }
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password) {
      return res.status(400).json({ ok: false, error: 'Email et mot de passe requis.' });
    }
    const devExists = Boolean(await User.exists({ role: 'dev' }));
    if (devExists) {
      return res.status(403).json({ ok: false, error: 'Un compte dev existe deja.' });
    }
    const { hash, salt } = await hashPassword(password);
    const user = await User.create({
      email: normalizedEmail,
      passwordHash: hash,
      passwordSalt: salt,
      role: 'dev',
      currentMode: 'gestion',
      emailVerified: true
    });
    return res.status(201).json({ ok: true, userId: user._id });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
});

router.get('/dev-bootstrap/status', async (_req, res) => {
  try {
    const devExists = Boolean(await User.exists({ role: 'dev' }));
    return res.json({ ok: true, devExists });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'Impossible de connaitre le statut.' });
  }
});

router.post('/signup', SIGNUP_RATE_LIMIT, async (req, res) => {
  try {
    const { email, password, passwordConfirm } = req.body || {};
    const normalizedEmail = normalizeEmail(email);
    const normalizedPassword = String(password || '');
    const normalizedPasswordConfirm = String(passwordConfirm || '');

    if (!normalizedEmail || !normalizedPassword || !normalizedPasswordConfirm) {
      return res.status(400).json({
        ok: false,
        code: 'SIGNUP_FIELDS_REQUIRED',
        error: 'Email, mot de passe et confirmation requis.'
      });
    }
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({
        ok: false,
        code: 'SIGNUP_EMAIL_INVALID',
        error: 'Adresse email invalide.'
      });
    }
    if (normalizedPassword !== normalizedPasswordConfirm) {
      return res.status(400).json({
        ok: false,
        code: 'SIGNUP_PASSWORD_MISMATCH',
        error: 'Les mots de passe ne correspondent pas.'
      });
    }
    if (normalizedPassword.length < SIGNUP_PASSWORD_MIN_LENGTH || !isStrongPassword(normalizedPassword)) {
      return res.status(400).json({
        ok: false,
        code: 'SIGNUP_PASSWORD_WEAK',
        error: 'Le mot de passe doit contenir au moins 8 caracteres, dont une lettre et un chiffre.'
      });
    }

    const existingUser = await User.findOne({ email: normalizedEmail }).lean();
    if (existingUser) {
      if (!isEmailVerified(existingUser)) {
        return res.status(409).json({
          ok: false,
          code: 'EMAIL_NOT_VERIFIED_PENDING',
          error: 'Email deja en attente de verification. Utilisez "Renvoyer le code".',
          email: normalizedEmail,
          retryAfterSeconds: getRetryAfterSeconds(existingUser.emailVerificationLastSentAt)
        });
      }
      return res.status(409).json({
        ok: false,
        code: 'EMAIL_ALREADY_USED',
        error: 'Un compte existe deja avec cet email.'
      });
    }

    const { hash, salt } = await hashPassword(normalizedPassword);
    const user = await User.create({
      email: normalizedEmail,
      passwordHash: hash,
      passwordSalt: salt,
      role: 'client',
      currentMode: 'vitrine',
      isActive: true,
      active: true,
      emailVerified: false,
      emailVerificationCodeHash: null,
      emailVerificationExpiresAt: null,
      emailVerificationAttempts: 0,
      emailVerificationLastSentAt: null
    });

    // LOT2 — Cohérence d'inscription : la notification institut « Nouveau client inscrit » n'est
    // PLUS créée avant l'e-mail. Le compte est créé (pending, emailVerified=false) ; on tente
    // l'envoi du code ; SEULEMENT en cas de succès on émet la notification et on répond succès.
    let verification;
    try {
      verification = await issueAndSendVerificationCode(user, { enforceCooldown: false });
    } catch (verificationError) {
      if (verificationError?.code === 'VERIFICATION_EMAIL_SEND_FAILED') {
        // Compte créé mais code non envoyé (ex. identité expéditrice/clé Brevo non configurée) :
        // réponse COHÉRENTE et resumable — surtout PAS un 500 générique, et AUCUNE notification
        // institut créée. Le client peut « Renvoyer le code ». Le compte reste en attente.
        console.warn('[auth/signup] compte cree mais envoi du code impossible (pending):', verificationError.code);
        return res.status(202).json({
          ok: false,
          code: 'ACCOUNT_PENDING_VERIFICATION',
          error: 'Votre compte a ete cree, mais nous n avons pas pu envoyer le code de verification. Vous pouvez reessayer.',
          email: normalizedEmail,
          emailSent: false,
          canResend: true,
          resendAfterSeconds: Math.ceil(EMAIL_VERIFICATION_RESEND_COOLDOWN_MS / 1000)
        });
      }
      console.error('[auth/signup] erreur inattendue verification', verificationError);
      return res.status(500).json({
        ok: false,
        code: verificationError?.code || 'VERIFICATION_EMAIL_SEND_FAILED',
        error: 'Impossible d envoyer le code de verification pour le moment.'
      });
    }

    // Envoi réussi → notification institut (fire-and-forget, jamais bloquante) + succès.
    void triggerNotification('new_client', {
      clientName: normalizedEmail,
      clientEmail: normalizedEmail,
      link: '/gestion.html?page=clients',
      linkLabel: 'Voir les clients'
    });

    return res.json({
      ok: true,
      email: normalizedEmail,
      expiresAt: verification.expiresAt,
      resendAfterSeconds: verification.retryAfterSeconds
    });
  } catch (error) {
    console.error('[auth/signup] erreur', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
});

router.post('/verify-email', VERIFY_RATE_LIMIT, async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();
    if (!normalizedEmail || !code) {
      return res.status(400).json({
        ok: false,
        code: 'VERIFY_EMAIL_FIELDS_REQUIRED',
        error: 'Email et code requis.'
      });
    }
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({
        ok: false,
        code: 'VERIFICATION_CODE_INVALID',
        error: 'Code invalide.'
      });
    }
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(400).json({
        ok: false,
        code: 'VERIFICATION_CODE_INVALID',
        error: 'Code invalide.'
      });
    }
    if (isEmailVerified(user)) {
      return res.status(409).json({
        ok: false,
        code: 'EMAIL_ALREADY_VERIFIED',
        error: 'Email deja confirme.'
      });
    }
    const attempts = Number(user.emailVerificationAttempts || 0);
    if (attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
      return res.status(429).json({
        ok: false,
        code: 'VERIFICATION_TOO_MANY_ATTEMPTS',
        error: 'Trop de tentatives. Demandez un nouveau code.'
      });
    }

    const expiresAt = user.emailVerificationExpiresAt ? new Date(user.emailVerificationExpiresAt).getTime() : NaN;
    if (!user.emailVerificationCodeHash || !Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      return res.status(400).json({
        ok: false,
        code: 'VERIFICATION_CODE_EXPIRED',
        error: 'Code expire. Demandez un nouveau code.'
      });
    }

    const codeMatches = hasMatchingVerificationCodeHash(user.emailVerificationCodeHash, code);
    if (!codeMatches) {
      user.emailVerificationAttempts = attempts + 1;
      await user.save();
      const remainingAttempts = Math.max(0, EMAIL_VERIFICATION_MAX_ATTEMPTS - Number(user.emailVerificationAttempts || 0));
      if (remainingAttempts <= 0) {
        return res.status(429).json({
          ok: false,
          code: 'VERIFICATION_TOO_MANY_ATTEMPTS',
          error: 'Trop de tentatives. Demandez un nouveau code.'
        });
      }
      return res.status(400).json({
        ok: false,
        code: 'VERIFICATION_CODE_INVALID',
        error: 'Code invalide.',
        remainingAttempts
      });
    }

    const sessionToken = generateSessionToken();
    user.emailVerified = true;
    user.emailVerificationCodeHash = null;
    user.emailVerificationExpiresAt = null;
    user.emailVerificationAttempts = 0;
    user.emailVerificationLastSentAt = null;
    user.sessionTokenHash = hashSessionToken(sessionToken);
    user.lastLogin = new Date();
    await user.save();

    createSessionCookie(res, user._id, sessionToken);
    return res.json({
      ok: true,
      role: user.role,
      currentMode: user.currentMode,
      mustChangePassword: Boolean(user.mustChangePassword)
    });
  } catch (error) {
    console.error('[auth/verify-email] erreur', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
});

router.post('/resend-verification', RESEND_RATE_LIMIT, async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body?.email);
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      return res.status(400).json({
        ok: false,
        code: 'RESEND_EMAIL_INVALID',
        error: 'Adresse email invalide.'
      });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.json({ ok: true, email: normalizedEmail });
    }
    if (isEmailVerified(user)) {
      return res.status(400).json({
        ok: false,
        code: 'EMAIL_ALREADY_VERIFIED',
        error: 'Email deja confirme.'
      });
    }

    let verification;
    try {
      verification = await issueAndSendVerificationCode(user, { enforceCooldown: true });
    } catch (resendError) {
      if (resendError?.code === 'VERIFICATION_RESEND_THROTTLED') {
        return res.status(429).json({
          ok: false,
          code: resendError.code,
          error: resendError.message,
          retryAfterSeconds: resendError.retryAfterSeconds || 1
        });
      }
      console.error('[auth/resend-verification] erreur', resendError);
      return res.status(500).json({
        ok: false,
        code: resendError?.code || 'VERIFICATION_EMAIL_SEND_FAILED',
        error: 'Impossible d envoyer le code de verification.'
      });
    }

    return res.json({
      ok: true,
      email: normalizedEmail,
      resendAfterSeconds: verification.retryAfterSeconds
    });
  } catch (error) {
    console.error('[auth/resend-verification] erreur', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
});

router.post('/login', LOGIN_RATE_LIMIT, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password) {
      return res.status(400).json({ ok: false, error: 'Email et mot de passe requis.' });
    }
    const user = await User.findOne({ email: normalizedEmail }).lean();
    if (!user) {
      return res.status(401).json({ ok: false, error: GENERIC_AUTH_ERROR });
    }
    const passwordMatches = await verifyPassword(user.passwordHash, user.passwordSalt, password);
    if (!passwordMatches) {
      return res.status(401).json({ ok: false, error: GENERIC_AUTH_ERROR });
    }
    const isActive = resolveUserIsActive(user);
    if (!isActive) {
      return res.status(403).json({
        ok: false,
        error: 'Votre compte est desactive, veuillez contacter le developpeur.'
      });
    }
    if (!isEmailVerified(user)) {
      return res.status(403).json({
        ok: false,
        code: 'EMAIL_NOT_VERIFIED',
        error: 'Email non confirme. Verifiez votre boite mail.',
        email: normalizedEmail,
        retryAfterSeconds: getRetryAfterSeconds(user.emailVerificationLastSentAt)
      });
    }
    if (!isRoleAllowedDuringMaintenance(user?.role) && (await isSiteInMaintenance())) {
      return res.status(403).json({
        ok: false,
        error: MAINTENANCE_BLOCKED_MESSAGE,
        code: 'SITE_MAINTENANCE_LOGIN'
      });
    }
    if (isAdminRole(user) && (await isSiteSuspended())) {
      return res.status(403).json({
        ok: false,
        error: ADMIN_SUSPENDED_MESSAGE,
        code: 'SITE_SUSPENDED_ADMIN_LOGIN'
      });
    }
    const sessionToken = generateSessionToken();
    const sessionHash = hashSessionToken(sessionToken);
    await User.findByIdAndUpdate(user._id, { sessionTokenHash: sessionHash, lastLogin: new Date() });
    createSessionCookie(res, user._id, sessionToken);
    console.log('[Login] role retourne:', user.role);

    // For admin users, include contract status in the response so the client
    // can decide whether to redirect directly or open the settlement modal.
    if (isAdminRole(user)) {
      const contract = await Contract.findOne({ status: { $in: ['active', 'pending'] } })
        .select({ status: 1 })
        .lean();
      if (!contract) {
        return res.json({
          ok: true,
          role: user.role,
          currentMode: user.currentMode,
          mustChangePassword: Boolean(user.mustChangePassword),
          blocked: true,
          reason: 'no_contract'
        });
      }
      if (contract.status === 'pending') {
        return res.json({
          ok: true,
          role: user.role,
          currentMode: user.currentMode,
          mustChangePassword: Boolean(user.mustChangePassword),
          blocked: true,
          reason: 'pending'
        });
      }
    }

    return res.json({
      ok: true,
      role: user.role,
      currentMode: user.currentMode,
      mustChangePassword: Boolean(user.mustChangePassword)
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth(), async (req, res) => {
  try {
    const userId = req.sessionUserId;
    const user = await User.findById(userId).lean();
    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({ ok: false, error: 'Session invalide.' });
    }
    const userIsActive =
      typeof user.isActive === 'boolean'
        ? user.isActive
        : typeof user.active === 'boolean'
          ? user.active
          : true;

    if (!isDevRole(user) && (await isSiteInMaintenance())) {
      clearSessionCookie(res);
      return res.status(403).json({
        ok: false,
        error: 'MAINTENANCE',
        code: 'MAINTENANCE',
        message: MAINTENANCE_BLOCKED_MESSAGE
      });
    }

    if (isAdminRole(user) && (await isSiteSuspended())) {
      return respondSuspendedAdmin(res);
    }

    return res.json({
      ok: true,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        currentMode: user.currentMode,
        createdAt: user.createdAt,
        isActive: userIsActive,
        mustChangePassword: Boolean(user.mustChangePassword),
        emailVerified: isEmailVerified(user)
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
});

export default router;
