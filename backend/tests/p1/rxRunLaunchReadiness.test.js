// tests/p1/rxRunLaunchReadiness.test.js
// RX-RUN — Évaluateur de préflight de lancement (pur). Vérifie : vars .env obligatoires, format vault,
// builds React, flag informatif (jamais bloquant).
import { describe, it, expect } from 'vitest';
import { evaluateReadiness, isReady } from '../../scripts/checkLaunchReadiness.js';

const GOOD_ENV = {
  MONGODB_URI: 'mongodb+srv://u:p@c.net/db',
  SESSION_SECRET: 'x'.repeat(20),
  PWD_PEPPER: 'y'.repeat(20),
  CREDENTIAL_VAULT_KEY: 'a'.repeat(64),
};
const BUILT = { vitrineBuilt: true, managerBuilt: true };

describe('RX-RUN — evaluateReadiness', () => {
  it('env complet + builds présents → prêt', () => {
    const rows = evaluateReadiness(GOOD_ENV, BUILT);
    expect(isReady(rows)).toBe(true);
  });

  it('détecte une variable obligatoire manquante ou placeholder', () => {
    const rows = evaluateReadiness({ ...GOOD_ENV, SESSION_SECRET: '<base64-session-secret>' }, BUILT);
    expect(isReady(rows)).toBe(false);
    expect(rows.find((r) => r.element.includes('SESSION_SECRET'))?.ok).toBe(false);
  });

  it('refuse une clé de coffre au mauvais format (pas 64 hex)', () => {
    const rows = evaluateReadiness({ ...GOOD_ENV, CREDENTIAL_VAULT_KEY: 'tooshort' }, BUILT);
    expect(rows.find((r) => r.element === 'CREDENTIAL_VAULT_KEY format')?.ok).toBe(false);
  });

  it('build React manquant → non prêt (503 attendu à l\'exécution)', () => {
    const rows = evaluateReadiness(GOOD_ENV, { vitrineBuilt: true, managerBuilt: false });
    expect(isReady(rows)).toBe(false);
    expect(rows.find((r) => r.element.includes('manager'))?.ok).toBe(false);
  });

  it('le flag REACT_OFFICIAL_FRONTEND est informatif (jamais bloquant, même en canary)', () => {
    const rows = evaluateReadiness(GOOD_ENV, { ...BUILT, canary: true });
    expect(isReady(rows)).toBe(true);
    expect(rows.find((r) => r.element === 'REACT_OFFICIAL_FRONTEND')?.ok).toBe(true);
  });
});
