// tests/p1/rxRunOneCommandScripts.test.js
// RX-RUN-2 — Commande unique dev/deploy. Vérifie (sans lancer de serveur) : injection du flag React
// (dev/start = ON, --vanilla = OFF), URLs affichées, `build` inclut le build React, et AUCUN script run ne
// modifie le .env.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reactFlagFor, isVanilla, envWithReactFlag, launchUrls, resolvePort } from '../../scripts/run/lib.js';

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package.json'), 'utf8'));

describe('RX-RUN-2 — injection du flag React (pure)', () => {
  it('dev/start (sans --vanilla) → React ON', () => {
    expect(reactFlagFor([])).toBe('true');
    expect(envWithReactFlag({ NODE_ENV: 'development' }, []).REACT_OFFICIAL_FRONTEND).toBe('true');
  });
  it('--vanilla → React OFF (rollback)', () => {
    expect(isVanilla(['--vanilla'])).toBe(true);
    expect(reactFlagFor(['--vanilla'])).toBe('false');
    expect(envWithReactFlag({}, ['--vanilla']).REACT_OFFICIAL_FRONTEND).toBe('false');
  });
  it('envWithReactFlag ne mute pas l\'env de base et préserve NODE_ENV', () => {
    const base = { NODE_ENV: 'production', FOO: '1' };
    const out = envWithReactFlag(base, []);
    expect(out.NODE_ENV).toBe('production');
    expect(out.FOO).toBe('1');
    expect(base.REACT_OFFICIAL_FRONTEND).toBeUndefined(); // base intact
  });
  it('URLs affichées = /app /manager /api/site-status', () => {
    const urls = launchUrls(resolvePort({ PORT: '3000' }));
    expect(urls).toEqual(['http://localhost:3000/app', 'http://localhost:3000/manager', 'http://localhost:3000/api/site-status']);
  });
});

describe('RX-RUN-2 — package.json (commande unique)', () => {
  it('les commandes officielles existent et pointent vers scripts/run/*', () => {
    expect(pkg.scripts.dev).toBe('node scripts/run/dev.js');
    expect(pkg.scripts['dev:vanilla']).toBe('node scripts/run/dev.js --vanilla');
    expect(pkg.scripts.start).toBe('node scripts/run/start.js');
    expect(pkg.scripts['start:vanilla']).toBe('node scripts/run/start.js --vanilla');
    expect(pkg.scripts.build).toBe('node scripts/run/build.js');
    expect(pkg.scripts.check).toContain('checkLaunchReadiness');
    expect(pkg.scripts.verify).toContain('verifyParcours');
  });
  it('les anciennes commandes verbeuses (canary:*/vanilla:up) ont disparu', () => {
    for (const k of ['canary:up', 'canary:build', 'vanilla:up', 'check:launch', 'verify:parcours']) {
      expect(pkg.scripts[k]).toBeUndefined();
    }
  });
});

describe('RX-RUN-2 — sûreté des scripts run', () => {
  const files = ['lib.js', 'preflight.js', 'build.js', 'dev.js', 'start.js'].map((f) =>
    fs.readFileSync(path.join(BACKEND, 'scripts', 'run', f), 'utf8'),
  );
  it('aucun script run n\'écrit dans le .env', () => {
    for (const src of files) {
      expect(/writeFile|appendFile|writeFileSync|createWriteStream/.test(src) && /\.env/.test(src)).toBe(false);
    }
  });
  it('`build` inclut bien le build React', () => {
    const buildSrc = fs.readFileSync(path.join(BACKEND, 'scripts', 'run', 'build.js'), 'utf8');
    expect(buildSrc).toContain('react:build');
  });
  it('dev/start injectent le flag React (jamais via .env)', () => {
    const devSrc = fs.readFileSync(path.join(BACKEND, 'scripts', 'run', 'dev.js'), 'utf8');
    const startSrc = fs.readFileSync(path.join(BACKEND, 'scripts', 'run', 'start.js'), 'utf8');
    expect(devSrc).toContain('envWithReactFlag');
    expect(startSrc).toContain('REACT_OFFICIAL_FRONTEND');
  });
});
