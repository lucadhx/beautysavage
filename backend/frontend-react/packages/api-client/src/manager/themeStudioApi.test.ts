import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  listThemes,
  getActiveTheme,
  createTheme,
  updateTheme,
  activateTheme,
  toBackendScope,
  toUiScope,
} from './themeStudio';

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

const RAW = { id: 't1', name: 'Panel', scope: 'manager', colors: { primary: '#2563eb', secondary: '#7c3aed', background: '#fff', surface: '#fff', text: '#000' }, derivedTokens: {}, radius: '6px', isActive: true };

describe('themeStudio api-client (M5)', () => {
  it('mapping scope : panel ↔ manager, vitrine ↔ vitrine', () => {
    expect(toBackendScope('panel')).toBe('manager');
    expect(toBackendScope('vitrine')).toBe('vitrine');
    expect(toUiScope('manager')).toBe('panel');
    expect(toUiScope('vitrine')).toBe('vitrine');
  });

  it('listThemes(panel) → filtre scope=manager, renvoie scope produit "panel"', async () => {
    mockFetch({ ok: true, themes: [RAW] });
    const themes = await listThemes('panel');
    expect(lastUrl).toContain('/api/gestion/themes');
    expect(lastUrl).toContain('scope=manager');
    expect(themes[0].scope).toBe('panel');
  });

  it('getActiveTheme(panel) → GET /api/theme/manager', async () => {
    mockFetch({ ok: true, scope: 'manager', theme: RAW });
    const t = await getActiveTheme('panel');
    expect(lastUrl).toContain('/api/theme/manager');
    expect(t?.scope).toBe('panel');
    expect(t?.isActive).toBe(true);
  });

  it('getActiveTheme(vitrine) → GET /api/theme/vitrine ; null si absent', async () => {
    mockFetch({ ok: true, scope: 'vitrine', theme: null });
    const t = await getActiveTheme('vitrine');
    expect(lastUrl).toContain('/api/theme/vitrine');
    expect(t).toBeNull();
  });

  it('createTheme(panel) POST avec scope backend manager + tokens visuels', async () => {
    mockFetch({ ok: true, theme: RAW });
    await createTheme({ name: 'Panel', scope: 'panel', colors: { primary: '#111111' } as never, radius: '8px', spacing: { x1: '4px' } });
    expect(lastUrl).toContain('/api/gestion/themes');
    expect(lastInit?.method).toBe('POST');
    const body = JSON.parse(String(lastInit?.body));
    expect(body.scope).toBe('manager');
    expect(body.radius).toBe('8px');
    expect(body.spacing.x1).toBe('4px');
  });

  it('updateTheme PUT /:id ; activateTheme POST /:id/activate', async () => {
    mockFetch({ ok: true, theme: RAW });
    await updateTheme('t1', { shadow: '0 1px 2px rgba(0,0,0,.1)' });
    expect(lastUrl).toContain('/api/gestion/themes/t1');
    expect(lastInit?.method).toBe('PUT');

    await activateTheme('t1');
    expect(lastUrl).toContain('/api/gestion/themes/t1/activate');
    expect(lastInit?.method).toBe('POST');
  });
});
