// RX-GO-2 — Parcours auth React : signup (validation), forgot (succès), reset (token→form→succès), verify.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, stubFetch, jsonResponse } from '../test/utils';
import { SignupPage } from './SignupPage';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { ResetPasswordPage } from './ResetPasswordPage';
import { VerifyEmailPage } from './VerifyEmailPage';

afterEach(() => vi.unstubAllGlobals());

describe('SignupPage (RX-GO-2)', () => {
  it('bloque un mot de passe faible puis soumet un formulaire valide', async () => {
    const urls: string[] = [];
    stubFetch((url) => { urls.push(url); return jsonResponse({ ok: true, email: 'a@b.fr' }); });
    renderWithProviders(<SignupPage />, '/inscription');
    fireEvent.change(screen.getByLabelText(/^E-mail/), { target: { value: 'a@b.fr' } });
    fireEvent.change(screen.getByLabelText(/^Mot de passe/), { target: { value: 'weak' } });
    fireEvent.change(screen.getByLabelText(/^Confirmer le mot de passe/), { target: { value: 'weak' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    expect(urls.some((u) => u.includes('/auth/signup'))).toBe(false); // trop faible → pas d'appel
    // Corrige : mot de passe conforme.
    fireEvent.change(screen.getByLabelText(/^Mot de passe/), { target: { value: 'abcd1234' } });
    fireEvent.change(screen.getByLabelText(/^Confirmer le mot de passe/), { target: { value: 'abcd1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    await waitFor(() => expect(urls.some((u) => u.includes('/auth/signup'))).toBe(true));
  });
});

describe('ForgotPasswordPage (RX-GO-2)', () => {
  it('affiche un message de succès neutre après envoi', async () => {
    stubFetch(() => jsonResponse({ ok: true }));
    renderWithProviders(<ForgotPasswordPage />, '/mot-de-passe-oublie');
    fireEvent.change(screen.getByLabelText(/^E-mail/), { target: { value: 'a@b.fr' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le lien' }));
    expect(await screen.findByText(/Si un compte existe/i)).toBeInTheDocument();
  });
});

describe('ResetPasswordPage (RX-GO-2)', () => {
  it('token valide → formulaire → succès', async () => {
    stubFetch((url) => {
      if (url.includes('/password-reset/validate')) return jsonResponse({ ok: true, expiresAt: 'x' });
      if (url.includes('/password-reset/complete')) return jsonResponse({ ok: true });
      return jsonResponse({ ok: true });
    });
    renderWithProviders(<ResetPasswordPage />, '/reinitialiser-mot-de-passe?token=tok');
    expect(await screen.findByText(/Lien validé/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Nouveau mot de passe/), { target: { value: 'abcd1234' } });
    fireEvent.change(screen.getByLabelText(/^Confirmer le mot de passe/), { target: { value: 'abcd1234' } });
    fireEvent.click(screen.getByRole('button', { name: /Réinitialiser/i }));
    expect(await screen.findByText(/bien été mis à jour/i)).toBeInTheDocument();
  });
  it('token invalide → écran dédié', async () => {
    stubFetch(() => jsonResponse({ ok: false, error: 'expired' }, 400));
    renderWithProviders(<ResetPasswordPage />, '/reinitialiser-mot-de-passe?token=bad');
    expect(await screen.findByText(/plus valide/i)).toBeInTheDocument();
  });
});

describe('VerifyEmailPage (RX-GO-2)', () => {
  it('sans e-mail → invite à créer un compte', () => {
    stubFetch(() => jsonResponse({ ok: true }));
    renderWithProviders(<VerifyEmailPage />, '/verify-email');
    expect(screen.getByText(/Lien incomplet/i)).toBeInTheDocument();
  });
  it('code 6 chiffres → vérification', async () => {
    const urls: string[] = [];
    stubFetch((url) => { urls.push(url); return jsonResponse({ ok: true, role: 'client' }); });
    renderWithProviders(<VerifyEmailPage />, '/verify-email?email=a@b.fr');
    fireEvent.change(screen.getByLabelText(/^Code de vérification/), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(urls.some((u) => u.includes('/auth/verify-email'))).toBe(true));
  });
});
