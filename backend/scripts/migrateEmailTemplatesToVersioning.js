// scripts/migrateEmailTemplatesToVersioning.js
// Idempotent migration to the versioned EmailTemplate model (Phase 5A).
//
//   - drops the legacy unique index `functionName_1` (allows multiple versions);
//   - ensures the new indexes exist;
//   - sets status='published', version=1 on every existing template that has no
//     status yet (legacy docs). CONTENT IS NEVER MODIFIED.
//
// Usage:
//   node scripts/migrateEmailTemplatesToVersioning.js            # dry-run (default)
//   node scripts/migrateEmailTemplatesToVersioning.js --apply    # persist
//
// Self-heal: app.js runs this in --apply mode at boot (non-test), so a deploy
// normalises the data automatically. mailService also tolerates un-migrated docs
// (status missing == published), so emails are unchanged even before it runs.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import EmailTemplate from '../models/EmailTemplate.js';

export async function migrateEmailTemplatesToVersioning({ apply = false } = {}) {
  const summary = { droppedLegacyIndex: false, inspected: 0, migrated: 0, apply };

  if (apply) {
    try {
      await EmailTemplate.collection.dropIndex('functionName_1');
      summary.droppedLegacyIndex = true;
    } catch (_err) {
      // index already absent — fine
    }
    try {
      await EmailTemplate.syncIndexes();
    } catch (err) {
      console.warn('[migrateEmailTemplates] syncIndexes warning:', err?.message || err);
    }
  }

  // Legacy docs = status missing or null (never touch already-migrated docs).
  const legacy = await EmailTemplate.find({ status: { $in: [null] } }).select('_id createdAt').lean();
  summary.inspected = legacy.length;

  for (const doc of legacy) {
    if (apply) {
      await EmailTemplate.updateOne(
        { _id: doc._id, status: { $in: [null] } },
        { $set: { status: 'published', version: 1, publishedAt: doc.createdAt || new Date() } }
      );
    }
    summary.migrated += 1;
  }

  return summary;
}

export default migrateEmailTemplatesToVersioning;

async function main() {
  const apply = process.argv.includes('--apply');
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error('[migrateEmailTemplates] MONGODB_URI manquant.');
    process.exit(1);
  }
  console.log(`[migrateEmailTemplates] mode=${apply ? 'APPLY' : 'DRY-RUN'}`);
  await mongoose.connect(mongoURI, { dbName: 'beautysavage-database' });
  try {
    const summary = await migrateEmailTemplatesToVersioning({ apply });
    console.log('[migrateEmailTemplates]', JSON.stringify(summary));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch(err => {
    console.error('[migrateEmailTemplates] failed:', err?.message || err);
    process.exit(1);
  });
}
