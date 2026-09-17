import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getMyPlanningAvailability,
  savePlanningSchedule,
  listPlanningExceptions,
  createPlanningException,
  updatePlanningException,
  deletePlanningException,
} from './availability';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

const calls: { url: string; method: string }[] = [];

function installFetch() {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method || 'GET' });
    if (String(url).includes('/schedule/me')) return json({ ok: true, practitionerId: 'p1', schedule: { practitionerId: 'p1', weeklySchedule: [] } });
    if (String(url).includes('/exceptions/p1')) return json({ ok: true, exceptions: [{ _id: 'exc-1', practitionerId: 'p1', date: '2026-07-08T00:00:00.000Z', type: 'block', isFullDay: true, startTime: null, endTime: null, slots: [], reason: 'Congé' }] });
    return json({ ok: true, schedule: { practitionerId: 'p1', weeklySchedule: [] }, exception: { _id: 'exc-1' } });
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('planning availability api-client', () => {
  it('reads the institute availability schedule', async () => {
    installFetch();
    const payload = await getMyPlanningAvailability();
    expect(payload.practitionerId).toBe('p1');
    expect(calls[0].url).toContain('/api/gestion/availability/schedule/me');
  });

  it('saves the weekly schedule', async () => {
    installFetch();
    await savePlanningSchedule('p1', { weeklySchedule: [] });
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toContain('/api/gestion/availability/schedule/p1');
  });

  it('lists exceptions for a date range', async () => {
    installFetch();
    const items = await listPlanningExceptions('p1', { from: '2026-07-01', to: '2026-07-31' });
    expect(items.length).toBe(1);
    expect(calls[0].url).toContain('/api/gestion/availability/exceptions/p1');
    expect(calls[0].url).toContain('from=2026-07-01');
  });

  it('creates, updates and deletes an exception', async () => {
    installFetch();
    await createPlanningException({ practitionerId: 'p1', date: '2026-07-08', type: 'block' });
    await updatePlanningException('exc-1', { reason: 'Mis à jour' });
    await deletePlanningException('exc-1');
    expect(calls[0].method).toBe('POST');
    expect(calls[1].method).toBe('PUT');
    expect(calls[2].method).toBe('DELETE');
  });
});
