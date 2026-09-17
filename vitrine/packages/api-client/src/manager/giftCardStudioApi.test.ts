// M13 — Client API Gift Card Template Studio (dev) + librairie admin + notes + réservation manuelle.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  listGiftCardStudioTemplates,
  createGiftCardTemplateDraft,
  updateGiftCardTemplateDraft,
  publishGiftCardTemplateDraft,
  rollbackGiftCardTemplate,
  previewGiftCardTemplate,
} from './giftCardTemplates';
import {
  listGiftCardLibrary,
  getActiveGiftCardTemplate,
  previewGiftCardLibraryTemplate,
  activateGiftCardLibraryTemplate,
} from './giftCardLibrary';
import { listCustomerNotes, createCustomerNote } from './customerNotes';
import {
  listBookableServices,
  getAvailabilitySlots,
  holdBookingSlot,
  releaseBookingSlot,
  createManualBooking,
} from './manualBooking';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
const calls: { url: string; method: string; body: unknown }[] = [];
function installFetch(payload: unknown, status = 200) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    return json(payload, status);
  }));
}
afterEach(() => vi.unstubAllGlobals());

const TPL = { id: 't1', name: 'Default', slug: 'default', html: '<p>{{code}}</p>', css: '', variables: ['code'], previewData: null, visible: true, active: true, version: 1, status: 'published', isSystemDefault: true, createdBy: '', updatedBy: '' };

describe('giftCardTemplates studio api-client (M13)', () => {
  it('listGiftCardStudioTemplates renvoie templates + variables', async () => {
    installFetch({ ok: true, templates: [TPL], variables: ['code', 'amount'] });
    const res = await listGiftCardStudioTemplates();
    expect(calls[0].url).toContain('/api/gestion/dev/gift-card-templates');
    expect(res.templates.length).toBe(1);
    expect(res.variables).toContain('amount');
  });

  it('createGiftCardTemplateDraft poste sur /:slug/draft', async () => {
    installFetch({ ok: true, template: { ...TPL, status: 'draft', version: 2 } }, 201);
    await createGiftCardTemplateDraft('default', { html: '<p>x</p>' });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/gift-card-templates/default/draft');
  });

  it('updateGiftCardTemplateDraft utilise PATCH /drafts/:id', async () => {
    installFetch({ ok: true, template: { ...TPL, status: 'draft' } });
    await updateGiftCardTemplateDraft('d1', { html: '<p>y</p>' });
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url).toContain('/drafts/d1');
  });

  it('publishGiftCardTemplateDraft poste /drafts/:id/publish', async () => {
    installFetch({ ok: true, template: TPL });
    await publishGiftCardTemplateDraft('d1');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/drafts/d1/publish');
  });

  it('rollbackGiftCardTemplate poste /:slug/rollback/:version', async () => {
    installFetch({ ok: true, template: TPL });
    await rollbackGiftCardTemplate('default', 1);
    expect(calls[0].url).toContain('/default/rollback/1');
  });

  it('previewGiftCardTemplate poste html/css et renvoie le HTML', async () => {
    installFetch({ ok: true, html: '<html>rendered</html>' });
    const html = await previewGiftCardTemplate({ html: '<p>{{code}}</p>', css: '' });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/gift-card-templates/preview');
    expect(html).toContain('rendered');
  });
});

describe('giftCardLibrary api-client (M13)', () => {
  it('listGiftCardLibrary appelle /templates', async () => {
    installFetch({ ok: true, templates: [TPL] });
    const res = await listGiftCardLibrary();
    expect(calls[0].url).toContain('/api/gestion/gift-cards/templates');
    expect(res.length).toBe(1);
  });

  it('getActiveGiftCardTemplate appelle /templates/active', async () => {
    installFetch({ ok: true, template: TPL });
    const res = await getActiveGiftCardTemplate();
    expect(calls[0].url).toContain('/templates/active');
    expect(res?.active).toBe(true);
  });

  it('previewGiftCardLibraryTemplate GET /:id/preview', async () => {
    installFetch({ ok: true, html: '<html>lib</html>' });
    const html = await previewGiftCardLibraryTemplate('t1');
    expect(calls[0].url).toContain('/templates/t1/preview');
    expect(html).toContain('lib');
  });

  it('activateGiftCardLibraryTemplate POST /:id/activate', async () => {
    installFetch({ ok: true, template: TPL });
    await activateGiftCardLibraryTemplate('t1');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/templates/t1/activate');
  });
});

describe('customerNotes api-client (M13)', () => {
  it('listCustomerNotes GET /:id/notes', async () => {
    installFetch({ ok: true, notes: [{ id: 'n1', body: 'hello', authorRole: 'admin', authorLabel: 'a@b.c', createdAt: null }] });
    const res = await listCustomerNotes('c1');
    expect(calls[0].url).toContain('/api/gestion/customers/c1/notes');
    expect(res.length).toBe(1);
  });

  it('createCustomerNote POST body', async () => {
    installFetch({ ok: true, note: { id: 'n1', body: 'hi', authorRole: 'admin', authorLabel: '', createdAt: null } }, 201);
    await createCustomerNote('c1', 'hi');
    expect(calls[0].method).toBe('POST');
    expect((calls[0].body as { body: string }).body).toBe('hi');
  });
});

describe('manualBooking api-client (M13)', () => {
  it('listBookableServices filtre les non réservables', async () => {
    installFetch({ ok: true, services: [
      { id: 's1', name: 'Soin', duration: 60, price: 80, isBookable: true, options: [] },
      { id: 's2', name: 'Produit', duration: 0, price: 10, isBookable: false, options: [] },
    ] });
    const res = await listBookableServices();
    expect(res.length).toBe(1);
    expect(res[0].id).toBe('s1');
  });

  it('getAvailabilitySlots passe serviceId + date', async () => {
    installFetch({ ok: true, slots: [{ start: '2026-07-01T10:00', end: '2026-07-01T11:00' }] });
    const res = await getAvailabilitySlots('s1', '2026-07-01');
    expect(calls[0].url).toContain('/api/vitrine/availability/slots');
    expect(calls[0].url).toContain('serviceId=s1');
    expect(res.length).toBe(1);
  });

  it('holdBookingSlot POST /bookings/hold renvoie hold', async () => {
    installFetch({ ok: true, hold: { holdToken: 'HOLD-1', expiresAt: '2026-07-01T10:05', slotStartAt: '2026-07-01T10:00', slotEndAt: '2026-07-01T11:00' } }, 201);
    const hold = await holdBookingSlot('s1', '2026-07-01T10:00');
    expect(calls[0].url).toContain('/bookings/hold');
    expect(hold.holdToken).toBe('HOLD-1');
  });

  it('releaseBookingSlot POST /bookings/hold/release', async () => {
    installFetch({ ok: true, released: 60 });
    const n = await releaseBookingSlot('HOLD-1');
    expect(calls[0].url).toContain('/bookings/hold/release');
    expect(n).toBe(60);
  });

  it('createManualBooking POST /bookings/manual avec holdToken', async () => {
    installFetch({ ok: true, booking: { bookingId: 'BKG-1', startAt: '2026-07-01T10:00' }, paymentMode: 'on_site', balanceDueAmount: 80 }, 201);
    const res = await createManualBooking({ clientId: 'c1', serviceId: 's1', startAt: '2026-07-01T10:00', holdToken: 'HOLD-1' });
    expect(calls[0].url).toContain('/bookings/manual');
    expect(res.paymentMode).toBe('on_site');
    expect((calls[0].body as { holdToken: string }).holdToken).toBe('HOLD-1');
  });
});
