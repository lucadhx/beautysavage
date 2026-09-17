import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  listMailTemplates,
  getMailTemplate,
  listMailTemplateVersions,
  createMailTemplateDraft,
  publishMailTemplateDraft,
  archiveMailTemplateDraft,
  rollbackMailTemplate,
  previewMailTemplate,
  getTemplateRoleBinding,
} from './mailTemplates';

let lastUrl = '';
let lastInit: RequestInit | undefined;
function mockFetch(payload: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      lastUrl = String(url);
      lastInit = init;
      return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe('mailTemplates api-client (M6)', () => {
  it('listMailTemplates aplatit les groupes', async () => {
    mockFetch({ ok: true, groups: [{ templates: [{ functionName: 'vente' }] }, { templates: [{ functionName: 'refund_confirmed' }] }] });
    const list = await listMailTemplates();
    expect(lastUrl).toContain('/api/gestion/mails/templates');
    expect(list.map((t) => t.functionName)).toEqual(['vente', 'refund_confirmed']);
  });

  it('getMailTemplate passe functionName en query', async () => {
    mockFetch({ ok: true, template: { functionName: 'vente', subject: 'S', bodyHtml: '', fullHtml: '<p>x</p>', mode: 'html' } });
    const t = await getMailTemplate('vente');
    expect(lastUrl).toContain('/api/gestion/mails/template');
    expect(lastUrl).toContain('functionName=vente');
    expect(t?.functionName).toBe('vente');
  });

  it('versions / draft / publish / archive / rollback ciblent les bons endpoints', async () => {
    mockFetch({ ok: true, versions: [] });
    await listMailTemplateVersions('vente');
    expect(lastUrl).toContain('/api/gestion/mails/templates/vente/versions');

    mockFetch({ ok: true, draft: { _id: 'd1', functionName: 'vente', version: 2, status: 'draft' } });
    const d = await createMailTemplateDraft('vente', { subject: 'S', fullHtml: '<p>x</p>' });
    expect(lastUrl).toContain('/api/gestion/mails/templates/vente/draft');
    expect(lastInit?.method).toBe('POST');
    expect(d._id).toBe('d1');

    mockFetch({ ok: true, published: { _id: 'd1', functionName: 'vente', version: 2, status: 'published' } });
    await publishMailTemplateDraft('d1');
    expect(lastUrl).toContain('/api/gestion/mails/drafts/d1/publish');

    mockFetch({ ok: true, archived: { _id: 'd1', version: 2, status: 'archived' } });
    await archiveMailTemplateDraft('d1');
    expect(lastUrl).toContain('/api/gestion/mails/drafts/d1/archive');

    mockFetch({ ok: true, published: { functionName: 'vente', version: 3, status: 'published' } });
    await rollbackMailTemplate('vente', 1);
    expect(lastUrl).toContain('/api/gestion/mails/templates/vente/rollback/1');
  });

  it('getTemplateRoleBinding : rôles only, jamais d’e-mail', () => {
    const b = getTemplateRoleBinding('refund_confirmed');
    expect(b.wired).toBe(true);
    expect(b.fromRole).toBe('commerciale');
    expect(b.toRole).toBe('client');
    expect(b.eventName).toBe('refund.succeeded');
    expect(b.mode).toBe('active');
    expect(JSON.stringify(b)).not.toMatch(/@/);
    const unwired = getTemplateRoleBinding('some_other_template');
    expect(unwired.wired).toBe(false);
    expect(unwired.fromRole).toBeNull();
  });

  it('previewMailTemplate (front) interpole les variables et détecte les inconnues — aucun envoi', async () => {
    // LOT2 §2 — l'aperçu est désormais délégué au BACKEND (POST /preview) : le front n'interpole
    // plus localement. On mocke la réponse du moteur backend (rendu identique à l'envoi réel).
    mockFetch({
      ok: true,
      subject: 'Bonjour Marie',
      html: '<p>Soin — {{unknownvar}}</p>',
      text: '',
      usedVariables: [
        { name: 'firstname', known: true },
        { name: 'servicename', known: true },
        { name: 'unknownvar', known: false },
      ],
      unknownVariables: ['unknownvar'],
    });
    const p = await previewMailTemplate('vente', {
      subject: 'Bonjour {{firstname}}',
      html: '<p>{{servicename}} — {{unknownvar}}</p>',
      text: '',
      variables: { firstname: 'Marie', servicename: 'Soin' },
    });
    expect(lastUrl).toContain('/templates/vente/preview');
    expect(lastInit?.method).toBe('POST');
    expect(p.subject).toBe('Bonjour Marie');
    expect(p.html).toContain('Soin');
    expect(p.html).toContain('{{unknownvar}}'); // inconnue → laissée telle quelle par le backend
    expect(p.unknownVariables).toContain('unknownvar');
    expect(p.usedVariables.find((v) => v.name === 'firstname')?.known).toBe(true);
  });
});
