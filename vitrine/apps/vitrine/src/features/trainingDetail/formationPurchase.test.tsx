// RX3 S3 — Achat formation depuis la fiche : présentiel (session obligatoire) + distanciel (direct).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import type { PublicTraining } from '@bs/api-client';
import { renderWithProviders, stubFetch, jsonResponse } from '../../test/utils';
import { FormationPurchasePanel } from './FormationPurchasePanel';
import { useCart } from '../cart/CartProvider';

afterEach(() => vi.unstubAllGlobals());

function CartCount() {
  const { summary } = useCart();
  return <div>cartcount:{summary.count}</div>;
}

const presentiel: PublicTraining = { id: 'f1', name: 'Maquillage pro', price: 300, type: 'presentiel', refundDays: 14 };
const distanciel: PublicTraining = { id: 'f9', name: 'Onglerie en ligne', price: 120, type: 'distanciel' };

describe('FormationPurchasePanel', () => {
  it('présentiel : ajout impossible sans session, possible après sélection', async () => {
    stubFetch((url) => {
      if (url.includes('/sessions')) {
        return jsonResponse({
          ok: true,
          sessions: [{ id: 'ss1', startDate: '2026-12-01T09:00:00Z', durationLabel: '2 jours', placesRemaining: 5, isAvailable: true, schedule: [{ dayIndex: 0, startTime: '09:00', endTime: '17:00' }] }],
        });
      }
      return jsonResponse({ ok: true }, 404);
    });
    renderWithProviders(<><FormationPurchasePanel training={presentiel} /><CartCount /></>, '/formations/f1');

    // Avant sélection : CTA « Choisissez une session » désactivé
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choisissez une session' })).toBeDisabled());
    expect(screen.getByText('cartcount:0')).toBeInTheDocument();

    // Sélectionne la session puis ajoute
    fireEvent.click(await screen.findByRole('button', { name: /place/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter au panier' }));
    await waitFor(() => expect(screen.getByText('cartcount:1')).toBeInTheDocument());
  });

  it('distanciel : ajout direct au panier', async () => {
    stubFetch(() => jsonResponse({ ok: true }, 404));
    renderWithProviders(<><FormationPurchasePanel training={distanciel} /><CartCount /></>, '/formations/f9');

    expect(screen.getByText('cartcount:0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter au panier' }));
    await waitFor(() => expect(screen.getByText('cartcount:1')).toBeInTheDocument());
  });
});
