import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const { createGlobalServiceBooking } = await import('../../services/calendar/globalAvailabilityService.js');

let agent;
let fx;

function at(iso, hour) {
  const date = new Date(iso);
  date.setHours(hour, 0, 0, 0);
  return date;
}

describe('planning day exceptions (HTTP)', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  async function login(email) {
    const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    return res.headers['set-cookie'];
  }

  async function createBooking(hour = 10) {
    const startAt = at(fx.bookingSlotISO, hour);
    const endAt = new Date(startAt.getTime() + Number(fx.service.duration) * 60000);
    return createGlobalServiceBooking({
      bookingData: {
        serviceId: fx.service._id,
        clientId: fx.client1._id,
        startAt,
        endAt,
        totalPrice: 80,
        totalSoldAmount: 80,
        paymentType: 'full',
        paymentStatus: 'paid',
        status: 'confirmed',
      },
    });
  }

  it('refuses a blocked slot that overlaps an existing booking', async () => {
    await createBooking(10);
    const cookie = await login('admin@test.local');
    const date = fx.bookingSlotISO.slice(0, 10);

    const res = await agent
      .post('/api/gestion/availability/exceptions')
      .set('Cookie', cookie)
      .send({
        practitionerId: String(fx.practitioner._id),
        date,
        type: 'block',
        isFullDay: false,
        slots: [{ startTime: '10:00', endTime: '11:00' }],
        reason: 'Pause',
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BOOKING_CONFLICT');
    expect(res.body.conflicts[0].bookingId).toBeTruthy();
  });

  it('accepts a modify exception that preserves the existing booking window', async () => {
    await createBooking(10);
    const cookie = await login('admin@test.local');
    const date = fx.bookingSlotISO.slice(0, 10);

    const res = await agent
      .post('/api/gestion/availability/exceptions')
      .set('Cookie', cookie)
      .send({
        practitionerId: String(fx.practitioner._id),
        date,
        type: 'modify',
        isFullDay: false,
        slots: [
          { startTime: '09:00', endTime: '12:00' },
          { startTime: '14:00', endTime: '18:00' },
        ],
        reason: 'Aménagement',
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.exception.type).toBe('modify');
  });
});
