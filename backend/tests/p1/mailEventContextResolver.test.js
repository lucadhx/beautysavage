// tests/p1/mailEventContextResolver.test.js
// M3B — Resolver mail : retrouve le client via sale/booking/refund (DB, jamais via
// e-mail stocké dans EventLog), et la commerciale via l'identité active M1.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Sale from '../../models/Sale.js';
import ServiceBooking from '../../models/ServiceBooking.js';
import RefundRequest from '../../models/RefundRequest.js';
import User from '../../models/user.js';
import CommunicationIdentity from '../../models/CommunicationIdentity.js';
import {
  resolveClientForEvent,
  resolveCommercialeForEvent,
  resolveMailContextForEvent
} from '../../services/mail/mailEventContextResolver.js';

async function makeUser(email, first, last) {
  const u = new User({ email, firstName: first, lastName: last, role: 'client' });
  await u.save({ validateBeforeSave: false });
  return u;
}

describe('mailEventContextResolver (M3B)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('sale.finalized → retrouve le client via le snapshot Sale', async () => {
    const user = await makeUser('client-sale@test.local', 'Anna', 'Martin');
    const sale = new Sale({ saleId: 'S-1', userId: user._id, customer: { firstName: 'Anna', lastName: 'Martin', email: 'client-sale@test.local' }, totalAmount: 100 });
    await sale.save({ validateBeforeSave: false });

    const eventLog = { contextType: 'sale', contextId: 'S-1', payloadSafe: { context: { related: { saleId: 'S-1', clientId: String(user._id) } } } };
    const client = await resolveClientForEvent(eventLog);
    expect(client).toBeTruthy();
    expect(client.email).toBe('client-sale@test.local');
    expect(client.name).toBe('Anna Martin');
  });

  it('booking.confirmed → retrouve le client via ServiceBooking.clientId', async () => {
    const user = await makeUser('client-booking@test.local', 'Bob', 'Durand');
    const booking = new ServiceBooking({ clientId: user._id, serviceId: new mongoose.Types.ObjectId(), bookingId: 'BK-1', startAt: new Date(), endAt: new Date(), totalPrice: 80, status: 'confirmed' });
    await booking.save({ validateBeforeSave: false });

    const eventLog = { contextType: 'service_booking', contextId: String(booking._id), payloadSafe: { context: { related: { clientId: String(user._id) } } } };
    const client = await resolveClientForEvent(eventLog);
    expect(client.email).toBe('client-booking@test.local');
    expect(client.name).toBe('Bob Durand');
  });

  it('refund.succeeded → retrouve le client via RefundRequest.userId', async () => {
    const user = await makeUser('client-refund@test.local', 'Cleo', 'Petit');
    const refund = new RefundRequest({ userId: user._id, saleId: 'S-2', amount: 30, status: 'succeeded' });
    await refund.save({ validateBeforeSave: false });

    const eventLog = { contextType: 'refund_request', contextId: String(refund._id), payloadSafe: { context: { related: { userId: String(user._id), saleId: 'S-2' } } } };
    const client = await resolveClientForEvent(eventLog);
    expect(client.email).toBe('client-refund@test.local');
  });

  it('refund via saleId fallback (sans userId résolvable) → snapshot Sale', async () => {
    const sale = new Sale({ saleId: 'S-3', customer: { firstName: 'Dan', lastName: 'Roy', email: 'client-sale3@test.local' }, totalAmount: 10 });
    await sale.save({ validateBeforeSave: false });
    const eventLog = { contextType: 'refund_request', contextId: new mongoose.Types.ObjectId().toString(), payloadSafe: { context: { related: { saleId: 'S-3' } } } };
    const client = await resolveClientForEvent(eventLog);
    expect(client.email).toBe('client-sale3@test.local');
  });

  it('commission.available → retrouve la commerciale (identité active institute)', async () => {
    await CommunicationIdentity.create({ role: 'commerciale', scope: 'institute', email: 'commerciale@beautysavage.fr', displayName: 'Commercial BS', active: true, status: 'verified' });
    const commerciale = await resolveCommercialeForEvent({ contextType: 'commission_payment' });
    expect(commerciale).toBeTruthy();
    expect(commerciale.email).toBe('commerciale@beautysavage.fr');
    expect(commerciale.role).toBe('commerciale');
  });

  it('client introuvable → null (pas de throw)', async () => {
    const eventLog = { contextType: 'sale', contextId: 'S-UNKNOWN', payloadSafe: { context: { related: {} } } };
    const client = await resolveClientForEvent(eventLog);
    expect(client).toBeNull();
  });

  it('resolveMailContextForEvent → pont vers M2 (context.client.email)', async () => {
    const user = await makeUser('client-ctx@test.local', 'Eve', 'Blanc');
    const sale = new Sale({ saleId: 'S-4', userId: user._id, customer: { firstName: 'Eve', lastName: 'Blanc', email: 'client-ctx@test.local' }, totalAmount: 60 });
    await sale.save({ validateBeforeSave: false });
    const eventLog = { contextType: 'sale', contextId: 'S-4', payloadSafe: { context: { variables: { amount: 60 }, related: { saleId: 'S-4' } } } };
    const ctx = await resolveMailContextForEvent(eventLog);
    expect(ctx.client.email).toBe('client-ctx@test.local');
    expect(ctx.contextType).toBe('sale');
    expect(ctx.variables.amount).toBe(60);
  });
});
