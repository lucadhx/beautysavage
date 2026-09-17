// FORMATION-EVALUATION — Validation des rendus (photo avant/après, vidéo), pur, sans DB.
import { describe, it, expect } from 'vitest';
import { validateSubmission } from '../../services/evaluation/evaluationScoringService.js';

const DEF = {
  sections: [],
  deliverables: [
    { _id: 'd1', type: 'photo_before_after', required: true },
    { _id: 'd2', type: 'video', required: true },
    { _id: 'd3', type: 'photo_before_after', required: false }
  ]
};

describe('validateSubmission — rendus obligatoires', () => {
  it('photo obligatoire exige avant ET après', () => {
    const onlyBefore = validateSubmission(DEF, {
      answers: [],
      deliverables: [
        { deliverableId: 'd1', files: [{ kind: 'before' }] },
        { deliverableId: 'd2', files: [{ kind: 'video' }] }
      ]
    });
    expect(onlyBefore.valid).toBe(false);
    expect(onlyBefore.missingDeliverables).toContain('d1');
  });

  it('vidéo obligatoire exige un fichier vidéo', () => {
    const noVideo = validateSubmission(DEF, {
      answers: [],
      deliverables: [{ deliverableId: 'd1', files: [{ kind: 'before' }, { kind: 'after' }] }]
    });
    expect(noVideo.valid).toBe(false);
    expect(noVideo.missingDeliverables).toContain('d2');
  });

  it('valide quand tous les rendus obligatoires sont fournis (le facultatif est ignoré)', () => {
    const ok = validateSubmission(DEF, {
      answers: [],
      deliverables: [
        { deliverableId: 'd1', files: [{ kind: 'before' }, { kind: 'after' }] },
        { deliverableId: 'd2', files: [{ kind: 'video' }] }
      ]
    });
    expect(ok.valid).toBe(true);
    expect(ok.missingDeliverables).toHaveLength(0);
  });
});
