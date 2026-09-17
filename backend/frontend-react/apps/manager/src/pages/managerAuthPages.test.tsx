// RX-BLOCKER-2 — Pages d'auth manager publiques : acceptation d'invitation, mot de passe oublié, reset.
// Réutilisent l'engine existant (aucun second moteur) ; fetch mocké, aucun token en clair affiché.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ManagerInvitationPage } from './ManagerInvitationPage';
import { ManagerForgotPasswordPage } from './ManagerForgotPasswordPage';
import { ManagerResetPasswordPage } from './ManagerResetPasswordPage';

const urls: string[] = [];
function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function stub(handler: (url: string, init?: RequestInit) => Response) {
  urls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { urls.push(String(url)); return handler(String(url), init); }));
}
afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string, pattern: string, element: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={pattern} element={element} />
        <Route path="/login" element={<div>ÉCRAN LOGIN</div>} />
        <Route path="/mot-de-passe-oublie" element={<div>ÉCRAN FORGOT</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ManagerInvitationPage (RX-BLOCKER-2)', () => {
  it('token valide → affiche e-mail + rôle, définit le mot de passe, active', async () => {
    stub((url, init) => {
      if (url.includes('/manager-invitations/') && (init?.method || 'GET') === 'GET') {
        return jsonRes({ ok: true, email: 'nina@test.local', firstName: 'Nina', role: 'admin' });
      }
      return jsonRes({ ok: true }); // accept
    });
    renderAt('/invitation/tok', '/invitation/:token', <ManagerInvitationPage />);
    expect(await screen.findByText('nina@test.local')).toBeInTheDocument();
    expect(screen.getByText(/Administrateur/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Mot de passe/), { target: { value: 'Motdepasse1' } });
    fireEvent.change(screen.getByLabelText(/^Confirmer le mot de passe/), { target: { value: 'Motdepasse1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Activer mon compte' }));
    expect(await screen.findByText(/Votre compte est prêt/i)).toBeInTheDocument();
    expect(urls.some((u) => u.includes('/manager-invitations/tok/accept'))).toBe(true);
  });

  it('mot de passe faible → pas d’appel accept', async () => {
    stub(() => jsonRes({ ok: true, email: 'a@b.fr', firstName: '', role: 'dev' }));
    renderAt('/invitation/tok', '/invitation/:token', <ManagerInvitationPage />);
    await screen.findByText('a@b.fr');
    fireEvent.change(screen.getByLabelText(/^Mot de passe/), { target: { value: 'weak' } });
    fireEvent.change(screen.getByLabelText(/^Confirmer le mot de passe/), { target: { value: 'weak' } });
    fireEvent.click(screen.getByRole('button', { name: 'Activer mon compte' }));
    expect(await screen.findByText(/dont une lettre et un chiffre/i)).toBeInTheDocument();
    expect(urls.some((u) => u.includes('/accept'))).toBe(false);
  });

  it('token expiré → écran dédié, pas de formulaire', async () => {
    stub(() => jsonRes({ ok: false, status: 'expired' }, 400));
    renderAt('/invitation/bad', '/invitation/:token', <ManagerInvitationPage />);
    expect(await screen.findByText(/a expiré/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activer mon compte' })).toBeNull();
  });
});

describe('ManagerForgotPasswordPage (RX-BLOCKER-2)', () => {
  it('réutilise /auth/password-reset/request et affiche un message neutre', async () => {
    stub(() => jsonRes({ ok: true }));
    renderAt('/mot-de-passe-oublie', '/mot-de-passe-oublie', <ManagerForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText(/^Adresse e-mail/), { target: { value: 'admin@test.local' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le lien' }));
    expect(await screen.findByText(/Si un compte de gestion existe/i)).toBeInTheDocument();
    expect(urls.some((u) => u.includes('/auth/password-reset/request'))).toBe(true);
  });
});

describe('ManagerResetPasswordPage (RX-BLOCKER-2)', () => {
  it('token valide → formulaire → complete → succès', async () => {
    stub((url) => {
      if (url.includes('/password-reset/validate')) return jsonRes({ ok: true, expiresAt: 'x' });
      if (url.includes('/password-reset/complete')) return jsonRes({ ok: true });
      return jsonRes({ ok: true });
    });
    renderAt('/reinitialiser-mot-de-passe/tok', '/reinitialiser-mot-de-passe/:token', <ManagerResetPasswordPage />);
    expect(await screen.findByText('Nouveau mot de passe')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Mot de passe/), { target: { value: 'Motdepasse1' } });
    fireEvent.change(screen.getByLabelText(/^Confirmer le mot de passe/), { target: { value: 'Motdepasse1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }));
    await waitFor(() => expect(urls.some((u) => u.includes('/password-reset/complete'))).toBe(true));
    expect(await screen.findByText(/C’est fait/i)).toBeInTheDocument();
  });

  it('token invalide → écran dédié + lien pour redemander', async () => {
    stub(() => jsonRes({ ok: false, errorCode: 'expired' }, 400));
    renderAt('/reinitialiser-mot-de-passe/bad', '/reinitialiser-mot-de-passe/:token', <ManagerResetPasswordPage />);
    expect(await screen.findByText(/n’est plus valide/i)).toBeInTheDocument();
  });
});
