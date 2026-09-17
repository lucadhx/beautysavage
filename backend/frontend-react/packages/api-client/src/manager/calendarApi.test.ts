// M10 — Client API calendrier global : endpoints, mapping actions, report non supporté.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  listCalendarItems,
  cancelBooking,
  markBalancePaid,
  rescheduleBooking,
  RESCHEDULE_SUPPORTED,
} from './calendar';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
const calls: { url: string; method: string }[] = [];
function installFetch() {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method || 'GET' });
    if (String(url).includes('/calendar/items')) return json({ ok: true, items: [{ id: 'a', type: 'service_booking' }] });
    return json({ ok: true });
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe('calendar api-client (M10)', () => {
  it('listCalendarItems appelle /api/gestion/calendar/items avec la plage', async () => {
    installFetch();
    const items = await listCalendarItems({ startDate: '2026-06-01T00:00:00Z', endDate: '2026-06-02T00:00:00Z', type: 'formation_session' });
    expect(items.length).toBe(1);
    expect(calls[0].url).toContain('/api/gestion/calendar/items');
    expect(calls[0].url).toContain('type=formation_session');
  });

  it('cancelBooking → POST /bookings/:id/cancel', async () => {
    installFetch();
    await cancelBooking('BKG-1', 'raison');
    expect(calls[0]).toMatchObject({ method: 'POST' });
    expect(calls[0].url).toContain('/api/gestion/bookings/BKG-1/cancel');
  });

  it('markBalancePaid → POST /bookings/:id/balance-paid', async () => {
    installFetch();
    await markBalancePaid('BKG-2');
    expect(calls[0]).toMatchObject({ method: 'POST' });
    expect(calls[0].url).toContain('/api/gestion/bookings/BKG-2/balance-paid');
  });

  it('M11B — rescheduleBooking → POST /bookings/:id/reschedule (report admin global)', async () => {
    installFetch();
    expect(RESCHEDULE_SUPPORTED).toBe(true);
    await rescheduleBooking('BKG-3', { newStartAt: '2026-07-01T14:00', newEndAt: '2026-07-01T15:00', reason: 'r' });
    expect(calls[0]).toMatchObject({ method: 'POST' });
    expect(calls[0].url).toContain('/api/gestion/bookings/BKG-3/reschedule');
  });
});
