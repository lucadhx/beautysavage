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

function buildWeek(overrides = {}) {
  return [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    isWorking: dayOfWeek >= 1 && dayOfWeek <= 5,
    slots: dayOfWeek >= 1 && dayOfWeek <= 5 ? [{ startTime: '09:00', endTime: '17:00' }] : [],
    ...(overrides[dayOfWeek] || {}),
  }));
}

describe('planning availability settings (HTTP)', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  async function login(email) {
    const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    return res.headers['set-cookie'];
  }

  it('dev can read the institute schedule through /schedule/me even without a practitioner profile', async () => {
    const cookie = await login('dev@test.local');
    const res = await agent.get('/api/gestion/availability/schedule/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.practitionerId).toBe(String(fx.practitioner._id));
  });

  it('refuses a weekly schedule update that would close an already booked slot', async () => {
    const startAt = at(fx.bookingSlotISO, 10);
    const endAt = new Date(startAt.getTime() + Number(fx.service.duration) * 60000);
    await createGlobalServiceBooking({
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

    const cookie = await login('admin@test.local');
    const bookingDay = startAt.getDay();
    const res = await agent
      .put(`/api/gestion/availability/schedule/${fx.practitioner._id}`)
      .set('Cookie', cookie)
      .send({
        weeklySchedule: buildWeek({
          [bookingDay]: { isWorking: true, slots: [{ startTime: '12:00', endTime: '17:00' }] },
        }),
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BOOKING_CONFLICT');
    expect(res.body.conflicts[0].bookingId).toBeTruthy();
  });
});
