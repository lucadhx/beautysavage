// tests/p0/security.logging.test.js
// P0 (Phase 1A — FIXED): a debug log used to print the public refund tracking
// token (and the full tracking URL + client email) to stdout. This static guard
// fails if any console.* call in the backend source references `trackingToken`,
// preventing a regression.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCAN_DIRS = ['controllers', 'services', 'routers', 'automatisme'];

// Matches a console.(log|warn|error)( ... trackingToken ... ) within a bounded
// window (covers multi-line objects without spanning unrelated statements).
const OFFENDING_PATTERN = /console\.(log|warn|error)\s*\([\s\S]{0,400}?trackingToken/;

function collectJsFiles(dir) {
  const base = path.join(ROOT, dir);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { recursive: true })
    .map(String)
    .filter(name => name.endsWith('.js'))
    .map(name => ({ rel: `${dir}/${name}`, abs: path.join(base, name) }));
}

describe('P0 — no console.* logging of refund tracking tokens', () => {
  it('source backend code never logs `trackingToken` via console.*', () => {
    const offenders = [];
    for (const dir of SCAN_DIRS) {
      for (const file of collectJsFiles(dir)) {
        const content = fs.readFileSync(file.abs, 'utf8');
        if (OFFENDING_PATTERN.test(content)) {
          offenders.push(file.rel);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
