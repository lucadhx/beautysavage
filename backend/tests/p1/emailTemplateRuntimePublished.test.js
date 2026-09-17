// tests/p1/emailTemplateRuntimePublished.test.js
// mailService.loadTemplate serves the PUBLISHED version; falls back to a legacy
// doc (no status) and to the generated default; never serves a draft/archived.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import EmailTemplate from '../../models/EmailTemplate.js';
import { loadTemplate } from '../../services/mailService.js';
import { createDraftFromPublished, publishDraft } from '../../services/emailTemplateVersioningService.js';

describe('email template runtime (published)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await EmailTemplate.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await EmailTemplate.syncIndexes(); });

  it('loadTemplate returns the published version', async () => {
    await EmailTemplate.create({ functionName: 'vente', status: 'published', version: 1, subject: 'PublishedSubject', bodyHtml: '<p>b</p>', fullHtml: '<p>f</p>' });
    const tpl = await loadTemplate('vente');
    expect(tpl.subject).toBe('PublishedSubject');
  });

  it('loadTemplate falls back to a legacy doc (no status) — content unchanged', async () => {
    await EmailTemplate.collection.insertOne({ functionName: 'vente', subject: 'LegacySubject', bodyHtml: '<p>x</p>', fullHtml: '<p>x</p>', mode: 'text' });
    const tpl = await loadTemplate('vente');
    expect(tpl.subject).toBe('LegacySubject');
  });

  it('loadTemplate generates the default when no doc exists', async () => {
    const tpl = await loadTemplate('vente');
    expect(tpl).toBeTruthy();
    expect(tpl.functionName).toBe('vente');
    expect(String(tpl.subject || '').length).toBeGreaterThan(0); // default subject
  });

  it('a draft does NOT affect the runtime until published', async () => {
    await EmailTemplate.create({ functionName: 'vente', status: 'published', version: 1, subject: 'Live', bodyHtml: '<p>b</p>', fullHtml: '<p>f</p>' });
    const draft = await createDraftFromPublished('vente', { subject: 'NotLiveYet' }, 'dev');
    expect((await loadTemplate('vente')).subject).toBe('Live'); // unchanged
    await publishDraft(draft._id, 'dev');
    expect((await loadTemplate('vente')).subject).toBe('NotLiveYet'); // now live
  });

  it('an archived version is never served', async () => {
    await EmailTemplate.create({ functionName: 'vente', status: 'archived', version: 1, subject: 'Archived' });
    await EmailTemplate.create({ functionName: 'vente', status: 'published', version: 2, subject: 'Current' });
    expect((await loadTemplate('vente')).subject).toBe('Current');
  });
});
