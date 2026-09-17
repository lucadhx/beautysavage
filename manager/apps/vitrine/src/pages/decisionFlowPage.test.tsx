// RX4 S3 — Page décision tokenisée : options réelles, refund → confirmation → succès, token invalide/expiré.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DecisionFlowPage } from './DecisionFlowPage';

function stub(handler: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => handler(String(url), init)));
}
function json(p: unknown, status = 200) { return new Response(JSON.stringify(p), { status, headers: { 'Content-Type': 'application/json' } }); }
function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}><DecisionFlowPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}
const SERVICE_FLOW = { ok: true, flow: { flowId: 'F1', flowType: 'service_booking_cancelled', decision: 'pending', autoRefundDays: 7, options: { canRefund: true, canReschedule: true, serviceRescheduleAvailable: true } }, service: { id: 's1', name: 'Soin visage' }, bookingSnapshot: { startAt: '2099-06-01T14:00:00Z' }, refundAmount: 90 };

afterEach(() => vi.unstubAllGlobals());

describe('DecisionFlowPage (RX4 S3)', () => {
  it('token manquant → état invalide', () => {
    stub(() => json({ ok: true }));
    renderAt('/decision');
    expect(screen.getByText(/n’est plus valide/)).toBeInTheDocument();
  });

  it('affiche uniquement les options disponibles', async () => {
    stub(() => json(SERVICE_FLOW));
    renderAt('/decision?flowId=F1&token=tok');
    expect(await screen.findByText('Soin visage')).toBeInTheDocument();
    expect(screen.getByText('Demander un remboursement')).toBeInTheDocument();
    expect(screen.getByText('Reporter mon rendez-vous')).toBeInTheDocument();
    expect(screen.queryByText('Recevoir une carte cadeau')).toBeNull();
  });

  it('remboursement : confirmation → succès', async () => {
    stub((url, init) => {
      if (url.includes('/refund') && init?.method === 'POST') return json({ ok: true });
      return json(SERVICE_FLOW);
    });
    renderAt('/decision?flowId=F1&token=tok');
    fireEvent.click(await screen.findByText('Demander un remboursement'));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmer le remboursement' }));
    expect(await screen.findByText(/remboursement est lancé/)).toBeInTheDocument();
  });

  it('token expiré/utilisé → état expiré', async () => {
    stub(() => json({ ok: false, code: 'FLOW_ALREADY_USED', error: 'x' }, 409));
    renderAt('/decision?flowId=F1&token=tok');
    expect(await screen.findByText(/déjà été utilisé/)).toBeInTheDocument();
  });
});
