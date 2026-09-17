import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BookingParticipant, BookingPricingBreakdown, CalendarItem } from '@bs/api-client';
import { CalendarItemDetailDrawer } from './components';

const ITEM: CalendarItem = {
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

describe('booking detail amounts', () => {
  it('renders the three amount cards at the top of the drawer', () => {
    render(
      <CalendarItemDetailDrawer
        item={ITEM}
        onClose={() => {}}
        onCancel={() => {}}
        onMarkPaid={() => {}}
        onReschedule={async () => {}}
      />,
    );

    expect(screen.getByTestId('pl-amount-total')).toHaveTextContent('100,00 €');
    expect(screen.getByTestId('pl-amount-deposit')).toHaveTextContent('30,00 €');
    expect(screen.getByTestId('pl-amount-balance')).toHaveTextContent('70,00 €');
    expect(screen.getByText(/Reste à payer sur place/i)).toBeInTheDocument();
  });

  it('shows the participant and the real-price breakdown (promotion + gift card) when enriched', () => {
    const pricing: BookingPricingBreakdown = {
      catalogAmount: 120,
      promotionApplied: true,
      promotionDiscountAmount: 20,
      soldAmount: 100,
      giftCardAmount: 40,
      paidOnlineAmount: 30,
      paidOnSiteAmount: 0,
      balanceDueAmount: 30,
      totalPaidAmount: 70,
      currency: 'EUR',
    };
    const participant: BookingParticipant = { name: 'Jane Doe', email: 'jane@example.com' };

    render(
      <CalendarItemDetailDrawer
        item={ITEM}
        onClose={() => {}}
        onCancel={() => {}}
        onMarkPaid={() => {}}
        onReschedule={async () => {}}
        pricing={pricing}
        participant={participant}
      />,
    );

    // Participant : qui + combien payé + combien reste
    const person = screen.getByTestId('pl-participants');
    expect(person).toHaveTextContent('Jane Doe');
    expect(person).toHaveTextContent('jane@example.com');
    expect(screen.getByTestId('pl-person-paid')).toHaveTextContent('70,00 €');
    expect(screen.getByTestId('pl-person-due')).toHaveTextContent('30,00 €');

    // Ventilation : catalogue → remise → prix réel, carte cadeau incluse
    expect(screen.getByTestId('pl-real-price')).toHaveTextContent('100,00 €');
    expect(screen.getByTestId('pl-promo-line')).toHaveTextContent('20,00 €');
    expect(screen.getByTestId('pl-giftcard-line')).toHaveTextContent('40,00 €');
    expect(screen.getByTestId('pl-total-paid')).toHaveTextContent('70,00 €');

    // La section fallback (item-level) est remplacée par la ventilation enrichie
    expect(screen.queryByTestId('pl-balance-due')).toBeNull();
  });
});
