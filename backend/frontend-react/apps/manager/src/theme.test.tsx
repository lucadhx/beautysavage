import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, defaultPanelTheme, defaultVitrineTheme } from '@bs/ui';
import { AuthProvider } from '@bs/auth';
import type { AuthUser } from '@bs/api-client';
import { App } from './App';

const admin: AuthUser = { id: '1', email: 'admin@b.c', role: 'admin' };

describe('Manager App avec thème panel', () => {
  it('rend le tableau de bord et applique le thème panel (distinct vitrine)', async () => {
    document.documentElement.removeAttribute('style');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ThemeProvider scope="panel">
          <AuthProvider loader={async () => admin}>
            <MemoryRouter initialEntries={['/']}>
              <App />
            </MemoryRouter>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Tableau de bord' })).toBeInTheDocument(),
    );
    expect(document.documentElement.style.getPropertyValue('--bs-color-primary')).toBe(
      defaultPanelTheme.colors.primary,
    );
    expect(defaultPanelTheme.colors.primary).not.toBe(defaultVitrineTheme.colors.primary);
  });
});
