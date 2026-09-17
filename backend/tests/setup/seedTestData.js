// tests/setup/seedTestData.js
// Deterministic, reusable fixtures for the test harness.
// Must be called AFTER the app has booted (mongoose connected) — see testApp.js.
//
// Creates:
//   - 1 dev
//   - 1 admin practitioner (+ PractitionerProfile + simple weekly schedule)
//   - 2 clients (both email-verified, known password)
//   - 1 active bookable service/prestation (with one option)
//   - 1 présentiel formation + 1 active session
//   - 1 distanciel formation
//   - 1 product
//   - 1 gift card with a known balance
//
// No real/sensitive data is used. All passwords are the same fixed test password.
import User from '../../models/user.js';
import Service from '../../models/Service.js';
import PractitionerProfile from '../../models/PractitionerProfile.js';
import PractitionerSchedule from '../../models/PractitionerSchedule.js';
import Formation from '../../models/Formation.js';
import FormationSession from '../../models/FormationSession.js';
import Product from '../../models/Product.js';
import GiftCard from '../../models/GiftCard.js';
import Contract from '../../models/Contract.js';
import { hashPassword } from '../../utils/password.js';

export const TEST_PASSWORD = 'Test1234';

function buildNextWorkingBookingSlot() {
  const slot = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  slot.setHours(10, 0, 0, 0);
  while (slot.getDay() === 0 || slot.getDay() === 6) {
    slot.setDate(slot.getDate() + 1);
  }
  return slot;
}

export async function seedTestData() {
  const { hash, salt } = await hashPassword(TEST_PASSWORD);
  const cred = { passwordHash: hash, passwordSalt: salt };

  // Active contract so contractGuard() lets API routes (/api/client, /api/refund-tracking)
  // through. Without this the guard returns 503 CONTRACT_INACTIVE and tests never
  // reach the handlers. Raw insert bypasses mongoose required-field validation.
  await Contract.collection.insertOne({
    contractId: 'CTR-TEST-0001',
    status: 'active',
    createdAt: new Date()
  });

  const dev = await User.create({
    email: 'dev@test.local',
    role: 'dev',
    currentMode: 'gestion',
    emailVerified: true,
    isActive: true,
    ...cred
  });

  const admin = await User.create({
    email: 'admin@test.local',
    role: 'admin',
    currentMode: 'gestion',
    emailVerified: true,
    isActive: true,
    ...cred
  });

  const client1 = await User.create({
    email: 'client1@test.local',
    role: 'client',
    currentMode: 'vitrine',
    emailVerified: true,
    isActive: true,
    ...cred
  });

  const client2 = await User.create({
    email: 'client2@test.local',
    role: 'client',
    currentMode: 'vitrine',
    emailVerified: true,
    isActive: true,
    ...cred
  });

  // Active, bookable service with one option.
  const service = await Service.create({
    name: 'Soin visage test',
    slug: 'soin-visage-test',
    duration: 60,
    price: 80,
    isActive: true,
    isBookable: true,
    paymentType: 'full',
    cancellationDays: 7,
    bookingLeadDays: 0,
    options: [{ name: 'Option masque', price: 20, isActive: true }]
  });

  // Practitioner profile (linked to admin) offering the service.
  const practitioner = await PractitionerProfile.create({
    userId: admin._id,
    displayName: 'Romane (test)',
    isActive: true,
    slotGranularity: 30,
    serviceIds: [service._id]
  });

  // Simple weekly schedule: working Mon-Fri 09:00-17:00.
  await PractitionerSchedule.create({
    practitionerId: practitioner._id,
    weeklySchedule: [0, 1, 2, 3, 4, 5, 6].map(dayOfWeek => ({
      dayOfWeek,
      isWorking: dayOfWeek >= 1 && dayOfWeek <= 5,
      slots: dayOfWeek >= 1 && dayOfWeek <= 5 ? [{ startTime: '09:00', endTime: '17:00' }] : []
    }))
  });

  // Présentiel formation + active session (start in +30 days).
  const sessionStart = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  sessionStart.setHours(9, 0, 0, 0);
  const formationPresentiel = await Formation.create({
    name: 'Formation présentiel test',
    type: 'presentiel',
    price: 500,
    status: 'published',
    active: true,
    refundDays: 7
  });
  const formationSession = await FormationSession.create({
    formationId: formationPresentiel._id,
    startDate: sessionStart,
    durationDays: 2,
    schedule: [
      { dayIndex: 1, startTime: '09:00', endTime: '12:00' },
      { dayIndex: 2, startTime: '09:00', endTime: '12:00' }
    ],
    maxClients: 5,
    reservedCount: 0,
    status: 'active'
  });

  // Distanciel formation.
  const formationDistanciel = await Formation.create({
    name: 'Formation distanciel test',
    type: 'distanciel',
    price: 200,
    status: 'published',
    active: true,
    refundDays: 7
  });

  // Product.
  const product = await Product.create({
    name: 'Produit test',
    price: 40,
    active: true
  });

  // Gift card with a known balance owned by client1.
  const giftCard = await GiftCard.create({
    code: 'TESTGIFT100',
    userId: client1._id,
    amount: 100,
    balance: 100,
    status: 'active'
  });

  // A fixed future bookable slot on a working day for booking tests.
  const bookingSlot = buildNextWorkingBookingSlot();

  return {
    password: TEST_PASSWORD,
    dev,
    admin,
    client1,
    client2,
    service,
    practitioner,
    formationPresentiel,
    formationSession,
    formationDistanciel,
    product,
    giftCard,
    bookingSlotISO: bookingSlot.toISOString()
  };
}
