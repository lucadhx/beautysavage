import crypto from 'node:crypto';
import ResetPasswordToken from '../models/ResetPasswordToken.js';

const TOKEN_EXPIRATION_MINUTES = 30;

function hashResetToken(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function buildExpirationDate() {
  return new Date(Date.now() + TOKEN_EXPIRATION_MINUTES * 60 * 1000);
}

export async function createResetPasswordToken(userId) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashResetToken(rawToken);
  const expiresAt = buildExpirationDate();
  await ResetPasswordToken.create({
    userId,
    tokenHash,
    expiresAt,
    used: false,
    createdAt: new Date()
  });
  return { token: rawToken, expiresAt };
}

export async function loadResetToken(rawToken) {
  if (!rawToken) {
    return null;
  }
  const tokenHash = hashResetToken(rawToken);
  const tokenDoc = await ResetPasswordToken.findOne({ tokenHash }).lean();
  return tokenDoc || null;
}

export function evaluateResetToken(tokenDoc) {
  if (!tokenDoc) {
    return { status: 'invalid' };
  }
  if (tokenDoc.used) {
    return { status: 'used' };
  }
  if (tokenDoc.expiresAt && new Date(tokenDoc.expiresAt).getTime() <= Date.now()) {
    return { status: 'expired' };
  }
  return { status: 'valid' };
}

export async function markResetTokenUsed(tokenId) {
  if (!tokenId) return null;
  const updated = await ResetPasswordToken.findOneAndUpdate(
    { _id: tokenId, used: false },
    { $set: { used: true, usedAt: new Date() } },
    { new: true }
  ).lean();
  return updated;
}

export { hashResetToken };
