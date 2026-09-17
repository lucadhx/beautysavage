// tests/p1/notificationTargetBackfill.test.js
// M3A — Backfill targetRole : dry-run ne modifie rien, --apply remplit, mapping correct.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Notification from '../../models/Notification.js';
import { backfillNotificationTargetRole } from '../../scripts/backfillNotificationTargetRole.js';

const col = () => mongoose.connection.collection('notifications');

// Insère en contournant le défaut mongoose pour simuler des notifs legacy.
let seq = 0;
async function insertLegacy(doc) {
  seq += 1;
  return col().insertOne({
    notificationId: `NOTIF-LEGACY-${seq}`,
    title: 'L', message: 'm', targetType: 'all', createdAt: new Date(), ...doc
  });
}

describe('backfillNotificationTargetRole (M3A)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('dry-run ne modifie rien', async () => {
    await insertLegacy({ eventType: 'new_sale' }); // pas de targetRole
    await insertLegacy({ eventType: 'webhook_failure' });
    const before = await col().find({}).toArray();
    expect(before.every(d => d.targetRole === undefined)).toBe(true);

    const r = await backfillNotificationTargetRole({ apply: false });
    expect(r.applied).toBe(false);
    expect(r.counts.admin).toBe(1);
    expect(r.counts.dev).toBe(1);

    const after = await col().find({}).toArray();
    expect(after.every(d => d.targetRole === undefined)).toBe(true); // inchangé
  });

  it('--apply remplit targetRole avec le bon mapping', async () => {
    await insertLegacy({ eventType: 'new_sale' });
    await insertLegacy({ eventType: 'job_failed' });
    await insertLegacy({ eventType: 'unknown_type_xyz' }); // → admin par défaut
    await insertLegacy({ eventType: 'new_client', targetRole: null });

    const r = await backfillNotificationTargetRole({ apply: true });
    expect(r.applied).toBe(true);
    expect(r.counts.updated).toBe(4);

    const docs = await col().find({}).toArray();
    const byType = Object.fromEntries(docs.map(d => [d.eventType, d.targetRole]));
    expect(byType['new_sale']).toBe('admin');
    expect(byType['job_failed']).toBe('dev');
    expect(byType['unknown_type_xyz']).toBe('admin');
    expect(byType['new_client']).toBe('admin');
  });

  it('ne touche pas les notifs déjà valides (idempotent) et ne supprime rien', async () => {
    const ok1 = await Notification.create({ title: 'A', message: 'm', targetRole: 'admin', eventType: 'new_sale' });
    const ok2 = await Notification.create({ title: 'B', message: 'm', targetRole: 'dev', eventType: 'job_failed' });
    await insertLegacy({ eventType: 'refund_requested' });

    const totalBefore = await col().countDocuments({});
    const r = await backfillNotificationTargetRole({ apply: true });
    expect(r.counts.skipped).toBe(2); // les 2 déjà valides
    expect(r.counts.updated).toBe(1); // le legacy
    expect(await col().countDocuments({})).toBe(totalBefore); // rien supprimé

    // valeurs valides inchangées
    expect((await Notification.findById(ok1._id)).targetRole).toBe('admin');
    expect((await Notification.findById(ok2._id)).targetRole).toBe('dev');
  });

  it('relancer après apply est un no-op (idempotence)', async () => {
    await insertLegacy({ eventType: 'new_sale' });
    await backfillNotificationTargetRole({ apply: true });
    const r2 = await backfillNotificationTargetRole({ apply: true });
    expect(r2.counts.updated).toBe(0);
  });
});
