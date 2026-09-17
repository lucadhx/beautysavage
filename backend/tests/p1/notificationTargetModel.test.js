// tests/p1/notificationTargetModel.test.js
// M3A — Modèle Notification.targetRole : default admin, enum admin|dev, rejet invalide.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Notification from '../../models/Notification.js';

describe('Notification.targetRole (M3A model)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('default → admin quand targetRole non fourni', async () => {
    const n = await Notification.create({ title: 'T', message: 'M' });
    expect(n.targetRole).toBe('admin');
  });

  it('accepte targetRole = dev', async () => {
    const n = await Notification.create({ title: 'T', message: 'M', targetRole: 'dev' });
    expect(n.targetRole).toBe('dev');
  });

  it('accepte targetRole = admin', async () => {
    const n = await Notification.create({ title: 'T', message: 'M', targetRole: 'admin' });
    expect(n.targetRole).toBe('admin');
  });

  it('rejette une valeur hors enum (ex. client)', async () => {
    await expect(
      Notification.create({ title: 'T', message: 'M', targetRole: 'client' })
    ).rejects.toThrow();
  });

  it('rejette une valeur arbitraire (ex. practitioner)', async () => {
    await expect(
      Notification.create({ title: 'T', message: 'M', targetRole: 'practitioner' })
    ).rejects.toThrow();
  });
});
