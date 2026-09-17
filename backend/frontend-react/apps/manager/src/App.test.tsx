import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@bs/auth';
import type { AuthUser } from '@bs/api-client';
import { App } from './App';

function renderAt(path: string, user: AuthUser | null) {
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

// RX-BLOCKER — managers déjà en mode gestion (le ManagerModeGate est alors « prêt » sans appel réseau).
const dev: AuthUser = { id: '1', email: 'dev@b.c', role: 'dev', currentMode: 'gestion' };
const admin: AuthUser = { id: '2', email: 'admin@b.c', role: 'admin', currentMode: 'gestion' };

describe('Manager App', () => {
  it('redirige un visiteur anonyme vers /login', async () => {
    renderAt('/', null);
    // RX-GO-2 — /login est désormais une vraie page de connexion manager (plus un placeholder).
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Connexion — Gestion' })).toBeInTheDocument(),
    );
  });

  it('affiche le tableau de bord pour un admin', async () => {
    renderAt('/', admin);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Tableau de bord' })).toBeInTheDocument(),
    );
  });

  it('autorise /dev pour un dev', async () => {
    renderAt('/dev', dev);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Espace développeur' })).toBeInTheDocument(),
    );
  });

  it('bloque /dev pour un admin (redirige vers le tableau de bord)', async () => {
    renderAt('/dev', admin);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Tableau de bord' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('heading', { name: 'Espace développeur' })).not.toBeInTheDocument();
  });
});
