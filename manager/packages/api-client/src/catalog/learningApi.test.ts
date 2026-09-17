// C2 — Learning api-client (client/apprenant) : URLs + méthodes.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { listMyLearningFormations, getMyLearningFormation, completeLesson, getMyAttendanceToken } from './learning';

function json(p: unknown) { return new Response(JSON.stringify(p), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
const calls: { url: string; method: string }[] = [];
function installFetch(p: unknown) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url: String(url), method: init?.method || 'GET' }); return json(p); }));
}
afterEach(() => vi.unstubAllGlobals());

describe('learning api-client (client)', () => {
  it('listMyLearningFormations', async () => {
    installFetch({ ok: true, formations: [{ formationId: 'f1', progressPct: 50 }] });
    const r = await listMyLearningFormations();
    expect(r.length).toBe(1);
    expect(calls[0].url).toContain('/api/client/learning/formations');
  });

  it('getMyLearningFormation', async () => {
    installFetch({ ok: true, formation: { id: 'f1' }, chapters: [], lessons: [], progress: { formationPct: 0, completedLessonIds: [], chapters: [], lastLessonId: null, completedAt: null } });
    const r = await getMyLearningFormation('f1');
    expect(r.formation.id).toBe('f1');
    expect(calls[0].url).toContain('/api/client/learning/formations/f1');
  });

  it('completeLesson POST', async () => {
    installFetch({ ok: true, progress: { formationPct: 100, completedLessonIds: ['l1'], chapters: [], lastLessonId: 'l1', completedAt: '2026-01-01' } });
    const r = await completeLesson('l1');
    expect(r.formationPct).toBe(100);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/lessons/l1/complete');
  });

  it('getMyAttendanceToken', async () => {
    installFetch({ ok: true, attendance: { status: 'pending', token: 'abc', payload: 'BS-PRESENCE:s1:abc' } });
    const a = await getMyAttendanceToken('s1');
    expect(a.payload).toContain('BS-PRESENCE');
    expect(calls[0].url).toContain('/sessions/s1/attendance-token');
  });
});
