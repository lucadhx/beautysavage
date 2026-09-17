// RX-RUN-2 — `npm start` : boot de DÉPLOIEMENT (React officiel ON, injecté ici — pas dans le .env). Parité
// totale avec `npm run dev`. Mono-process : pose le flag puis importe app.js (signaux natifs du host).
// Rollback prod : `npm run start:vanilla`. Prérequis : `npm run build` fait (dist présents).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { envReady, printFailures } from './preflight.js';
import { isVanilla, reactFlagFor, resolvePort, banner } from './lib.js';

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const distIndex = (app) => fs.existsSync(path.join(BACKEND, 'frontend-react', 'apps', app, 'dist', 'index.html'));

async function main() {
  const argv = process.argv.slice(2);
  const vanilla = isVanilla(argv);

  const env0 = envReady();
  if (!env0.ok) {
    console.error('\n❌ Variables .env obligatoires manquantes — démarrage interrompu :');
    printFailures(env0.failures);
    process.exit(1);
  }
  if (!distIndex('vitrine') || !distIndex('manager')) {
    console.error('\n❌ Builds React absents. Lancez d\'abord : `npm run build`.\n');
    process.exit(1);
  }

  // Injection du flag (jamais dans le .env) — lu dynamiquement par app.js à chaque requête.
  process.env.REACT_OFFICIAL_FRONTEND = reactFlagFor(argv);
  console.log(banner({ mode: vanilla ? 'vanilla' : 'react', port: resolvePort(process.env) }));

  await import('../../app.js');
}

main().catch((err) => { console.error(`\n❌ Démarrage échoué : ${err.message}\n`); process.exit(1); });
