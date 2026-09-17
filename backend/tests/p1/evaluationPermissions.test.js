// FORMATION-EVALUATION — Permissions client : pas d'accès aux tentatives d'autrui, jamais de correction.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ userId: null }));
vi.mock('../../utils/session.js', () => ({ getSessionUserId: () => h.userId }));

import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Purchase from '../../models/Purchase.js';
import FormationProgress from '../../models/FormationProgress.js';
import EvaluationAttempt from '../../models/EvaluationAttempt.js';
import { upsertDefinition } from '../../services/evaluation/evaluationDefinitionService.js';

const { saveAnswers, submitAttempt, getClientEvaluation } = await import('../../controllers/evaluationClientController.js');

function mockRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

describe('permissions', () => {
  let owner, intruder, formationId;
  beforeAll(async () => { await mongoose.connect(await startMemoryDb(), { dbName: 'beautysavage-database' }); });
  afterAll(async () => { await mongoose.disconnect(); await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    owner = new mongoose.Types.ObjectId(); intruder = new mongoose.Types.ObjectId();
    formationId = new mongoose.Types.ObjectId();
  });

  it('un client ne peut PAS modifier la tentative d\'un autre (403)', async () => {
    const attempt = await EvaluationAttempt.create({ formationId, userId: owner, status: 'in_progress' });
    h.userId = String(intruder);
    const r1 = mockRes();
    await saveAnswers({ params: { attemptId: String(attempt._id) }, body: { answers: [] } }, r1);
    expect(r1.statusCode).toBe(403);
    const r2 = mockRes();
    await submitAttempt({ params: { attemptId: String(attempt._id) } }, r2);
    expect(r2.statusCode).toBe(403);
  });

  it('la vue client NE contient jamais les bonnes réponses', async () => {
    await upsertDefinition(formationId, {
      active: true,
      sections: [{ title: 'S', questions: [
        { type: 'true_false', prompt: 'Q1', correctBoolean: true },
        { type: 'quiz', mode: 'single', prompt: 'Q2', answers: [{ text: 'a', correct: true }, { text: 'b', correct: false }] }
      ] }]
    });
    await Purchase.collection.insertOne({ userId: owner, itemType: 'formation', formationId, itemId: formationId });
    await FormationProgress.create({ userId: owner, formationId, completedAt: new Date() });
    h.userId = String(owner);
    const res = mockRes();
    await getClientEvaluation({ params: { formationId: String(formationId) } }, res);
    expect(res.body.hasEvaluation).toBe(true);
    const json = JSON.stringify(res.body.definition);
    expect(json).not.toContain('correctBoolean');
    expect(json).not.toContain('"correct"');
  });
});
