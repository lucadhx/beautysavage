// RX4 S3 — Report tokenisé : formation (sessions embarquées) & prestation (calendrier réutilisé).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DecisionReportPage } from './DecisionReportPage';

function stub(handler: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => handler(String(url), init)));
}
function json(p: unknown, status = 200) { return new Response(JSON.stringify(p), { status, headers: { 'Content-Type': 'application/json' } }); }
function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}><DecisionReportPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => vi.unstubAllGlobals());

const FORMATION_FLOW = {
  ok: true,
  flow: { flowId: 'F2', flowType: 'session_cancelled', decision: 'pending', options: { canReschedule: true } },
  formation: { id: 'f', name: 'Volume russe', refundDays: 7 },
  availableSessions: [{ id: 'sess-1', startDate: '2099-07-01T09:00:00Z', durationDays: 2, schedule: [] }],
  legal: { cgvText: '', presentielWaiverBetween7And14: '', presentielWaiverWithin7: '', refundDays: 7 },
};
const SERVICE_FLOW = {
  ok: true,
  flow: { flowId: 'F1', flowType: 'service_booking_cancelled', decision: 'pending', options: { canReschedule: true, serviceRescheduleAvailable: true } },
  service: { id: 's1', name: 'Soin visage', slug: 'soin', duration: 60 },
  bookingSnapshot: { startAt: '2099-06-01T14:00:00Z' },
  serviceAvailable: true,
};

describe('DecisionReportPage (RX4 S3)', () => {
  it('formation : sélection d’une session lointaine (sans waiver) → confirmation', async () => {
    stub((url, init) => {
      if (url.includes('/reschedule') && init?.method === 'POST') return json({ ok: true });
      return json(FORMATION_FLOW);
    });
    renderAt('/decision/report?flowId=F2&token=tok');
    expect(await screen.findByText('Volume russe')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirmer le report' });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByText(/2 juillet 2099|juillet 2099/));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(await screen.findByText(/nouvelle session est confirmée/)).toBeInTheDocument();
  });

  it('prestation : réutilise le calendrier de disponibilité', async () => {
    stub((url) => {
      if (url.includes('/availability/days')) return json({ ok: true, availableDays: [] });
      return json(SERVICE_FLOW);
    });
    renderAt('/decision/report?flowId=F1&token=tok');
    expect(await screen.findByText('Soin visage')).toBeInTheDocument();
    // CTA de confirmation présent mais désactivé tant qu'aucun créneau choisi.
    expect(screen.getByRole('button', { name: 'Confirmer le report' })).toBeDisabled();
  });
});
