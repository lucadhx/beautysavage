// tests/p1/customer360Timeline.test.js
// M12 — Timeline fusionnée : items multi-types, tri décroissant, cap, mapping EventLog curé.
import { describe, it, expect } from 'vitest';
import { buildCustomerTimeline, TIMELINE_CAP } from '../../services/customer360/customer360TimelineBuilder.js';

function iso(daysAgo) { return new Date(Date.now() - daysAgo * 86400000).toISOString(); }

describe('M12 — buildCustomerTimeline', () => {
  it('fusionne les types et trie du plus récent au plus ancien', () => {
    const tl = buildCustomerTimeline({
      sales: [{ saleId: 'S1', createdAt: iso(5), totalAmount: 80, itemCount: 1, giftCardUsage: [] }],
      bookings: [{ id: 'B1', bookingId: 'B1', serviceName: 'Soin', startAt: iso(1), status: 'confirmed', totalPrice: 80 }],
      refunds: [{ id: 'R1', refundId: 'R1', amount: 30, itemType: 'service', status: 'succeeded', refundedAt: iso(2) }],
      giftCards: [{ id: 'G1', code: 'GC', amount: 100, balance: 100, status: 'active', purchasedAt: iso(10) }],
      invoices: [{ id: 'I1', saleId: 'S1', official: true, invoiceId: 'INV1', invoiceDate: iso(4) }],
      communications: [{ id: 'C1', subject: 'Confirmation', channel: 'email', status: 'sent', sentAt: iso(3) }],
      notifications: [{ id: 'N1', title: 'Nouvelle réservation', category: 'prestations', createdAt: iso(1.5) }],
      eventLogs: [{ _id: 'E1', eventName: 'booking.balance_paid_on_site', createdAt: iso(0.5), contextId: 'B1' }]
    });
    const types = tl.map(i => i.type);
    expect(types).toContain('achat');
    expect(types).toContain('reservation');
    expect(types).toContain('remboursement');
    expect(types).toContain('carte_cadeau');
    expect(types).toContain('document');
    expect(types).toContain('email');
    expect(types).toContain('notification');
    expect(types).toContain('solde_paye'); // depuis EventLog curé
    // tri décroissant
    for (let i = 1; i < tl.length; i++) {
      expect(new Date(tl[i - 1].date).getTime()).toBeGreaterThanOrEqual(new Date(tl[i].date).getTime());
    }
    // chaque item a la forme attendue
    for (const it of tl) {
      expect(it).toHaveProperty('id');
      expect(it).toHaveProperty('icon');
      expect(it).toHaveProperty('title');
      expect(it).toHaveProperty('type');
    }
  });

  it('ignore les EventLog non curés et borne à TIMELINE_CAP', () => {
    const sales = Array.from({ length: TIMELINE_CAP + 50 }, (_, i) => ({ saleId: `S${i}`, createdAt: iso(i), totalAmount: 10, itemCount: 1, giftCardUsage: [] }));
    const eventLogs = [{ _id: 'E', eventName: 'some.unmapped.event', createdAt: iso(0), contextId: 'x' }];
    const tl = buildCustomerTimeline({ sales, eventLogs });
    expect(tl.length).toBe(TIMELINE_CAP);
    expect(tl.some(i => i.title === 'some.unmapped.event')).toBe(false);
  });
});
