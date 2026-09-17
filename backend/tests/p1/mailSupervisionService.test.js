// tests/p1/mailSupervisionService.test.js
// M3E — Service de supervision : list/detail/stats, roleView (dev tout, admin institut/client),
// filtres, limit, corrélation SendLog. Lecture seule.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import MailEventDelivery from '../../models/MailEventDelivery.js';
import SendLog from '../../models/SendLog.js';
import {
  listMailEventDeliveries,
  getMailEventDeliveryDetail,
  getMailSupervisionStats,
  listSendLogsForSupervision,
  getSendLogSupervisionStats
} from '../../services/mail/mailSupervisionService.js';

async function seedDeliveries() {
  await MailEventDelivery.create([
    { eventName: 'refund.succeeded', templateKey: 'refund_confirmed', fromRole: 'commerciale', toRole: 'client', contextType: 'refund_request', contextId: 'R1', status: 'sent' },
    { eventName: 'booking.confirmed', templateKey: 'booking_confirmed', fromRole: 'commerciale', toRole: 'client', contextType: 'service_booking', contextId: 'B1', status: 'sent' },
    { eventName: 'booking.confirmed', templateKey: 'booking_confirmed', fromRole: 'commerciale', toRole: 'client', contextType: 'service_booking', contextId: 'B2', status: 'identity_missing' },
    { eventName: 'commission.available', templateKey: 'commission_available', fromRole: 'support', toRole: 'commerciale', contextType: 'commission_payment', contextId: 'C1', status: 'shadow' },
    { eventName: 'sale.finalized', templateKey: 'vente', fromRole: 'commerciale', toRole: 'client', contextType: 'sale', contextId: 'S1', status: 'skipped_duplicate_direct_sender' }
  ]);
}
async function seedSendLogs() {
  await SendLog.create([
    { provider: 'brevo', templateKey: 'refund_confirmed', recipientHash: 'h1', status: 'sent', providerMessageId: '<m1>', contextType: 'refund_request', contextId: 'R1', metadata: { tags: ['transactional', 'refund_confirmed', 'from:commerciale', 'to:client', 'role-engine'] } },
    { provider: 'brevo', templateKey: 'password_reset', recipientHash: 'h2', status: 'sent', contextType: 'user', contextId: 'U1', metadata: { tags: ['transactional', 'password_reset'] } },
    { provider: 'brevo', templateKey: 'commission_available', recipientHash: 'h3', status: 'sent', contextType: 'commission_payment', contextId: 'C1', metadata: { tags: ['transactional', 'commission_available'] } }
  ]);
}

describe('mailSupervisionService (M3E)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await MailEventDelivery.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await MailEventDelivery.syncIndexes(); await seedDeliveries(); await seedSendLogs(); });

  it('dev voit toutes les livraisons (active/shadow/failed)', async () => {
    const { items, count } = await listMailEventDeliveries({ roleView: 'dev' });
    expect(count).toBe(5);
    const events = items.map(i => i.eventName);
    expect(events).toContain('commission.available'); // plateforme visible pour dev
  });

  it('admin ne voit PAS les livraisons plateforme (commission support→commerciale)', async () => {
    const { items } = await listMailEventDeliveries({ roleView: 'admin' });
    const events = items.map(i => i.eventName);
    expect(events).toContain('refund.succeeded');
    expect(events).toContain('booking.confirmed');
    expect(events).not.toContain('commission.available');
    expect(items.every(i => i.fromRole === 'commerciale' || i.toRole === 'client')).toBe(true);
  });

  it('filtre status / eventName / templateKey', async () => {
    expect((await listMailEventDeliveries({ roleView: 'dev', status: 'sent' })).count).toBe(2);
    expect((await listMailEventDeliveries({ roleView: 'dev', eventName: 'booking.confirmed' })).count).toBe(2);
    expect((await listMailEventDeliveries({ roleView: 'dev', templateKey: 'commission_available' })).count).toBe(1);
  });

  it('limit borné à 100 et appliqué', async () => {
    const res = await listMailEventDeliveries({ roleView: 'dev', limit: 2 });
    expect(res.items.length).toBe(2);
    const big = await listMailEventDeliveries({ roleView: 'dev', limit: 9999 });
    expect(big.limit).toBe(100);
  });

  it('detail dev OK ; admin refuse une livraison plateforme (404)', async () => {
    const commission = await MailEventDelivery.findOne({ eventName: 'commission.available' }).lean();
    expect(await getMailEventDeliveryDetail(commission._id, { roleView: 'dev' })).toBeTruthy();
    expect(await getMailEventDeliveryDetail(commission._id, { roleView: 'admin' })).toBeNull();
  });

  it('detail corrèle le SendLog (providerMessageId/recipientHash)', async () => {
    const refund = await MailEventDelivery.findOne({ eventName: 'refund.succeeded' }).lean();
    const dto = await getMailEventDeliveryDetail(refund._id, { roleView: 'admin' });
    expect(dto.providerMessageId).toBe('<m1>');
    expect(dto.recipientHash).toBe('h1');
    expect(dto.mode).toBe('active'); // dérivé de la règle
  });

  it('send-logs : admin masque les templates plateforme (password_reset, commission_*)', async () => {
    const dev = await listSendLogsForSupervision({ roleView: 'dev' });
    expect(dev.count).toBe(3);
    const admin = await listSendLogsForSupervision({ roleView: 'admin' });
    const keys = admin.items.map(i => i.templateKey);
    expect(keys).toContain('refund_confirmed');
    expect(keys).not.toContain('password_reset');
    expect(keys).not.toContain('commission_available');
  });

  it('stats deliveries : byStatus, shadow/active, failures', async () => {
    const stats = await getMailSupervisionStats({ roleView: 'dev' });
    expect(stats.total).toBe(5);
    expect(stats.byStatus.sent).toBe(2);
    expect(stats.activeCount).toBe(3); // refund.succeeded + booking.confirmed x2 (règles actives)
    expect(stats.shadowCount).toBe(2); // commission.available + sale.finalized (règles shadow)
    expect(stats.byEvent['booking.confirmed']).toBe(2);
  });

  it('stats send-logs : total + byStatus (vue dev)', async () => {
    const stats = await getSendLogSupervisionStats({ roleView: 'dev' });
    expect(stats.total).toBe(3);
    expect(stats.byStatus.sent).toBe(3);
  });

  it('detail avec id invalide → null (pas de throw)', async () => {
    expect(await getMailEventDeliveryDetail('not-an-id', { roleView: 'dev' })).toBeNull();
  });
});
