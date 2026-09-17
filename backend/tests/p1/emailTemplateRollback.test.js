// tests/p1/emailTemplateRollback.test.js
// rollbackToVersion copies an older version into a new published version (archiving
// the current one) — full, reversible history, never overwriting a published doc.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import EmailTemplate from '../../models/EmailTemplate.js';
import { loadTemplate } from '../../services/mailService.js';
import {
  createDraftFromPublished,
  publishDraft,
  rollbackToVersion,
  getPublishedTemplate
} from '../../services/emailTemplateVersioningService.js';

describe('email template rollback', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await EmailTemplate.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await EmailTemplate.syncIndexes(); });

  it('rolls back to an older version (new published copy, old archived)', async () => {
    // v1 published = "A"
    await EmailTemplate.create({ functionName: 'vente', status: 'published', version: 1, subject: 'A', bodyHtml: '<p>A</p>', fullHtml: '<p>A</p>' });
    // publish v2 = "B"
    const draftB = await createDraftFromPublished('vente', { subject: 'B', bodyHtml: '<p>B</p>', fullHtml: '<p>B</p>' }, 'dev');
    await publishDraft(draftB._id, 'dev');
    expect((await loadTemplate('vente')).subject).toBe('B');

    // rollback to version 1 ("A")
    const published = await rollbackToVersion('vente', 1, 'dev');
    expect(published.status).toBe('published');
    expect(published.subject).toBe('A'); // content of v1 restored
    expect((await loadTemplate('vente')).subject).toBe('A');

    // exactly one published; v2 archived
    expect(await EmailTemplate.countDocuments({ functionName: 'vente', status: 'published' })).toBe(1);
    const v2 = await EmailTemplate.findOne({ functionName: 'vente', version: 2 }).lean();
    expect(v2.status).toBe('archived');
    // the restored content lives in a NEW version (history preserved)
    expect(published.version).toBeGreaterThan(2);
  });

  it('rollback to a missing version throws (no change)', async () => {
    await EmailTemplate.create({ functionName: 'vente', status: 'published', version: 1, subject: 'A' });
    await expect(rollbackToVersion('vente', 99, 'dev')).rejects.toThrow(/introuvable/i);
    expect((await getPublishedTemplate('vente')).subject).toBe('A');
  });
});
