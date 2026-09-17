import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { AuthUser } from '@bs/api-client';
import { AuthProvider } from './AuthProvider';
import { RequireAuth, RequireRole } from './guards';

function renderWithAuth(loader: () => Promise<AuthUser | null>, ui: ReactNode, initialPath = '/secret') {
  return render(
    <AuthProvider loader={loader}>
      <MemoryRouter initialEntries={[initialPath]}>{ui}</MemoryRouter>
    </AuthProvider>,
  );
}

const adminUser: AuthUser = { id: '1', email: 'a@b.c', role: 'admin' };
const clientUser: AuthUser = { id: '2', email: 'c@b.c', role: 'client' };

describe('RequireAuth', () => {
  it('redirige un visiteur non authentifié vers le login', async () => {
    renderWithAuth(
      async () => null,
      <Routes>
        <Route path="/login" element={<div>page-login</div>} />
        <Route element={<RequireAuth loginPath="/login" />}>
          <Route path="/secret" element={<div>page-secrete</div>} />
        </Route>
      </Routes>,
    );
    await waitFor(() => expect(screen.getByText('page-login')).toBeInTheDocument());
    expect(screen.queryByText('page-secrete')).not.toBeInTheDocument();
  });

  it('laisse passer un utilisateur authentifié', async () => {
    renderWithAuth(
      async () => adminUser,
      <Routes>
        <Route path="/login" element={<div>page-login</div>} />
        <Route element={<RequireAuth loginPath="/login" />}>
          <Route path="/secret" element={<div>page-secrete</div>} />
        </Route>
      </Routes>,
    );
    await waitFor(() => expect(screen.getByText('page-secrete')).toBeInTheDocument());
  });
});

describe('RequireRole', () => {
  it('bloque un rôle insuffisant (écran refus)', async () => {
    renderWithAuth(
      async () => clientUser,
      <Routes>
        <Route element={<RequireRole allow={['admin', 'dev']} loginPath="/login" />}>
          <Route path="/secret" element={<div>zone-manager</div>} />
        </Route>
      </Routes>,
    );
    await waitFor(() => expect(screen.getByText('Accès réservé.')).toBeInTheDocument());
    expect(screen.queryByText('zone-manager')).not.toBeInTheDocument();
  });

  it('laisse passer un rôle autorisé', async () => {
    renderWithAuth(
      async () => adminUser,
      <Routes>
        <Route element={<RequireRole allow={['admin', 'dev']} loginPath="/login" />}>
          <Route path="/secret" element={<div>zone-manager</div>} />
        </Route>
      </Routes>,
    );
    await waitFor(() => expect(screen.getByText('zone-manager')).toBeInTheDocument());
  });
});
