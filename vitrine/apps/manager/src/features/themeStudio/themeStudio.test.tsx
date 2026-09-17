import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@bs/auth';
import type { AuthUser } from '@bs/api-client';
import { App } from '../../App';

const dev: AuthUser = { id: '1', email: 'dev@b.c', role: 'dev' };
const admin: AuthUser = { id: '2', email: 'admin@b.c', role: 'admin' };

const VITRINE = { id: 'v1', name: 'Vitrine', scope: 'vitrine', colors: { primary: '#5f4ff7', secondary: '#f24692', background: '#f5f4ef', surface: '#ffffff', text: '#0f172a' }, derivedTokens: { accent: '#7a4ad0' }, radius: '6px', isActive: true };
const PANEL = { id: 'p1', name: 'Panel', scope: 'manager', colors: { primary: '#2563eb', secondary: '#7c3aed', background: '#f1f5f9', surface: '#ffffff', text: '#0f172a' }, derivedTokens: { accent: '#0ea5e9' }, radius: '6px', isActive: true };

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
function installFetch(captured?: { calls: { url: string; method: string }[] }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      captured?.calls.push({ url: u, method: init?.method || 'GET' });
      if (u.includes('/api/theme/vitrine')) return json({ ok: true, scope: 'vitrine', theme: VITRINE });
      if (u.includes('/api/theme/manager')) return json({ ok: true, scope: 'manager', theme: PANEL });
      if (u.includes('/api/gestion/themes/v1/activate')) return json({ ok: true, theme: { ...VITRINE, isActive: true } });
      if (u.includes('/api/gestion/themes/v1')) return json({ ok: true, theme: VITRINE }); // PUT
      if (u.includes('/api/gestion/themes')) return json({ ok: true, themes: [VITRINE, PANEL] });
      return json({ ok: true });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

function renderApp(path: string, user: AuthUser | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider loader={async () => user}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('Theme Studio (M5)', () => {
  it('dev : /dev/theme-studio affiche les 2 thèmes (Vitrine + Panel)', async () => {
    installFetch();
    renderApp('/dev/theme-studio', dev);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Theme Studio' })).toBeInTheDocument());
    await waitFor(() => {
      expect(screen.getByText('Thème Vitrine')).toBeInTheDocument();
      expect(screen.getByText('Thème Panel')).toBeInTheDocument();
    });
  });

  it('admin : Theme Studio est bloqué (dev-only)', async () => {
    installFetch();
    renderApp('/dev/theme-studio', admin);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Tableau de bord' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Theme Studio' })).not.toBeInTheDocument();
  });

  it('éditeur vitrine charge le thème actif', async () => {
    installFetch();
    const { container } = renderApp('/dev/theme-studio/vitrine', dev);
    await waitFor(() => expect((container.querySelector('#ts-name') as HTMLInputElement)?.value).toBe('Vitrine'));
    expect((container.querySelector('#ts-c-primary') as HTMLInputElement)?.value).toBe('#5f4ff7');
  });

  it('éditeur panel charge le thème panel (scope manager)', async () => {
    installFetch();
    const { container } = renderApp('/dev/theme-studio/panel', dev);
    await waitFor(() => expect((container.querySelector('#ts-name') as HTMLInputElement)?.value).toBe('Panel'));
    expect((container.querySelector('#ts-c-primary') as HTMLInputElement)?.value).toBe('#2563eb');
  });

  it('modifier une couleur met à jour la preview live (sans sauvegarde)', async () => {
    installFetch();
    const { container } = renderApp('/dev/theme-studio/vitrine', dev);
    await waitFor(() => expect(container.querySelector('#ts-c-primary')).toBeTruthy());
    const preview = screen.getByTestId('theme-preview');
    fireEvent.change(container.querySelector('#ts-c-primary') as HTMLInputElement, { target: { value: '#123456' } });
    await waitFor(() => expect(preview.style.getPropertyValue('--bs-color-primary')).toBe('#123456'));
  });

  it('sauvegarde appelle updateTheme (PUT /:id)', async () => {
    const captured = { calls: [] as { url: string; method: string }[] };
    installFetch(captured);
    const { container } = renderApp('/dev/theme-studio/vitrine', dev);
    // Attendre que le thème actif soit chargé (sinon le bouton est désactivé : brouillon vide).
    await waitFor(() => expect((container.querySelector('#ts-name') as HTMLInputElement)?.value).toBe('Vitrine'));
    fireEvent.click(screen.getAllByRole('button', { name: /Sauvegarder/i })[0]);
    await waitFor(() => expect(captured.calls.some((c) => c.method === 'PUT' && c.url.includes('/api/gestion/themes/v1'))).toBe(true));
  });

  it('le journal/éditeur n’utilise pas de table (mobile-first)', async () => {
    installFetch();
    const { container } = renderApp('/dev/theme-studio/vitrine', dev);
    await waitFor(() => expect(container.querySelector('#ts-name')).toBeTruthy());
    expect(container.querySelector('table')).toBeNull();
  });
});
