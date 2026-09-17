// LOT2 §3 — Matrice des déclencheurs (page). Rendu des lignes + filtre par catégorie.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@bs/api-client', async (orig) => ({
  ...(await (orig() as Promise<Record<string, unknown>>)),
  getCommunicationTriggers: vi.fn(async () => ({
    engineEnabled: false,
    rows: [
      { event: 'booking.confirmed', category: 'réservation', templateKey: 'booking_confirmed', templatePublished: true, fromRole: 'commerciale', toRole: 'client', active: true, directSender: false, engine: false, lastSentAt: null, lastStatus: null },
      { event: 'gift_card.online_created', category: 'carte cadeau', templateKey: 'gift_card_online_created', templatePublished: true, fromRole: 'commerciale', toRole: 'client', active: true, directSender: false, engine: false, lastSentAt: null, lastStatus: 'sent' },
    ],
  })),
}));

import { CommunicationTriggersPage } from './CommunicationTriggersPage';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('CommunicationTriggersPage', () => {
  it('affiche une ligne par déclencheur', async () => {
    wrap(<CommunicationTriggersPage />);
    await waitFor(() => expect(screen.getByText('booking.confirmed')).toBeInTheDocument());
    expect(screen.getByText('gift_card.online_created')).toBeInTheDocument();
  });

  it('filtre par catégorie', async () => {
    wrap(<CommunicationTriggersPage />);
    await waitFor(() => screen.getByText('booking.confirmed'));
    fireEvent.change(screen.getByLabelText(/Catégorie/i), { target: { value: 'carte cadeau' } });
    expect(screen.queryByText('booking.confirmed')).not.toBeInTheDocument();
    expect(screen.getByText('gift_card.online_created')).toBeInTheDocument();
  });
});
