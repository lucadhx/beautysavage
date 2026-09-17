// tests/p1/globalCalendarService.test.js
// M10 — Calendrier global : liste bookings + formations présentielles ; mappers SAFE.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import { seedTestData } from '../setup/seedTestData.js';
import ServiceBooking from '../../models/ServiceBooking.js';
import {
  listGlobalCalendarItems,
  mapServiceBookingToCalendarItem,
  mapFormationSessionToCalendarItem
} from '../../services/calendar/globalCalendarService.js';

let seed;

describe('global calendar service (M10)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); seed = await seedTestData(); });

  async function seedConfirmedBooking(overrides = {}) {
    const startAt = new Date(seed.bookingSlotISO);
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    return ServiceBooking.create({
      bookingId: `BKG-${Date.now()}-x`,
      serviceId: seed.service._id,
      practitionerId: seed.practitioner._id, // legacy = institut
      clientId: seed.client1._id,
      startAt, endAt,
      totalPrice: 80, totalSoldAmount: 80,
      paymentType: 'full', paymentStatus: 'paid', status: 'confirmed',
      ...overrides
    });
  }

  it('liste les réservations prestations (global, sans filtre prestataire)', async () => {
    await seedConfirmedBooking();
    const items = await listGlobalCalendarItems({
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 60 * 86400000)
    });
    const bookings = items.filter(i => i.type === 'service_booking');
    expect(bookings.length).toBe(1);
    expect(bookings[0].title).toBe('Soin visage test');
    expect(bookings[0].client.name).toBeNull(); // client sans nom → null (jamais d'e-mail)
    expect(bookings[0].sourceModel).toBe('ServiceBooking');
  });

  it('inclut les formations présentielles dans le calendrier', async () => {
    const items = await listGlobalCalendarItems({
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 60 * 86400000),
      status: 'active'
    });
    const formations = items.filter(i => i.type === 'formation_session');
    expect(formations.length).toBeGreaterThanOrEqual(1);
    expect(formations[0].title).toContain('Formation');
    expect(formations[0].participant).toMatchObject({ maxClients: 5, placesLeft: 5 });
  });

  it('mapServiceBookingToCalendarItem expose acompte/solde et actions', () => {
    const item = mapServiceBookingToCalendarItem({
      bookingId: 'B1', startAt: new Date(), endAt: new Date(), status: 'confirmed',
      paymentType: 'deposit', paymentStatus: 'deposit_paid',
      depositAmount: 30, totalPrice: 100, totalSoldAmount: 100,
      balanceDueAmount: 70, balanceSettlementMode: 'pay_on_site', _id: 'x'
    }, { service: { name: 'Soin' } });
    expect(item.amountPaidOnline).toBe(30);
    expect(item.balanceDueAmount).toBe(70);
    expect(item.actionLinks.markBalancePaid).toBe(true);
    expect(item.actionLinks.cancel).toBe(true);
    // M11B — report admin global désormais disponible pour une réservation active.
    expect(item.actionLinks.reschedule).toBe(true);
  });

  it('mapFormationSessionToCalendarItem produit un item par jour planifié', () => {
    const start = new Date(2026, 8, 1);
    const items = mapFormationSessionToCalendarItem({
      _id: 's1', startDate: start, durationDays: 2, maxClients: 5, reservedCount: 2, status: 'active',
      schedule: [{ dayIndex: 1, startTime: '09:00', endTime: '12:00' }, { dayIndex: 2, startTime: '09:00', endTime: '12:00' }]
    }, { formationName: 'CILS' });
    expect(items.length).toBe(2);
    expect(items[0].type).toBe('formation_session');
    expect(items[0].participant.placesLeft).toBe(3);
  });
});
