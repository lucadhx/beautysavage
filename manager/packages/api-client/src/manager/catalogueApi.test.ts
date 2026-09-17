// C1 — Catalogue Studio api-client : URLs + méthodes + envelope-unwrap.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  listServices,
  getService,
  saveService,
  archiveService,
  duplicateService,
  listTrainings,
  getTraining,
  saveTraining,
  duplicateTraining,
  listSessions,
  saveSession,
  generateSessionQr,
  getGiftCardsConfig,
  updateGiftCardsConfig,
} from './catalogue';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
const calls: { url: string; method: string }[] = [];
function installFetch(payload: unknown) {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method || 'GET' });
      return json(payload);
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe('catalogue api-client (C1) — prestations', () => {
  it('listServices unwrappe { ok, services }', async () => {
    installFetch({ ok: true, services: [{ id: 's1', name: 'Soin' }] });
    const res = await listServices();
    expect(res.length).toBe(1);
    expect(calls[0]).toMatchObject({ method: 'GET' });
    expect(calls[0].url).toContain('/api/gestion/services');
  });

  it('getService cible /:id', async () => {
    installFetch({ ok: true, service: { id: 's1' } });
    const res = await getService('s1');
    expect(res.id).toBe('s1');
    expect(calls[0].url).toContain('/api/gestion/services/s1');
  });

  it('saveService POST sans id, PUT avec id', async () => {
    installFetch({ ok: true, service: { id: 's2' } });
    await saveService({ name: 'Nouveau' });
    expect(calls[0].method).toBe('POST');

    installFetch({ ok: true, service: { id: 's1' } });
    await saveService({ name: 'Maj' }, 's1');
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toContain('/api/gestion/services/s1');
  });

  it('archiveService DELETE, duplicateService POST /duplicate', async () => {
    installFetch({ ok: true });
    await archiveService('s1');
    expect(calls[0].method).toBe('DELETE');

    installFetch({ ok: true, service: { id: 's3' } });
    await duplicateService('s1');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/api/gestion/services/s1/duplicate');
  });
});

describe('catalogue api-client (C1) — formations', () => {
  it('listTrainings unwrappe { ok, formations }', async () => {
    installFetch({ ok: true, formations: [{ id: 'f1' }] });
    const res = await listTrainings();
    expect(res.length).toBe(1);
    expect(calls[0].url).toContain('/api/gestion/formations');
  });

  it('getTraining + saveTraining (POST/PUT) + duplicate', async () => {
    installFetch({ ok: true, formation: { id: 'f1' } });
    await getTraining('f1');
    expect(calls[0].url).toContain('/api/gestion/formations/f1');

    installFetch({ ok: true, formation: { id: 'f2' } });
    await saveTraining({ name: 'X' });
    expect(calls[0].method).toBe('POST');

    installFetch({ ok: true, formation: { id: 'f1' } });
    await saveTraining({ name: 'X' }, 'f1');
    expect(calls[0].method).toBe('PUT');

    installFetch({ ok: true, formation: { id: 'f3' } });
    await duplicateTraining('f1');
    expect(calls[0].url).toContain('/api/gestion/formations/f1/duplicate');
  });
});

describe('catalogue api-client (C1) — sessions + QR', () => {
  it('listSessions + saveSession (POST/PUT) + generateSessionQr', async () => {
    installFetch({ ok: true, sessions: [] });
    await listSessions('f1');
    expect(calls[0].url).toContain('/api/gestion/formations/f1/sessions');

    installFetch({ ok: true });
    await saveSession('f1', { startDate: '2026-09-01', maxClients: 8, schedule: [] });
    expect(calls[0].method).toBe('POST');

    installFetch({ ok: true });
    await saveSession('f1', { startDate: '2026-09-01', maxClients: 8, schedule: [] }, 'sess1');
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toContain('/sessions/sess1');

    installFetch({ ok: true, qr: { hasToken: true, token: 'abc', payload: 'BS-SESSION:sess1:abc', generatedAt: null } });
    const qr = await generateSessionQr('f1', 'sess1', true);
    expect(qr.token).toBe('abc');
    expect(calls[0].url).toContain('/sessions/sess1/qr');
    expect(calls[0].method).toBe('POST');
  });
});

describe('catalogue api-client (C1) — cartes cadeaux', () => {
  it('getGiftCardsConfig normalise les valeurs manquantes', async () => {
    installFetch({ ok: true, config: { minAmount: 20 } });
    const cfg = await getGiftCardsConfig();
    expect(cfg.minAmount).toBe(20);
    expect(cfg.maxAmount).toBe(0);
    expect(cfg.presetAmounts).toEqual([]);
    expect(calls[0].url).toContain('/api/gestion/gift-cards/config');
  });

  it('updateGiftCardsConfig PUT', async () => {
    installFetch({ ok: true, config: { minAmount: 20, maxAmount: 500, presetAmounts: [50, 100] } });
    const cfg = await updateGiftCardsConfig({ maxAmount: 500, presetAmounts: [50, 100] });
    expect(cfg.maxAmount).toBe(500);
    expect(calls[0].method).toBe('PUT');
  });
});
