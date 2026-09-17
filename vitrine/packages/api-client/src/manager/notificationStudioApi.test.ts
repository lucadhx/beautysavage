import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  listNotificationCategories, createNotificationCategory, updateNotificationCategory, deleteNotificationCategory,
} from './notificationCategories';
import {
  listNotificationTemplates, getNotificationTemplate, listNotificationTemplateVersions,
  createNotificationTemplate, createNotificationTemplateDraft, publishNotificationTemplateDraft,
  archiveNotificationTemplateDraft, rollbackNotificationTemplate, previewNotificationTemplate,
} from './notificationTemplates';

let lastUrl = '';
let lastInit: RequestInit | undefined;
function mockFetch(payload: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    lastUrl = String(url); lastInit = init;
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe('notification categories api-client (M7)', () => {
  it('CRUD cible /api/gestion/dev/notification-categories', async () => {
    mockFetch({ ok: true, categories: [] });
    await listNotificationCategories();
    expect(lastUrl).toContain('/api/gestion/dev/notification-categories');

    mockFetch({ ok: true, category: { id: 'c1', name: 'Paiement', slug: 'paiement' } });
    const c = await createNotificationCategory({ name: 'Paiement' });
    expect(lastInit?.method).toBe('POST');
    expect(c.slug).toBe('paiement');

    mockFetch({ ok: true, category: { id: 'c1', name: 'Paiement', slug: 'paiement', active: false } });
    await updateNotificationCategory('c1', { active: false });
    expect(lastUrl).toContain('/notification-categories/c1');
    expect(lastInit?.method).toBe('PUT');

    mockFetch({ ok: true, id: 'c1' });
    await deleteNotificationCategory('c1');
    expect(lastInit?.method).toBe('DELETE');
  });
});

describe('notification templates api-client (M7)', () => {
  it('endpoints + jamais de scope/targetRole dans le client', async () => {
    mockFetch({ ok: true, templates: [{ templateKey: 'new_sale' }] });
    const list = await listNotificationTemplates();
    expect(lastUrl).toContain('/api/gestion/dev/notification-templates');
    expect(list[0].templateKey).toBe('new_sale');

    mockFetch({ ok: true, template: { templateKey: 'new_sale', title: 'T', body: 'B', priority: 'high' } });
    const t = await getNotificationTemplate('new_sale');
    expect(t?.priority).toBe('high');

    mockFetch({ ok: true, versions: [] });
    await listNotificationTemplateVersions('new_sale');
    expect(lastUrl).toContain('/new_sale/versions');

    mockFetch({ ok: true, template: { templateKey: 'new_sale', title: 'T', body: 'B' } });
    await createNotificationTemplate('new_sale', { title: 'T', body: 'B', priority: 'high', persistent: true, action: 'commission_details' });
    expect(lastInit?.method).toBe('POST');
    const body = JSON.parse(String(lastInit?.body));
    expect(body).not.toHaveProperty('targetRole');
    expect(body).not.toHaveProperty('scope');
    expect(body.persistent).toBe(true);
    expect(body.action).toBe('commission_details');

    mockFetch({ ok: true, draft: { id: 'd1', templateKey: 'new_sale', version: 2, status: 'draft' } });
    const d = await createNotificationTemplateDraft('new_sale', { title: 'T2' });
    expect(lastUrl).toContain('/new_sale/draft');
    expect(d.id).toBe('d1');

    mockFetch({ ok: true, published: { id: 'd1', version: 2, status: 'published' } });
    await publishNotificationTemplateDraft('d1');
    expect(lastUrl).toContain('/drafts/d1/publish');

    mockFetch({ ok: true, archived: { id: 'd1', status: 'archived' } });
    await archiveNotificationTemplateDraft('d1');
    expect(lastUrl).toContain('/drafts/d1/archive');

    mockFetch({ ok: true, published: { templateKey: 'new_sale', version: 3, status: 'published' } });
    await rollbackNotificationTemplate('new_sale', 1);
    expect(lastUrl).toContain('/new_sale/rollback/1');
  });

  it('previewNotificationTemplate (front) interpole + détecte inconnues, aucune notif réelle', () => {
    const p = previewNotificationTemplate({ title: 'Vente {{amount}}', body: '{{saleid}} / {{weird}}', variables: { amount: '80 €', saleid: 'S-1' } });
    expect(p.title).toBe('Vente 80 €');
    expect(p.body).toContain('S-1');
    expect(p.body).toContain('{{weird}}');
    expect(p.unknownVariables).toContain('weird');
  });
});
