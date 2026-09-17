// RX-BLOCKER-2 — Service jeton d'invitation manager (clone de passwordResetService). Le token brut n'est
// renvoyé qu'à la création (pour le lien e-mail) ; en DB seul le hash SHA-256 est stocké. Usage unique + TTL.
import crypto from 'node:crypto';
import ManagerInvitationToken from '../models/ManagerInvitationToken.js';

const TOKEN_EXPIRATION_DAYS = 7;

function hashInvitationToken(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function buildExpirationDate() {
  return new Date(Date.now() + TOKEN_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
}

/** Crée un jeton d'invitation. Invalide (marque used) les jetons pendants antérieurs du même user (resend). */
export async function createManagerInvitationToken(userId, createdByUserId = null) {
  await ManagerInvitationToken.updateMany(
    { userId, used: false },
    { $set: { used: true, usedAt: new Date() } }
  );
  const rawToken = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  await ManagerInvitationToken.create({
    userId,
    tokenHash: hashInvitationToken(rawToken),
    expiresAt: buildExpirationDate(),
    used: false,
    createdBy: createdByUserId,
    sentAt: now,
    lastSentAt: now,
    createdAt: now
  });
  return { token: rawToken, expiresAt: buildExpirationDate() };
}

export async function loadInvitationToken(rawToken) {
  if (!rawToken) return null;
  const tokenDoc = await ManagerInvitationToken.findOne({ tokenHash: hashInvitationToken(rawToken) }).lean();
  return tokenDoc || null;
}

export function evaluateInvitationToken(tokenDoc) {
  if (!tokenDoc) return { status: 'invalid' };
  if (tokenDoc.used) return { status: 'used' };
  if (tokenDoc.expiresAt && new Date(tokenDoc.expiresAt).getTime() <= Date.now()) return { status: 'expired' };
  return { status: 'valid' };
}

export async function markInvitationTokenUsed(tokenId) {
  if (!tokenId) return null;
  return ManagerInvitationToken.findOneAndUpdate(
    { _id: tokenId, used: false },
    { $set: { used: true, usedAt: new Date() } },
    { new: true }
  ).lean();
}

export { hashInvitationToken };
