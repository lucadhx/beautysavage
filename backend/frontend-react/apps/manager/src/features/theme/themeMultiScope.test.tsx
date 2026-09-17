import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { defaultPanelTheme } from '@bs/ui';
import { PanelThemeProvider } from './PanelThemeProvider';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function stubFetch(handler: (url: string) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => handler(typeof input === 'string' ? input : input.toString())),
  );
}
function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelThemeProvider>
        <div>contenu</div>
      </PanelThemeProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('PanelThemeProvider (scope manager)', () => {
  it('utilise defaultPanelTheme si /api/theme/manager renvoie theme:null', async () => {
    document.documentElement.removeAttribute('style');
    stubFetch((url) =>
      url.includes('/api/theme/manager')
        ? jsonResponse({ ok: true, scope: 'manager', theme: null })
        : jsonResponse({ ok: true }, 404),
    );
    renderPanel();
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--bs-color-primary')).toBe(
        defaultPanelTheme.colors.primary,
      ),
    );
  });

  it('utilise defaultPanelTheme si l’endpoint échoue (jamais bloquant)', async () => {
    document.documentElement.removeAttribute('style');
    stubFetch(() => jsonResponse({ ok: false, error: 'boom' }, 500));
    renderPanel();
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--bs-color-primary')).toBe(
        defaultPanelTheme.colors.primary,
      ),
    );
  });

  it('applique la couleur backend manager si fournie', async () => {
    document.documentElement.removeAttribute('style');
    stubFetch((url) =>
      url.includes('/api/theme/manager')
        ? jsonResponse({ ok: true, scope: 'manager', theme: { colors: { primary: '#123abc' } } })
        : jsonResponse({ ok: true }, 404),
    );
    renderPanel();
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--bs-color-primary')).toBe('#123abc'),
    );
  });
});
