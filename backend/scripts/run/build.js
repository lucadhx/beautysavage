// RX-RUN-2 — `npm run build` : vérifie l'env minimal puis build les deux SPA React. Utilisé aussi en
// déploiement (npm install → npm run build → npm start). Ne modifie ni .env ni la base.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { envReady, printFailures } from './preflight.js';

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: BACKEND, stdio: 'inherit', shell: true });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} → code ${code}`))));
    child.on('error', reject);
  });
}

async function main() {
  const env = envReady();
  if (!env.ok) {
    console.error('\n❌ Variables .env obligatoires manquantes — build interrompu :');
    printFailures(env.failures);
    process.exit(1);
  }
  console.log('\n[build] Build des SPA React (vitrine + manager)…');
  await run('npm', ['run', 'react:build']);
  console.log('\n✅ Build terminé. Déploiement : `npm start` (React officiel).\n');
}

main().catch((err) => { console.error(`\n❌ Build échoué : ${err.message}\n`); process.exit(1); });
