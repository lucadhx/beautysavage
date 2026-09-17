// M11B — Client API report admin global : rescheduleBooking poste le bon payload et propage les
// erreurs backend (ApiError).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { rescheduleBooking, RESCHEDULE_SUPPORTED } from './calendar';
import { ApiError } from '../types';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
let lastBody: Record<string, unknown> | null = null;
function installFetch(payload: unknown, status = 200) {
  lastBody = null;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.body) lastBody = JSON.parse(String(init.body));
    return json(payload, status);
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe('rescheduleBooking (M11B)', () => {
  it('expose RESCHEDULE_SUPPORTED = true', () => {
    expect(RESCHEDULE_SUPPORTED).toBe(true);
  });

  it('poste newStartAt/newEndAt/reason et renvoie le booking déplacé', async () => {
    installFetch({ ok: true, booking: { bookingId: 'BKG-9', startAt: '2026-07-01T14:00', endAt: '2026-07-01T15:00', status: 'confirmed' } });
    const res = await rescheduleBooking('BKG-9', { newStartAt: '2026-07-01T14:00', newEndAt: '2026-07-01T15:00', reason: 'Convenance' });
    expect(res.ok).toBe(true);
    expect(res.booking?.bookingId).toBe('BKG-9');
    expect(lastBody).toEqual({ newStartAt: '2026-07-01T14:00', newEndAt: '2026-07-01T15:00', reason: 'Convenance' });
  });

  it('omet reason quand absent', async () => {
    installFetch({ ok: true });
    await rescheduleBooking('BKG-9', { newStartAt: '2026-07-01T14:00', newEndAt: '2026-07-01T15:00' });
    expect(lastBody).toEqual({ newStartAt: '2026-07-01T14:00', newEndAt: '2026-07-01T15:00' });
  });

  it('propage une ApiError 409 (créneau indisponible)', async () => {
    installFetch({ ok: false, error: 'Indispo', code: 'SLOT_UNAVAILABLE' }, 409);
    await expect(
      rescheduleBooking('BKG-9', { newStartAt: '2026-07-01T14:00', newEndAt: '2026-07-01T15:00' }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 409, code: 'SLOT_UNAVAILABLE' });
  });

  it('ApiError est bien une instance', async () => {
    installFetch({ ok: false, error: 'x' }, 400);
    const err = await rescheduleBooking('BKG-9', { newStartAt: 'a', newEndAt: 'b' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
  });
});
