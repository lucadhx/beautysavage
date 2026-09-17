// RX-BLOCKER-2 — Page comptes manager (dev-only) : liste en cards (zéro table), création par invitation
// (aucun mot de passe saisi), action « renvoyer l'invitation ». Le serveur fait foi ; fetch mocké.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ManagerUsersPage } from './ManagerUsersPage';

const calls: { url: string; method: string; body: unknown }[] = [];
function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const USER = {
  id: 'u1', firstName: 'Nina', lastName: 'M', email: 'nina@test.local', role: 'admin',
  status: 'invited', inviteSentAt: null, activatedAt: null, lastLogin: null, createdAt: null,
};
function installFetch() {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET';
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (method === 'POST' && String(url).endsWith('/manager-users')) {
      return jsonRes({ ok: true, user: { ...USER, id: 'u2', email: 'new@test.local' } });
    }
    if (method === 'POST' && String(url).includes('/send-invitation')) {
      return jsonRes({ ok: true, user: { ...USER, inviteSentAt: '2026-07-03' } });
    }
    return jsonRes({ ok: true, users: [USER] }); // GET list
  }));
}
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  installFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><ManagerUsersPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ManagerUsersPage (RX-BLOCKER-2)', () => {
  it('liste les comptes en cards (pas de table) avec statut', async () => {
    const { container } = renderPage();
    expect(await screen.findByText('Nina M')).toBeInTheDocument();
    expect(container.querySelector('table')).toBeNull();
    expect(screen.getByText('Invitation envoyée')).toBeInTheDocument();
  });

  it('création : ouvre le drawer, invite par e-mail SANS champ mot de passe', async () => {
    renderPage();
    await screen.findByText('Nina M');
    fireEvent.click(screen.getByRole('button', { name: 'Créer un utilisateur' }));
    expect(await screen.findByText(/Aucun mot de passe n’est saisi ici/i)).toBeInTheDocument();
    // Aucun champ de type password dans le drawer de création (le dev ne choisit jamais le mot de passe).
    expect(document.querySelector('input[type="password"]')).toBeNull();
    fireEvent.change(screen.getByLabelText(/^E-mail/), { target: { value: 'new@test.local' } });
    fireEvent.click(screen.getByRole('button', { name: 'Inviter' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/manager-users'))).toBe(true));
    const created = calls.find((c) => c.method === 'POST' && c.url.endsWith('/manager-users'));
    expect((created?.body as { password?: string })?.password).toBeUndefined();
  });

  it('action : renvoyer l’invitation appelle /send-invitation', async () => {
    renderPage();
    await screen.findByText('Nina M');
    fireEvent.click(screen.getByRole('button', { name: /Renvoyer l’invitation/i }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/u1/send-invitation'))).toBe(true));
  });
});
