// RX-GO-2 — Manager : plus d'écran vide. Tableau de bord = hub réel ; placeholders → « Bientôt disponible »
// avec liens ; routes subsumées → redirections. Le titre « Tableau de bord » reste (point d'entrée).
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@bs/ui';
import { AuthProvider } from '@bs/auth';
import type { AuthUser } from '@bs/api-client';
import { App } from './App';

const dev: AuthUser = { id: '1', email: 'dev@b.c', role: 'dev' };

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider scope="panel">
        <AuthProvider loader={async () => dev}>
          <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('Manager — no empty screen (RX-GO-2)', () => {
  it('tableau de bord = hub avec accès rapides', async () => {
    renderAt('/');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Tableau de bord' })).toBeInTheDocument());
    // « Planning »/« Finance » apparaissent dans la nav ET dans les cards du hub.
    expect(screen.getAllByText('Planning').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Finance').length).toBeGreaterThanOrEqual(1);
  });

  it('placeholder /parametres → écran « Bientôt disponible » utile (pas vide)', async () => {
    renderAt('/parametres');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Paramètres' })).toBeInTheDocument());
    expect(screen.getByText(/Bientôt disponible/i)).toBeInTheDocument();
  });
});
