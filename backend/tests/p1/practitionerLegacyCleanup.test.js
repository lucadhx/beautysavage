// tests/p1/practitionerLegacyCleanup.test.js
// M11B — Script cleanup VOLONTAIRE de l'héritage multi-prestataire. Dry-run par défaut (aucune
// écriture) ; --apply consolide vers l'institut + archive les profils legacy ; NE SUPPRIME JAMAIS ;
// --create-global-index crée l'index global unique (après contrôle de doublons). Idempotent.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import { seedTestData } from '../setup/seedTestData.js';
import ServiceBooking from '../../models/ServiceBooking.js';
import BookingSlotLock from '../../models/BookingSlotLock.js';
import PractitionerProfile from '../../models/PractitionerProfile.js';
import { cleanupPractitionerLegacy, GLOBAL_SLOT_INDEX_NAME } from '../../scripts/cleanupPractitionerLegacy.js';

let fx;
let strayProfile;

async function seedStray() {
  // Profil legacy distinct de l'institut + réservation/verrou égarés.
  strayProfile = await PractitionerProfile.create({
    userId: fx.client2._id, displayName: 'Ancienne prestataire', isActive: true, serviceIds: [fx.service._id]
  });
  const startAt = new Date(fx.bookingSlotISO); startAt.setHours(15, 0, 0, 0);
  const endAt = new Date(startAt.getTime() + 60 * 60000);
  await ServiceBooking.create({
    bookingId: 'BKG-STRAY-1', serviceId: fx.service._id, practitionerId: strayProfile._id,
    clientId: fx.client1._id, startAt, endAt, totalPrice: 80, paymentType: 'full',
    paymentStatus: 'paid', status: 'confirmed'
  });
  await BookingSlotLock.create({ practitionerId: strayProfile._id, bookingId: 'BKG-STRAY-1', slotStartAt: startAt });
}

describe('M11B — cleanup practitioner legacy', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await ServiceBooking.syncIndexes();
    await BookingSlotLock.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); await seedStray(); });

  it('dry-run : rapporte les égarés SANS rien écrire', async () => {
    const report = await cleanupPractitionerLegacy({ apply: false });
    expect(report.apply).toBe(false);
    expect(report.applied).toBe(false);
    expect(report.instituteId).toBe(String(fx.practitioner._id));
    expect(report.strayBookings).toBe(1);
    expect(report.strayLocks).toBe(1);
    expect(report.archivableProfiles).toBe(1);

    // Aucune écriture : la réservation égarée pointe toujours sur le profil legacy.
    const stray = await ServiceBooking.findOne({ bookingId: 'BKG-STRAY-1' }).lean();
    expect(String(stray.practitionerId)).toBe(String(strayProfile._id));
    const prof = await PractitionerProfile.findById(strayProfile._id).lean();
    expect(prof.isActive).toBe(true);
  });

  it('--apply : consolide vers l\'institut + archive le profil legacy, sans rien supprimer', async () => {
    const before = await PractitionerProfile.countDocuments({});
    const report = await cleanupPractitionerLegacy({ apply: true });
    expect(report.applied).toBe(true);

    const stray = await ServiceBooking.findOne({ bookingId: 'BKG-STRAY-1' }).lean();
    expect(String(stray.practitionerId)).toBe(String(fx.practitioner._id)); // consolidé
    const lock = await BookingSlotLock.findOne({ bookingId: 'BKG-STRAY-1' }).lean();
    expect(String(lock.practitionerId)).toBe(String(fx.practitioner._id));

    const prof = await PractitionerProfile.findById(strayProfile._id).lean();
    expect(prof.isActive).toBe(false); // archivé
    expect(prof.archivedAt).toBeTruthy();

    // Aucune suppression (le profil existe toujours).
    const after = await PractitionerProfile.countDocuments({});
    expect(after).toBe(before);
  });

  it('idempotent : un second --apply ne change plus rien', async () => {
    await cleanupPractitionerLegacy({ apply: true });
    const report2 = await cleanupPractitionerLegacy({ apply: true });
    expect(report2.strayBookings).toBe(0);
    expect(report2.strayLocks).toBe(0);
    expect(report2.archivableProfiles).toBe(0);
  });

  it('--create-global-index : crée l\'index global unique slotStartAt (sans doublon)', async () => {
    const report = await cleanupPractitionerLegacy({ apply: true, createGlobalIndex: true });
    expect(report.globalIndex.duplicates).toBe(0);
    expect(report.globalIndex.created).toBe(true);
    const indexes = await BookingSlotLock.collection.indexes();
    expect(indexes.some(i => i.name === GLOBAL_SLOT_INDEX_NAME)).toBe(true);
  });
});
