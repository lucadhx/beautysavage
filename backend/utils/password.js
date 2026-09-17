import crypto from 'node:crypto';
import argon2 from 'argon2';

const PWD_PEPPER_ENV = 'PWD_PEPPER';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 2 ** 16,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32
};

function getPepperKey() {
  const pepperKey = process.env[PWD_PEPPER_ENV];
  if (!pepperKey) {
    console.warn(`${PWD_PEPPER_ENV} manquant dans .env - impossible de deriver les mots de passe.`);
    throw new Error(`${PWD_PEPPER_ENV} requis`);
  }
  return pepperKey;
}

function buildPepperedBuffer(password) {
  const pepperKey = getPepperKey();
  const hmac = crypto.createHmac('sha256', pepperKey);
  hmac.update(String(password));
  return hmac.digest();
}

/**
 * Hash a raw password using pepper + salt + argon2id.
 */
export async function hashPassword(password) {
  const peppered = buildPepperedBuffer(password);
  const salt = crypto.randomBytes(16);
  const rawHash = await argon2.hash(peppered, {
    ...ARGON2_OPTIONS,
    salt,
    raw: true
  });
  return {
    salt: salt.toString('hex'),
    hash: rawHash.toString('hex')
  };
}

/**
 * Verify a password against a stored hash and salt.
 */
export async function verifyPassword(hash, salt, password) {
  if (!hash || !salt) return false;
  const peppered = buildPepperedBuffer(password);
  const saltBuffer = Buffer.from(salt, 'hex');
  const computed = await argon2.hash(peppered, {
    ...ARGON2_OPTIONS,
    salt: saltBuffer,
    raw: true
  });
  const stored = Buffer.from(hash, 'hex');
  if (stored.length !== computed.length) return false;
  return crypto.timingSafeEqual(stored, computed);
}
