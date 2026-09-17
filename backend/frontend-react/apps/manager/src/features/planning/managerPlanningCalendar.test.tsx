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

function todayKey(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const currentUrl = String(url);
    if (currentUrl.includes('/calendar/items')) return json({ ok: true, items: [BOOKING] });
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
          date: `${todayKey()}T00:00:00.000Z`,
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

describe('manager planning calendar', () => {
  it('renders the hourly calendar with blocked zones and week toggle', async () => {
    installFetch();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/planning']}>
          <PlanningPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('pl-agenda')).toBeInTheDocument());
    expect(screen.getByTestId('pl-blocked-zone')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Semaine' }));
    await waitFor(() => expect(screen.getByTestId('pl-week')).toBeInTheDocument());
  });
});
