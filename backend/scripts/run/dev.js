// RX-RUN-2 — `npm run dev` : LA commande officielle de développement. React officiel ON (injecté ici, PAS
// dans le .env). Stratégie Option A (parité déploiement) : Express sert les builds React sous /app /manager.
//   1. préflight env ; 2. build React si `dist` absent (auto) ; 3. affiche les URLs ; 4. nodemon backend.
// Rollback : `npm run dev:vanilla`. Hot reload React : `npm run dev:vite`.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { envReady, printFailures } from './preflight.js';
import { isVanilla, envWithReactFlag, resolvePort, banner } from './lib.js';

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const distIndex = (app) => fs.existsSync(path.join(BACKEND, 'frontend-react', 'apps', app, 'dist', 'index.html'));

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: BACKEND, stdio: 'inherit', shell: true, env });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} → code ${code}`))));
    child.on('error', reject);
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const vanilla = isVanilla(argv);

  const env0 = envReady();
  if (!env0.ok) {
    console.error('\n❌ Variables .env obligatoires manquantes — dev interrompu :');
    printFailures(env0.failures);
    process.exit(1);
  }

  // Build auto si un des builds React manque (Option A : Express sert les builds).
  if (!distIndex('vitrine') || !distIndex('manager')) {
    console.log('[dev] Build React absent → build automatique…');
    await run('npm', ['run', 'react:build'], process.env);
  } else {
    console.log('[dev] Builds React présents (rebuild : `npm run build` · hot reload : `npm run dev:vite`).');
  }

  const port = resolvePort(process.env);
  console.log(banner({ mode: vanilla ? 'vanilla' : 'react', port }));

  // Backend en watch (nodemon) avec le flag injecté. Le flag est lu dynamiquement par requête.
  const env = envWithReactFlag(process.env, argv);
  const child = spawn('nodemon', ['app.js'], { cwd: BACKEND, stdio: 'inherit', shell: true, env });
  child.on('exit', (code) => process.exit(code ?? 0));
  const stop = () => child.kill();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => { console.error(`\n❌ Dev échoué : ${err.message}\n`); process.exit(1); });
