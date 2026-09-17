// FORMATION-EVALUATION — Soumission client : blocage si incomplet, succès + événement sinon.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ userId: null, submitted: [] }));
vi.mock('../../utils/session.js', () => ({ getSessionUserId: () => h.userId }));
vi.mock('../../services/evaluation/evaluationEventsService.js', () => ({
  onEvaluationSubmitted: vi.fn(async (...a) => { h.submitted.push(a); })
}));

import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import EvaluationAttempt from '../../models/EvaluationAttempt.js';
import { upsertDefinition } from '../../services/evaluation/evaluationDefinitionService.js';

const { submitAttempt } = await import('../../controllers/evaluationClientController.js');

function mockRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

describe('submitAttempt', () => {
  let userId, formationId, def;
  beforeAll(async () => { await mongoose.connect(await startMemoryDb(), { dbName: 'beautysavage-database' }); });
  afterAll(async () => { await mongoose.disconnect(); await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    h.submitted.length = 0;
    userId = new mongoose.Types.ObjectId(); formationId = new mongoose.Types.ObjectId();
    h.userId = String(userId);
    def = await upsertDefinition(formationId, {
      active: true,
      sections: [{ title: 'S', questions: [{ type: 'true_false', prompt: 'Q', required: true, correctBoolean: true }] }],
      deliverables: [{ type: 'video', required: true }]
    });
  });

  it('bloque (400) une soumission incomplète et liste les manquants', async () => {
    const attempt = await EvaluationAttempt.create({ formationId, userId, status: 'in_progress' });
    const res = mockRes();
    await submitAttempt({ params: { attemptId: String(attempt._id) } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.missingQuestions.length + res.body.missingDeliverables.length).toBeGreaterThan(0);
    expect(h.submitted).toHaveLength(0);
  });

  it('soumet (200) quand complet et déclenche l\'événement', async () => {
    const q = def.sections[0].questions[0];
    const d = def.deliverables[0];
    const attempt = await EvaluationAttempt.create({
      formationId, userId, status: 'in_progress',
      answers: [{ questionId: q._id, type: 'true_false', booleanValue: true }],
      deliverables: [{ deliverableId: d._id, type: 'video', files: [{ kind: 'video', url: '/uploads/evaluations/x.mp4' }] }]
    });
    const res = mockRes();
    await submitAttempt({ params: { attemptId: String(attempt._id) } }, res);
    expect(res.body.ok).toBe(true);
    expect(res.body.attempt.status).toBe('submitted');
    expect(h.submitted).toHaveLength(1);
  });
});
