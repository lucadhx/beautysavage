import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CalendarItem, PlanningSchedule, PlanningExceptionInput } from '@bs/api-client';
import { PlanningAvailabilityPanel } from './components';

const BOOKING: CalendarItem = {
  id: 'BKG-1',
  type: 'service_booking',
  title: 'Soin visage',
  startAt: '2026-07-08T10:00:00',
  endAt: '2026-07-08T11:00:00',
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

const SCHEDULE: PlanningSchedule = {
  practitionerId: 'p1',
  weeklySchedule: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    isWorking: dayOfWeek >= 1 && dayOfWeek <= 5,
    slots: dayOfWeek >= 1 && dayOfWeek <= 5 ? [{ startTime: '09:00', endTime: '18:00' }] : [],
  })),
  lunchBreak: { isActive: false, startTime: '12:00', endTime: '13:00' },
};

function renderPanel(overrides?: Partial<ComponentProps<typeof PlanningAvailabilityPanel>>) {
  const onSaveSchedule = vi.fn(async () => {});
  const onCreateException = vi.fn(async (_input: PlanningExceptionInput) => {});
  const onUpdateException = vi.fn(async () => {});
  const onDeleteException = vi.fn(async () => {});

  const view = render(
    <PlanningAvailabilityPanel
      schedule={SCHEDULE}
      practitionerId="p1"
      exceptions={[]}
      visibleBookings={[BOOKING]}
      onSaveSchedule={onSaveSchedule}
      onCreateException={onCreateException}
      onUpdateException={onUpdateException}
      onDeleteException={onDeleteException}
      busy={false}
      {...overrides}
    />,
  );

  return { ...view, onSaveSchedule, onCreateException };
}

describe('PlanningAvailabilityPanel', () => {
  it('saves the weekly schedule', async () => {
    const { onSaveSchedule } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer les disponibilités/i }));
    expect(onSaveSchedule).toHaveBeenCalledTimes(1);
  });

  it('opens the exception editor in a modal from the CTA', async () => {
    renderPanel();
    expect(screen.queryByTestId('pl-exception-modal')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ajouter une exception/i }));
    expect(await screen.findByTestId('pl-exception-modal')).toBeInTheDocument();
  });

  it('blocks conflicting exceptions before submit', async () => {
    const { onCreateException } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Ajouter une exception/i }));
    await screen.findByTestId('pl-exception-modal');
    fireEvent.change(screen.getByLabelText("Date de l'exception"), { target: { value: '2026-07-08' } });
    fireEvent.change(screen.getByLabelText("Heure de début de l'exception"), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText("Heure de fin de l'exception"), { target: { value: '11:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer l’exception/i }));
    expect(await screen.findByTestId('pl-exception-conflict')).toBeInTheDocument();
    expect(onCreateException).not.toHaveBeenCalled();
  });
});
