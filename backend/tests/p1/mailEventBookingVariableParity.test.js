// tests/p1/mailEventBookingVariableParity.test.js
// M3D — buildBookingConfirmedVariables : parité avec le direct legacy sendBookingConfirmedEmail
// (servicename, dates, practitionername, cancellationdays, paymenttype, depositamount,
// remainingamount), sans e-mail dans les variables.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import User from '../../models/user.js';
import Service from '../../models/Service.js';
import PractitionerProfile from '../../models/PractitionerProfile.js';
import ServiceBooking from '../../models/ServiceBooking.js';
import { buildBookingConfirmedVariables } from '../../services/mail/mailEventVariableBuilder.js';

function eventFor(booking) {
  return { contextType: 'service_booking', contextId: String(booking._id), payloadSafe: { context: { related: {} } } };
}

describe('M3D — parité variables booking_confirmed', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('paiement complet → variables complètes, pas d’e-mail', async () => {
    const user = new User({ email: 'parity-bk@test.local', firstName: 'Mia', lastName: 'Roy', role: 'client' });
    await user.save({ validateBeforeSave: false });
    const service = new Service({ name: 'Épilation' });
    await service.save({ validateBeforeSave: false });
    const practitioner = new PractitionerProfile({ userId: user._id, displayName: 'Romane' });
    await practitioner.save({ validateBeforeSave: false });
    const booking = new ServiceBooking({ clientId: user._id, serviceId: service._id, practitionerId: practitioner._id, bookingId: 'BKG-P1', startAt: new Date('2026-07-15T14:00:00Z'), endAt: new Date('2026-07-15T15:00:00Z'), totalPrice: 90, paymentType: 'full', status: 'confirmed' });
    await booking.save({ validateBeforeSave: false });

    const built = await buildBookingConfirmedVariables(eventFor(booking));
    expect(built.templateKey).toBe('booking_confirmed');
    expect(built.client.email).toBe('parity-bk@test.local');
    expect(built.variables.firstname).toBe('Mia');
    expect(built.variables.servicename).toBe('Épilation');
    expect(built.variables.practitionername).toBe('Romane');
    expect(built.variables.bookingdate).toBeTruthy();
    expect(built.variables.bookingtime).toBeTruthy();
    expect(built.variables.bookingid).toBe('BKG-P1');
    expect(built.variables.paymenttype).toBe('Paiement complet');
    expect(built.variables.depositamount).toBe('');
    expect(built.variables.cancellationdays).toBe('7'); // fallback
    expect(JSON.stringify(built.variables)).not.toContain('parity-bk@test.local');
  });

  it('acompte → paymenttype Acompte + depositamount + remainingamount', async () => {
    const user = new User({ email: 'parity-bk2@test.local', firstName: 'Nina', lastName: 'Sol', role: 'client' });
    await user.save({ validateBeforeSave: false });
    const service = new Service({ name: 'Soin' });
    await service.save({ validateBeforeSave: false });
    const booking = new ServiceBooking({ clientId: user._id, serviceId: service._id, bookingId: 'BKG-P2', startAt: new Date('2026-07-16T10:00:00Z'), endAt: new Date('2026-07-16T11:00:00Z'), totalPrice: 100, depositAmount: 30, paymentType: 'deposit', status: 'confirmed' });
    await booking.save({ validateBeforeSave: false });

    const built = await buildBookingConfirmedVariables(eventFor(booking));
    expect(built.variables.paymenttype).toBe('Acompte');
    expect(built.variables.depositamount).toBe('30.00 €');
    expect(built.variables.remainingamount).toBe('70.00 €');
  });

  it('booking introuvable → null', async () => {
    const fake = { contextType: 'service_booking', contextId: new mongoose.Types.ObjectId().toString(), payloadSafe: { context: { related: {} } } };
    expect(await buildBookingConfirmedVariables(fake)).toBeNull();
  });
});
