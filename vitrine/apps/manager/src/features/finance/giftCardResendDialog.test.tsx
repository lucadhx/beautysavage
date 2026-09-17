// LOT2 §4 — Dialogue de renvoi carte cadeau (reset PIN) : confirmation obligatoire + succès.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const resetMock = vi.fn(async () => ({ pinVersion: 1, mail: {} }));
vi.mock('@bs/api-client', async (orig) => ({
  ...(await (orig() as Promise<Record<string, unknown>>)),
  resetGiftCardPin: (...args: unknown[]) => resetMock(...(args as [])),
}));

import { GiftCardResendControl } from './GiftCardResendControl';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('GiftCardResendControl', () => {
  it('demande confirmation puis renvoie (nouveau code)', async () => {
    wrap(<GiftCardResendControl giftCardId="gc1" status="active" />);
    fireEvent.click(screen.getByText('Renvoyer (nouveau code)'));
    expect(screen.getByText(/nouveau/i)).toBeInTheDocument();
    expect(screen.getByText(/ne peut pas être récupéré/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Confirmer et renvoyer'));
    await waitFor(() => expect(screen.getByText(/nouveau code a été généré/i)).toBeInTheDocument());
    expect(resetMock).toHaveBeenCalledWith('gc1');
  });

  it('est masqué pour une carte non active', () => {
    const { container } = wrap(<GiftCardResendControl giftCardId="gc1" status="redeemed" />);
    expect(container.textContent).not.toContain('Renvoyer');
  });
});
