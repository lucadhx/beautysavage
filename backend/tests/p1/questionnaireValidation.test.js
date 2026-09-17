// FORMATION-EVALUATION — Scoring + validation questionnaire (pur, sans DB).
import { describe, it, expect } from 'vitest';
import { computeScore, validateSubmission } from '../../services/evaluation/evaluationScoringService.js';

// Définition minimale (les _id sont de simples chaînes, computeScore les compare via String()).
const DEF = {
  sections: [
    {
      _id: 's1',
      questions: [
        { _id: 'q1', type: 'true_false', prompt: 'Vrai ?', required: true, correctBoolean: true },
        {
          _id: 'q2', type: 'quiz', mode: 'single', required: true,
          answers: [{ _id: 'a1', correct: false }, { _id: 'a2', correct: true }]
        },
        {
          _id: 'q3', type: 'quiz', mode: 'multiple', required: false,
          answers: [{ _id: 'b1', correct: true }, { _id: 'b2', correct: true }, { _id: 'b3', correct: false }]
        }
      ]
    }
  ],
  deliverables: []
};

describe('computeScore', () => {
  it('note vrai/faux, quiz mono et quiz multi', () => {
    const attempt = { answers: [
      { questionId: 'q1', booleanValue: true },                 // juste
      { questionId: 'q2', selectedAnswerIds: ['a2'] },           // juste
      { questionId: 'q3', selectedAnswerIds: ['b1', 'b2'] }      // juste (ensemble exact)
    ] };
    const s = computeScore(DEF, attempt);
    expect(s.total).toBe(3);
    expect(s.correct).toBe(3);
    expect(s.percent).toBe(100);
  });

  it('quiz multi faux si ensemble incomplet ou en trop', () => {
    const partial = computeScore(DEF, { answers: [{ questionId: 'q3', selectedAnswerIds: ['b1'] }] });
    expect(partial.perQuestion.find((p) => p.questionId === 'q3').correct).toBe(false);
    const extra = computeScore(DEF, { answers: [{ questionId: 'q3', selectedAnswerIds: ['b1', 'b2', 'b3'] }] });
    expect(extra.perQuestion.find((p) => p.questionId === 'q3').correct).toBe(false);
  });

  it('quiz mono faux si mauvaise réponse ou plusieurs sélections', () => {
    const wrong = computeScore(DEF, { answers: [{ questionId: 'q2', selectedAnswerIds: ['a1'] }] });
    expect(wrong.perQuestion.find((p) => p.questionId === 'q2').correct).toBe(false);
    const multi = computeScore(DEF, { answers: [{ questionId: 'q2', selectedAnswerIds: ['a1', 'a2'] }] });
    expect(multi.perQuestion.find((p) => p.questionId === 'q2').correct).toBe(false);
  });

  it('vrai/faux faux si valeur opposée ou absente', () => {
    expect(computeScore(DEF, { answers: [{ questionId: 'q1', booleanValue: false }] }).correct).toBe(0);
    expect(computeScore(DEF, { answers: [] }).correct).toBe(0);
  });

  it('pourcentage arrondi', () => {
    // 1 juste sur 3 → 33 %
    const s = computeScore(DEF, { answers: [{ questionId: 'q1', booleanValue: true }] });
    expect(s.percent).toBe(33);
  });
});

describe('validateSubmission — questions obligatoires', () => {
  it('bloque si une question obligatoire est sans réponse', () => {
    const r = validateSubmission(DEF, { answers: [{ questionId: 'q1', booleanValue: true }] }); // q2 requis manquant
    expect(r.valid).toBe(false);
    expect(r.missingQuestions).toContain('q2');
    expect(r.missingQuestions).not.toContain('q3'); // q3 facultatif
  });

  it('valide si toutes les questions obligatoires sont répondues (pas de rendus)', () => {
    const r = validateSubmission(DEF, { answers: [
      { questionId: 'q1', booleanValue: true },
      { questionId: 'q2', selectedAnswerIds: ['a2'] }
    ] });
    expect(r.valid).toBe(true);
  });
});
