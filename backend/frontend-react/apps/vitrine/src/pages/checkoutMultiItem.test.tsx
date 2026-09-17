// RX3 S3 — Checkout multi-item : gating légal, carte cadeau appliquée, redirection hosted, item indisponible.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders, stubFetch, jsonResponse } from '../test/utils';
import { CheckoutPage } from './CheckoutPage';
import type { CartItem } from '../features/cart/cartTypes';

let assignSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  assignSpy = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { ...window.location, assign: assignSpy },
    writable: true,
    configurable: true,
  });
});
afterEach(() => vi.unstubAllGlobals());

const distanciel: CartItem = {
  lineId: 'l1',
  kind: 'formation',
  refId: 'f1',
  name: 'Formation en ligne',
  formationType: 'distanciel',
  indicativePrice: 120,
};

function presentiel(): CartItem {
  return {
    lineId: 'l2',
    kind: 'formation',
    refId: 'f2',
    name: 'Formation présentielle',
    formationType: 'presentiel',
    sessionId: 's2',
    sessionStartAt: '2026-12-01T09:00:00Z',
    indicativePrice: 80,
  };
}

describe('CheckoutPage — panier formation', () => {
  it('gating légal : le paiement est bloqué tant que les consentements ne sont pas cochés, puis redirige (hosted)', async () => {
    stubFetch((url) => {
      if (url.includes('/api/stripe/create-checkout-session')) {
        return jsonResponse({ ok: true, mode: 'hosted', url: 'https://stripe.example/cs_1' });
      }
      return jsonResponse({ ok: true }, 404);
    });
    renderWithProviders(<CheckoutPage />, '/checkout', [distanciel]);

    // 2 consentements : CGV + distanciel
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    const payBtns = screen.getAllByRole('button', { name: /Payer/ });
    expect(payBtns[0]).toBeDisabled();

    boxes.forEach((b) => fireEvent.click(b));
    expect(screen.getAllByRole('button', { name: /Payer/ })[0]).not.toBeDisabled();

    fireEvent.click(screen.getAllByRole('button', { name: /Payer/ })[0]);
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('https://stripe.example/cs_1'));
  });

  it('carte cadeau : application → solde utilisé et reste à payer recalculés', async () => {
    stubFetch((url) => {
      if (url.includes('/api/client/gift-cards/validate')) {
        return jsonResponse({ ok: true, card: { id: 'g1', code: 'ABCD1234', availableBalance: 50, status: 'active', hasPassword: false } });
      }
      return jsonResponse({ ok: true }, 404);
    });
    renderWithProviders(<CheckoutPage />, '/checkout', [distanciel]);

    fireEvent.change(screen.getByPlaceholderText('Entrer un code'), { target: { value: 'ABCD1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));

    await waitFor(() => expect(screen.getByText(/Carte •••• 1234/)).toBeInTheDocument());
    expect(screen.getByText('Carte cadeau utilisée')).toBeInTheDocument();
    // reste 120 - 50 = 70
    expect(screen.getAllByText(/70,00/).length).toBeGreaterThan(0);
  });

  it('session complète → item marqué non disponible et paiement bloqué', async () => {
    stubFetch((url) => {
      if (url.includes('/sessions')) {
        return jsonResponse({ ok: true, sessions: [{ id: 's2', startDate: '2026-12-01T09:00:00Z', durationLabel: '1 jour', placesRemaining: 0, isAvailable: false, schedule: [] }] });
      }
      return jsonResponse({ ok: true }, 404);
    });
    renderWithProviders(<CheckoutPage />, '/checkout', [presentiel()]);

    await waitFor(() => expect(screen.getByText('Non disponible')).toBeInTheDocument());
    expect(screen.getByText(/Retirez les articles non disponibles/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Payer/ })[0]).toBeDisabled();
  });
});
