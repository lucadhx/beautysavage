// LOT2 §5 — Scheduler DÉDIÉ de rappels de sessions de formation. Vérifie qu'une session dans la
// fenêtre envoie un rappel à chaque participant inscrit et marque l'anti-doublon (remindersSent).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ mails: [] }));
vi.mock('../../services/mailService.js', () => ({
  sendFormationSessionReminderEmail: vi.fn(async (a) => { h.mails.push(a); return true; }),
}));

import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import FormationSession from '../../models/FormationSession.js';
import Purchase from '../../models/Purchase.js';
import ServiceSettings from '../../models/ServiceSettings.js';
import User from '../../models/user.js';
import Formation from '../../models/Formation.js';

const { runFormationSessionRemindersJob } = await import('../../automatisme/formationSessionRemindersJob.js');

describe('LOT2 — rappels sessions de formation', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await mongoose.disconnect(); await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); h.mails.length = 0; });

  async function seed() {
    await ServiceSettings.collection.insertOne({ reminders: [{ hoursBeforeAppointment: 24, isActive: true }] });
    const formationId = new mongoose.Types.ObjectId();
    await Formation.collection.insertOne({ _id: formationId, name: 'Formation Présentielle' });
    const sessionId = new mongoose.Types.ObjectId();
    const startDate = new Date(Date.now() + 24 * 3600000); // dans la fenêtre 24h
    await FormationSession.collection.insertOne({
      _id: sessionId, formationId, startDate, durationDays: 1,
      schedule: [{ dayIndex: 0, startTime: '14:00', endTime: '17:00' }],
      maxClients: 10, reservedCount: 1, status: 'active', remindersSent: [],
    });
    const user = await User.create({ email: 'p@bs.test', firstName: 'Marc', lastName: 'D', role: 'client', passwordHash: 'x', passwordSalt: 'x' });
    await Purchase.collection.insertOne({ userId: user._id, sessionId, formationId, itemType: 'formation', participationStatus: 'active', saleId: 'S1' });
    return { sessionId };
  }

  it('envoie un rappel au participant et marque remindersSent', async () => {
    const { sessionId } = await seed();
    const result = await runFormationSessionRemindersJob();
    expect(result.sent).toBe(1);
    expect(h.mails).toHaveLength(1);
    expect(h.mails[0].toEmail).toBe('p@bs.test');
    expect(h.mails[0].formationTitle).toBe('Formation Présentielle');
    expect(h.mails[0].sessionTime).toBe('14:00');
    const session = await FormationSession.findById(sessionId).lean();
    expect(session.remindersSent).toContain('24h');
  });

  it('ne renvoie pas deux fois (anti-doublon)', async () => {
    await seed();
    await runFormationSessionRemindersJob();
    h.mails.length = 0;
    const second = await runFormationSessionRemindersJob();
    expect(second.sent).toBe(0);
    expect(h.mails).toHaveLength(0);
  });
});
