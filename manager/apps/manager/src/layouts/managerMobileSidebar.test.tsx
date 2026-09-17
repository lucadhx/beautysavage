// RX-BLOCKER - Sidebar mobile manager: burger -> drawer slide-in, finance group precise active state.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@bs/auth';
import type { AuthUser } from '@bs/api-client';
import { ManagerLayout } from './ManagerLayout';

function stub() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
}

function renderLayout(user: AuthUser, path = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider loader={async () => user}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<ManagerLayout />}>
              <Route index element={<div>CONTENU</div>} />
              <Route path="finance" element={<div>FINANCE</div>} />
              <Route path="finance/timeline" element={<div>TIMELINE</div>} />
              <Route path="finance/commissions" element={<div>COMMISSIONS</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const dev: AuthUser = { id: '1', email: 'dev@b.c', role: 'dev', currentMode: 'gestion' };

afterEach(() => vi.unstubAllGlobals());

describe('ManagerLayout - sidebar mobile (RX-BLOCKER)', () => {
  it('burger present; drawer closed by default', () => {
    stub();
    renderLayout(dev);
    expect(screen.getByRole('button', { name: 'Ouvrir le menu' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Menu de navigation' })).toBeNull();
  });

  it('finance group opens on demand and closes drawer after navigation', () => {
    stub();
    const { container } = renderLayout(dev);
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le menu' }));
    const drawer = screen.getByRole('dialog', { name: 'Menu de navigation' });
    expect(within(drawer).queryByRole('link', { name: 'Ventes' })).toBeNull();

    fireEvent.click(within(drawer).getByTestId('manager-finance-toggle'));
    const salesLink = within(drawer).getByRole('link', { name: 'Ventes' });
    expect(salesLink).toBeInTheDocument();

    fireEvent.click(salesLink);
    expect(screen.queryByRole('dialog', { name: 'Menu de navigation' })).toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });

  it('marks the sales child active when timeline filter comes from the URL', () => {
    stub();
    renderLayout(dev, '/finance/timeline?type=sale');
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le menu' }));
    const drawer = screen.getByRole('dialog', { name: 'Menu de navigation' });
    expect(within(drawer).getByRole('link', { name: 'Ventes' })).toHaveAttribute('aria-current', 'page');
    expect(within(drawer).getByRole('link', { name: 'Remboursements' })).not.toHaveAttribute('aria-current');
  });

  it('Escape closes the drawer', () => {
    stub();
    renderLayout(dev);
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le menu' }));
    expect(screen.getByRole('dialog', { name: 'Menu de navigation' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Menu de navigation' })).toBeNull();
  });
});
