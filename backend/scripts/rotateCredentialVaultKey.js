// scripts/rotateCredentialVaultKey.js
// Re-encrypt every IntegratedApi.credentials[].encryptedValue from an OLD vault
// key to a NEW vault key.
//
// Usage:
//   OLD_CREDENTIAL_VAULT_KEY=<64hex> NEW_CREDENTIAL_VAULT_KEY=<64hex> \
//     node scripts/rotateCredentialVaultKey.js            # dry-run (default)
//   ... node scripts/rotateCredentialVaultKey.js --apply  # actually persist
//
// SECURITY: never logs a secret value. Per credential it prints only
// integration slug, role, runtime, and status (migrated | skipped | error).
//
// The default mode is dry-run: it verifies every credential can be decrypted with
// the OLD key and re-encrypted with the NEW key, WITHOUT saving. Use --apply to
// persist. Idempotence-friendly: a value already decryptable only by NEW is
// reported as "skipped".

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import IntegratedApi from '../models/IntegratedApi.js';
import {
  isValidKeyHex,
  encryptCredentialWithKey,
  decryptCredentialWithKey
} from '../utils/credentialVault.js';

/**
 * Rotate the vault key across all stored credentials.
 * @param {{ oldKeyHex: string, newKeyHex: string, apply?: boolean }} opts
 * @returns {Promise<{summary: object[], counts: object}>}
 */
export async function rotateVaultKey({ oldKeyHex, newKeyHex, apply = false }) {
  if (!isValidKeyHex(oldKeyHex)) throw new Error('OLD_CREDENTIAL_VAULT_KEY missing or invalid (need 64 hex chars).');
  if (!isValidKeyHex(newKeyHex)) throw new Error('NEW_CREDENTIAL_VAULT_KEY missing or invalid (need 64 hex chars).');

  const summary = [];
  const counts = { migrated: 0, skipped: 0, error: 0 };

  const apis = await IntegratedApi.find({});
  for (const api of apis) {
    let docChanged = false;
    for (const cred of api.credentials || []) {
      const row = { slug: api.slug, role: cred.role, runtime: cred.runtime ?? null, status: 'skipped' };
      let plaintext = null;
      try {
        plaintext = decryptCredentialWithKey(cred.encryptedValue, oldKeyHex, 'OLD_CREDENTIAL_VAULT_KEY');
      } catch (_oldErr) {
        // Not decryptable with OLD key. If it already decrypts with NEW, it's
        // already rotated → skip. Otherwise it's a real error.
        try {
          decryptCredentialWithKey(cred.encryptedValue, newKeyHex, 'NEW_CREDENTIAL_VAULT_KEY');
          row.status = 'skipped'; // already on the new key
        } catch (_newErr) {
          row.status = 'error'; // decryptable by neither key
        }
        summary.push(row);
        counts[row.status] += 1;
        continue;
      }

      try {
        const reEncrypted = encryptCredentialWithKey(plaintext, newKeyHex, 'NEW_CREDENTIAL_VAULT_KEY');
        if (apply) {
          cred.encryptedValue = reEncrypted;
          cred.updatedAt = new Date();
          docChanged = true;
        }
        row.status = 'migrated';
      } catch (_encErr) {
        row.status = 'error';
      } finally {
        // Never keep the plaintext around.
        plaintext = null;
      }
      summary.push(row);
      counts[row.status] += 1;
    }
    if (apply && docChanged) {
      await api.save();
    }
  }

  return { summary, counts };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const oldKeyHex = String(process.env.OLD_CREDENTIAL_VAULT_KEY || '').trim();
  const newKeyHex = String(process.env.NEW_CREDENTIAL_VAULT_KEY || '').trim();
  const mongoURI = process.env.MONGODB_URI;

  if (!mongoURI) {
    console.error('[rotate] MONGODB_URI manquant.');
    process.exit(1);
  }

  console.log(`[rotate] mode=${apply ? 'APPLY' : 'DRY-RUN'} (use --apply to persist)`);
  await mongoose.connect(mongoURI, { dbName: 'beautysavage-database' });
  try {
    const { summary, counts } = await rotateVaultKey({ oldKeyHex, newKeyHex, apply });
    for (const row of summary) {
      // No secret value is ever printed.
      console.log(`[rotate] ${row.slug} / ${row.role} / runtime=${row.runtime ?? 'null'} -> ${row.status}`);
    }
    console.log(`[rotate] done: migrated=${counts.migrated} skipped=${counts.skipped} error=${counts.error}`);
    if (counts.error > 0) process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }
}

// Run only when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch(err => {
    console.error('[rotate] failed:', err?.message || err);
    process.exit(1);
  });
}

export default rotateVaultKey;
// Touch pathToFileURL import usage to avoid unused warnings in some linters.
export const __selfUrl = pathToFileURL(fileURLToPath(import.meta.url)).href;
