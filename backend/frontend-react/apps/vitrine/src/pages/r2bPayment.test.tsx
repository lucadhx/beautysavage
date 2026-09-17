import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { ApiError } from '@bs/api-client';
import vitrinePkg from '../../package.json';
import rootPkg from '../../../../package.json';
import { renderWithProviders } from '../test/utils';
import { CheckoutPage } from './CheckoutPage';
import { PaymentSuccessPage } from './PaymentSuccessPage';
import { PaymentCancelPage } from './PaymentCancelPage';
import { useCart } from '../features/cart/CartProvider';
import type { ServiceCartItem } from '../features/cart/cartTypes';

const { mockCreate, mockFinalize, mockResult } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockFinalize: vi.fn(),
  mockResult: vi.fn(),
}));

vi.mock('@bs/api-client', async (orig) => {
  const actual = await orig<typeof import('@bs/api-client')>();
  return { ...actual, createCheckoutSession: mockCreate, finalizeFreeCheckout: mockFinalize, getPaymentResult: mockResult };
});

const serviceItem: ServiceCartItem = {
  lineId: 'l1',
  kind: 'service',
  refId: 's1',
  slug: 'soin',
  name: 'Soin visage',
  indicativePrice: 50,
  selectedSlot: { slotStart: '2026-07-01T14:00', slotEnd: '2026-07-01T14:30', practitionerId: 'p1' },
};

const assignMock = vi.fn();
beforeEach(() => {
  mockCreate.mockReset();
  mockFinalize.mockReset();
  mockResult.mockReset();
  assignMock.mockReset();
  Object.defineProperty(window, 'location', { configurable: true, value: { assign: assignMock, href: '', search: '' } });
});
afterEach(() => vi.unstubAllGlobals());

function acceptConsents() {
  fireEvent.click(screen.getByLabelText(/conditions générales/i));
  fireEvent.click(screen.getByLabelText(/exécutée à la date/i));
}

describe('CheckoutPage — paiement (R2B)', () => {
  it('bouton désactivé sans consentements, activé après', () => {
    renderWithProviders(<CheckoutPage />, '/checkout', [serviceItem]);
    const btn = screen.getByRole('button', { name: 'Payer / Confirmer' });
    expect(btn).toBeDisabled();
    acceptConsents();
    expect(btn).toBeEnabled();
  });

  it('appelle createCheckoutSession avec le checkoutState attendu', async () => {
    mockCreate.mockResolvedValue({ ok: true, mode: 'hosted', url: 'https://stripe/cs_1' });
    renderWithProviders(<CheckoutPage />, '/checkout', [serviceItem]);
    acceptConsents();
    fireEvent.click(screen.getByRole('button', { name: 'Payer / Confirmer' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const state = mockCreate.mock.calls[0][0];
    expect(state.item).toEqual({ type: 'service', id: 's1', name: 'Soin visage' });
    expect(state.service).toMatchObject({ serviceId: 's1', slotStart: '2026-07-01T14:00', practitionerId: 'p1' });
    expect(state.legal.acceptedCgv).toBe(true);
    expect('totals' in state).toBe(false); // aucun montant autoritaire
  });

  it('réponse hosted → window.location.assign(url)', async () => {
    mockCreate.mockResolvedValue({ ok: true, mode: 'hosted', url: 'https://stripe/cs_redir' });
    renderWithProviders(<CheckoutPage />, '/checkout', [serviceItem]);
    acceptConsents();
    fireEvent.click(screen.getByRole('button', { name: 'Payer / Confirmer' }));
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('https://stripe/cs_redir'));
  });

  it('réponse free → finalizeFreeCheckout puis navigation succès', async () => {
    mockCreate.mockResolvedValue({ ok: true, mode: 'free', requiresPayment: false });
    mockFinalize.mockResolvedValue({ ok: true, saleId: 'sale1' });
    renderWithProviders(
      <Routes>
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/paiement/succes" element={<div>PAGE SUCCES FREE</div>} />
      </Routes>,
      '/checkout',
      [serviceItem],
    );
    acceptConsents();
    fireEvent.click(screen.getByRole('button', { name: 'Payer / Confirmer' }));
    await waitFor(() => expect(mockFinalize).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('PAGE SUCCES FREE')).toBeInTheDocument());
  });

  it('erreur backend → ErrorState', async () => {
    mockCreate.mockRejectedValue(new ApiError({ status: 409, code: 'SESSION_FULL', message: 'Complet' }));
    renderWithProviders(<CheckoutPage />, '/checkout', [serviceItem]);
    acceptConsents();
    fireEvent.click(screen.getByRole('button', { name: 'Payer / Confirmer' }));
    await waitFor(() => expect(screen.getByText('Le paiement n’a pas pu démarrer.')).toBeInTheDocument());
  });

  it('401 → connexion requise (panier conservé)', async () => {
    mockCreate.mockRejectedValue(new ApiError({ status: 401, message: 'Authentification requise.' }));
    renderWithProviders(<CheckoutPage />, '/checkout', [serviceItem]);
    acceptConsents();
    fireEvent.click(screen.getByRole('button', { name: 'Payer / Confirmer' }));
    await waitFor(() => expect(screen.getByText('Connexion requise pour payer.')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Se connecter' })).toBeInTheDocument();
  });
});

describe('PaymentSuccessPage', () => {
  it('flow gratuit (free=1) → paiement confirmé', async () => {
    renderWithProviders(<PaymentSuccessPage />, '/paiement/succes?free=1&checkoutId=sale1');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Paiement confirmé.' })).toBeInTheDocument());
    expect(mockResult).not.toHaveBeenCalled();
  });

  it('hosted pending → wording prudent (confirmation en cours)', async () => {
    mockResult.mockResolvedValue({ ok: true, status: 'pending' });
    renderWithProviders(<PaymentSuccessPage />, '/paiement/succes?payment_intent_id=pi_1');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /confirmation en cours/i })).toBeInTheDocument(),
    );
    expect(mockResult).toHaveBeenCalledWith('pi_1');
  });
});

describe('PaymentCancelPage', () => {
  it('conserve le panier (ne le vide pas)', () => {
    function CartCount() {
      const { summary } = useCart();
      return <div>cartcount:{summary.count}</div>;
    }
    renderWithProviders(<><PaymentCancelPage /><CartCount /></>, '/paiement/annule', [serviceItem]);
    expect(screen.getByRole('heading', { name: 'Paiement annulé.' })).toBeInTheDocument();
    expect(screen.getByText('cartcount:1')).toBeInTheDocument();
  });
});

describe('Sécurité : pas de dépendance Stripe côté front', () => {
  it("aucune dépendance contenant 'stripe' dans les package.json front", () => {
    type Pkg = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const collect = (p: Pkg) => ({ ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) });
    const deps = { ...collect(vitrinePkg as Pkg), ...collect(rootPkg as Pkg) };
    expect(Object.keys(deps).some((k) => k.toLowerCase().includes('stripe'))).toBe(false);
  });
});
