import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { ApiError } from '@bs/api-client';
import { renderWithProviders } from '../test/utils';
import { PaymentSuccessPage } from './PaymentSuccessPage';
import { LoginPage } from './LoginPage';
import { CheckoutPage } from './CheckoutPage';
import { useCart } from '../features/cart/CartProvider';
import type { ServiceCartItem } from '../features/cart/cartTypes';

const { mockSessionStatus, mockPaymentResult, mockLogin, mockCreate } = vi.hoisted(() => ({
  mockSessionStatus: vi.fn(),
  mockPaymentResult: vi.fn(),
  mockLogin: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock('@bs/api-client', async (orig) => {
  const actual = await orig<typeof import('@bs/api-client')>();
  return {
    ...actual,
    getCheckoutSessionStatus: mockSessionStatus,
    getPaymentResult: mockPaymentResult,
    login: mockLogin,
    createCheckoutSession: mockCreate,
  };
});

const serviceItem: ServiceCartItem = {
  lineId: 'l1', kind: 'service', refId: 's1', slug: 'soin', name: 'Soin visage', indicativePrice: 50,
  selectedSlot: { slotStart: '2026-07-01T14:00', slotEnd: '2026-07-01T14:30', practitionerId: 'p1' },
};

function CartCount() {
  const { summary } = useCart();
  return <div>cartcount:{summary.count}</div>;
}

beforeEach(() => {
  mockSessionStatus.mockReset();
  mockPaymentResult.mockReset();
  mockLogin.mockReset();
  mockCreate.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('PaymentSuccessPage (retour hosted)', () => {
  it('session_id → appelle session-status ; succeeded vide le panier', async () => {
    mockSessionStatus.mockResolvedValue({ status: 'succeeded', paymentStatus: 'succeeded' });
    renderWithProviders(<><PaymentSuccessPage /><CartCount /></>, '/paiement/succes?session_id=cs_1', [serviceItem]);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Paiement confirmé.' })).toBeInTheDocument());
    expect(mockSessionStatus).toHaveBeenCalledWith('cs_1');
    expect(screen.getByText('cartcount:0')).toBeInTheDocument();
  });

  it('session pending → wording prudent, panier conservé', async () => {
    mockSessionStatus.mockResolvedValue({ status: 'pending', paymentStatus: 'processing' });
    renderWithProviders(<><PaymentSuccessPage /><CartCount /></>, '/paiement/succes?session_id=cs_2', [serviceItem]);
    await waitFor(() => expect(screen.getByRole('heading', { name: /confirmation en cours/i })).toBeInTheDocument());
    expect(screen.getByText('cartcount:1')).toBeInTheDocument(); // panier NON vidé
  });

  it('payment_intent_id failed → message échec, panier conservé', async () => {
    mockPaymentResult.mockResolvedValue({ ok: true, status: 'failed', errorMessage: 'Carte refusée' });
    renderWithProviders(<><PaymentSuccessPage /><CartCount /></>, '/paiement/succes?payment_intent_id=pi_9', [serviceItem]);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Le paiement a échoué.' })).toBeInTheDocument());
    expect(screen.getByText('cartcount:1')).toBeInTheDocument();
  });

  it('free=1 → commande confirmée, panier vidé (aucun appel réseau)', async () => {
    renderWithProviders(<><PaymentSuccessPage /><CartCount /></>, '/paiement/succes?free=1&checkoutId=sale1', [serviceItem]);
    await waitFor(() => expect(screen.getByText('cartcount:0')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Paiement confirmé.' })).toBeInTheDocument();
    expect(mockSessionStatus).not.toHaveBeenCalled();
    expect(mockPaymentResult).not.toHaveBeenCalled();
  });
});

describe('LoginPage', () => {
  it('connexion réussie → redirige vers ?redirect (panier conservé)', async () => {
    mockLogin.mockResolvedValue({ ok: true, role: 'client' });
    renderWithProviders(
      <Routes>
        <Route path="/connexion" element={<LoginPage />} />
        <Route path="/checkout" element={<div>PAGE CHECKOUT</div>} />
      </Routes>,
      '/connexion?redirect=/checkout',
      [serviceItem],
    );
    fireEvent.change(screen.getByLabelText(/^E-mail/), { target: { value: 'c@b.c' } });
    fireEvent.change(screen.getByLabelText(/^Mot de passe/), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('c@b.c', 'secret'));
    await waitFor(() => expect(screen.getByText('PAGE CHECKOUT')).toBeInTheDocument());
  });

  it('erreur de connexion → message', async () => {
    mockLogin.mockRejectedValue(new ApiError({ status: 401, message: 'Identifiants invalides.' }));
    renderWithProviders(<LoginPage />, '/connexion');
    fireEvent.change(screen.getByLabelText(/^E-mail/), { target: { value: 'x@y.z' } });
    fireEvent.change(screen.getByLabelText(/^Mot de passe/), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    await waitFor(() => expect(screen.getByText('Identifiants invalides.')).toBeInTheDocument());
  });
});

describe('CheckoutPage 401', () => {
  it('401 → lien connexion avec redirect=/checkout (panier conservé)', async () => {
    mockCreate.mockRejectedValue(new ApiError({ status: 401, message: 'Authentification requise.' }));
    renderWithProviders(<><CheckoutPage /><CartCount /></>, '/checkout', [serviceItem]);
    fireEvent.click(screen.getByLabelText(/conditions générales/i));
    fireEvent.click(screen.getByLabelText(/exécutée à la date/i));
    fireEvent.click(screen.getByRole('button', { name: 'Payer / Confirmer' }));
    const link = await screen.findByRole('link', { name: 'Se connecter' });
    expect(link.getAttribute('href')).toContain('redirect=/checkout');
    expect(screen.getByText('cartcount:1')).toBeInTheDocument();
  });
});
