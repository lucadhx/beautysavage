import { describe, it, expect, afterEach, vi } from 'vitest';
import { createCheckoutSession, finalizeFreeCheckout, buildServiceCheckoutState, buildIdempotencyKey } from './checkout';
import { ApiError } from '../types';
import type { CheckoutLine, LegalConsentState } from '../booking/types';

function mockFetch(payload: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })),
  );
}
afterEach(() => vi.unstubAllGlobals());

const line: CheckoutLine = {
  kind: 'service',
  refId: 's1',
  slug: 'soin',
  name: 'Soin',
  service: { serviceId: 's1', slotStart: '2026-07-01T14:00', slotEnd: '2026-07-01T14:30', practitionerId: 'p1', selectedOptions: [] },
};
const legal: LegalConsentState = { acceptedCgv: true, acknowledgedRetractation: false, acknowledgedDatedService: true };

describe('buildServiceCheckoutState', () => {
  it('mappe la ligne prestation + consentements, sans montant', () => {
    const st = buildServiceCheckoutState(line, legal)!;
    expect(st.item).toEqual({ type: 'service', id: 's1', name: 'Soin' });
    expect(st.service).toMatchObject({ serviceId: 's1', practitionerId: 'p1', slotStart: '2026-07-01T14:00' });
    expect(st.legal.acceptedCgv).toBe(true);
    expect(st.legal.waiverAccepted).toBe(true);
    expect('totals' in st).toBe(false); // jamais de montant autoritaire
  });
  it('renvoie null pour une ligne non-service', () => {
    expect(buildServiceCheckoutState({ kind: 'product', refId: 'p', name: 'P' }, legal)).toBeNull();
  });
  it('M11A — ne dépend pas du prestataire : payload construit même sans practitionerId', () => {
    const lineNoPract: CheckoutLine = {
      kind: 'service',
      refId: 's1',
      slug: 'soin',
      name: 'Soin',
      service: { serviceId: 's1', slotStart: '2026-07-01T14:00', slotEnd: '2026-07-01T14:30', practitionerId: null, selectedOptions: [] },
    };
    const st = buildServiceCheckoutState(lineNoPract, legal)!;
    expect(st.service.serviceId).toBe('s1');
    expect(st.service.slotStart).toBe('2026-07-01T14:00');
    expect(st.service.practitionerId).toBeNull(); // legacy, ignoré côté serveur
  });
});

describe('buildIdempotencyKey', () => {
  it('produit une clé alphanumérique 8-128', () => {
    const k = buildIdempotencyKey('s1-2026-07-01T14:00');
    expect(k).toMatch(/^[a-zA-Z0-9]+$/);
    expect(k.length).toBeGreaterThanOrEqual(8);
    expect(k.length).toBeLessThanOrEqual(128);
  });
});

describe('createCheckoutSession', () => {
  it('parse une réponse hosted', async () => {
    mockFetch({ ok: true, mode: 'hosted', url: 'https://stripe/cs_x', checkoutId: 'c1' });
    const res = await createCheckoutSession(buildServiceCheckoutState(line, legal)!);
    expect(res).toEqual({ ok: true, mode: 'hosted', url: 'https://stripe/cs_x', checkoutId: 'c1' });
  });
  it('parse une réponse free', async () => {
    mockFetch({ ok: true, mode: 'free', checkoutId: 'c2', requiresPayment: false });
    const res = await createCheckoutSession(buildServiceCheckoutState(line, legal)!);
    expect(res).toMatchObject({ mode: 'free', requiresPayment: false });
  });
  it('détecte le mode elements (flag OFF, clientSecret)', async () => {
    mockFetch({ ok: true, clientSecret: 'pi_secret', returnUrl: '/x' });
    const res = await createCheckoutSession(buildServiceCheckoutState(line, legal)!);
    expect(res.mode).toBe('elements');
  });
  it('propage une ApiError sur 400 (code)', async () => {
    mockFetch({ ok: false, error: 'CGV', code: 'LEGAL_VALIDATION_REQUIRED' }, 400);
    await expect(createCheckoutSession(buildServiceCheckoutState(line, legal)!)).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'LEGAL_VALIDATION_REQUIRED',
    });
  });
});

describe('finalizeFreeCheckout', () => {
  it('renvoie saleId', async () => {
    mockFetch({ ok: true, saleId: 'sale1' });
    const res = await finalizeFreeCheckout(buildServiceCheckoutState(line, legal)!, 'freeKey12345');
    expect(res.saleId).toBe('sale1');
  });
  it('401 → ApiError 401', async () => {
    mockFetch({ ok: false, error: 'Authentification requise.' }, 401);
    const err = await finalizeFreeCheckout(buildServiceCheckoutState(line, legal)!).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
  });
});
