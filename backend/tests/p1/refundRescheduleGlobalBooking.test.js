// tests/p1/refundRescheduleGlobalBooking.test.js
// M11B — Le reschedule post-annulation/remboursement (applyFlowServiceRescheduleDecision) crée la
// nouvelle réservation via le chemin GLOBAL (createGlobalServiceBooking) : practitionerId non requis
// (legacy ignoré), slot-lock global, double-booking bloqué. Règles de remboursement non modifiées.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../services/notificationService.js', async o => ({ ...(await o()), triggerNotification: async () => {} }));
vi.mock('../../services/mailService.js', async o => ({
  ...(await o()),
  sendBookingConfirmedEmail: async () => true,
  sendServiceRescheduledAdminEmail: async () => true
}));

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const ServiceBooking = (await import('../../models/ServiceBooking.js')).default;
const SessionCancellationFlow = (await import('../../models/SessionCancellationFlow.js')).default;
const {
  applyFlowServiceRescheduleDecision,
  FLOW_TYPE_SERVICE_BOOKING_CANCELLED,
  FLOW_DECISION_PENDING
} = await import('../../services/sessionCancellationFlowService.js');
const { createGlobalServiceBooking } = await import('../../services/calendar/globalAvailabilityService.js');

let fx;
function at(iso, h) { const d = new Date(iso); d.setHours(h, 0, 0, 0); return d; }

async function makeFlow({ practitionerId = null } = {}) {
  const now = new Date();
  return SessionCancellationFlow.create({
    flowId: `FLOW-${now.getTime()}-${Math.floor(now.getTime() % 100000)}`,
    tokenHash: 'hash_' + now.getTime(),
    tokenCreatedAt: now,
    tokenExpiresAt: new Date(now.getTime() + 7 * 86400000),
    autoRefundAt: new Date(now.getTime() + 7 * 86400000),
    decision: FLOW_DECISION_PENDING,
    flowType: FLOW_TYPE_SERVICE_BOOKING_CANCELLED,
    serviceId: fx.service._id,
    userId: fx.client1._id,
    saleId: 'SALE-RESCHED-TEST',
    serviceSnapshot: { name: fx.service.name, slug: fx.service.slug, duration: fx.service.duration, isActive: true, isBookable: true },
    bookingSnapshot: { startAt: at(fx.bookingSlotISO, 9), endAt: at(fx.bookingSlotISO, 10), totalPrice: 80, practitionerId, selectedOptions: [] }
  });
}

describe('M11B — reschedule remboursement → booking global', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await ServiceBooking.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  it('crée un booking GLOBAL (institut) même sans practitionerId', async () => {
    const flow = await makeFlow({ practitionerId: null });
    const { newBooking } = await applyFlowServiceRescheduleDecision({
      flow,
      chosenSlotStart: at(fx.bookingSlotISO, 11).toISOString(),
      chosenSlotEnd: at(fx.bookingSlotISO, 12).toISOString()
    });
    expect(newBooking).toBeTruthy();
    expect(newBooking.status).toBe('confirmed');
    expect(String(newBooking.practitionerId)).toBe(String(fx.practitioner._id));
  });

  it('practitionerId legacy dans le snapshot → ignoré (institut)', async () => {
    const garbage = new mongoose.Types.ObjectId();
    const flow = await makeFlow({ practitionerId: garbage });
    const { newBooking } = await applyFlowServiceRescheduleDecision({
      flow,
      chosenSlotStart: at(fx.bookingSlotISO, 13).toISOString(),
      chosenSlotEnd: at(fx.bookingSlotISO, 14).toISOString()
    });
    expect(String(newBooking.practitionerId)).toBe(String(fx.practitioner._id));
    expect(String(newBooking.practitionerId)).not.toBe(String(garbage));
  });

  it('double-booking global bloqué (créneau déjà pris)', async () => {
    const startAt = at(fx.bookingSlotISO, 15);
    const endAt = at(fx.bookingSlotISO, 16);
    await createGlobalServiceBooking({ bookingData: {
      serviceId: fx.service._id, clientId: fx.client2._id, startAt, endAt,
      totalPrice: 80, paymentType: 'full', paymentStatus: 'paid', status: 'confirmed'
    } });
    const flow = await makeFlow({ practitionerId: null });
    await expect(applyFlowServiceRescheduleDecision({
      flow,
      chosenSlotStart: startAt.toISOString(),
      chosenSlotEnd: endAt.toISOString()
    })).rejects.toMatchObject({ status: 409 });
  });
});
