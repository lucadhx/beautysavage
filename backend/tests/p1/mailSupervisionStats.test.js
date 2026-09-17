// tests/p1/mailSupervisionStats.test.js
// M3E — Stats de supervision : byStatus/byTemplate/byEvent, shadow vs active, failures, date range.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import MailEventDelivery from '../../models/MailEventDelivery.js';
import { getMailSupervisionStats } from '../../services/mail/mailSupervisionService.js';

async function seed() {
  await MailEventDelivery.create([
    { eventName: 'refund.succeeded', templateKey: 'refund_confirmed', fromRole: 'commerciale', toRole: 'client', contextType: 'refund_request', contextId: 'R1', status: 'sent' },
    { eventName: 'booking.confirmed', templateKey: 'booking_confirmed', fromRole: 'commerciale', toRole: 'client', contextType: 'service_booking', contextId: 'B1', status: 'sent' },
    { eventName: 'booking.confirmed', templateKey: 'booking_confirmed', fromRole: 'commerciale', toRole: 'client', contextType: 'service_booking', contextId: 'B2', status: 'identity_missing' },
    { eventName: 'booking.confirmed', templateKey: 'booking_confirmed', fromRole: 'commerciale', toRole: 'client', contextType: 'service_booking', contextId: 'B3', status: 'client_missing' },
    { eventName: 'commission.available', templateKey: 'commission_available', fromRole: 'support', toRole: 'commerciale', contextType: 'commission_payment', contextId: 'C1', status: 'shadow' }
  ]);
}

describe('mailSupervision stats (M3E)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await MailEventDelivery.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await MailEventDelivery.syncIndexes(); await seed(); });

  it('dev : total + byStatus + byEvent + shadow/active', async () => {
    const s = await getMailSupervisionStats({ roleView: 'dev' });
    expect(s.total).toBe(5);
    expect(s.byStatus.sent).toBe(2);
    expect(s.byStatus.identity_missing).toBe(1);
    expect(s.byStatus.client_missing).toBe(1);
    expect(s.byEvent['booking.confirmed']).toBe(3);
    expect(s.activeCount).toBe(4);  // refund(1) + booking(3) — règles actives
    expect(s.shadowCount).toBe(1);  // commission — règle shadow
  });

  it('failuresLast24h compte les erreurs récentes', async () => {
    const s = await getMailSupervisionStats({ roleView: 'dev' });
    // identity_missing + client_missing créés à l'instant → 2 échecs sur 24h
    expect(s.failuresLast24h).toBe(2);
    expect(s.last24h).toBe(5);
  });

  it('admin : périmètre réduit (commission exclue)', async () => {
    const s = await getMailSupervisionStats({ roleView: 'admin' });
    expect(s.total).toBe(4); // commission.available exclue
    expect(s.shadowCount).toBe(0);
    expect(s.activeCount).toBe(4);
  });

  it('date range futur → total 0', async () => {
    const s = await getMailSupervisionStats({ roleView: 'dev', dateFrom: '2099-01-01' });
    expect(s.total).toBe(0);
  });
});
