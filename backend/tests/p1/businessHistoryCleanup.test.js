// tests/p1/businessHistoryCleanup.test.js
// D4 — Script de nettoyage des données transactionnelles : dry-run par défaut (ne supprime
// rien), --apply supprime uniquement les collections autorisées, configuration intacte.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Sale from '../../models/Sale.js';
import RefundRequest from '../../models/RefundRequest.js';
import Service from '../../models/Service.js';
import ServiceBooking from '../../models/ServiceBooking.js';
import EventLog from '../../models/EventLog.js';
import { cleanupBusinessHistory } from '../../scripts/cleanupBusinessHistory.js';

async function seedTransactional() {
  await Sale.create({ saleId: 'S-1', userId: new mongoose.Types.ObjectId(), items: [], totalAmount: 50, itemCount: 0 });
  await RefundRequest.create({ refundId: 'R-1', saleId: 'S-1', userId: new mongoose.Types.ObjectId(), itemId: new mongoose.Types.ObjectId(), itemType: 'formation', amount: 10 });
  await ServiceBooking.create({ bookingId: 'B-1', serviceId: new mongoose.Types.ObjectId(), practitionerId: new mongoose.Types.ObjectId(), clientId: new mongoose.Types.ObjectId(), startAt: new Date(), endAt: new Date(), totalPrice: 50 });
  await EventLog.create({ eventName: 'sale.finalized', contextType: 'sale', contextId: 'S-1' });
  // Configuration (NE DOIT JAMAIS être supprimée)
  await Service.create({ name: 'Soin', slug: 'soin-config', duration: 60, price: 80 });
}

describe('D4 — cleanup business history', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await seedTransactional(); });

  it('dry-run ne supprime rien (compte seulement)', async () => {
    const res = await cleanupBusinessHistory({ apply: false });
    expect(res.apply).toBe(false);
    expect(res.collections.Sale.wouldDelete).toBe(1);
    expect(res.collections.Sale.deleted).toBe(0);
    expect(await Sale.countDocuments({})).toBe(1); // intact
    expect(await RefundRequest.countDocuments({})).toBe(1);
  });

  it('apply supprime les collections transactionnelles autorisées', async () => {
    const res = await cleanupBusinessHistory({ apply: true });
    expect(res.collections.Sale.deleted).toBe(1);
    expect(await Sale.countDocuments({})).toBe(0);
    expect(await RefundRequest.countDocuments({})).toBe(0);
    // Sans --include-bookings : ServiceBooking NON supprimé.
    expect(await ServiceBooking.countDocuments({})).toBe(1);
  });

  it('apply --include-bookings supprime aussi les ServiceBooking', async () => {
    await cleanupBusinessHistory({ apply: true, includeBookings: true });
    expect(await ServiceBooking.countDocuments({})).toBe(0);
  });

  it('apply --include-event-logs supprime les EventLog transactionnels', async () => {
    await cleanupBusinessHistory({ apply: true, includeEventLogs: true });
    expect(await EventLog.countDocuments({})).toBe(0);
  });

  it('la configuration (Service) reste TOUJOURS intacte', async () => {
    await cleanupBusinessHistory({ apply: true, includeBookings: true, includeEventLogs: true, includeSendLogs: true });
    expect(await Service.countDocuments({})).toBe(1); // jamais supprimé
  });
});
