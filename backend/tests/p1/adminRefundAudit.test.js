// tests/p1/adminRefundAudit.test.js
// Sprint pré-React A4 — Gouvernance : une décision admin de remboursement / annulation
// laisse toujours une trace EventLog (qui/quand/raison/résultat). Aucun remboursement
// silencieux.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';

// cancelBookingByAdmin déclenche un flow tokenisé + email : on les neutralise.
vi.mock('../../services/sessionCancellationFlowService.js', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    createOrRefreshServiceCancellationFlow: async () => ({ flow: { flowId: 'FLOW-TEST' }, token: 'tok-test' }),
    notifyServiceCancellationChoiceForFlow: async () => {}
  };
});
vi.mock('../../services/notificationService.js', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, triggerNotification: async () => {} };
});

const EventLog = (await import('../../models/EventLog.js')).default;
const RefundRequest = (await import('../../models/RefundRequest.js')).default;
const Sale = (await import('../../models/Sale.js')).default;
const ServiceBooking = (await import('../../models/ServiceBooking.js')).default;
const User = (await import('../../models/user.js')).default;
const { updateRefundStatus } = await import('../../controllers/salesController.js');
const { cancelBookingByAdmin } = await import('../../controllers/serviceBookingController.js');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

async function seedRefund(status = 'requested') {
  const sale = await Sale.create({
    saleId: 'S-AUDIT-1',
    userId: new mongoose.Types.ObjectId(),
    items: [{ type: 'formation', itemId: new mongoose.Types.ObjectId(), name: 'F', price: 100, finalPrice: 100 }],
    totalAmount: 100,
    itemCount: 1
  });
  const refund = await RefundRequest.create({
    refundId: 'REF-AUDIT-1',
    saleId: sale.saleId,
    userId: sale.userId,
    itemId: new mongoose.Types.ObjectId(),
    itemType: 'formation',
    amount: 100,
    status
  });
  return { sale, refund };
}

describe('A4 — admin refund / cancellation governance', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); vi.clearAllMocks(); });

  it('emits refund.failed with the admin reason when an admin marks a refund failed', async () => {
    await seedRefund('requested');
    const req = {
      params: { refundId: 'REF-AUDIT-1' },
      body: { status: 'failed', reason: 'Carte expirée côté banque' },
      headers: {}, cookies: {}
    };
    const res = mockRes();
    await updateRefundStatus(req, res);
    expect(res.statusCode).toBe(200);

    const events = await EventLog.find({ eventName: 'refund.failed' }).lean();
    expect(events).toHaveLength(1);
    expect(events[0].contextType).toBe('refund_request');
    expect(events[0].payloadSafe?.decidedBy).toBe('admin');
    expect(events[0].payloadSafe?.reason).toContain('Carte expirée');

    // Raison persistée dans les notes (audit durable).
    const refund = await RefundRequest.findOne({ refundId: 'REF-AUDIT-1' }).lean();
    expect(String(refund.meta?.notes || '')).toContain('Carte expirée');
  });

  it('emits refund.requested when an admin (re)opens a refund', async () => {
    await seedRefund('pending');
    const req = {
      params: { refundId: 'REF-AUDIT-1' },
      body: { status: 'requested', reason: 'Réouverture dossier' },
      headers: {}, cookies: {}
    };
    await updateRefundStatus(req, mockRes());
    const events = await EventLog.find({ eventName: 'refund.requested' }).lean();
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('an admin booking cancellation is never silent: emits booking.cancelled with a reason', async () => {
    const client = await User.create({
      email: 'audit-client@test.local', role: 'client', emailVerified: true, isActive: true,
      passwordHash: 'x', passwordSalt: 'y'
    });
    const booking = await ServiceBooking.create({
      bookingId: 'BKG-AUDIT-1',
      serviceId: new mongoose.Types.ObjectId(),
      practitionerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      startAt: new Date(Date.now() + 3 * 24 * 3600 * 1000),
      endAt: new Date(Date.now() + 3 * 24 * 3600 * 1000 + 3600 * 1000),
      totalPrice: 80,
      status: 'confirmed'
    });
    const req = {
      params: { bookingId: booking.bookingId },
      body: { reason: 'Indisponibilité praticienne' },
      headers: {}, cookies: {}
    };
    const res = mockRes();
    await cancelBookingByAdmin(req, res);
    expect(res.statusCode).toBe(200);

    const events = await EventLog.find({ eventName: 'booking.cancelled' }).lean();
    expect(events).toHaveLength(1);
    expect(events[0].payloadSafe?.cancelledBy).toBe('admin');
    expect(events[0].payloadSafe?.reason).toContain('Indisponibilité');

    const updated = await ServiceBooking.findOne({ bookingId: 'BKG-AUDIT-1' }).lean();
    expect(updated.status).toBe('cancelled');
  });
});
