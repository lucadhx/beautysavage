// FORMATION-EVALUATION — Décision institut : validation (→ diplôme) / refus (→ scrub + nouvelle tentative).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ accepted: [], refused: [] }));
vi.mock('../../services/evaluation/certificateService.js', () => ({
  issueCertificate: vi.fn(async ({ attempt }) => ({
    certificate: { _id: 'cert1', certificateNumber: 'BS-DIP-TEST', attemptId: attempt._id },
    pdfBase64: 'QUFB'
  }))
}));
vi.mock('../../services/evaluation/evaluationEventsService.js', () => ({
  onEvaluationAccepted: vi.fn(async (...a) => { h.accepted.push(a); }),
  onEvaluationRefused: vi.fn(async (...a) => { h.refused.push(a); })
}));

import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import EvaluationAttempt from '../../models/EvaluationAttempt.js';
import EvaluationDecision from '../../models/EvaluationDecision.js';
import { acceptAttempt, refuseAttempt, EvaluationDecisionError } from '../../services/evaluation/evaluationDecisionService.js';

const DEF = { sections: [{ _id: 's1', questions: [{ _id: 'q1', type: 'true_false', correctBoolean: true }] }], deliverables: [] };
const user = { _id: new mongoose.Types.ObjectId(), firstName: 'A', email: 'a@b.c' };
const formation = { _id: new mongoose.Types.ObjectId(), name: 'Formation X' };
const reviewer = { _id: new mongoose.Types.ObjectId(), firstName: 'Rev' };

async function seedSubmitted() {
  return EvaluationAttempt.create({
    formationId: formation._id, userId: user._id, attemptNumber: 1, status: 'submitted',
    answers: [{ questionId: new mongoose.Types.ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa'), type: 'true_false', booleanValue: true }],
    deliverables: [{ deliverableId: new mongoose.Types.ObjectId(), type: 'video', files: [{ kind: 'video', url: '/uploads/evaluations/x.mp4' }] }]
  });
}

describe('décision', () => {
  beforeAll(async () => { await mongoose.connect(await startMemoryDb(), { dbName: 'beautysavage-database' }); });
  afterAll(async () => { await mongoose.disconnect(); await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); h.accepted.length = 0; h.refused.length = 0; });

  it('validation → décision accepted + certificat + tentative accepted', async () => {
    const attempt = await seedSubmitted();
    const { decision, certificate } = await acceptAttempt({ attempt, definition: DEF, user, formation, comment: 'Excellent travail', reviewer });
    expect(decision.decision).toBe('accepted');
    expect(decision.certificateId).toBe('BS-DIP-TEST');
    expect(certificate.certificateNumber).toBe('BS-DIP-TEST');
    const reloaded = await EvaluationAttempt.findById(attempt._id).lean();
    expect(reloaded.status).toBe('accepted');
    expect(h.accepted).toHaveLength(1); // e-mail/notif déclenchés
  });

  it('refus → décision refused + scrub réponses/fichiers + NOUVELLE tentative in_progress', async () => {
    const attempt = await seedSubmitted();
    const { decision, newAttempt } = await refuseAttempt({ attempt, definition: DEF, user, formation, comment: 'À retravailler', reviewer });
    expect(decision.decision).toBe('refused');
    const reloaded = await EvaluationAttempt.findById(attempt._id).lean();
    expect(reloaded.status).toBe('refused');
    expect(reloaded.answers).toHaveLength(0);       // réponses effacées
    expect(reloaded.deliverables).toHaveLength(0);  // fichiers effacés
    expect(newAttempt.attemptNumber).toBe(2);
    expect(newAttempt.status).toBe('in_progress');
    expect(h.refused).toHaveLength(1);
  });

  it('commentaire OBLIGATOIRE (accept + refuse)', async () => {
    const a1 = await seedSubmitted();
    await expect(acceptAttempt({ attempt: a1, definition: DEF, user, formation, comment: '  ', reviewer }))
      .rejects.toBeInstanceOf(EvaluationDecisionError);
    const a2 = await seedSubmitted();
    await expect(refuseAttempt({ attempt: a2, definition: DEF, user, formation, comment: '', reviewer }))
      .rejects.toBeInstanceOf(EvaluationDecisionError);
  });

  it('refuse une tentative non soumise (409)', async () => {
    const attempt = await EvaluationAttempt.create({ formationId: formation._id, userId: user._id, status: 'in_progress' });
    await expect(acceptAttempt({ attempt, definition: DEF, user, formation, comment: 'ok', reviewer }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('historique : décisions conservées (jamais supprimées)', async () => {
    const a1 = await seedSubmitted();
    await refuseAttempt({ attempt: a1, definition: DEF, user, formation, comment: 'tentative 1 refusée', reviewer });
    const decisions = await EvaluationDecision.find({ userId: user._id }).lean();
    expect(decisions).toHaveLength(1);
    expect(decisions[0].comment).toBe('tentative 1 refusée');
  });
});
