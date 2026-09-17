// C2 — Learning api-client (manager) : URLs + méthodes.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getLearningTree, createChapter, updateChapter, deleteChapter,
  createLesson, updateLesson, deleteLesson,
  listSessionParticipants, markAttendance, scanAttendance,
} from './learning';

function json(p: unknown) { return new Response(JSON.stringify(p), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
const calls: { url: string; method: string }[] = [];
function installFetch(p: unknown) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url: String(url), method: init?.method || 'GET' }); return json(p); }));
}
afterEach(() => vi.unstubAllGlobals());

describe('learning api-client (manager)', () => {
  it('getLearningTree unwrappe { chapters, lessons }', async () => {
    installFetch({ ok: true, chapters: [{ id: 'c1' }], lessons: [] });
    const t = await getLearningTree('f1');
    expect(t.chapters.length).toBe(1);
    expect(calls[0].url).toContain('/api/gestion/learning/formations/f1/tree');
  });

  it('chapter CRUD', async () => {
    installFetch({ ok: true, chapter: { id: 'c1' } });
    await createChapter('f1', { title: 'X' });
    expect(calls[0].method).toBe('POST');
    installFetch({ ok: true, chapter: { id: 'c1' } });
    await updateChapter('c1', { title: 'Y' });
    expect(calls[0].method).toBe('PUT');
    installFetch({ ok: true });
    await deleteChapter('c1');
    expect(calls[0].method).toBe('DELETE');
  });

  it('lesson CRUD', async () => {
    installFetch({ ok: true, lesson: { id: 'l1' } });
    await createLesson('f1', { chapterId: 'c1', title: 'L' });
    expect(calls[0].url).toContain('/formations/f1/lessons');
    installFetch({ ok: true, lesson: { id: 'l1' } });
    await updateLesson('l1', { title: 'L2' });
    expect(calls[0].method).toBe('PUT');
    installFetch({ ok: true });
    await deleteLesson('l1');
    expect(calls[0].method).toBe('DELETE');
  });

  it('présence : participants / mark / scan', async () => {
    installFetch({ ok: true, participants: [], summary: { total: 0, present: 0, remaining: 0 } });
    await listSessionParticipants('s1');
    expect(calls[0].url).toContain('/sessions/s1/participants');
    installFetch({ ok: true });
    await markAttendance('s1', 'u1', 'present');
    expect(calls[0].url).toContain('/sessions/s1/attendance');
    installFetch({ ok: true, participant: { userId: 'u1', name: 'X', status: 'present' } });
    const p = await scanAttendance('s1', 'tok');
    expect(p.status).toBe('present');
    expect(calls[0].url).toContain('/sessions/s1/scan');
  });
});
