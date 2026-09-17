// FORMATION-EVALUATION — Définition : sanitize, upsert/version, projection client (sans corrections).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import {
  sanitizeDefinitionInput, upsertDefinition, getActiveDefinition, toClientDefinition
} from '../../services/evaluation/evaluationDefinitionService.js';

describe('sanitizeDefinitionInput (pur)', () => {
  it('normalise types, ordres et rejette les types inconnus', () => {
    const clean = sanitizeDefinitionInput({
      active: true,
      sections: [{ title: 'S', questions: [
        { type: 'true_false', prompt: 'x', correctBoolean: true },
        { type: 'quiz', mode: 'multiple', answers: [{ text: 'a', correct: true }] },
        { type: 'HACK', prompt: 'y' } // type inconnu → true_false
      ] }],
      deliverables: [{ type: 'video', maxDurationSeconds: 120 }, { type: 'nope' }]
    });
    expect(clean.active).toBe(true);
    expect(clean.sections[0].questions[0].type).toBe('true_false');
    expect(clean.sections[0].questions[1].mode).toBe('multiple');
    expect(clean.sections[0].questions[2].type).toBe('true_false'); // fallback
    expect(clean.deliverables[0].maxDurationSeconds).toBe(120);
    expect(clean.deliverables[1].type).toBe('photo_before_after'); // fallback
  });
});

describe('upsert + projection', () => {
  let formationId;
  beforeAll(async () => {
    await mongoose.connect(await startMemoryDb(), { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await mongoose.disconnect(); await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); formationId = new mongoose.Types.ObjectId(); });

  it('crée puis incrémente la version à chaque mise à jour', async () => {
    const first = await upsertDefinition(formationId, { active: true, sections: [{ title: 'S1' }] });
    expect(first.version).toBe(1);
    const second = await upsertDefinition(formationId, { active: true, sections: [{ title: 'S1 modifiée' }] });
    expect(second.version).toBe(2);
    // Toujours une seule définition (unicité formationId)
    const active = await getActiveDefinition(formationId);
    expect(active.sections[0].title).toBe('S1 modifiée');
  });

  it('la projection client NE contient PAS les bonnes réponses', async () => {
    const def = await upsertDefinition(formationId, {
      active: true,
      sections: [{ title: 'S', questions: [
        { type: 'true_false', prompt: 'Q1', correctBoolean: true },
        { type: 'quiz', mode: 'single', prompt: 'Q2', answers: [{ text: 'a', correct: false }, { text: 'b', correct: true }] }
      ] }]
    });
    const client = toClientDefinition(def);
    const json = JSON.stringify(client);
    expect(json).not.toContain('correctBoolean');
    expect(json).not.toContain('"correct"');
    // Les libellés + ids restent (nécessaires pour répondre)
    expect(client.sections[0].questions[1].answers[0]).toHaveProperty('text', 'a');
    expect(client.sections[0].questions[1].answers[0]).toHaveProperty('id');
  });

  it('inactive → getActiveDefinition renvoie null', async () => {
    await upsertDefinition(formationId, { active: false, sections: [] });
    expect(await getActiveDefinition(formationId)).toBeNull();
  });
});
