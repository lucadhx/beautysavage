// tests/p1/businessEventContextEnrichment.test.js
// M3B — Les emitters attachent un `context` standard (related IDs + variables) au
// payload, et EventLog ne contient jamais de secret/token/password/e-mail.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import EventLog from '../../models/EventLog.js';
import { clearSubscribers } from '../../services/eventBusService.js';
import {
  emitSaleEvent,
  emitBookingEvent,
  emitRefundEvent,
  emitCommissionEvent,
  emitGiftCardEvent
} from '../../services/businessEventService.js';

describe('business event context enrichment (M3B)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); clearSubscribers(); });
  afterEach(() => { vi.restoreAllMocks(); clearSubscribers(); });

  it('sale.finalized → payloadSafe.context porte related IDs + variables, sans e-mail', async () => {
    const userId = new mongoose.Types.ObjectId();
    const formationId = new mongoose.Types.ObjectId();
    await emitSaleEvent('sale.finalized', {
      saleId: 'S-1', userId, totalAmount: 120,
      customer: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
      stripePaymentIntentId: 'pi_secret',
      items: [{ name: 'Formation X', formationId }]
    });
    const ev = await EventLog.findOne({ eventName: 'sale.finalized' }).lean();
    const ctx = ev.payloadSafe.context;
    expect(ctx).toBeTruthy();
    expect(ctx.contextType).toBe('sale');
    expect(ctx.related.saleId).toBe('S-1');
    expect(ctx.related.clientId).toBe(String(userId));
    expect(ctx.related.formationId).toBe(String(formationId));
    expect(ctx.variables.amount).toBe(120);
    expect(ctx.variables.clientName).toBe('Jane Doe');
    expect(ctx.privacy.containsPii).toBe(true);
    // jamais d'e-mail / secret dans tout l'EventLog
    const raw = JSON.stringify(ev);
    expect(raw).not.toContain('jane@example.com');
    expect(raw).not.toContain('pi_secret');
  });

  it('booking.created → context.related bookingId/serviceId/clientId', async () => {
    const _id = new mongoose.Types.ObjectId();
    const clientId = new mongoose.Types.ObjectId();
    const serviceId = new mongoose.Types.ObjectId();
    await emitBookingEvent('booking.created', { _id, bookingId: 'BK-1', clientId, serviceId, startAt: new Date('2026-07-01T09:00:00Z'), totalPrice: 80, status: 'confirmed' });
    const ev = await EventLog.findOne({ eventName: 'booking.created' }).lean();
    expect(ev.payloadSafe.context.related.bookingId).toBe('BK-1');
    expect(ev.payloadSafe.context.related.clientId).toBe(String(clientId));
    expect(ev.payloadSafe.context.variables.bookingDate).toBe('2026-07-01T09:00:00.000Z');
  });

  it('refund.succeeded → context.related refundId/saleId + refundAmount', async () => {
    const _id = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    await emitRefundEvent('refund.succeeded', { _id, saleId: 'S-1', userId, amount: 50, itemType: 'formation', status: 'succeeded' });
    const ev = await EventLog.findOne({ eventName: 'refund.succeeded' }).lean();
    expect(ev.payloadSafe.context.related.refundId).toBe(String(_id));
    expect(ev.payloadSafe.context.related.saleId).toBe('S-1');
    expect(ev.payloadSafe.context.variables.refundAmount).toBe(50);
  });

  it('commission.available → context.related commissionPaymentId + commissionAmount', async () => {
    const _id = new mongoose.Types.ObjectId();
    await emitCommissionEvent('commission.available', { _id, month: 5, year: 2026, netAmountDue: 210, status: 'pending' });
    const ev = await EventLog.findOne({ eventName: 'commission.available' }).lean();
    expect(ev.payloadSafe.context.related.commissionPaymentId).toBe(String(_id));
    expect(ev.payloadSafe.context.variables.commissionAmount).toBe(210);
  });

  it('gift_card.created → context.related giftCardId', async () => {
    const _id = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    await emitGiftCardEvent('gift_card.created', { _id, userId, amount: 100 }, { extra: { amount: 100 } });
    const ev = await EventLog.findOne({ eventName: 'gift_card.created' }).lean();
    expect(ev.payloadSafe.context.related.giftCardId).toBe(String(_id));
    expect(ev.contextType).toBe('gift_card');
  });

  it('payload existant inchangé (clés legacy conservées)', async () => {
    await emitSaleEvent('sale.finalized', { saleId: 'S-2', totalAmount: 10, stripePaymentIntentId: 'pi' });
    const ev = await EventLog.findOne({ eventName: 'sale.finalized', 'payloadSafe.saleId': 'S-2' }).lean();
    expect(ev.payloadSafe.saleId).toBe('S-2');
    expect(ev.payloadSafe.hasStripePayment).toBe(true);
  });
});
