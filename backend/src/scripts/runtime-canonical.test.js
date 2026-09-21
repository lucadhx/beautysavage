/*
 * RUNTIME CANONIQUE — il n'existe qu'UNE manière officielle de lancer le projet.
 *
 * Verrouille l'architecture des ports décidée après l'incident « deux managers » :
 *   backend 6100 · manager 6101 · vitrine 6102 — les 6060/6061 (ex-worktree
 *   feat/brevo) sont morts et ne doivent réapparaître dans AUCUN chemin de
 *   lancement (package.json racine, vite.config, .env.example, dev-canonical,
 *   défauts réseau du backend).
 *
 * Style promote.test.js : runner autonome, aucun framework, aucun serveur lancé.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NETWORK_DEFAULTS } from '../utils/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const read = (rel) => fs.readFile(path.join(ROOT, rel), 'utf8');

async function main() {
  /* -------- 1. Point d'entrée unique : package.json racine -------- */
  const rootPkg = JSON.parse(await read('package.json'));
  check('racine : npm run dev -> dev-canonical (seul lanceur officiel)',
    rootPkg.scripts?.dev === 'node scripts/dev-canonical.mjs');
  check('racine : npm run manager -> port 6101',
    /--port 6101/.test(rootPkg.scripts?.manager || ''));
  check('racine : npm run vitrine -> port 6102',
    /--port 6102/.test(rootPkg.scripts?.vitrine || ''));
  check('racine : npm run backend défini (backend seul, PORT du .env = 6100)',
    /--prefix backend/.test(rootPkg.scripts?.backend || ''));
  check('racine : aucun script ne référence 6060/6061',
    !JSON.stringify(rootPkg.scripts).match(/606[01]/));

  /* -------- 2. dev-canonical : ports par défaut + détection des morts -------- */
  const dev = await read('scripts/dev-canonical.mjs');
  check('dev-canonical : backend 6100 par défaut', dev.includes('BACKEND_PORT || 6100'));
  check('dev-canonical : manager 6101 par défaut', dev.includes('MANAGER_PORT || 6101'));
  check('dev-canonical : vitrine 6102 par défaut', dev.includes('VITRINE_PORT || 6102'));
  check('dev-canonical : 6060/6061 déclarés LEGACY (détection anciens serveurs)',
    /LEGACY_PORTS\s*=\s*\[6060,\s*6061\]/.test(dev));

  /* -------- 3. Vite : les fronts pointent le backend canonique -------- */
  const mgrVite = await read('manager/vite.config.ts');
  check('manager/vite : port 6101', /port:\s*6101/.test(mgrVite));
  check('manager/vite : proxy /api -> 6100', /'\/api':\s*'http:\/\/localhost:6100'/.test(mgrVite));
  check('manager/vite : aucune trace de 6060/6061', !/606[01]/.test(mgrVite));

  const vitVite = await read('vitrine/vite.config.ts');
  check('vitrine/vite : port 6102', /port:\s*6102/.test(vitVite));
  check('vitrine/vite : proxy /api -> 6100', /'\/api':\s*'http:\/\/localhost:6100'/.test(vitVite));
  check('vitrine/vite : aucune trace de 6060/6061', !/606[01]/.test(vitVite));

  /* -------- 4. backend/.env.example : régime canonique -------- */
  const envEx = await read('backend/.env.example');
  check('.env.example : PORT=6100', /^PORT=6100$/m.test(envEx));
  check('.env.example : CORS = manager 6101 + vitrine 6102',
    envEx.includes('CORS_ORIGINS=http://localhost:6101,http://localhost:6102'));
  check('.env.example : PUBLIC_URL=6100', envEx.includes('PUBLIC_URL=http://localhost:6100'));
  check('.env.example : plus de PORT/CORS/PUBLIC_URL en 6060/6061',
    !/^(PORT|CORS_ORIGINS|PUBLIC_URL)=.*606[01]/m.test(envEx));

  /* -------- 5. Fronts : VITE_API_URL ne doit PAS être actif par défaut -------- */
  for (const app of ['manager', 'vitrine']) {
    const fe = await read(`${app}/.env.example`);
    check(`${app}/.env.example : VITE_API_URL commenté (même origine via proxy)`,
      !/^VITE_API_URL=/m.test(fe));
  }

  /* -------- 6. Défauts réseau du backend (SystemConfiguration) -------- */
  check('NETWORK_DEFAULTS.backendUrl = 6100', NETWORK_DEFAULTS.backendUrl === 'http://localhost:6100');
  check('NETWORK_DEFAULTS.managerUrl = 6101', NETWORK_DEFAULTS.managerUrl === 'http://localhost:6101');
  check('NETWORK_DEFAULTS.websiteUrl = 6102', NETWORK_DEFAULTS.websiteUrl === 'http://localhost:6102');

  /* -------- 7. README : le démarrage documenté est le canonique -------- */
  const readme = await read('README.md');
  check('README : npm run dev (racine) documenté', readme.includes('npm run dev'));
  check('README : ports canoniques 6100/6101 documentés',
    readme.includes('6100') && readme.includes('6101'));
  const quickstart = readme.split('## Démarrage rapide')[1]?.split('\n## ')[0] || '';
  check('README : le démarrage rapide ne pointe plus vers http://localhost:6060/6061',
    !quickstart.includes('http://localhost:6060') && !quickstart.includes('http://localhost:6061'));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
