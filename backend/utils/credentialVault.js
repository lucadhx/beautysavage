// utils/credentialVault.js
// Minimal AES-256-GCM credential vault.
//
// Stores third-party API secrets encrypted at rest. Symmetric authenticated
// encryption (GCM) so any tampering of the ciphertext is detected at decrypt.
//
// Key: env CREDENTIAL_VAULT_KEY = 64 hex chars (32 bytes / 256 bits).
//   POLITIQUE UNIFORME (S1C) — IDENTIQUE dans TOUS les environnements (aucun if NODE_ENV) :
//   le backend REFUSE de démarrer si la clé est absente/invalide (validateCredentialVaultKey throws).
//   - tests  : injectent leur propre clé (tests/setup/testEnv.js).
//   - dev    : le développeur fournit sa clé locale.
//   - prod   : la production fournit sa clé de production.
//
// Storage format: "ivB64.authTagB64.ciphertextB64" (separator '.' is outside base64).
//
// The *WithKey variants take an explicit key (used by the rotation script). The
// default encrypt/decrypt delegate to the env key (CREDENTIAL_VAULT_KEY).
//
// SECURITY: never log a decrypted value; only slug/role/generic messages elsewhere.

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce recommended for GCM
const KEY_ENV = 'CREDENTIAL_VAULT_KEY';
const SENTINEL_PREFIX = '__UNFILLED';

function readKeyHex() {
  return String(process.env[KEY_ENV] || '').trim();
}

export function isValidKeyHex(hex) {
  return /^[0-9a-fA-F]{64}$/.test(String(hex || ''));
}

/**
 * Validate the vault key at boot. Politique UNIFORME : aucune logique d'environnement.
 * @returns {boolean} true if a valid key is present (sinon throw — jamais de retour false).
 * @throws {Error} when the key is absent/invalid (blocks boot, in EVERY environment).
 */
export function validateCredentialVaultKey() {
  const hex = readKeyHex();
  if (isValidKeyHex(hex)) {
    console.log('[credentialVault] CREDENTIAL_VAULT_KEY present and valid.');
    return true;
  }
  throw new Error(
    `[credentialVault] ${KEY_ENV} is missing or not a 64-char hex string (32 bytes). Refusing to boot.`
  );
}

function keyBufferFromHex(hex, label = KEY_ENV) {
  if (!isValidKeyHex(hex)) {
    throw new Error(`[credentialVault] ${label} missing or invalid (need 64 hex chars).`);
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a plaintext credential with an explicit key.
 * @param {string} value
 * @param {string} keyHex 64 hex chars
 * @returns {string} "iv.authTag.ciphertext" (base64 segments)
 */
export function encryptCredentialWithKey(value, keyHex, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('[credentialVault] encryptCredential expects a non-empty string.');
  }
  const key = keyBufferFromHex(keyHex, label);
  const iv = crypto.randomBytes(IV_LENGTH); // random IV per encryption (never reuse with GCM)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${authTag.toString('base64')}.${encrypted.toString('base64')}`;
}

/**
 * Decrypt a stored credential with an explicit key.
 * @param {string} encryptedValue "iv.authTag.ciphertext"
 * @param {string} keyHex 64 hex chars
 * @returns {string} plaintext
 * @throws {Error} on bad format, tampering, wrong key, or invalid key
 */
export function decryptCredentialWithKey(encryptedValue, keyHex, label) {
  if (typeof encryptedValue !== 'string') {
    throw new Error('[credentialVault] decryptCredential expects a string.');
  }
  const parts = encryptedValue.split('.');
  if (parts.length !== 3) {
    throw new Error('[credentialVault] invalid encrypted format (expected 3 segments).');
  }
  const key = keyBufferFromHex(keyHex, label);
  const [ivB64, authTagB64, encB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(encB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]); // throws on tamper/wrong key
  return decrypted.toString('utf8');
}

/** Encrypt with the env key (CREDENTIAL_VAULT_KEY). */
export function encryptCredential(value) {
  return encryptCredentialWithKey(value, readKeyHex());
}

/** Decrypt with the env key (CREDENTIAL_VAULT_KEY). */
export function decryptCredential(encryptedValue) {
  return decryptCredentialWithKey(encryptedValue, readKeyHex());
}

/** True if a decrypted value is a seed placeholder (never to be sent to a provider). */
export function isUnfilledSentinel(value) {
  return typeof value === 'string' && value.startsWith(SENTINEL_PREFIX);
}

/** 4 last clear chars for masked display (••••XXXX). Never the full value. */
export function lastFour(value) {
  const s = String(value || '');
  return s.slice(-4);
}
