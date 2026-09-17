// tests/p1/eventContextBuilder.test.js
// M3B — Builders : contexte standard par domaine + sanitize (retire e-mail/secret/token).
import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import {
  buildSaleEventContext,
  buildBookingEventContext,
  buildRefundEventContext,
  buildCommissionEventContext,
  buildGiftCardEventContext,
  buildSystemEventContext,
  sanitizeEventContext,
  normalizeEventContext
} from '../../services/eventContextBuilderService.js';

describe('eventContextBuilderService (M3B)', () => {
  it('buildSaleEventContext : related IDs + variables, e-mail JAMAIS inclus', () => {
    const userId = new mongoose.Types.ObjectId();
    const formationId = new mongoose.Types.ObjectId();
    const sale = {
      saleId: 'S-1', userId, totalAmount: 120,
      customer: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
      items: [{ name: 'Formation X', formationId }]
    };
    const ctx = buildSaleEventContext(sale);
    expect(ctx.contextType).toBe('sale');
    expect(ctx.contextId).toBe('S-1');
    expect(ctx.related.saleId).toBe('S-1');
    expect(ctx.related.clientId).toBe(String(userId));
    expect(ctx.related.formationId).toBe(String(formationId));
    expect(ctx.variables.amount).toBe(120);
    expect(ctx.variables.itemName).toBe('Formation X');
    expect(ctx.variables.clientName).toBe('Jane Doe');
    expect(ctx.privacy.containsPii).toBe(true);
    expect(ctx.privacy.piiFields).toContain('clientName');
    // e-mail jamais présent
    expect(JSON.stringify(ctx)).not.toContain('jane@example.com');
  });

  it('buildBookingEventContext : IDs + bookingDate', () => {
    const _id = new mongoose.Types.ObjectId();
    const clientId = new mongoose.Types.ObjectId();
    const serviceId = new mongoose.Types.ObjectId();
    const ctx = buildBookingEventContext({ _id, bookingId: 'BK-1', clientId, serviceId, startAt: new Date('2026-07-01T09:00:00Z'), totalPrice: 80, status: 'confirmed' });
    expect(ctx.contextType).toBe('service_booking');
    expect(ctx.related.bookingId).toBe('BK-1');
    expect(ctx.related.serviceId).toBe(String(serviceId));
    expect(ctx.related.clientId).toBe(String(clientId));
    expect(ctx.variables.bookingDate).toBe('2026-07-01T09:00:00.000Z');
    expect(ctx.variables.amount).toBe(80);
  });

  it('buildRefundEventContext : refundId + saleId + refundAmount', () => {
    const _id = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const ctx = buildRefundEventContext({ _id, saleId: 'S-1', userId, amount: 50, itemType: 'formation', status: 'succeeded' });
    expect(ctx.contextType).toBe('refund_request');
    expect(ctx.related.refundId).toBe(String(_id));
    expect(ctx.related.saleId).toBe('S-1');
    expect(ctx.variables.refundAmount).toBe(50);
  });

  it('buildCommissionEventContext : commissionPaymentId + commissionAmount, pas de client', () => {
    const _id = new mongoose.Types.ObjectId();
    const ctx = buildCommissionEventContext({ _id, month: 5, year: 2026, netAmountDue: 210, status: 'pending' });
    expect(ctx.contextType).toBe('commission_payment');
    expect(ctx.related.commissionPaymentId).toBe(String(_id));
    expect(ctx.variables.commissionAmount).toBe(210);
    expect(ctx.related.clientId).toBeUndefined();
    expect(ctx.privacy.containsPii).toBe(false);
  });

  it('buildGiftCardEventContext : giftCardId + amount', () => {
    const _id = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const ctx = buildGiftCardEventContext({ _id, userId, amount: 100, saleId: 'S-9' });
    expect(ctx.contextType).toBe('gift_card');
    expect(ctx.related.giftCardId).toBe(String(_id));
    expect(ctx.related.saleId).toBe('S-9');
    expect(ctx.variables.amount).toBe(100);
  });

  it('sanitizeEventContext retire les champs sensibles (e-mail/secret/token/password/code)', () => {
    const dirty = {
      contextType: 'sale', contextId: 'S-1',
      related: { saleId: 'S-1', token: 'whsec_abc', stripePaymentIntentId: 'pi_x' },
      variables: { amount: 10, clientEmail: 'leak@example.com', password: 'p', giftCardCode: 'GC-XYZ', note: 'contact me at z@w.com', clientName: 'Jane Doe' }
    };
    const ctx = sanitizeEventContext(dirty);
    const raw = JSON.stringify(ctx);
    expect(raw).not.toContain('whsec_abc');
    expect(raw).not.toContain('leak@example.com');
    expect(raw).not.toContain('z@w.com');
    expect(raw).not.toContain('GC-XYZ');
    expect(ctx.related.token).toBeUndefined();
    expect(ctx.related.stripePaymentIntentId).toBeUndefined();
    expect(ctx.variables.clientEmail).toBeUndefined();
    expect(ctx.variables.password).toBeUndefined();
    expect(ctx.variables.giftCardCode).toBeUndefined();
    // champs safe conservés
    expect(ctx.variables.amount).toBe(10);
    expect(ctx.variables.clientName).toBe('Jane Doe');
    expect(ctx.privacy.piiFields).toContain('clientName');
  });

  it('builder sur entrée null → contexte vide mais valide', () => {
    const ctx = buildSaleEventContext(null);
    expect(ctx.contextType).toBe('sale');
    expect(ctx.related).toEqual({});
    expect(ctx.privacy.containsPii).toBe(false);
  });

  it('normalizeEventContext garantit la forme', () => {
    const ctx = normalizeEventContext({ contextType: 'system' });
    expect(ctx.actors.system).toBe(true);
    expect(ctx.related).toEqual({});
  });

  it('buildSystemEventContext pour formation_session', () => {
    const sessionId = new mongoose.Types.ObjectId();
    const ctx = buildSystemEventContext({ contextType: 'formation_session', contextId: String(sessionId), related: { sessionId: String(sessionId), formationId: 'F-1' } });
    expect(ctx.contextType).toBe('formation_session');
    expect(ctx.related.formationId).toBe('F-1');
  });
});
