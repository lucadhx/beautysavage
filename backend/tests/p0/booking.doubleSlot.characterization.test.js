import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../../services/notificationService.js', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, triggerNotification: async () => {} };
});

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const ServiceBooking = (await import('../../models/ServiceBooking.js')).default;
const ScheduleException = (await import('../../models/ScheduleException.js')).default;

describe('P0 - service booking slot protection', () => {
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

  async function loginAs(email) {
    const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    return res.headers['set-cookie'];
  }

  function buildIsoAtLocalTime(sourceIso, hours, minutes, dayOffset = 0) {
    const date = new Date(sourceIso);
    date.setDate(date.getDate() + dayOffset);
    date.setHours(hours, minutes, 0, 0);
    return date.toISOString();
  }

  function buildDateOnlyUtc(sourceIso) {
    const date = new Date(sourceIso);
    return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  }

  async function createBooking(cookie, { serviceId, practitionerId, startAt }) {
    return agent
      .post('/api/client/bookings')
      .set('Cookie', cookie)
      .send({ serviceId, practitionerId, startAt });
  }

  it('should allow only one booking when two clients race for the exact same slot', async () => {
    const { service, practitioner, bookingSlotISO } = fixtures;
    const serviceId = String(service._id);
    const practitionerId = String(practitioner._id);
    const cookie1 = await loginAs('client1@test.local');
    const cookie2 = await loginAs('client2@test.local');

    const [r1, r2] = await Promise.all([
      createBooking(cookie1, { serviceId, practitionerId, startAt: bookingSlotISO }),
      createBooking(cookie2, { serviceId, practitionerId, startAt: bookingSlotISO })
    ]);

    const statuses = [r1.status, r2.status].sort((left, right) => left - right);
    expect(statuses).toEqual([201, 409]);

    const count = await ServiceBooking.countDocuments({
      practitionerId: practitioner._id,
      startAt: new Date(bookingSlotISO),
      status: { $ne: 'cancelled' }
    });
    expect(count).toBe(1);
  });

  it('should reject a partially overlapping slot even with a different start time', async () => {
    const { service, practitioner, bookingSlotISO } = fixtures;
    const serviceId = String(service._id);
    const practitionerId = String(practitioner._id);
    const cookie1 = await loginAs('client1@test.local');
    const cookie2 = await loginAs('client2@test.local');
    const overlapStart = buildIsoAtLocalTime(bookingSlotISO, 10, 30);

    const [r1, r2] = await Promise.all([
      createBooking(cookie1, { serviceId, practitionerId, startAt: bookingSlotISO }),
      createBooking(cookie2, { serviceId, practitionerId, startAt: overlapStart })
    ]);

    const statuses = [r1.status, r2.status].sort((left, right) => left - right);
    expect(statuses).toEqual([201, 409]);

    const count = await ServiceBooking.countDocuments({
      practitionerId: practitioner._id,
      status: { $ne: 'cancelled' }
    });
    expect(count).toBe(1);
  });

  it('should reject a slot in the past', async () => {
    const { service, practitioner } = fixtures;
    const cookie = await loginAs('client1@test.local');
    const past = new Date();
    past.setDate(past.getDate() - 1);
    past.setHours(10, 0, 0, 0);

    const res = await createBooking(cookie, {
      serviceId: String(service._id),
      practitionerId: String(practitioner._id),
      startAt: past.toISOString()
    });

    expect(res.status).toBe(409);
  });

  it('should reject a slot outside practitioner schedule', async () => {
    const { service, practitioner, bookingSlotISO } = fixtures;
    const cookie = await loginAs('client1@test.local');

    const res = await createBooking(cookie, {
      serviceId: String(service._id),
      practitionerId: String(practitioner._id),
      startAt: buildIsoAtLocalTime(bookingSlotISO, 18, 0)
    });

    expect(res.status).toBe(409);
  });

  it('should reject a slot covered by a partial block exception', async () => {
    const { service, practitioner, bookingSlotISO } = fixtures;
    const cookie = await loginAs('client1@test.local');

    await ScheduleException.create({
      practitionerId: practitioner._id,
      date: buildDateOnlyUtc(bookingSlotISO),
      type: 'block',
      isFullDay: false,
      startTime: '10:15',
      endTime: '10:45',
      reason: 'Pause exceptionnelle'
    });

    const res = await createBooking(cookie, {
      serviceId: String(service._id),
      practitionerId: String(practitioner._id),
      startAt: bookingSlotISO
    });

    expect(res.status).toBe(409);
  });

  it('should allow a slot that is explicitly opened by a modify exception', async () => {
    const { service, practitioner, bookingSlotISO } = fixtures;
    const cookie = await loginAs('client1@test.local');
    const serviceId = String(service._id);
    const practitionerId = String(practitioner._id);

    await ScheduleException.create({
      practitionerId: practitioner._id,
      date: buildDateOnlyUtc(bookingSlotISO),
      type: 'modify',
      isFullDay: false,
      slots: [{ startTime: '14:00', endTime: '16:00' }],
      reason: 'Horaires modifies'
    });

    const offWindow = await createBooking(cookie, {
      serviceId,
      practitionerId,
      startAt: bookingSlotISO
    });
    expect(offWindow.status).toBe(409);

    const openWindow = await createBooking(cookie, {
      serviceId,
      practitionerId,
      startAt: buildIsoAtLocalTime(bookingSlotISO, 14, 0)
    });
    expect(openWindow.status).toBe(201);
  });

  it('should free the slot after a client cancellation', async () => {
    const { service, practitioner, bookingSlotISO } = fixtures;
    const serviceId = String(service._id);
    const practitionerId = String(practitioner._id);
    const cookie1 = await loginAs('client1@test.local');
    const cookie2 = await loginAs('client2@test.local');

    const created = await createBooking(cookie1, { serviceId, practitionerId, startAt: bookingSlotISO });
    expect(created.status).toBe(201);

    const cancelRes = await agent
      .post(`/api/client/bookings/${encodeURIComponent(created.body.booking.bookingId)}/cancel`)
      .set('Cookie', cookie1)
      .send({});
    expect(cancelRes.status).toBe(200);

    const retry = await createBooking(cookie2, { serviceId, practitionerId, startAt: bookingSlotISO });
    expect(retry.status).toBe(201);
  });
});
