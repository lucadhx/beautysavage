// RX3 S3 — Tests du moteur légal front (dérivation par item + payload). Textes de waiver EXACTS backend.
import { describe, it, expect } from 'vitest';
import {
  buildLegalRequirements,
  isLegalComplete,
  buildCartLegalPayload,
} from './cartLegalRequirements';
import { DISTANT_LEARNING_WAIVER_TEXT } from './waiverConstants';
import type { CartItem } from '../cart/cartTypes';

const NOW = new Date('2026-07-01T00:00:00Z');

function distanciel(refId = 'f1'): CartItem {
  return { lineId: `l-${refId}`, kind: 'formation', refId, name: 'Formation en ligne', formationType: 'distanciel' };
}
function presentiel(refId: string, daysAhead: number, refundDays = 7): CartItem {
  const start = new Date(NOW.getTime() + daysAhead * 86_400_000).toISOString();
  return {
    lineId: `l-${refId}`,
    kind: 'formation',
    refId,
    name: 'Formation présentielle',
    formationType: 'presentiel',
    sessionId: `s-${refId}`,
    sessionStartAt: start,
    refundDays,
  };
}

describe('buildLegalRequirements', () => {
  it('CGV toujours en tête', () => {
    const reqs = buildLegalRequirements([], NOW);
    expect(reqs[0].id).toBe('cgv');
    expect(reqs).toHaveLength(1);
  });

  it('distanciel → renonciation avec le texte EXACT backend', () => {
    const reqs = buildLegalRequirements([distanciel('f1')], NOW);
    const d = reqs.find((r) => r.id === 'distanciel');
    expect(d).toBeDefined();
    expect(d?.text).toBe(DISTANT_LEARNING_WAIVER_TEXT);
    expect(d?.formationIds).toEqual(['f1']);
  });

  it('présentiel proche (< fenêtre) → renonciation requise', () => {
    const reqs = buildLegalRequirements([presentiel('f2', 5, 7)], NOW);
    expect(reqs.some((r) => r.id === 'presentiel')).toBe(true);
  });

  it('présentiel lointain → pas de renonciation présentielle', () => {
    const reqs = buildLegalRequirements([presentiel('f3', 60, 7)], NOW);
    expect(reqs.some((r) => r.id === 'presentiel')).toBe(false);
  });

  it('isLegalComplete exige toutes les cases requises', () => {
    const reqs = buildLegalRequirements([distanciel('f1')], NOW);
    expect(isLegalComplete(reqs, { cgv: true })).toBe(false);
    expect(isLegalComplete(reqs, { cgv: true, distanciel: true })).toBe(true);
  });
});

describe('buildCartLegalPayload', () => {
  it('construit legal.acceptedCgv + consumerWaivers acceptés + snapshots', () => {
    const reqs = buildLegalRequirements([distanciel('f1')], NOW);
    const payload = buildCartLegalPayload(reqs, { cgv: true, distanciel: true }, '2026-07-01T10:00:00.000Z');
    expect(payload.legal.acceptedCgv).toBe(true);
    expect(payload.consumerWaivers).toHaveLength(1);
    expect(payload.consumerWaivers[0]).toMatchObject({ text: DISTANT_LEARNING_WAIVER_TEXT, accepted: true, formationIds: ['f1'] });
    expect(payload.refundPolicySnapshots.f1.acceptedAt).toBe('2026-07-01T10:00:00.000Z');
  });

  it('waiver non coché → non inclus dans consumerWaivers', () => {
    const reqs = buildLegalRequirements([distanciel('f1')], NOW);
    const payload = buildCartLegalPayload(reqs, { cgv: true }, '2026-07-01T10:00:00.000Z');
    expect(payload.consumerWaivers).toHaveLength(0);
    expect(payload.refundPolicySnapshots.f1.acceptedAt).toBeNull();
  });
});
