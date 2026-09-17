// tests/p1/calendarFormationSessions.test.js
// M10 — Les sessions de formation présentielle apparaissent dans le calendrier global ;
// les distancielles n'ont pas de créneau physique.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import { seedTestData } from '../setup/seedTestData.js';
import Formation from '../../models/Formation.js';
import FormationSession from '../../models/FormationSession.js';
import { listGlobalCalendarItems } from '../../services/calendar/globalCalendarService.js';

let seed;

describe('calendrier — formations présentielles (M10)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); seed = await seedTestData(); });

  it('expose la session présentielle (places restantes, statut)', async () => {
    const items = await listGlobalCalendarItems({
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 60 * 86400000)
    });
    const formation = items.filter(i => i.type === 'formation_session');
    expect(formation.length).toBeGreaterThanOrEqual(1);
    expect(formation[0].participant.maxClients).toBe(5);
    expect(formation[0].participant.placesLeft).toBe(5);
    expect(formation[0].status).toBe('active');
  });

  it('une session distancielle n\'apparaît pas comme créneau', async () => {
    const distSession = await FormationSession.create({
      formationId: seed.formationDistanciel._id,
      startDate: new Date(Date.now() + 20 * 86400000),
      durationDays: 1,
      schedule: [{ dayIndex: 1, startTime: '10:00', endTime: '12:00' }],
      maxClients: 10, reservedCount: 0, status: 'active'
    });
    const items = await listGlobalCalendarItems({
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 60 * 86400000)
    });
    const ids = items.map(i => i.sourceId);
    expect(ids).not.toContain(String(distSession._id));
    // la présentielle (seed) reste présente
    expect(items.some(i => i.sourceId === String(seed.formationSession._id))).toBe(true);
    // Formation existe bien (sanity)
    expect(await Formation.countDocuments({})).toBeGreaterThanOrEqual(2);
  });
});
