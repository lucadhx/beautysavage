// RX3 S4 — Achat carte cadeau : presets, bénéficiaire, message, aperçu, gating CGV, redirection hosted.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders, stubFetch, jsonResponse } from '../../test/utils';
import { GiftCardsPage } from '../../pages/GiftCardsPage';

let assignSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  assignSpy = vi.fn();
  Object.defineProperty(window, 'location', { value: { ...window.location, assign: assignSpy }, writable: true, configurable: true });
});
afterEach(() => vi.unstubAllGlobals());

function stubGiftCard() {
  stubFetch((url) => {
    if (url.includes('/api/vitrine/gift-cards')) {
      return jsonResponse({ ok: true, config: { minAmount: 20, maxAmount: 200, presetAmounts: [50, 80, 100] } });
    }
    if (url.includes('/api/stripe/create-checkout-session')) {
      return jsonResponse({ ok: true, mode: 'hosted', url: 'https://stripe.example/gc_1' });
    }
    return jsonResponse({ ok: true }, 404);
  });
}

describe('GiftCardsPage — achat', () => {
  it('affiche les presets, le bénéficiaire, l’aperçu, et bloque le paiement sans CGV', async () => {
    stubGiftCard();
    renderWithProviders(<GiftCardsPage />, '/cartes-cadeaux');
    // Attendre le chargement de la config (presets rendus)
    await waitFor(() => expect(screen.getByRole('button', { name: /80,00/ })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Offrir une carte cadeau' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nom du bénéficiaire'), { target: { value: 'Camille' } });
    // Aperçu reflète le bénéficiaire
    expect(screen.getByText('Pour Camille')).toBeInTheDocument();

    // Paiement bloqué tant que CGV non cochées
    const payBtn = screen.getByRole('button', { name: /Offrir/ });
    expect(payBtn).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: /Offrir/ })).not.toBeDisabled();
  });

  it('paiement → redirection Stripe hébergée', async () => {
    stubGiftCard();
    renderWithProviders(<GiftCardsPage />, '/cartes-cadeaux');
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Offrir/ }));
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('https://stripe.example/gc_1'));
  });

  it('montant sous le minimum → erreur et paiement bloqué', async () => {
    stubGiftCard();
    renderWithProviders(<GiftCardsPage />, '/cartes-cadeaux');
    await waitFor(() => expect(screen.getByLabelText('Montant personnalisé')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Montant personnalisé'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText(/Montant minimum/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Offrir/ })).toBeDisabled();
  });
});
