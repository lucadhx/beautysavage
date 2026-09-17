import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@bs/auth';
import type { AuthUser } from '@bs/api-client';
import { App } from '../../App';

const dev: AuthUser = { id: '1', email: 'dev@b.c', role: 'dev', currentMode: 'gestion' };

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/api/gestion/dev/notifications')) {
        return json({ ok: true, notifications: [], unreadCount: 0 });
      }
      if (u.includes('/api/contract/current')) {
        return json({
          ok: true,
          contract: {
            status: 'active',
            startDate: '2026-07-01T00:00:00.000Z',
            launchFee: { amount: 0, paid: true },
            monthlyFee: { amount: 0, active: true },
            commissions: { type: 'percentage', value: 10 },
          },
        });
      }
      if (u.includes('/api/contract/check-payment-status')) {
        return json({
          ok: true,
          contractStatus: 'active',
          steps: {
            contractActive: true,
            launchFeePaid: true,
            monthlyActive: true,
            fileDownloaded: true,
          },
        });
      }
      if (u.includes('/api/gestion/dev/unified-checkouts')) {
        return json({
          ok: true,
          checkouts: [{
            checkoutId: 'UC-1',
            kind: 'service',
            status: 'pricing_ready',
            source: 'test',
            payment: {
              amountToPay: 80,
              mode: 'stripe',
              provider: 'stripe',
              status: 'pending',
            },
            finalization: { saleId: null, bookingId: null, finalizedAt: null },
            hasPricingSnapshot: true,
            hasTaxSnapshot: true,
            hasLegalConsentSnapshot: true,
            createdAt: null,
            updatedAt: null,
            expiresAt: null,
          }],
        });
      }
      if (u.includes('/api/gestion/dev/events')) {
        return json({
          ok: true,
          events: [{
            eventName: 'booking.confirmed',
            domain: 'booking',
            actorType: 'system',
            source: 'test',
            contextType: 'booking',
            contextId: 'BK-1',
            payloadSafe: {},
            traceId: 'trace-1',
            emittedAt: null,
            createdAt: null,
          }],
        });
      }
      if (u.includes('/api/gestion/dev/webhook-failures')) {
        return json({
          ok: true,
          failures: [{
            provider: 'stripe',
            webhookType: 'checkout',
            eventType: 'payment_intent.succeeded',
            failureStage: 'processing',
            errorCode: 'ERR',
            errorMessageSafe: 'Failure safe.',
            stripeEventId: 'evt_1',
            paymentIntentId: 'pi_1',
            status: 'failed',
            retryable: true,
            createdAt: null,
          }],
        });
      }
      if (u.includes('/api/contract/stripe-dev-config')) {
        return json({ ok: true, publishableKey: 'pk_test_123456789' });
      }
      if (u.includes('/api/gestion/finance/commissions/current')) {
        return json({
          ok: true,
          current: {
            month: 7,
            year: 2026,
            amountDue: 120,
            lateStatus: 'pending_due',
            dueAt: '2026-07-31T00:00:00.000Z',
            paymentStatus: 'pending',
          },
          terms: {
            gracePeriodDays: 3,
            blockingMode: 'warning_only',
          },
          hasContract: true,
        });
      }
      if (u.includes('/api/gestion/finance/commissions/history')) {
        return json({ ok: true, items: [] });
      }
      return json({ ok: true });
    }),
  );
}

function renderApp(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider loader={async () => dev}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('dev panel routes', () => {
  it('renders the dev dashboard instead of ComingSoon', async () => {
    installFetch();
    renderApp('/dev');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Espace développeur' })).toBeInTheDocument());
    expect(screen.queryByText(/bient[oô]t disponible/i)).not.toBeInTheDocument();
  });

  it('renders integrated API diagnostics instead of ComingSoon', async () => {
    installFetch();
    renderApp('/dev/integrated-api');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'API intégrée' })).toBeInTheDocument());
    expect(screen.queryByText(/bient[oô]t disponible/i)).not.toBeInTheDocument();
  });

  it('renders event logs instead of ComingSoon', async () => {
    installFetch();
    renderApp('/dev/event-logs');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Event logs' })).toBeInTheDocument());
    expect(screen.queryByText(/bient[oô]t disponible/i)).not.toBeInTheDocument();
  });

  it('renders webhook failures instead of ComingSoon', async () => {
    installFetch();
    renderApp('/dev/webhook-failures');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Webhook failures' })).toBeInTheDocument());
    expect(screen.queryByText(/bient[oô]t disponible/i)).not.toBeInTheDocument();
  });
});
