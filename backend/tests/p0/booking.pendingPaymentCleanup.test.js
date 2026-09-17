import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const { runPendingPaymentCleanup } = await import('../../automatisme/pendingPaymentCleanupJob.js');
const { PENDING_PAYMENT_EXPIRATION_MINUTES } = await import('../../constants/serviceBooking.js');
const ServiceBooking = (await import('../../models/ServiceBooking.js')).default;
const BookingSlotLock = (await import('../../models/BookingSlotLock.js')).default;

describe('P0 - pending payment cleanup', () => {
  let agent;
  let fixtures;

  beforeAll(async () => {
    agent = await getAgent();
  });

  afterAll(async () => {
    await stopMemoryDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    fixtures = await seedTestData();
  });

  async function loginAsClient(email) {
    const response = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
    expect(response.status).toBe(200);
    return response.headers['set-cookie'];
  }

  async function createPendingBooking() {
    const cookie = await loginAsClient('client1@test.local');
    const response = await agent
      .post('/api/client/bookings')
      .set('Cookie', cookie)
      .send({
        serviceId: String(fixtures.service._id),
        practitionerId: String(fixtures.practitioner._id),
        startAt: fixtures.bookingSlotISO
      });

    expect(response.status).toBe(201);
    expect(response.body?.booking?.status).toBe('pending_payment');
    const bookingId = String(response.body?.booking?.bookingId || '').trim();
    expect(bookingId).toBeTruthy();

    return bookingId;
  }

  async function countLocks(bookingId) {
    return BookingSlotLock.countDocuments({ bookingId });
  }

  it('expires an old pending_payment booking and releases its locks', async () => {
    const bookingId = await createPendingBooking();
    const expiredAt = new Date(
      Date.now() - (PENDING_PAYMENT_EXPIRATION_MINUTES + 5) * 60 * 1000
    );

    await ServiceBooking.updateOne(
      { bookingId },
      { $set: { createdAt: expiredAt } }
    );

    const beforeLocks = await countLocks(bookingId);
    expect(beforeLocks).toBeGreaterThan(0);

    const summary = await runPendingPaymentCleanup({ now: new Date() });
    expect(summary.cancelledCount).toBe(1);

    const booking = await ServiceBooking.findOne({ bookingId }).lean();
    expect(booking?.status).toBe('cancelled');
    expect(booking?.cancelledBy).toBe('system');
    expect(booking?.cancelledAt).not.toBeNull();
    expect(booking?.paymentStatus).toBe('cancelled');
    expect(await countLocks(bookingId)).toBe(0);
  });

  it('does nothing on a non-expired pending_payment booking', async () => {
    const bookingId = await createPendingBooking();

    const summary = await runPendingPaymentCleanup({ now: new Date() });
    expect(summary.cancelledCount).toBe(0);

    const booking = await ServiceBooking.findOne({ bookingId }).lean();
    expect(booking?.status).toBe('pending_payment');
    expect(await countLocks(bookingId)).toBeGreaterThan(0);
  });

  it('leaves a confirmed booking untouched', async () => {
    const bookingId = await createPendingBooking();
    await ServiceBooking.updateOne(
      { bookingId },
      {
        $set: {
          status: 'confirmed',
          paymentStatus: 'paid',
          saleId: 'SALE-CONFIRMED-001',
          stripePaymentIntentId: 'pi_confirmed_001'
        }
      }
    );

    const summary = await runPendingPaymentCleanup({ now: new Date() });
    expect(summary.cancelledCount).toBe(0);

    const booking = await ServiceBooking.findOne({ bookingId }).lean();
    expect(booking?.status).toBe('confirmed');
    expect(booking?.saleId).toBe('SALE-CONFIRMED-001');
    expect(await countLocks(bookingId)).toBeGreaterThan(0);
  });

  it('is idempotent when run twice on the same expired booking', async () => {
    const bookingId = await createPendingBooking();
    const expiredAt = new Date(
      Date.now() - (PENDING_PAYMENT_EXPIRATION_MINUTES + 5) * 60 * 1000
    );

    await ServiceBooking.updateOne(
      { bookingId },
      { $set: { createdAt: expiredAt } }
    );

    const first = await runPendingPaymentCleanup({ now: new Date() });
    const second = await runPendingPaymentCleanup({ now: new Date() });

    expect(first.cancelledCount).toBe(1);
    expect(second.cancelledCount).toBe(0);
    expect(await countLocks(bookingId)).toBe(0);

    const booking = await ServiceBooking.findOne({ bookingId }).lean();
    expect(booking?.status).toBe('cancelled');
  });

  it('does not break a booking already marked as paid before expiration', async () => {
    const bookingId = await createPendingBooking();
    const oldCreatedAt = new Date(
      Date.now() - (PENDING_PAYMENT_EXPIRATION_MINUTES + 5) * 60 * 1000
    );

    await ServiceBooking.updateOne(
      { bookingId },
      {
        $set: {
          createdAt: oldCreatedAt,
          paymentStatus: 'paid',
          saleId: 'SALE-PAID-001',
          stripePaymentIntentId: 'pi_paid_001'
        }
      }
    );

    const summary = await runPendingPaymentCleanup({ now: new Date() });
    expect(summary.cancelledCount).toBe(0);

    const booking = await ServiceBooking.findOne({ bookingId }).lean();
    expect(booking?.status).toBe('pending_payment');
    expect(booking?.paymentStatus).toBe('paid');
    expect(booking?.saleId).toBe('SALE-PAID-001');
    expect(await countLocks(bookingId)).toBeGreaterThan(0);
  });
});
