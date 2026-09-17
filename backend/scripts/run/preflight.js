// RX-RUN-2 — Préflight léger partagé (env obligatoires + builds React), réutilise l'évaluateur RX-RUN.
// Lecture seule ; ne modifie NI .env NI la base.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateReadiness, isReady } from '../checkLaunchReadiness.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const distIndex = (app) => fs.existsSync(path.join(REPO, 'frontend-react', 'apps', app, 'dist', 'index.html'));

export function inspect() {
  const vitrineBuilt = distIndex('vitrine');
  const managerBuilt = distIndex('manager');
  const rows = evaluateReadiness(process.env, { vitrineBuilt, managerBuilt });
  return { rows, vitrineBuilt, managerBuilt };
}

/** Vérifie uniquement les variables .env obligatoires (les builds sont gérés à part par dev/build/start). */
export function envReady() {
  const { rows } = inspect();
  const envRows = rows.filter((r) => r.element.startsWith('.env ') || r.element.startsWith('CREDENTIAL_VAULT_KEY'));
  const ok = envRows.every((r) => r.ok);
  return { ok, failures: envRows.filter((r) => !r.ok) };
}

export function printFailures(failures) {
  for (const r of failures) console.error(`  ❌ ${r.element} — ${r.detail}${r.risk ? `  ⚠ ${r.risk}` : ''}`);
}

export { isReady };
