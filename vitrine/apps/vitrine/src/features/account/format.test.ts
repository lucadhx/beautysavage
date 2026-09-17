// RX4 — Helpers purs de l'espace client (sélection, formatage, masquage). Sans réseau.
import { describe, it, expect } from 'vitest';
import type { ClientBooking, ClientGiftCard } from '@bs/api-client';
import {
  pickNextBooking,
  isUpcomingBooking,
  bookingBalanceDue,
  bookingStatusTone,
  maskGiftCardCode,
  totalGiftCardBalance,
  greetingName,
  formatTimeRange,
  bookingDurationMinutes,
  refundReasonLabel,
} from './format';

const NOW = Date.UTC(2026, 5, 1, 12, 0, 0); // 2026-06-01T12:00:00Z

function booking(over: Partial<ClientBooking>): ClientBooking {
  return {
    id: 'b', bookingId: 'b', serviceId: 's', serviceName: 'Soin', practitionerName: '', practitionerPhoto: null,
    startAt: null, endAt: null, totalPrice: 0, depositAmount: 0, paymentType: '', paymentStatus: '',
    status: 'confirmed', cancelledAt: null, cancelledBy: null, selectedOptions: [], saleId: null, createdAt: null,
    ...over,
  };
}

describe('pickNextBooking', () => {
  it('sélectionne la réservation à venir la plus proche (non annulée)', () => {
    const list = [
      booking({ id: 'far', startAt: '2026-08-01T10:00:00Z' }),
      booking({ id: 'soon', startAt: '2026-06-10T10:00:00Z' }),
      booking({ id: 'past', startAt: '2026-01-01T10:00:00Z' }),
      booking({ id: 'cancelled', startAt: '2026-06-05T10:00:00Z', status: 'cancelled' }),
    ];
    expect(pickNextBooking(list, NOW)?.id).toBe('soon');
  });
  it('renvoie null sans réservation future', () => {
    expect(pickNextBooking([booking({ startAt: '2026-01-01T10:00:00Z' })], NOW)).toBeNull();
  });
});

describe('isUpcomingBooking', () => {
  it('exclut les annulées et les passées', () => {
    expect(isUpcomingBooking(booking({ startAt: '2026-07-01T10:00:00Z' }), NOW)).toBe(true);
    expect(isUpcomingBooking(booking({ startAt: '2026-07-01T10:00:00Z', status: 'canceled' }), NOW)).toBe(false);
    expect(isUpcomingBooking(booking({ startAt: '2026-01-01T10:00:00Z' }), NOW)).toBe(false);
  });
});

describe('bookingBalanceDue', () => {
  it('total − acompte, borné à 0', () => {
    expect(bookingBalanceDue(booking({ totalPrice: 100, depositAmount: 30 }))).toBe(70);
    expect(bookingBalanceDue(booking({ totalPrice: 100, depositAmount: 100 }))).toBe(0);
    expect(bookingBalanceDue(booking({ totalPrice: 100, depositAmount: 200 }))).toBe(0);
  });
});

describe('bookingStatusTone', () => {
  it('danger si annulée, success si à venir', () => {
    expect(bookingStatusTone('cancelled', '2026-07-01T10:00:00Z')).toBe('danger');
    expect(bookingStatusTone('confirmed', '2050-01-01T10:00:00Z')).toBe('success');
    expect(bookingStatusTone('completed', null)).toBe('muted');
  });
});

describe('maskGiftCardCode', () => {
  it('ne révèle que les 4 derniers caractères', () => {
    expect(maskGiftCardCode('ABCD1234')).toBe('•••• 1234');
    expect(maskGiftCardCode('')).toBe('');
  });
});

describe('totalGiftCardBalance', () => {
  it('additionne les soldes disponibles des cartes actives uniquement', () => {
    const cards = [
      { status: 'active', availableBalance: 20 },
      { status: 'active', availableBalance: 5.5 },
      { status: 'used', availableBalance: 100 },
    ] as ClientGiftCard[];
    expect(totalGiftCardBalance(cards)).toBe(25.5);
  });
});

describe('greetingName', () => {
  it('préfère le prénom, sinon déduit de l\'e-mail', () => {
    expect(greetingName('Julie', 'x@test.fr')).toBe('Julie');
    expect(greetingName('', 'julie.martin@test.fr')).toBe('Julie martin');
    expect(greetingName('', '')).toBe('');
  });
});

describe('formatTimeRange', () => {
  it('renvoie une plage, ou juste le départ, ou vide', () => {
    expect(formatTimeRange('2026-06-01T14:30:00Z', '2026-06-01T15:30:00Z')).toContain('→');
    expect(formatTimeRange(null, null)).toBe('');
  });
});

describe('bookingDurationMinutes', () => {
  it('calcule la durée en minutes, 0 si indéterminable', () => {
    expect(bookingDurationMinutes('2026-06-01T14:00:00Z', '2026-06-01T15:30:00Z')).toBe(90);
    expect(bookingDurationMinutes('2026-06-01T14:00:00Z', null)).toBe(0);
    expect(bookingDurationMinutes('2026-06-01T15:00:00Z', '2026-06-01T14:00:00Z')).toBe(0);
  });
});

describe('refundReasonLabel', () => {
  it('libellé par motif', () => {
    expect(refundReasonLabel('retractation', true)).toMatch(/rétractation/i);
    expect(refundReasonLabel('institut', true)).toMatch(/institut/i);
    expect(refundReasonLabel('none', false)).toMatch(/non remboursable/i);
  });
});
