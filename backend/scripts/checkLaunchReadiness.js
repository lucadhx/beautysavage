// RX-RUN — Préflight de lancement (OFFLINE, lecture seule, aucune mutation). Vérifie les prérequis
// techniques AVANT de démarrer le serveur : variables .env obligatoires, builds React présents, flags de
// bascule. N'accède PAS à la base (les seeds/données se vérifient sur serveur lancé via verifyParcours.js).
//
// Usage :
//   node scripts/checkLaunchReadiness.js            # mode courant (.env réel)
//   node scripts/checkLaunchReadiness.js --canary   # exige REACT_OFFICIAL_FRONTEND=true
import 'dotenv/config'; // lit le .env réel (comme app.js), pour un préflight fidèle.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..');

const REQUIRED_ENV = ['MONGODB_URI', 'SESSION_SECRET', 'PWD_PEPPER', 'CREDENTIAL_VAULT_KEY'];

/**
 * Évalue la préparation au lancement à partir d'un environnement + de la présence des builds.
 * PURE (testable) : ne lit ni fichiers ni process.
 * @param {Record<string,string|undefined>} env
 * @param {{ vitrineBuilt:boolean, managerBuilt:boolean, canary?:boolean }} facts
 * @returns {{ element:string, ok:boolean, detail:string, risk:string }[]}
 */
export function evaluateReadiness(env, facts) {
  const rows = [];
  for (const key of REQUIRED_ENV) {
    const val = String(env[key] || '').trim();
    const placeholder = /^<.*>$/.test(val) || val === '';
    rows.push({
      element: `.env ${key}`,
      ok: !placeholder,
      detail: placeholder ? 'absente ou placeholder' : 'définie',
      risk: placeholder ? 'Le process NE DÉMARRE PAS.' : '',
    });
  }
  const vaultHex = String(env.CREDENTIAL_VAULT_KEY || '').trim();
  rows.push({
    element: 'CREDENTIAL_VAULT_KEY format',
    ok: /^[0-9a-fA-F]{64}$/.test(vaultHex),
    detail: /^[0-9a-fA-F]{64}$/.test(vaultHex) ? '64 hex (32 octets)' : 'doit être 64 caractères hexadécimaux',
    risk: 'Coffre IntegratedAPI invalide → refus de boot.',
  });
  rows.push({ element: 'Build React vitrine (dist)', ok: facts.vitrineBuilt, detail: facts.vitrineBuilt ? 'présent' : 'absent', risk: '/app → 503 (npm run react:build).' });
  rows.push({ element: 'Build React manager (dist)', ok: facts.managerBuilt, detail: facts.managerBuilt ? 'présent' : 'absent', risk: '/manager → 503 (npm run react:build).' });

  // Le flag est INFORMATIF : le canary est activé par le lanceur (`npm run canary:up`), pas par le .env.
  // Le vrai prérequis canary = builds présents (lignes ci-dessus). On n'échoue donc jamais sur le flag.
  const flag = String(env.REACT_OFFICIAL_FRONTEND || '').trim().toLowerCase();
  rows.push({
    element: 'REACT_OFFICIAL_FRONTEND',
    ok: true,
    detail: flag === 'true'
      ? 'ON (React officiel)'
      : facts.canary ? 'OFF dans .env — sera activé par `npm run canary:up`' : 'OFF/absent (Vanilla, défaut)',
    risk: '',
  });
  return rows;
}

export function isReady(rows) {
  return rows.every((r) => r.ok);
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function distIndex(app) {
  return fs.existsSync(path.join(REPO, 'frontend-react', 'apps', app, 'dist', 'index.html'));
}

function main() {
  const canary = process.argv.includes('--canary');
  const rows = evaluateReadiness(process.env, {
    vitrineBuilt: distIndex('vitrine'),
    managerBuilt: distIndex('manager'),
    canary,
  });
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\nRX-RUN — Préflight de lancement${canary ? ' (mode CANARY)' : ''}\n`);
  console.log(`${pad('Élément', 34)} ${pad('Statut', 8)} Détail`);
  console.log('-'.repeat(80));
  for (const r of rows) {
    console.log(`${pad(r.element, 34)} ${pad(r.ok ? '✅ OK' : '❌ KO', 8)} ${r.detail}${r.ok ? '' : `  ⚠ ${r.risk}`}`);
  }
  const ready = isReady(rows);
  console.log('-'.repeat(80));
  console.log(ready ? '\n✅ Prêt à lancer.\n' : '\n❌ Non prêt — corrigez les lignes KO ci-dessus.\n');
  process.exit(ready ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
