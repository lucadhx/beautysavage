import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../../services/notificationService.js', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, triggerNotification: async () => {} };
});

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const ServiceBooking = (await import('../../models/ServiceBooking.js')).default;
const { processCheckoutStatePurchase } = await import('../../services/checkout/checkoutFacade.js');

describe('P0 - service booking slot revalidation', () => {
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

  it('should refuse webhook-side booking creation when the slot has become unavailable', async () => {
    const { client1, client2, service, practitioner, bookingSlotISO } = fixtures;
    const startAt = new Date(bookingSlotISO);
    const endAt = new Date(startAt.getTime() + Number(service.duration) * 60 * 1000);

    await ServiceBooking.create({
      bookingId: 'BKG-EXISTING-TEST',
      serviceId: service._id,
      practitionerId: practitioner._id,
      clientId: client1._id,
      startAt,
      endAt,
      totalPrice: Number(service.price || 0),
      depositAmount: 0,
      paymentType: 'full',
      paymentStatus: 'paid',
      status: 'confirmed'
    });

    await expect(
      processCheckoutStatePurchase({
        userId: client2._id,
        itemType: 'service',
        itemId: service._id,
        checkoutState: {
          item: {
            type: 'service',
            id: String(service._id),
            name: service.name
          },
          service: {
            serviceId: String(service._id),
            slotStart: startAt.toISOString(),
            slotEnd: endAt.toISOString(),
            practitionerId: String(practitioner._id),
            selectedOptions: []
          },
          appliedGiftCards: [],
          totals: {
            basePrice: Number(service.price || 0),
            optionsTotal: 0,
            subtotal: Number(service.price || 0),
            giftCardUsed: 0,
            depositAmount: 0,
            amountToPay: Number(service.price || 0),
            remainingOnSite: 0,
            totalAmount: Number(service.price || 0)
          },
          legal: {
            acceptedCgv: true,
            waiverRequired: false,
            waiverAccepted: false,
            waiverType: null,
            waiverText: ''
          }
        },
        clientIp: '127.0.0.1',
        stripeSessionId: 'pi_service_conflict_test',
        stripePaymentIntentId: 'pi_service_conflict_test'
      })
    ).rejects.toMatchObject({
      status: 409,
      code: 'SLOT_UNAVAILABLE'
    });

    const count = await ServiceBooking.countDocuments({
      practitionerId: practitioner._id,
      status: { $ne: 'cancelled' }
    });
    expect(count).toBe(1);
  });
});
