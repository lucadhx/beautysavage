import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CalendarItem } from '@bs/api-client';
import { PlanningPage } from './PlanningPage';

function todayAt(hour: number): string {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

const BOOKING: CalendarItem = {
  id: 'BKG-1',
  type: 'service_booking',
  title: 'Soin visage',
  startAt: todayAt(10),
  endAt: todayAt(11),
  status: 'confirmed',
  client: { name: 'Jane D.' },
  participant: null,
  paymentStatus: 'deposit_paid',
  paymentType: 'deposit',
  refundStatus: null,
  totalAmount: 100,
  depositAmount: 30,
  amountPaidOnline: 30,
  balanceDueAmount: 70,
  balanceSettlementMode: 'pay_on_site',
  actionLinks: { detail: true, cancel: true, markBalancePaid: true, reschedule: true },
  sourceModel: 'ServiceBooking',
  sourceId: 'x',
};

const FORMATION: CalendarItem = {
  id: 'F-1-d1',
  type: 'formation_session',
  title: 'Formation : CILS',
  startAt: todayAt(14),
  endAt: todayAt(17),
  status: 'active',
  client: null,
  participant: { reservedCount: 2, maxClients: 5, placesLeft: 3 },
  paymentStatus: null,
  paymentType: null,
  refundStatus: null,
  totalAmount: null,
  depositAmount: null,
  amountPaidOnline: null,
  balanceDueAmount: null,
  balanceSettlementMode: null,
  actionLinks: { detail: false, cancel: false, markBalancePaid: false, reschedule: false },
  sourceModel: 'FormationSession',
  sourceId: 'F-1',
};

const calls: { url: string; method: string }[] = [];

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function installFetch() {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method || 'GET' });
    const currentUrl = String(url);
    if (currentUrl.includes('/calendar/items')) {
      return json({ ok: true, items: [BOOKING, FORMATION] });
    }
    if (currentUrl.includes('/availability/schedule/me')) {
      return json({
        ok: true,
        practitionerId: 'p1',
        schedule: {
          practitionerId: 'p1',
          weeklySchedule: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
            dayOfWeek,
            isWorking: dayOfWeek >= 1 && dayOfWeek <= 5,
            slots: dayOfWeek >= 1 && dayOfWeek <= 5 ? [{ startTime: '09:00', endTime: '18:00' }] : [],
          })),
          lunchBreak: { isActive: false, startTime: '12:00', endTime: '13:00' },
        },
      });
    }
    if (currentUrl.includes('/availability/exceptions/p1')) {
      return json({
        ok: true,
        exceptions: [{
          _id: 'exc-1',
          practitionerId: 'p1',
          date: todayAt(0),
          type: 'block',
          isFullDay: false,
          startTime: '12:00',
          endTime: '13:00',
          slots: [{ startTime: '12:00', endTime: '13:00' }],
          reason: 'Pause exceptionnelle',
        }],
      });
    }
    return json({ ok: true });
  }));
}

afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/planning']}>
        <PlanningPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Planning global (M10)', () => {
  it('renders the day time grid without any table', async () => {
    installFetch();
    renderPage();
    await waitFor(() => expect(screen.getByTestId('pl-agenda')).toBeInTheDocument());
    expect(screen.getByText('Soin visage')).toBeInTheDocument();
    expect(screen.getByTestId('pl-formation-card')).toBeInTheDocument();
    expect(screen.getByTestId('pl-closed-zones')).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
  });

  it('switches to the week view', async () => {
    installFetch();
    renderPage();
    await screen.findByTestId('pl-agenda');
    fireEvent.click(screen.getByRole('button', { name: 'Semaine' }));
    await waitFor(() => expect(screen.getByTestId('pl-week')).toBeInTheDocument());
  });

  it('opens the detail drawer and shows the remaining balance', async () => {
    installFetch();
    renderPage();
    fireEvent.click(await screen.findByText('Soin visage'));
    await waitFor(() => expect(screen.getByTestId('pl-drawer')).toBeInTheDocument());
    expect(screen.getByTestId('pl-balance-due')).toHaveTextContent('70,00 €');
    expect(screen.getByTestId('pl-paid-online')).toHaveTextContent('30,00 €');
  });

  it('calls the API when collecting the remaining balance', async () => {
    installFetch();
    renderPage();
    fireEvent.click(await screen.findByText('Soin visage'));
    const button = await screen.findByRole('button', { name: /Encaisser le reste/i });
    fireEvent.click(button);
    await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url.includes('/BKG-1/balance-paid'))).toBe(true));
  });

  it('refetches when filtering by type', async () => {
    installFetch();
    renderPage();
    await screen.findByTestId('pl-agenda');
    fireEvent.click(screen.getByRole('tab', { name: 'Formations' }));
    await waitFor(() => expect(calls.some((call) => call.url.includes('type=formation_session'))).toBe(true));
  });

  it('keeps the reschedule flow available', async () => {
    installFetch();
    renderPage();
    fireEvent.click(await screen.findByText('Soin visage'));
    const button = await screen.findByTestId('pl-reschedule-open');
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(await screen.findByTestId('pl-reschedule-form')).toBeInTheDocument();
  });
});
