#!/usr/bin/env node
// RX-BLOCKER-2-FINAL — Orchestrateur de validation SÉQUENTIEL et FAIL-FAST.
//
// Pourquoi : sur cette machine (Windows), lancer la suite backend complète ET la suite frontend
// (test+lint+build) EN PARALLÈLE sature les processus → « Worker exited unexpectedly » (tinypool) puis
// « fork: Resource temporarily unavailable ». Ce script exécute chaque étape L'UNE APRÈS L'AUTRE, affiche un
// en-tête [i/N] + un pied PASS/FAIL avec la durée, et s'arrête à la première étape rouge (fail-fast).
//
// Il ne fait que RÉUTILISER les scripts npm existants (ou des invocations vitest ciblées) — aucune logique
// métier, aucun test désactivé. Modes :
//   node scripts/run/runReleaseChecks.js release        → suite complète (8 étapes)
//   node scripts/run/runReleaseChecks.js quick          → boucle rapide (ciblé RX-BLOCKER-2 + p0 + lint)
//   node scripts/run/runReleaseChecks.js rx-blocker-2   → uniquement les tests RX-BLOCKER-2 (backend+front)
//   node scripts/run/runReleaseChecks.js perf           → mesure la durée de chaque étape release (NON fail-fast)
import { spawnSync } from 'node:child_process';

const RX2_BACKEND =
  'npx vitest run tests/p1/managerUsersInvitation.test.js tests/p1/authMailSenderRouting.test.js tests/p1/managerPasswordResetRouting.test.js';
const RX2_FRONTEND =
  'npm --prefix frontend-react run test -- apps/manager/src/features/managerUsers/managerUsers.test.tsx apps/manager/src/pages/managerAuthPages.test.tsx';

const SUITES = {
  release: [
    ['Backend p0', 'npm run test:p0'],
    ['Backend p1', 'npm run test:p1'],
    ['Integration', 'npm run test:integration'],
    ['Business audit', 'npm run audit:business-scenarios'],
    ['Commissions audit', 'npm run audit:commissions'],
    ['React tests', 'npm run react:test'],
    ['React lint', 'npm run react:lint'],
    ['React build', 'npm run react:build'],
  ],
  quick: [
    ['RX-BLOCKER-2 backend', RX2_BACKEND],
    ['RX-BLOCKER-2 frontend', RX2_FRONTEND],
    ['Backend p0', 'npm run test:p0'],
    ['React lint', 'npm run react:lint'],
  ],
  'rx-blocker-2': [
    ['RX-BLOCKER-2 backend', RX2_BACKEND],
    ['RX-BLOCKER-2 frontend', RX2_FRONTEND],
  ],
};
// perf = mêmes étapes que release, mais mesure tout sans fail-fast.
SUITES.perf = SUITES.release;

const mode = (process.argv[2] || 'release').toLowerCase();
const steps = SUITES[mode];
if (!steps) {
  console.error(`Mode inconnu: "${mode}". Attendu: ${Object.keys(SUITES).join(' | ')}`);
  process.exit(2);
}
const failFast = mode !== 'perf';

function hms(ms) {
  const s = Math.round(ms / 100) / 10;
  return s >= 60 ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s` : `${s}s`;
}
function clock() {
  return new Date().toTimeString().slice(0, 8);
}

console.log(`\n=== runReleaseChecks [${mode}] — ${steps.length} étape(s), ${failFast ? 'fail-fast' : 'mesure complète'} ===\n`);

const results = [];
let failed = false;
for (let i = 0; i < steps.length; i++) {
  const [label, cmd] = steps[i];
  const tag = `[${i + 1}/${steps.length}] ${label}`;
  console.log(`\n${tag} — démarré ${clock()}`);
  console.log(`      $ ${cmd}`);
  const started = Date.now();
  const res = spawnSync(cmd, { stdio: 'inherit', shell: true });
  const dur = Date.now() - started;
  const ok = res.status === 0;
  results.push({ label, ok, dur, code: res.status });
  console.log(`${tag} — ${ok ? 'PASS' : `FAIL (exit ${res.status})`} en ${hms(dur)}`);
  if (!ok) {
    failed = true;
    if (failFast) break;
  }
}

const total = results.reduce((a, r) => a + r.dur, 0);
console.log(`\n=== Récapitulatif [${mode}] ===`);
for (const r of results) {
  console.log(`  ${r.ok ? '✓' : '✗'}  ${r.label.padEnd(24)} ${hms(r.dur).padStart(8)}${r.ok ? '' : `   (exit ${r.code})`}`);
}
console.log(`  ${'—'.repeat(36)}`);
console.log(`     ${'TOTAL'.padEnd(24)} ${hms(total).padStart(8)}`);
if (failed && failFast) {
  const skipped = steps.length - results.length;
  if (skipped > 0) console.log(`  (fail-fast : ${skipped} étape(s) non exécutée(s))`);
}

process.exit(failed ? 1 : 0);
