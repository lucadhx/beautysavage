import { describe, it, expect, afterEach, vi } from 'vitest';
import { getServiceAvailableSlots, getServiceAvailableDays } from './availability';
import { buildCheckoutPreparationPayload } from './checkoutPreparation';
import { isLegalConsentComplete, EMPTY_LEGAL_CONSENT } from './legalConsents';
import type { CheckoutLine } from './types';

function mockFetch(payload: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe('availability client', () => {
  it('mappe les créneaux (start/end/practitionerId)', async () => {
    mockFetch({ ok: true, slots: [{ start: '2026-07-01T14:00', end: '2026-07-01T14:30', practitionerId: 'p1' }] });
    const slots = await getServiceAvailableSlots({ serviceId: 's1', date: '2026-07-01' });
    expect(slots).toEqual([{ start: '2026-07-01T14:00', end: '2026-07-01T14:30', practitionerId: 'p1' }]);
  });
  it('mappe les jours disponibles', async () => {
    mockFetch({ ok: true, availableDays: ['2026-07-01', '2026-07-02'] });
    const days = await getServiceAvailableDays({ serviceId: 's1', year: 2026, month: 7 });
    expect(days).toEqual(['2026-07-01', '2026-07-02']);
  });
});

describe('isLegalConsentComplete', () => {
  it('exige la CGV, et les acks requis', () => {
    expect(isLegalConsentComplete(EMPTY_LEGAL_CONSENT)).toBe(false);
    expect(isLegalConsentComplete({ ...EMPTY_LEGAL_CONSENT, acceptedCgv: true })).toBe(true);
    expect(
      isLegalConsentComplete({ ...EMPTY_LEGAL_CONSENT, acceptedCgv: true }, { datedService: true }),
    ).toBe(false);
    expect(
      isLegalConsentComplete(
        { ...EMPTY_LEGAL_CONSENT, acceptedCgv: true, acknowledgedDatedService: true },
        { datedService: true },
      ),
    ).toBe(true);
  });
});

describe('buildCheckoutPreparationPayload', () => {
  it('extrait la prestation + les consentements, sans réseau', () => {
    const lines: CheckoutLine[] = [
      {
        kind: 'service',
        refId: 's1',
        slug: 'soin',
        name: 'Soin',
        service: { serviceId: 's1', slotStart: '2026-07-01T14:00', slotEnd: '2026-07-01T14:30', practitionerId: 'p1', selectedOptions: [] },
      },
    ];
    const payload = buildCheckoutPreparationPayload({
      lines,
      legal: { ...EMPTY_LEGAL_CONSENT, acceptedCgv: true, waiverAccepted: true, waiverType: 'service-dated', acceptedAt: '2026-06-28T10:00:00Z' },
      preparedAt: '2026-06-28T10:00:00Z',
    });
    expect(payload.itemType).toBe('service');
    expect(payload.service?.serviceId).toBe('s1');
    expect(payload.service?.slotStart).toBe('2026-07-01T14:00');
    expect(payload.legal.acceptedCgv).toBe(true);
    expect(payload.legal.waiverType).toBe('service-dated');
    expect(payload.version).toBe(1);
  });
});
