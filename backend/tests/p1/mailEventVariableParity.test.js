// tests/p1/mailEventVariableParity.test.js
// M3C — Parité des variables : buildRefundSucceededVariables reconstruit les mêmes
// variables que le dispatcher direct (via buildCommonMailVars), sans PII/secret.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import User from '../../models/user.js';
import RefundRequest from '../../models/RefundRequest.js';
import Service from '../../models/Service.js';
import ServiceBooking from '../../models/ServiceBooking.js';
import { buildRefundSucceededVariables } from '../../services/mail/mailEventVariableBuilder.js';

function eventFor(refund) {
  return { contextType: 'refund_request', contextId: String(refund._id), payloadSafe: { context: { related: { refundId: String(refund._id), userId: String(refund.userId), saleId: refund.saleId } } } };
}

describe('M3C — parité variables refund_confirmed', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('formation/produit → templateKey refund_confirmed + variables clés', async () => {
    const user = new User({ email: 'parity@test.local', firstName: 'Ana', lastName: 'Bell', role: 'client' });
    await user.save({ validateBeforeSave: false });
    const refund = new RefundRequest({ userId: user._id, saleId: 'S-1', refundId: 'RF-77', amount: 60, status: 'succeeded', itemType: 'formation', refundedAt: new Date('2026-06-01T08:00:00Z'), trackingToken: 'trk_xyz', meta: { formationTitle: 'Formation Teinture' } });
    await refund.save({ validateBeforeSave: false });

    const built = await buildRefundSucceededVariables(eventFor(refund));
    expect(built.templateKey).toBe('refund_confirmed');
    expect(built.client.email).toBe('parity@test.local');
    expect(built.variables.firstname).toBe('Ana');
    expect(built.variables.lastname).toBe('Bell');
    expect(built.variables.refundid).toBe('RF-77');
    expect(built.variables.refundamount).toBe(60); // montant numérique (parité direct non-service)
    expect(built.variables.itemdetail).toBe('Formation Teinture');
    expect(built.variables.trackingurl).toContain('trk_xyz');
    // pas d'e-mail / secret dans les variables
    const raw = JSON.stringify(built.variables);
    expect(raw).not.toContain('parity@test.local');
    expect(raw).not.toMatch(/whsec_|sk_live_|xkeysib-/);
  });

  it('service → templateKey refund_confirmed_service + montant formaté €', async () => {
    const user = new User({ email: 'parity2@test.local', firstName: 'Bea', lastName: 'Cor', role: 'client' });
    await user.save({ validateBeforeSave: false });
    const refund = new RefundRequest({ userId: user._id, saleId: 'S-2', refundId: 'RF-88', amount: 35, status: 'succeeded', itemType: 'service', refundedAt: new Date('2026-06-02T08:00:00Z') });
    await refund.save({ validateBeforeSave: false });
    const service = new Service({ name: 'Manucure' });
    await service.save({ validateBeforeSave: false });
    const booking = new ServiceBooking({ clientId: user._id, serviceId: service._id, bookingId: 'BK-3', saleId: 'S-2', startAt: new Date('2026-07-03T11:00:00Z'), endAt: new Date('2026-07-03T12:00:00Z'), totalPrice: 35, status: 'confirmed' });
    await booking.save({ validateBeforeSave: false });

    const built = await buildRefundSucceededVariables(eventFor(refund));
    expect(built.templateKey).toBe('refund_confirmed_service');
    expect(built.variables.servicename).toBe('Manucure');
    expect(built.variables.bookingdate).toBeTruthy();
    expect(String(built.variables.refundamount)).toContain('€'); // service variant: montant formaté
  });

  it('refund introuvable → null', async () => {
    const fakeEvent = { contextType: 'refund_request', contextId: new mongoose.Types.ObjectId().toString(), payloadSafe: { context: { related: {} } } };
    expect(await buildRefundSucceededVariables(fakeEvent)).toBeNull();
  });
});
