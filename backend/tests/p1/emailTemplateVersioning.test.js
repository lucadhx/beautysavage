// tests/p1/emailTemplateVersioning.test.js
// Migration to v1 published, single-published invariant, draft/publish lifecycle,
// and content sanitization. CONTENT IS NEVER CHANGED by migration.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import EmailTemplate from '../../models/EmailTemplate.js';
import { migrateEmailTemplatesToVersioning } from '../../scripts/migrateEmailTemplatesToVersioning.js';
import {
  createDraftFromPublished,
  publishDraft,
  getPublishedTemplate
} from '../../services/emailTemplateVersioningService.js';

describe('email template versioning', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await EmailTemplate.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await EmailTemplate.syncIndexes(); });

  it('migration sets legacy docs to v1 published WITHOUT changing content', async () => {
    // Insert a legacy doc (no status) bypassing Mongoose defaults.
    await EmailTemplate.collection.insertOne({
      functionName: 'vente', subject: 'LegacyContent', bodyHtml: '<p>legacy</p>', fullHtml: '<p>legacy</p>', mode: 'text', createdAt: new Date(), updatedAt: new Date()
    });
    const before = await EmailTemplate.findOne({ functionName: 'vente' }).lean();
    expect(before.status).toBeUndefined();

    const summary = await migrateEmailTemplatesToVersioning({ apply: true });
    expect(summary.migrated).toBe(1);

    const after = await EmailTemplate.findOne({ functionName: 'vente' }).lean();
    expect(after.status).toBe('published');
    expect(after.version).toBe(1);
    expect(after.subject).toBe('LegacyContent'); // unchanged
    expect(after.bodyHtml).toBe('<p>legacy</p>');
  });

  it('migration dry-run reports but does not persist', async () => {
    await EmailTemplate.collection.insertOne({ functionName: 'vente', subject: 'L', mode: 'text' });
    const summary = await migrateEmailTemplatesToVersioning({ apply: false });
    expect(summary.migrated).toBe(1);
    const doc = await EmailTemplate.findOne({ functionName: 'vente' }).lean();
    expect(doc.status).toBeUndefined(); // not persisted
  });

  it('only one published version per functionName (partial unique index)', async () => {
    await EmailTemplate.create({ functionName: 'vente', status: 'published', version: 1, subject: 'A' });
    await expect(
      EmailTemplate.create({ functionName: 'vente', status: 'published', version: 2, subject: 'B' })
    ).rejects.toBeTruthy();
  });

  it('create draft does NOT change the published runtime; publish does; old is archived', async () => {
    await EmailTemplate.create({ functionName: 'vente', status: 'published', version: 1, subject: 'Published', bodyHtml: '<p>pub</p>', fullHtml: '<p>pub</p>' });

    const draft = await createDraftFromPublished('vente', { subject: 'Draft', bodyHtml: '<p>draft</p>', fullHtml: '<p>draft</p>' }, 'dev');
    expect(draft.status).toBe('draft');
    expect(draft.version).toBe(2);
    // runtime still on the published version
    expect((await getPublishedTemplate('vente')).subject).toBe('Published');

    await publishDraft(draft._id, 'dev');
    expect((await getPublishedTemplate('vente')).subject).toBe('Draft');
    const old = await EmailTemplate.findOne({ functionName: 'vente', version: 1 }).lean();
    expect(old.status).toBe('archived');
    expect(old.archivedAt).toBeTruthy();
    // exactly one published
    expect(await EmailTemplate.countDocuments({ functionName: 'vente', status: 'published' })).toBe(1);
  });

  it('draft content is sanitized (no <script>, no inline handlers)', async () => {
    await EmailTemplate.create({ functionName: 'vente', status: 'published', version: 1, subject: 'P' });
    const draft = await createDraftFromPublished('vente', {
      bodyHtml: '<p>ok</p><script>alert(1)</script>',
      fullHtml: '<p>ok</p><script>steal()</script><a onclick="x()">l</a>'
    }, 'dev');
    expect(draft.bodyHtml.toLowerCase()).not.toContain('<script');
    expect(draft.fullHtml.toLowerCase()).not.toContain('<script');
    expect(draft.fullHtml.toLowerCase()).not.toContain('onclick');
  });
});
