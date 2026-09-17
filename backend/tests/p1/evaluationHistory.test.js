// FORMATION-EVALUATION — Historique complet : refus (tentative 1) puis validation (tentative 2).
// Toutes les décisions restent conservées ; le diplôme n'existe qu'après validation.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

vi.mock('../../services/evaluation/certificateService.js', () => ({
  issueCertificate: vi.fn(async ({ attempt }) => ({
    certificate: { _id: 'c1', certificateNumber: 'BS-DIP-HIST', attemptId: attempt._id }, pdfBase64: 'QUFB'
  }))
}));
vi.mock('../../services/evaluation/evaluationEventsService.js', () => ({
  onEvaluationAccepted: vi.fn(async () => {}), onEvaluationRefused: vi.fn(async () => {})
}));

import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import EvaluationAttempt from '../../models/EvaluationAttempt.js';
import EvaluationDecision from '../../models/EvaluationDecision.js';
import { acceptAttempt, refuseAttempt } from '../../services/evaluation/evaluationDecisionService.js';

const DEF = { sections: [{ _id: 's1', questions: [{ _id: 'q1', type: 'true_false', correctBoolean: true }] }], deliverables: [] };
const user = { _id: new mongoose.Types.ObjectId(), firstName: 'A', email: 'a@b.c' };
const formation = { _id: new mongoose.Types.ObjectId(), name: 'F' };
const reviewer = { _id: new mongoose.Types.ObjectId() };

describe('historique', () => {
  beforeAll(async () => { await mongoose.connect(await startMemoryDb(), { dbName: 'beautysavage-database' }); });
  afterAll(async () => { await mongoose.disconnect(); await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('refus tentative 1 → nouvelle tentative → validation tentative 2 : 2 décisions conservées + 1 diplôme', async () => {
    // Tentative 1 soumise → refus
    const a1 = await EvaluationAttempt.create({ formationId: formation._id, userId: user._id, attemptNumber: 1, status: 'submitted' });
    const { newAttempt } = await refuseAttempt({ attempt: a1, definition: DEF, user, formation, comment: 'Tentative 1 : à retravailler', reviewer });
    expect(newAttempt.attemptNumber).toBe(2);

    // Tentative 2 : passe en submitted puis validation
    const a2 = await EvaluationAttempt.findById(newAttempt._id);
    a2.status = 'submitted';
    await a2.save();
    const { certificate } = await acceptAttempt({ attempt: a2, definition: DEF, user, formation, comment: 'Tentative 2 : validée', reviewer });
    expect(certificate.certificateNumber).toBe('BS-DIP-HIST');

    // Historique : 2 décisions (refused puis accepted), dans l'ordre
    const decisions = await EvaluationDecision.find({ userId: user._id }).sort({ createdAt: 1 }).lean();
    expect(decisions.map((d) => d.decision)).toEqual(['refused', 'accepted']);
    expect(decisions[0].comment).toContain('Tentative 1');
    expect(decisions[1].comment).toContain('Tentative 2');

    // Statuts des tentatives conservés
    const finalA1 = await EvaluationAttempt.findById(a1._id).lean();
    const finalA2 = await EvaluationAttempt.findById(a2._id).lean();
    expect(finalA1.status).toBe('refused');
    expect(finalA2.status).toBe('accepted');
  });
});
