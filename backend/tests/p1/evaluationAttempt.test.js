// FORMATION-EVALUATION — Tentative client : gating (achat + complétion + définition active) + reprise.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ userId: null }));
vi.mock('../../utils/session.js', () => ({ getSessionUserId: () => h.userId }));

import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Purchase from '../../models/Purchase.js';
import FormationProgress from '../../models/FormationProgress.js';
import EvaluationAttempt from '../../models/EvaluationAttempt.js';
import { upsertDefinition } from '../../services/evaluation/evaluationDefinitionService.js';

const { createOrGetAttempt } = await import('../../controllers/evaluationClientController.js');

function mockRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

describe('createOrGetAttempt — gating', () => {
  let userId, formationId;
  beforeAll(async () => { await mongoose.connect(await startMemoryDb(), { dbName: 'beautysavage-database' }); });
  afterAll(async () => { await mongoose.disconnect(); await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    userId = new mongoose.Types.ObjectId(); formationId = new mongoose.Types.ObjectId();
    h.userId = String(userId);
  });

  async function purchase() {
    await Purchase.collection.insertOne({ userId, itemType: 'formation', formationId, itemId: formationId });
  }
  async function complete() {
    await FormationProgress.create({ userId, formationId, completedAt: new Date() });
  }
  async function activeDef() {
    await upsertDefinition(formationId, { active: true, sections: [{ title: 'S' }] });
  }
  const req = () => ({ params: { formationId: String(formationId) } });

  it('403 sans achat', async () => {
    const res = mockRes();
    await createOrGetAttempt(req(), res);
    expect(res.statusCode).toBe(403);
  });

  it('409 si formation non terminée', async () => {
    await purchase();
    const res = mockRes();
    await createOrGetAttempt(req(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('NOT_COMPLETED');
  });

  it('404 si aucune évaluation active', async () => {
    await purchase(); await complete();
    const res = mockRes();
    await createOrGetAttempt(req(), res);
    expect(res.statusCode).toBe(404);
  });

  it('201 crée une tentative in_progress, puis renvoie la même (reprise)', async () => {
    await purchase(); await complete(); await activeDef();
    const r1 = mockRes();
    await createOrGetAttempt(req(), r1);
    expect(r1.statusCode).toBe(201);
    expect(r1.body.attempt.status).toBe('in_progress');
    const r2 = mockRes();
    await createOrGetAttempt(req(), r2);
    expect(r2.body.attempt.id).toBe(r1.body.attempt.id); // reprise, pas de doublon
    expect(await EvaluationAttempt.countDocuments({ formationId, userId })).toBe(1);
  });
});
