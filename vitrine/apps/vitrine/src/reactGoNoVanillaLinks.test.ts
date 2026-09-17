// RX-GO — Garde anti-régression : aucune route React migrée ne doit référencer une page Vanilla
// (vitrine.html / gestion.html / admin.html) ni un préfixe de basename en dur (/app/ /manager/ dans un
// `to=`/`navigate(`). Verrouille l'état « prêt à basculer » vérifié à l'audit RX-GO.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)); // apps/vitrine/src
const FRONTEND_ROOT = path.resolve(HERE, '..', '..', '..'); // frontend-react
const SCAN_DIRS = [
  path.join(FRONTEND_ROOT, 'apps', 'vitrine', 'src'),
  path.join(FRONTEND_ROOT, 'apps', 'manager', 'src'),
  path.join(FRONTEND_ROOT, 'packages'),
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = SCAN_DIRS.filter((d) => fs.existsSync(d)).flatMap(walk);

describe('RX-GO — aucun lien Vanilla dans les routes React', () => {
  it('aucune référence à vitrine.html / gestion.html / admin.html', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const src = fs.readFileSync(file, 'utf8');
      if (/vitrine\.html|gestion\.html|admin\.html/.test(src)) {
        offenders.push(path.relative(FRONTEND_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('aucun préfixe /app/ ou /manager/ en dur dans un to=/navigate( (double-basename)', () => {
    const offenders: string[] = [];
    // Cible les usages de routing : to="/app/…", navigate('/app/…'), to="/manager/…", navigate('/manager/…').
    const re = /(to=|navigate\(|<Navigate\s+to=)\s*["'`]\/(app|manager)\//;
    for (const file of FILES) {
      const src = fs.readFileSync(file, 'utf8');
      if (re.test(src)) offenders.push(path.relative(FRONTEND_ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('le scan couvre bien les sources (garde-fou : liste non vide)', () => {
    expect(FILES.length).toBeGreaterThan(50);
  });
});
