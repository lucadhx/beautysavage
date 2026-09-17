import crypto from 'node:crypto';
import User from '../models/user.js';

const SESSION_COOKIE_NAME = 'beautysavage_session';
const SESSION_SECRET_ENV = 'SESSION_SECRET';
const COOKIE_MAX_AGE = 1000 * 60 * 60 * 24; // 24 hours
const SESSION_TOKEN_BYTES = 32;
const COOKIE_TOKEN_DELIMITER = ':';

function getCookieOptions() {
  return {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE,
    path: '/'
  };
}

function getSessionCookieValue(req) {
  const signed = req?.signedCookies?.[SESSION_COOKIE_NAME];
  if (signed) return signed;
  return req?.cookies?.[SESSION_COOKIE_NAME];
}

function buildSessionCookieValue(userId, token) {
  if (!userId) {
    return '';
  }
  const normalizedId = String(userId);
  if (!token) {
    return normalizedId;
  }
  return `${normalizedId}${COOKIE_TOKEN_DELIMITER}${token}`;
}

function parseSessionCookieValue(raw) {
  if (!raw) return null;
  const value = String(raw);
  const parts = value.split(COOKIE_TOKEN_DELIMITER);
  if (!parts.length) return null;
  const userId = parts[0] || null;
  const token = parts.length > 1 ? parts.slice(1).join(COOKIE_TOKEN_DELIMITER) : null;
  return { userId, token };
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function generateSessionToken() {
  return crypto.randomBytes(SESSION_TOKEN_BYTES).toString('hex');
}

function getSessionSecretValue() {
  const secret = process.env[SESSION_SECRET_ENV];
  if (!secret) {
    console.warn(`${SESSION_SECRET_ENV} manquant dans .env - les sessions ne peuvent pas etre signees.`);
    throw new Error(`${SESSION_SECRET_ENV} requis`);
  }
  return secret;
}

export function createSessionCookie(res, userId, token = null) {
  const value = buildSessionCookieValue(userId, token);
  res.cookie(SESSION_COOKIE_NAME, value, getCookieOptions());
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, { ...getCookieOptions(), maxAge: 0 });
}

export async function loadSessionUser(req, res, options = {}) {
  if (req.sessionUser) {
    return req.sessionUser;
  }
  const cookieValue = getSessionCookieValue(req);
  const parsed = parseSessionCookieValue(cookieValue);
  if (!parsed?.userId) {
    return null;
  }
  const { userId, token } = parsed;
  try {
    const user = await User.findById(userId).lean();
    if (!user) {
      clearSessionCookie(res);
      return null;
    }
    const isActive =
      typeof user.isActive === 'boolean'
        ? user.isActive
        : typeof user.active === 'boolean'
          ? user.active
          : true;
    if (!isActive) {
      clearSessionCookie(res);
      return null;
    }
    const storedHash = String(user.sessionTokenHash || '').trim();
    if (storedHash) {
      if (!token) {
        clearSessionCookie(res);
        return null;
      }
      const computedHash = hashSessionToken(token);
      const storedBuffer = Buffer.from(storedHash, 'hex');
      const computedBuffer = Buffer.from(computedHash, 'hex');
      if (
        storedBuffer.length !== computedBuffer.length ||
        !crypto.timingSafeEqual(storedBuffer, computedBuffer)
      ) {
        clearSessionCookie(res);
        return null;
      }
    } else if (token) {
      clearSessionCookie(res);
      return null;
    } else if (options.allowLegacyCookie !== false && !req.sessionCookieUpgraded) {
      const newToken = generateSessionToken();
      const newHash = hashSessionToken(newToken);
      await User.findByIdAndUpdate(userId, { sessionTokenHash: newHash });
      createSessionCookie(res, userId, newToken);
      req.sessionCookieUpgraded = true;
      user.sessionTokenHash = newHash;
    }
    req.sessionUserId = userId;
    req.sessionUser = user;
    return user;
  } catch (error) {
    console.error("Erreur d'authentification de session", error);
    clearSessionCookie(res);
    return null;
  }
}

export function requireAuth(options = {}) {
  const { redirectToLogin = false } = options;
  return async (req, res, next) => {
    try {
      const user = await loadSessionUser(req, res);
      if (!user) {
        if (redirectToLogin) {
          const target = encodeURIComponent(req.originalUrl || '/');
          return res.redirect(`/login.html?next=${target}`);
        }
        return res.status(401).json({ ok: false, error: 'Authentification requise.' });
      }
      req.sessionUserId = req.sessionUserId || String(user._id);
      next();
    } catch (error) {
      console.error('Erreur requireAuth', error);
      if (redirectToLogin) {
        const target = encodeURIComponent(req.originalUrl || '/');
        return res.redirect(`/login.html?next=${target}`);
      }
      return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
    }
  };
}

export function getSessionUserId(req) {
  const parsed = parseSessionCookieValue(getSessionCookieValue(req));
  return parsed?.userId || null;
}

export async function invalidateSessionTokens(userId) {
  if (!userId) return;
  const randomToken = generateSessionToken();
  const newHash = hashSessionToken(randomToken);
  await User.findByIdAndUpdate(userId, { sessionTokenHash: newHash });
}

export { getSessionSecretValue as getSessionSecret, generateSessionToken, hashSessionToken };

